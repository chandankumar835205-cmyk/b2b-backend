// src/routes/orderRoutes.ts
import express from "express";
import Order from "../models/Order";
import Product from "../models/Product";

import User from "../models/User";
import { generateInvoicePDF } from "../utils/invoiceGenerator";
import { sendSmsNotification } from "../utils/notificationService";

import {
  protect,
  AuthRequest,
  blockCheck,       // ⭐ ADDED
  authorize         // ⭐ ADDED (you were using authorize but had not imported it)
} from "../middleware/authMiddleware";

import mongoose from "mongoose";

const router = express.Router();

/* -----------------------------------------------------------
   POST /orders - Create MULTIPLE ORDERS (1 per factory)
----------------------------------------------------------- */
router.post("/", protect, blockCheck, authorize("shop"), async (req: AuthRequest, res) => {
  // ⭐ blockCheck added → blocked shop cannot place orders
  try {
    const { items, payment_method } = req.body;

    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ detail: "No items provided" });
    }

    // Step 1: Fetch all products and attach product + factory info
    const enrichedItems: any[] = [];

    for (const item of items) {
      if (!item?.product_id || !item?.quantity) {
        return res.status(400).json({ detail: "Invalid item structure" });
      }

      if (!mongoose.Types.ObjectId.isValid(item.product_id)) {
        return res.status(400).json({ detail: `Invalid product id: ${item.product_id}` });
      }

      const product = await Product.findById(item.product_id).populate("factory_id");
      if (!product) return res.status(404).json({ detail: "Product not found" });

      if (product.stock_quantity < item.quantity) {
        return res.status(400).json({ detail: `${product.name} - insufficient stock` });
      }

      const factory: any = product.factory_id;
      if (!factory) {
        return res.status(500).json({ detail: `Product ${product._id} missing factory info` });
      }

      enrichedItems.push({
        product_id: product._id,
        name: product.name,
        price: product.price,
        quantity: item.quantity,
        image_url: product.images?.[0] || "",
        factory_id: factory._id,
        seller_details: {
          name: factory.full_name || factory.email || "Factory",
          email: factory.email || "",
          phone: factory.phone || "",
          address: factory.address_line_1 || "",
          gstin: factory.gstin || ""
        }
      });
    }

    // Step 2: GROUP ITEMS BY FACTORY
    const factoryGroups: Record<string, any[]> = {};
    enrichedItems.forEach((it) => {
      const fId = it.factory_id.toString();
      if (!factoryGroups[fId]) factoryGroups[fId] = [];
      factoryGroups[fId].push(it);
    });

    // Step 3: Create separate orders per factory
    const createdOrders: any[] = [];

    for (const factoryId of Object.keys(factoryGroups)) {
      const itemsForFactory = factoryGroups[factoryId];

      let totalAmount = 0;
      itemsForFactory.forEach((i) => {
        totalAmount += Number(i.price) * Number(i.quantity);
      });

      const order = await Order.create({
        shop_id: req.user._id,
        factory_id: new mongoose.Types.ObjectId(factoryId),
        items: itemsForFactory,
        total_amount: totalAmount,
        payment_method,
        payment_status: "pending",
        status: "pending"
      });

      createdOrders.push(order);

      for (const it of itemsForFactory) {
        await Product.findByIdAndUpdate(it.product_id, { $inc: { stock_quantity: -it.quantity } });
      }

      const shopUser = await User.findById(req.user._id);
      if (shopUser?.phone) {
        sendSmsNotification(
          shopUser.phone,
          `Order #${order._id.toString().slice(-6)} placed successfully!`
        );
      }
    }

    return res.status(201).json({
      message: "Orders created successfully",
      orders: createdOrders
    });

  } catch (error) {
    console.error("Order Creation Error:", error);
    return res.status(500).json({ detail: (error as Error).message });
  }
});

/* -----------------------------------------------------------
   GET /orders - Works for shop & factory
----------------------------------------------------------- */
router.get("/", protect, blockCheck, async (req: AuthRequest, res) => {
  // ⭐ Blocked users cannot view orders
  try {
    const query: any = {};

    if (req.user.role === "shop") {
      query.shop_id = req.user._id;
    } else if (req.user.role === "factory") {
      query.factory_id = req.user._id;
    }

    const orders = await Order.find(query)
      .populate("shop_id", "full_name email phone address_line_1 city district state pincode")
      .sort({ createdAt: -1 });

    return res.json(orders);
  } catch (error) {
    console.error("Orders Fetch Error:", error);
    return res.status(500).json({ detail: (error as Error).message });
  }
});

/* -----------------------------------------------------------
   GET SINGLE ORDER
----------------------------------------------------------- */
router.get("/:id", protect, blockCheck, async (req: AuthRequest, res) => {
  // ⭐ Blocked users cannot view single order
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ detail: "Invalid ID" });
    }

    const order = await Order.findById(req.params.id)
      .populate("shop_id", "full_name email phone address_line_1 city district state pincode");

    if (!order) return res.status(404).json({ detail: "Order not found" });

    if (req.user.role === "shop" && order.shop_id._id.toString() !== req.user._id.toString()) {
      return res.status(403).json({ detail: "Unauthorized" });
    }
    if (req.user.role === "factory" && order.factory_id?.toString() !== req.user._id.toString()) {
      return res.status(403).json({ detail: "Unauthorized" });
    }

    return res.json(order);
  } catch (error) {
    console.error("Single Order Error:", error);
    return res.status(500).json({ detail: (error as Error).message });
  }
});

/* -----------------------------------------------------------
   DOWNLOAD INVOICE
----------------------------------------------------------- */
router.get("/:id/invoice", protect, blockCheck, authorize("admin", "factory", "shop"), async (req: AuthRequest, res) => {
  // ⭐ Blocked users cannot download invoices
  try {
    const order = await Order.findById(req.params.id)
      .populate("shop_id", "full_name email address_line_1 city district state pincode phone");

    if (!order) return res.status(404).json({ detail: "Order not found" });

    if (req.user.role === "factory" && order.factory_id?.toString() !== req.user._id.toString()) {
      return res.status(403).json({ detail: "Not authorized to view this invoice" });
    }

    generateInvoicePDF(order, res);
  } catch (err) {
    console.error("Invoice Error:", err);
    return res.status(500).json({ detail: "Internal Server Error" });
  }
});

/* -----------------------------------------------------------
   UPDATE ORDER STATUS
----------------------------------------------------------- */
router.put("/:id/status", protect, blockCheck, authorize("admin", "factory"), async (req: AuthRequest, res) => {
  // ⭐ Blocked factories/admin cannot update order status
  try {
    const { status } = req.body;
    const order = await Order.findById(req.params.id);
    if (!order) return res.status(404).json({ detail: "Order not found" });

    order.status = status;
    await order.save();
    return res.json(order);
  } catch (error) {
    console.error("Order Status Update Error:", error);
    return res.status(500).json({ detail: (error as Error).message });
  }
});

export default router;
