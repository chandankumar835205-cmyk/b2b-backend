// src/routes/adminRoutes.ts
import express from "express";
import User from "../models/User";
import Order from "../models/Order";
import Product from "../models/Product"; 
import { protect, authorize, AuthRequest } from "../middleware/authMiddleware";

const router = express.Router();

// GET /admin/stats - Updated to use Real-Time Wallets
router.get("/stats", protect, authorize("admin"), async (req: AuthRequest, res) => {
  try {
    const totalUsers = await User.countDocuments();
    const totalOrders = await Order.countDocuments();
    const totalProducts = await Product.countDocuments();

    // ⭐ NEW: Fetch Revenue & Profit directly from Admin Wallet
    // We use the current user (Admin) to get the live balance
    const adminUser = await User.findById(req.user._id);
    
    // Default to 0 if fields don't exist yet
    const totalRevenue = adminUser?.wallet_balance || 0; 
    const totalProfit = adminUser?.admin_profit_wallet || 0;

    // Fetch the 5 most recent orders
    const recentOrders = await Order.find()
      .sort({ createdAt: -1 })
      .limit(5)
      .populate("shop_id", "email"); 

    res.json({
      total_users: totalUsers,
      total_orders: totalOrders,
      total_products: totalProducts,
      total_revenue: totalRevenue, // Now shows accurate GTV
      total_profit: totalProfit,   // Now shows Commission Only
      recent_orders: recentOrders 
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

/* -----------------------------------------------------------
   POST /admin/orders/:id/release-payment
   ⭐ NEW: The "Settle to Factory" Button Logic
----------------------------------------------------------- */
router.post("/orders/:id/release-payment", protect, authorize("admin"), async (req: AuthRequest, res) => {
  try {
    const order = await Order.findById(req.params.id);
    if (!order) return res.status(404).json({ detail: "Order not found" });

    // 1. Safety Check: Don't pay twice
    if (order.is_factory_payout_released) {
      return res.status(400).json({ detail: "Payment already released to factory." });
    }

    // 2. Identify Factory & Admin
    const factoryId = order.factory_id;
    const adminId = req.user._id; // The one clicking the button

    // 3. Update Factory Wallet (Add Net Payout)
    if (factoryId && order.net_factory_payout > 0) {
        await User.findByIdAndUpdate(factoryId, {
            $inc: { wallet_balance: order.net_factory_payout }
        });
    }

    // 4. Update Admin PROFIT Wallet (Add Commission Share)
    // Note: We already added the "Total Revenue" when order was placed. 
    // This specific wallet is just for you to track pure profit.
    if (order.admin_profit_share > 0) {
        await User.findByIdAndUpdate(adminId, {
            $inc: { admin_profit_wallet: order.admin_profit_share }
        });
    }

    // 5. Lock the Order
    order.is_factory_payout_released = true;
    await order.save();

    res.json({ 
        message: "Payment released successfully", 
        released_amount: order.net_factory_payout 
    });

  } catch (error) {
    console.error("Release Payment Error:", error);
    res.status(500).json({ detail: (error as Error).message });
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