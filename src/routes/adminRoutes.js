const express = require("express");
const User = require("../models/User");
const Order = require("../models/Order");
const Product = require("../models/Product"); 
const { protect, authorize } = require("../middleware/authMiddleware");

const router = express.Router();

// GET /admin/stats - Updated to use Real-Time Wallets
router.get("/stats", protect, authorize("admin"), async (req, res) => {
  try {
    const totalUsers = await User.countDocuments();
    const totalOrders = await Order.countDocuments();
    const totalProducts = await Product.countDocuments();

    const adminUser = await User.findById(req.user._id);
    
    const totalRevenue = adminUser?.wallet_balance || 0; 
    const totalProfit = adminUser?.admin_profit_wallet || 0;

    const recentOrders = await Order.find()
      .sort({ createdAt: -1 })
      .limit(5)
      .populate("shop_id", "email"); 

    res.json({
      total_users: totalUsers,
      total_orders: totalOrders,
      total_products: totalProducts,
      total_revenue: totalRevenue,
      total_profit: totalProfit,
      recent_orders: recentOrders 
    });

  } catch (error) {
    res.status(500).json({ detail: error.message });
  }
});

// GET /admin/users - List all users
router.get("/users", protect, authorize("admin"), async (req, res) => {
  try {
    const users = await User.find({}).select("-hashed_password");
    res.json(users);
  } catch (error) {
    res.status(500).json({ detail: error.message });
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
    res.status(500).json({ detail: err.message });
  }
});

// POST /admin/orders/:id/release-payment - Settle to Factory
router.post("/orders/:id/release-payment", protect, authorize("admin"), async (req, res) => {
  try {
    const order = await Order.findById(req.params.id);
    if (!order) return res.status(404).json({ detail: "Order not found" });

    if (order.is_factory_payout_released) {
      return res.status(400).json({ detail: "Payment already released to factory." });
    }

    const factoryId = order.factory_id;
    const adminId = req.user._id;

    if (factoryId && order.net_factory_payout > 0) {
      await User.findByIdAndUpdate(factoryId, {
        $inc: { wallet_balance: order.net_factory_payout }
      });
    }

    if (order.admin_profit_share > 0) {
      await User.findByIdAndUpdate(adminId, {
        $inc: { admin_profit_wallet: order.admin_profit_share }
      });
    }

    order.is_factory_payout_released = true;
    await order.save();

    res.json({ 
      message: "Payment released successfully", 
      released_amount: order.net_factory_payout 
    });

  } catch (error) {
    console.error("Release Payment Error:", error);
    res.status(500).json({ detail: error.message });
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
    res.status(500).json({ detail: error.message });
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
    res.status(500).json({ detail: error.message });
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
    res.status(500).json({ detail: error.message });
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
    res.status(500).json({ detail: error.message });
  }
});

module.exports = router;
