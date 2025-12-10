// src/routes/paymentRoutes.ts
import express from "express";
import Razorpay from "razorpay";
import crypto from "crypto";
import Order from "../models/Order";
import Product from "../models/Product";
import User from "../models/User";
import { protect, AuthRequest } from "../middleware/authMiddleware";
import mongoose from "mongoose";
import { sendSmsNotification } from "../utils/notificationService";

const router = express.Router();

// Razorpay Initialization
const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID || "",
  key_secret: process.env.RAZORPAY_KEY_SECRET || "",
});

/* ----------------------------------------------------------------
   POST /payments/initiate-group
------------------------------------------------------------------*/
router.post("/initiate-group", protect, async (req: AuthRequest, res) => {
  try {
    const { order_ids, items } = req.body;

    // LEGACY: if order_ids provided -> compute total from DB orders
    if (Array.isArray(order_ids) && order_ids.length > 0) {
      const orders = await Order.find({ _id: { $in: order_ids } });
      if (orders.length === 0) {
        return res.status(404).json({ detail: "Orders not found" });
      }
      const totalAmount = orders.reduce((sum, o) => sum + (o.total_amount || 0), 0);
      const amountInPaisa = Math.round(totalAmount * 100);

      const options = {
        amount: amountInPaisa,
        currency: "INR",
        receipt: "grp_" + Date.now(),
        notes: { group_order_ids: JSON.stringify(order_ids) },
      };

      const razorpayOrder = await razorpay.orders.create(options);
      await Order.updateMany({ _id: { $in: order_ids } }, { $set: { razorpay_order_id: razorpayOrder.id } });

      return res.json(razorpayOrder);
    }

    // NEW: Prepaid Item Flow (Validates Unit Stock & Price)
    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ detail: "items array is required for prepaid flow" });
    }

    const enrichedItems: any[] = [];
    
    // Process items similarly to orderRoutes
    for (const item of items) {
       let realProductId = item.product_id;
       let unitName = null;

       if (item.product_id.length > 24 && item.product_id.includes("-")) {
           realProductId = item.product_id.substring(0, 24);
           unitName = decodeURIComponent(item.product_id.substring(25)); 
       }

       if (!mongoose.Types.ObjectId.isValid(realProductId)) {
          return res.status(400).json({ detail: `Invalid product id: ${item.product_id}` });
       }

       const product = await Product.findById(realProductId).populate("factory_id");
       if (!product) return res.status(404).json({ detail: "Product not found" });

       let targetUnit: any = null;
       let finalPrice = 0;

       if (product.selling_units && product.selling_units.length > 0) {
            if (unitName) {
                targetUnit = product.selling_units.find((u: any) => u.unit_name === unitName);
            } else {
                targetUnit = product.selling_units[0]; 
            }

            if (!targetUnit) return res.status(400).json({ detail: `Unit '${unitName}' not found for ${product.name}` });

            if (targetUnit.unit_stock < item.quantity) {
                return res.status(400).json({ detail: `${product.name} (${targetUnit.unit_name}) - insufficient stock.` });
            }

            const commission = product.commission_rate || 0;
            const basePrice = targetUnit.factory_unit_price;
            finalPrice = Math.ceil(basePrice * (1 + commission / 100));

       } else {
           return res.status(400).json({ detail: `Product ${product.name} configuration error (no units)` });
       }

       const factory: any = product.factory_id;
       enrichedItems.push({
        product_id: product._id.toString(),
        name: `${product.name} (${targetUnit.unit_name})`,
        unit_name: targetUnit.unit_name, 
        price: finalPrice,
        quantity: item.quantity,
        image_url: product.images?.[0] || "",
        factory_id: factory?._id ? factory._id.toString() : null,
      });
    }

    const totalAmount = enrichedItems.reduce((sum, it) => sum + Number(it.price) * Number(it.quantity), 0);
    const amountInPaisa = Math.round(totalAmount * 100);

    const options = {
      amount: amountInPaisa,
      currency: "INR",
      receipt: "grp_" + Date.now(),
      notes: {
        prepaid_items: JSON.stringify(enrichedItems),
      },
    };

    const razorpayOrder = await razorpay.orders.create(options);
    return res.json(razorpayOrder);
  } catch (err) {
    console.error("initiate-group ERROR:", err);
    return res.status(500).json({ detail: (err as Error).message });
  }
});

