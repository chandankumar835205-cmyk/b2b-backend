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
  blockCheck,
  authorize
} from "../middleware/authMiddleware";
import mongoose from "mongoose";

const router = express.Router();

/* -----------------------------------------------------------
   POST /orders - Create MULTIPLE ORDERS (COD only)
   NOTE: Prepaid (payment_method === "Prepaid") will NOT create DB orders here.
         For prepaid flows, use /payments/initiate-group and /payments/verify-group.
----------------------------------------------------------- */
router.post("/", protect, blockCheck, authorize("shop"), async (req: AuthRequest, res) => {
  try {
    const { items, payment_method } = req.body;

    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ detail: "No items provided" });
    }

    // If prepaid, do not create DB orders here. Return prepared summary so frontend can initiate payment.
    if (String(payment_method).toLowerCase() === "prepaid") {
      // Enrich items and compute grouping/amount similar to COD logic
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
        enrichedItems.push({
          product_id: product._id,
          name: product.name,
          price: product.price,
          quantity: item.quantity,
          image_url: product.images?.[0] || "",
          factory_id: factory?._id,
          seller_details: {
            name: factory?.full_name || factory?.email || "Factory",
            email: factory?.email || "",
            phone: factory?.phone || "",
            address: factory?.address_line_1 || "",
            gstin: factory?.gstin || ""
          }
        });
      }

      // Group items by factory and compute totals
      const factoryGroups: Record<string, any[]> = {};
      enrichedItems.forEach((it) => {
        const fId = it.factory_id?.toString() || "unknown";
        if (!factoryGroups[fId]) factoryGroups[fId] = [];
        factoryGroups[fId].push(it);
      });

      const previewOrders: any[] = [];
      Object.keys(factoryGroups).forEach((fid) => {
        const arr = factoryGroups[fid];
        let totalAmount = 0;
        arr.forEach((i) => (totalAmount += Number(i.price) * Number(i.quantity)));
        previewOrders.push({
          factory_id: fid === "unknown" ? null : fid,
          items: arr,
          total_amount: totalAmount,
          payment_method,
        });
      });

      // Return the prepared grouped order preview (frontend should call /payments/initiate-group with items)
      return res.json({
        status: "PREPAID_PREVIEW",
        previewOrders,
      });
    }

    // ---------- COD flow: create DB orders immediately ----------
    // Step 1: Fetch all products and attach product + factory info (re-validate server-side)
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

    // Group by factory
    const factoryGroups: Record<string, any[]> = {};
    enrichedItems.forEach((it) => {
      const fId = it.factory_id.toString();
      if (!factoryGroups[fId]) factoryGroups[fId] = [];
      factoryGroups[fId].push(it);
    });

    // Create orders per factory
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

      // decrement stock
      for (const it of itemsForFactory) {
        try {
          await Product.findByIdAndUpdate(it.product_id, { $inc: { stock_quantity: -it.quantity } });
        } catch (stockErr) {
          console.warn("Stock update failed for", it.product_id, stockErr);
        }
      }

      // send SMS
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
   POST /orders/cancel-group - Best-effort cancel (idempotent)
----------------------------------------------------------- */
router.post("/cancel-group", protect, async (req: AuthRequest, res) => {
  try {
    const { order_ids } = req.body;
    if (!Array.isArray(order_ids) || order_ids.length === 0) {
      return res.status(400).json({ detail: "order_ids array is required" });
    }

    const validIds = order_ids.filter((id: any) => mongoose.Types.ObjectId.isValid(id));
    if (validIds.length === 0) {
      return res.status(400).json({ detail: "No valid order IDs provided" });
    }

    const query: any = { _id: { $in: validIds } };
    if (req.user.role === "shop") {
      query.shop_id = req.user._id;
    }

    const orders = await Order.find(query);
    if (!orders || orders.length === 0) {
      return res.status(404).json({ detail: "No matching orders found for cancellation" });
    }

    const cancelled: string[] = [];
    const skipped: string[] = [];
    const errors: { id: string; error: string }[] = [];

    for (const ord of orders) {
      try {
        if (String(ord.payment_status) !== "pending" && String(ord.status) !== "pending") {
          skipped.push(ord._id.toString());
          continue;
        }

        ord.payment_status = "failed";
        ord.status = "cancelled";
        (ord as any).cancelledAt = new Date();
        (ord as any).cancelledBy = {
          id: req.user._id,
          role: req.user.role,
        };

        for (const it of ord.items || []) {
          try {
            if (it?.product_id && mongoose.Types.ObjectId.isValid(String(it.product_id))) {
              await Product.findByIdAndUpdate(it.product_id, { $inc: { stock_quantity: Number(it.quantity) || 0 } });
            }
          } catch (stockErr) {
            console.warn(`Failed to restore stock for product ${it?.product_id}:`, stockErr);
          }
        }

        await ord.save();
        cancelled.push(ord._id.toString());
      } catch (innerErr: any) {
        console.error("Error cancelling order", ord._id, innerErr);
        errors.push({ id: ord._id.toString(), error: (innerErr as Error).message });
      }
    }

    return res.json({ message: "Cancel group processed", cancelled, skipped, errors });
  } catch (err: any) {
    console.error("cancel-group ERROR:", err);
    return res.status(500).json({ detail: err.message || "Internal Server Error" });
  }
});

/* -----------------------------------------------------------
   GET /orders - Works for shop & factory
----------------------------------------------------------- */
router.get("/", protect, blockCheck, async (req: AuthRequest, res) => {
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
