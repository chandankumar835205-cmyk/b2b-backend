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
   - Accepts either:
     a) { order_ids: [...] }  -> legacy: DB orders already created (keeps old flow)
     b) { items: [...], payment_method: "Prepaid" } -> new flow: create Razorpay order using items (no DB orders created yet)
   - Returns razorpay order object
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
        notes: {
          group_order_ids: JSON.stringify(order_ids),
        },
      };

      const razorpayOrder = await razorpay.orders.create(options);

      // attach razorpay_order_id to DB orders (legacy behavior)
      await Order.updateMany({ _id: { $in: order_ids } }, { $set: { razorpay_order_id: razorpayOrder.id } });

      return res.json(razorpayOrder);
    }

    // NEW: items flow (prepaid) - server computes total and creates razorpay order WITHOUT creating DB orders yet
    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ detail: "items array is required for prepaid flow" });
    }

    // Enrich items server-side and validate stock (do NOT modify stock yet)
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
        product_id: product._id.toString(),
        name: product.name,
        price: product.price,
        quantity: item.quantity,
        image_url: product.images?.[0] || "",
        factory_id: factory?._id ? factory._id.toString() : null,
      });
    }

    // Compute group totals (sum of all factories)
    const totalAmount = enrichedItems.reduce((sum, it) => sum + Number(it.price) * Number(it.quantity), 0);
    const amountInPaisa = Math.round(totalAmount * 100);

    // Create razorpay order and include items in notes (stringified)
    const options = {
      amount: amountInPaisa,
      currency: "INR",
      receipt: "grp_" + Date.now(),
      notes: {
        prepaid_items: JSON.stringify(enrichedItems), // server will use these after payment verification
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
   - Verifies signature
   - Then:
     a) If razor notes contain group_order_ids -> update existing DB orders (legacy)
     b) If razor notes contain prepaid_items -> CREATE DB orders here (new prepaid flow),
        reduce stock, send SMS, set payment_status = "paid"