/* ----------------------------------------------------------------
   POST /payments/verify-group
------------------------------------------------------------------*/
router.post("/verify-group", protect, async (req: AuthRequest, res) => {
  try {
    const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body;
    
    const body = razorpay_order_id + "|" + razorpay_payment_id;
    const expectedSignature = crypto.createHmac("sha256", process.env.RAZORPAY_KEY_SECRET || "")
      .update(body.toString())
      .digest("hex");

    if (expectedSignature !== razorpay_signature) {
      return res.status(400).json({ detail: "Invalid payment signature" });
    }

    const razorOrder = await razorpay.orders.fetch(razorpay_order_id);
    let orderIds: string[] = [];
    let prepaidItems: any[] = [];
    
    try { orderIds = JSON.parse(String(razorOrder.notes?.group_order_ids || "[]")); } catch (e) {}
    try { prepaidItems = JSON.parse(String(razorOrder.notes?.prepaid_items || "[]")); } catch (e) {}

    // CASE A: Legacy
    if (orderIds.length > 0) {
      await Order.updateMany(
        { _id: { $in: orderIds } },
        { $set: { payment_status: "paid", status: "processing", razorpay_payment_id, razorpay_signature } }
      );
      return res.json({ status: "success", order_ids: orderIds });
    }

    // CASE B: New Prepaid Flow
    if (prepaidItems.length > 0) {
      const factoryGroups: Record<string, any[]> = {};
      for (const it of prepaidItems) {
        const f = it.factory_id ? String(it.factory_id) : "unknown";
        if (!factoryGroups[f]) factoryGroups[f] = [];
        factoryGroups[f].push(it);
      }

      const createdOrderIds: string[] = [];

      try {
        for (const factoryId of Object.keys(factoryGroups)) {
          const itemsForFactory = factoryGroups[factoryId];
          let totalAmount = 0;
          for (const it of itemsForFactory) {
            totalAmount += Number(it.price) * Number(it.quantity);
          }

          // ⭐ FIX: Cast the input object to 'any' to suppress the strict Type Overload Error
          const orderPayload: any = {
            shop_id: req.user._id,
            factory_id: mongoose.Types.ObjectId.isValid(factoryId) ? new mongoose.Types.ObjectId(factoryId) : null,
            items: itemsForFactory,
            total_amount: totalAmount,
            payment_method: "Prepaid",
            payment_status: "paid",
            status: "processing",
            razorpay_order_id,
            razorpay_payment_id,
            razorpay_signature,
          };

          const order = await Order.create(orderPayload) as any;
          
          createdOrderIds.push(order._id.toString());

          // Deduct Stock
          for (const it of itemsForFactory) {
            try {
              if (it.unit_name) {
                  await Product.findOneAndUpdate(
                    { 
                      _id: it.product_id, 
                      "selling_units.unit_name": it.unit_name 
                    },
                    { 
                      $inc: { "selling_units.$.unit_stock": -(Number(it.quantity) || 0) } 
                    }
                  );
              }
            } catch (stockErr) {
              console.warn("Failed to decrement stock for", it.product_id, stockErr);
            }
          }

          // SMS
          const shopUser = await User.findById(req.user._id);
          if (shopUser?.phone) {
             sendSmsNotification(shopUser.phone, `Order #${order._id.toString().slice(-6)} placed successfully!`);
          }
        }

        return res.json({ status: "success", order_ids: createdOrderIds });

      } catch (createErr) {
        console.error("Order creation failed:", createErr);
        return res.status(500).json({ detail: "Failed to create orders." });
      }
    }

    return res.status(400).json({ detail: "No order data found." });

  } catch (err) {
    console.error("verify-group ERROR:", err);
    return res.status(500).json({ detail: (err as Error).message });
  }
});

export default router;