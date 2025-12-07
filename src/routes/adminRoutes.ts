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
// GET /admin/orders/:id - Get single order details
router.get("/orders/:id", protect, authorize("admin"), async (req, res) => {
  try {
    const order = await Order.findById(req.params.id)
      .populate("shop_id", "full_name email phone address_line_1 city state pincode")
      .populate("factory_id", "full_name email phone");

    if (!order) {
      return res.status(404).json({ detail: "Order not found" });
    }

    res.json(order);
  } catch (err) {
    res.status(500).json({ detail: (err as Error).message });
  }
});


// BLOCK USER
router.patch("/users/:id/block", protect, authorize("admin"), async (req, res) => {
  try {
    const user = await User.findByIdAndUpdate(
      req.params.id,
      { is_blocked: true },
      { new: true }
    );
    res.json({ message: "User blocked", user });
  } catch (error) {
    res.status(500).json({ detail:  (error as Error).message });
  }
});

// UNBLOCK USER
router.patch("/users/:id/unblock", protect, authorize("admin"), async (req, res) => {
  try {
    const user = await User.findByIdAndUpdate(
      req.params.id,
      { is_blocked: false },
      { new: true }
    );
    res.json({ message: "User unblocked", user });
  } catch (error) {
    res.status(500).json({ detail:  (error as Error).message });
  }
});
router.get("/daily-stats", protect, authorize("admin"), async (req, res) => {
  try {
    const last7 = await Order.aggregate([
      {
        $match: {
          createdAt: {
            $gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
          }
        }
      },
      {
        $group: {
          _id: { $dateToString: { format: "%Y-%m-%d", date: "$createdAt" }},
          orders: { $sum: 1 },
          revenue: { $sum: "$total_amount" }
        }
      },
      { $sort: { _id: 1 } }
    ]);

    res.json(last7);
  } catch (error) {
    res.status(500).json({ detail:  (error as Error).message });
  }
});

// GET /admin/orders - List all orders (admin only)
router.get("/orders", protect, authorize("admin"), async (req, res) => {
  try {
    const orders = await Order.find({})
      .populate("shop_id", "email full_name phone")
      .sort({ createdAt: -1 });

    res.json(orders);
  } catch (error) {
    res.status(500).json({ detail: (error as Error).message });
  }
});
// GET /admin/daily-stats - For graphs (last 7 days)
router.get("/daily-stats", protect, authorize("admin"), async (req, res) => {
  try {
    const last7 = await Order.aggregate([
      {
        $match: {
          createdAt: {
            $gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
          }
        }
      },
      {
        $group: {
          _id: { $dateToString: { format: "%Y-%m-%d", date: "$createdAt" }},
          orders: { $sum: 1 },
          revenue: { $sum: "$total_amount" }
        }
      },
      { $sort: { _id: 1 } }
    ]);

    res.json(last7);
  } catch (error) {
    res.status(500).json({ detail: (error as Error).message });
  }
});




export default router;