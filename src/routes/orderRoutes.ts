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
----------------------------------------------------------- */
router.post("/", protect, blockCheck, authorize("shop"), async (req: AuthRequest, res) => {
  try {
    const { items, payment_method } = req.body;

    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ detail: "No items provided" });
    }

    // --- Helper: Find the Admin User (to update wallet) ---
    const adminUser = await User.findOne({ role: "admin" });
    if (!adminUser) {
        return res.status(500).json({ detail: "System Error: Admin account not found." });
    }

    // Helper to process items (parse IDs, check stock, calculate price)
    const processItems = async (itemsList: any[]) => {
      const results: any[] = [];
      
      for (const item of itemsList) {
        // 1. Parse Composite ID
        let realProductId = item.product_id;
        let unitName = null;

        if (item.product_id.length > 24 && item.product_id.includes("-")) {
            realProductId = item.product_id.substring(0, 24);
            unitName = decodeURIComponent(item.product_id.substring(25)); 
        }

        if (!mongoose.Types.ObjectId.isValid(realProductId)) {
           throw new Error(`Invalid product id: ${item.product_id}`);
        }

        // 2. Fetch Product
        const product = await Product.findById(realProductId).populate("factory_id");
        if (!product) throw new Error(`Product not found: ${realProductId}`);

        // 3. Find Specific Unit & Check Stock
        let targetUnit: any = null;
        let finalPrice = 0;
        let factoryBasePrice = 0; // NEW: Track base price

        if (product.selling_units && product.selling_units.length > 0) {
             if (unitName) {
                 targetUnit = product.selling_units.find((u: any) => u.unit_name === unitName);
             } else {
                 targetUnit = product.selling_units[0];
             }

             if (!targetUnit) throw new Error(`Unit '${unitName}' not found for product ${product.name}`);

             if (targetUnit.unit_stock < item.quantity) {
                 throw new Error(`${product.name} (${targetUnit.unit_name}) - insufficient stock.`);
             }

             const commission = product.commission_rate || 0;
             factoryBasePrice = targetUnit.factory_unit_price; // Store base
             finalPrice = Math.ceil(factoryBasePrice * (1 + commission / 100));

        } else {
             throw new Error(`Product ${product.name} has no selling units defined.`);
        }

        const factory: any = product.factory_id;
        
        results.push({
          product_id: product._id,
          name: `${product.name} (${targetUnit.unit_name})`,
          unit_name: targetUnit.unit_name, 
          price: finalPrice,
          factory_unit_price: factoryBasePrice, // NEW: Pass this along
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
      return results;
    };


    // --- PREPAID FLOW (Preview Only) ---
    if (String(payment_method).toLowerCase() === "prepaid") {
      // ... (Existing Prepaid logic remains unchanged) ...
      // I am keeping your existing logic here for brevity, 
      // but ensure you didn't delete the code block you already had here!
       try {
        const enrichedItems = await processItems(items);
        
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

        return res.json({ status: "PREPAID_PREVIEW", previewOrders });

      } catch (err: any) {
        return res.status(400).json({ detail: err.message });
      }
    }

    // --- COD FLOW (Create Orders & Update Admin Wallet) ---
    try {
        const enrichedItems = await processItems(items);

        const factoryGroups: Record<string, any[]> = {};
        enrichedItems.forEach((it) => {
          const fId = it.factory_id.toString();
          if (!factoryGroups[fId]) factoryGroups[fId] = [];
          factoryGroups[fId].push(it);
        });

        const createdOrders: any[] = [];

        for (const factoryId of Object.keys(factoryGroups)) {
          const itemsForFactory = factoryGroups[factoryId];
          
          let totalOrderAmount = 0;
          let totalFactoryPayout = 0;
          let totalAdminProfit = 0;

          // CALCULATE SPLITS
          itemsForFactory.forEach((i) => {
            const itemTotal = Number(i.price) * Number(i.quantity);
            const itemFactoryTotal = Number(i.factory_unit_price) * Number(i.quantity);
            
            totalOrderAmount += itemTotal;
            totalFactoryPayout += itemFactoryTotal;
            // Admin gets the difference (Commission)
            totalAdminProfit += (itemTotal - itemFactoryTotal);
          });

          // CREATE ORDER WITH NEW FIELDS
          const order = await Order.create({
            shop_id: req.user._id,
            factory_id: new mongoose.Types.ObjectId(factoryId),
            items: itemsForFactory,
            total_amount: totalOrderAmount,
            
            // ⭐ NEW: Store the calculated split
            net_factory_payout: totalFactoryPayout,
            admin_profit_share: totalAdminProfit,
            is_factory_payout_released: false, // Default: Held

            payment_method,
            payment_status: "pending",
            status: "pending"
          }) as any;

          createdOrders.push(order);

          // ⭐ NEW: IMMEDIATELY ADD TO ADMIN TOTAL REVENUE (WALLET)
          // Admin sees the full cash flow (+105) immediately
          await User.findByIdAndUpdate(adminUser._id, {
             $inc: { wallet_balance: totalOrderAmount }
          });

          // Decrement Stock
          for (const it of itemsForFactory) {
            try {
              if (it.unit_name) {
                  await Product.findOneAndUpdate(
                    { 
                      _id: it.product_id, 
                      "selling_units.unit_name": it.unit_name 
                    },
                    { 
                      $inc: { "selling_units.$.unit_stock": -it.quantity } 
                    }
                  );
              }
            } catch (stockErr) {
              console.warn("Stock update failed for", it.product_id, stockErr);
            }
          }

          // Send SMS
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

    } catch (err: any) {
        return res.status(400).json({ detail: err.message });
    }

  } catch (error) {
    console.error("Order Creation Error:", error);
    return res.status(500).json({ detail: (error as Error).message });
  }
});

/* -----------------------------------------------------------
   POST /orders/cancel-group - Cancel & Deduct Admin Wallet
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
    
    // Find Admin for wallet deduction
    const adminUser = await User.findOne({ role: "admin" });

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
        // Only allow cancel if pending
        if (String(ord.payment_status) !== "pending" && String(ord.status) !== "pending") {
          skipped.push(ord._id.toString());
          continue;
        }

        // 1. UPDATE STATUS
        ord.payment_status = "failed";
        ord.status = "cancelled";
        (ord as any).cancelledAt = new Date();
        (ord as any).cancelledBy = {
          id: req.user._id,
          role: req.user.role,
        };
        await ord.save();

        // 2. ⭐ NEW: DEDUCT FROM ADMIN WALLET
        // We remove the phantom revenue (-105) immediately
        if (adminUser) {
            await User.findByIdAndUpdate(adminUser._id, {
                $inc: { wallet_balance: -(ord.total_amount || 0) }
            });
        }

        // 3. RESTORE STOCK
        for (const itemObj of ord.items || []) {
          const it = itemObj as any; 
          try {
            if (it?.product_id && mongoose.Types.ObjectId.isValid(String(it.product_id))) {
               if (it.unit_name) {
                   await Product.findOneAndUpdate(
                    { 
                      _id: it.product_id, 
                      "selling_units.unit_name": it.unit_name 
                    },
                    { 
                      $inc: { "selling_units.$.unit_stock": Number(it.quantity) || 0 } 
                    }
                  );
               }
            }
          } catch (stockErr) {
            console.warn(`Failed to restore stock for product ${it?.product_id}:`, stockErr);
          }
        }

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
   GET /orders
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