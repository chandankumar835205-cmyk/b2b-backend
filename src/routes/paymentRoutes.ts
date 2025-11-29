import express from "express";
import Razorpay from "razorpay";
import crypto from "crypto";
import Order from "../models/Order";
import { protect, AuthRequest } from "../middleware/authMiddleware";

const router = express.Router();

// Initialize Razorpay
const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID || "",
  key_secret: process.env.RAZORPAY_KEY_SECRET || "",
});

// POST /payments/initiate/:orderId
router.post("/initiate/:orderId", protect, async (req: AuthRequest, res) => {
  try {
    const order = await Order.findById(req.params.orderId);
    if (!order) return res.status(404).json({ detail: "Order not found" });

    // Amount must be in paisa (multiply by 100)
    const options = {
      amount: Math.round(order.total_amount * 100), 
      currency: "INR",
      receipt: `order_${order._id}`,
    };

    const razorpayOrder = await razorpay.orders.create(options);

    // Save the Razorpay Order ID to our database
    order.razorpay_order_id = razorpayOrder.id;
    await order.save();

    res.json(razorpayOrder);
  } catch (error) {
    res.status(500).json({ detail: (error as Error).message });
  }
});

// POST /payments/verify
router.post("/verify", protect, async (req: AuthRequest, res) => {
  try {
    const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body;

    const body = razorpay_order_id + "|" + razorpay_payment_id;

    const expectedSignature = crypto
      .createHmac("sha256", process.env.RAZORPAY_KEY_SECRET || "")
      .update(body.toString())
      .digest("hex");

    if (expectedSignature === razorpay_signature) {
      // Payment Successful
      const order = await Order.findOne({ razorpay_order_id });
      if (order) {
        order.payment_status = "paid";
        order.status = "processing";
        order.razorpay_payment_id = razorpay_payment_id;
        order.razorpay_signature = razorpay_signature;
        await order.save();
        
        return res.json({ status: "success", order });
      }
    }
    
    res.status(400).json({ detail: "Invalid signature" });

  } catch (error) {
    res.status(500).json({ detail: (error as Error).message });
  }
});

export default router;