------------------------------------------------------------------*/
router.post("/verify-group", protect, async (req: AuthRequest, res) => {
  try {
    const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body;
    if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
      return res.status(400).json({ detail: "Missing payment fields" });
    }

    // Validate signature
    const body = razorpay_order_id + "|" + razorpay_payment_id;
    const expectedSignature = crypto.createHmac("sha256", process.env.RAZORPAY_KEY_SECRET || "")
      .update(body.toString())
      .digest("hex");

    if (expectedSignature !== razorpay_signature) {
      console.warn("INVALID SIGNATURE FOR GROUP PAYMENT");
      return res.status(400).json({ detail: "Invalid payment signature" });
    }

    // Fetch Razorpay order to read notes
    const razorOrder = await razorpay.orders.fetch(razorpay_order_id);

    // Try to parse notes
    let orderIds: string[] = [];
    let prepaidItems: any[] = [];
    try {
      orderIds = JSON.parse(String(razorOrder.notes?.group_order_ids || "[]"));
    } catch (e) {
      orderIds = [];
    }
    try {
      prepaidItems = JSON.parse(String(razorOrder.notes?.prepaid_items || "[]"));
    } catch (e) {
      prepaidItems = [];
    }

    // CASE A: legacy - update existing orders
    if (orderIds.length > 0) {
      const updateResult = await Order.updateMany(
        { _id: { $in: orderIds } },
        {
          $set: {
            payment_status: "paid",
            status: "processing",
            razorpay_payment_id,
            razorpay_signature,
          },
        }
      );

      console.log("LEGACY GROUP PAYMENT VERIFIED:", {
        razorpay_order_id,
        orderIds,
        matched: (updateResult as any).matchedCount,
        modified: (updateResult as any).modifiedCount,
      });

      return res.json({
        status: "success",
        order_ids: orderIds,
        matched: (updateResult as any).matchedCount,
        modified: (updateResult as any).modifiedCount,
      });
    }

    // CASE B: prepaidItems present -> create DB orders now (one per factory)
    if (prepaidItems.length > 0) {
      // Group items by factory
      const factoryGroups: Record<string, any[]> = {};
      for (const it of prepaidItems) {
        const f = it.factory_id ? String(it.factory_id) : "unknown";
        if (!factoryGroups[f]) factoryGroups[f] = [];
        factoryGroups[f].push(it);
      }

      const createdOrders: any[] = [];
      const createdOrderIds: string[] = [];
      const failedCreates: { error: string; factory?: string }[] = [];

      // We'll perform sequential creates and stock reductions.
      // If anything fails, attempt to rollback created orders and restore stock.
      try {
        for (const factoryId of Object.keys(factoryGroups)) {
          const itemsForFactory = factoryGroups[factoryId];
          let totalAmount = 0;
          for (const it of itemsForFactory) {
            totalAmount += Number(it.price) * Number(it.quantity);
          }

         const order = await (Order as any).create({
  shop_id: req.user._id,
  factory_id: mongoose.Types.ObjectId.isValid(factoryId)
    ? new mongoose.Types.ObjectId(factoryId)
    : null,
  items: itemsForFactory,
  total_amount: totalAmount,
  payment_method: "Prepaid",
  payment_status: "paid",
  status: "processing",
  razorpay_order_id,
  razorpay_payment_id,
  razorpay_signature,
});


          // decrement stock
          for (const it of itemsForFactory) {
            try {
              if (it?.product_id && mongoose.Types.ObjectId.isValid(String(it.product_id))) {
                await Product.findByIdAndUpdate(it.product_id, { $inc: { stock_quantity: -(Number(it.quantity) || 0) } });
              }
            } catch (stockErr) {
              console.warn("Failed to decrement stock for", it.product_id, stockErr);
              // If stock decrement fails, we'll let overall try/catch handle rollback
              throw new Error(`Stock update failed for product ${it.product_id}`);
            }
          }

          // SMS notification to shop
          try {
            const shopUser = await User.findById(req.user._id);
            if (shopUser?.phone) {
              sendSmsNotification(
                shopUser.phone,
                `Order #${order._id.toString().slice(-6)} placed successfully!`
              );
            }
          } catch (smsErr) {
            console.warn("SMS send failed for order", order._id, smsErr);
            // not fatal
          }
        }

        return res.json({
          status: "success",
          order_ids: createdOrderIds,
          created: createdOrderIds.length,
        });
      } catch (createErr) {
        console.error("Error creating orders after payment verification, attempting rollback:", createErr);
        // Attempt rollback for created orders: restore stock and mark cancelled
        for (const cid of createdOrderIds) {
          try {
            const ord = await Order.findById(cid);
            if (!ord) continue;
            // restore stock for items
            for (const it of ord.items || []) {
              try {
                if (it?.product_id && mongoose.Types.ObjectId.isValid(String(it.product_id))) {
                  await Product.findByIdAndUpdate(it.product_id, { $inc: { stock_quantity: Number(it.quantity) || 0 } });
                }
              } catch (rerr) {
                console.warn("Rollback: failed to restore stock for", it.product_id, rerr);
              }
            }
            ord.payment_status = "failed";
            ord.status = "cancelled";
            (ord as any).cancelledAt = new Date();
            await ord.save();
          } catch (rerr) {
            console.warn("Rollback: failed for order id", cid, rerr);
          }
        }

        return res.status(500).json({ detail: "Failed to create orders after payment; rollback attempted" });
      }
    }

    // Fallback: if neither orderIds nor prepaidItems found, try to update any order with same razorpay_order_id
    const fallback = await Order.findOneAndUpdate(
      { razorpay_order_id },
      {
        $set: {
          payment_status: "paid",
          status: "processing",
          razorpay_payment_id,
          razorpay_signature,
        },
      },
      { new: true }
    );

    if (fallback) {
      return res.json({ status: "success", updated: [fallback._id] });
    }

    return res.status(400).json({ detail: "No order IDs or prepaid items found for this payment." });

  } catch (err) {
    console.error("verify-group ERROR:", err);
    return res.status(500).json({ detail: (err as Error).message });
  }
});

export default router;
