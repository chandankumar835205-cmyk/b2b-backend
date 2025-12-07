// src/routes/paymentRoutes.ts
import express from "express";
import Razorpay from "razorpay";
import crypto from "crypto";
import Order from "../models/Order";
import { protect, AuthRequest } from "../middleware/authMiddleware";

const router = express.Router();

// -------------------------------
// Razorpay Initialization
// -------------------------------
const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID || "",
  key_secret: process.env.RAZORPAY_KEY_SECRET || "",
});

// ============================================================================
// 1️⃣ INITIATE PAYMENT FOR MULTIPLE ORDERS (GROUP PAYMENT)
// ============================================================================
router.post("/initiate-group", protect, async (req: AuthRequest, res) => {
  try {
    const { order_ids } = req.body;

    if (!Array.isArray(order_ids) || order_ids.length === 0) {
      return res.status(400).json({ detail: "order_ids array is required" });
    }

    const orders = await Order.find({ _id: { $in: order_ids } });
    if (orders.length === 0) {
      return res.status(404).json({ detail: "Orders not found" });
    }

    const totalAmount = orders.reduce((sum, o) => sum + (o.total_amount || 0), 0);
    const amountInPaisa = Math.round(totalAmount * 100);

    const options = {
      amount: amountInPaisa,
      currency: "INR",

      // FIXED RECEIPT (always < 40 chars)
      receipt: "grp_" + Date.now(),

      notes: {
        group_order_ids: JSON.stringify(order_ids),
      },
    };

    const razorpayOrder = await razorpay.orders.create(options);

    await Order.updateMany(
      { _id: { $in: order_ids } },
      { $set: { razorpay_order_id: razorpayOrder.id } }
    );

    return res.json(razorpayOrder);

  } catch (err) {
    console.error("initiate-group ERROR:", err);
    res.status(500).json({ detail: (err as Error).message });
  }
});

// ============================================================================
// 2️⃣ VERIFY GROUP PAYMENT (AFTER RAZORPAY SUCCESS)
// ============================================================================

router.post("/verify-group", protect, async (req: AuthRequest, res) => {
  try {
    const { razorpay_order_id, razorpay_payment_id, razorpay_signature } =
      req.body;

    if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
      return res.status(400).json({ detail: "Missing payment fields" });
    }

    // Validate Signature
    const body = razorpay_order_id + "|" + razorpay_payment_id;
    const expectedSignature = crypto
      .createHmac("sha256", process.env.RAZORPAY_KEY_SECRET || "")
      .update(body.toString())
      .digest("hex");

    if (expectedSignature !== razorpay_signature) {
      console.warn("❌ INVALID SIGNATURE FOR GROUP PAYMENT");
      return res.status(400).json({ detail: "Invalid payment signature" });
    }

    // Fetch Razorpay order to read notes
    const razorOrder = await razorpay.orders.fetch(razorpay_order_id);

    let orderIds: string[] = [];
    try {
      orderIds = JSON.parse(String(razorOrder.notes?.group_order_ids || "[]"));
      if (!Array.isArray(orderIds)) orderIds = [];
    } catch (e) {
      orderIds = [];
    }

    // Fallback — if notes missing, update any order with same razorpay_order_id
    if (orderIds.length === 0) {
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

      return res.status(400).json({
        detail: "No order IDs found and no fallback order matched.",
      });
    }

    // Update ALL orders in group
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

    console.log("GROUP PAYMENT VERIFIED:", {
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
  } catch (err) {
    console.error("verify-group ERROR:", err);
    return res.status(500).json({ detail: (err as Error).message });
  }
});

export default router;
