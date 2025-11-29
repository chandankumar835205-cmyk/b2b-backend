import express from "express";
import User from "../models/User";
import Order from "../models/Order";
import Product from "../models/Product"; // Added Product import
import { protect, authorize } from "../middleware/authMiddleware";

const router = express.Router();

// GET /admin/stats
router.get("/stats", protect, authorize("admin"), async (req, res) => {
  try {
    const totalUsers = await User.countDocuments();
    const totalOrders = await Order.countDocuments();
    const totalProducts = await Product.countDocuments();

    // Calculate Total Revenue
    const revenueAgg = await Order.aggregate([
      { $match: { payment_status: "paid" } },
      { $group: { _id: null, total: { $sum: "$total_amount" } } }
    ]);
    const totalRevenue = revenueAgg.length > 0 ? revenueAgg[0].total : 0;

    // --- [THIS IS THE NEW PART] ---
    // Fetch the 5 most recent orders
    const recentOrders = await Order.find()
      .sort({ createdAt: -1 })
      .limit(5)
      .populate("shop_id", "email"); // Get the shop's email
    // ------------------------------

    res.json({
      total_users: totalUsers,
      total_orders: totalOrders,
      total_products: totalProducts,
      total_revenue: totalRevenue,
      recent_orders: recentOrders // <--- Send it to the frontend
    });

  } catch (error) {
    res.status(500).json({ detail: (error as Error).message });
  }
});

// GET /admin/users - List all users
router.get("/users", protect, authorize("admin"), async (req, res) => {
    try {
        const users = await User.find({}).select("-hashed_password");
        res.json(users);
    } catch (error) {
        res.status(500).json({ detail: (error as Error).message });
    }
});

export default router;