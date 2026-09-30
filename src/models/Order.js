const mongoose = require("mongoose");

const orderItemSchema = new mongoose.Schema({
  product_id: { type: mongoose.Schema.Types.ObjectId, ref: "Product", required: true },
  name: { type: String, required: true },
  unit_name: { type: String }, 
  quantity: { type: Number, required: true },
  price: { type: Number, required: true },
  image_url: { type: String },
  seller_details: {
    name: String,
    address: String,
    gstin: String,
    phone: String,
    email: String,
  },
  factory_id: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: "User",
    required: true 
  },
});

const orderSchema = new mongoose.Schema(
  {
    shop_id: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    factory_id: {  
      type: mongoose.Schema.Types.ObjectId, 
      ref: "User",
      required: true 
    },
    items: [orderItemSchema],
    total_amount: { type: Number, required: true },
    status: {
      type: String,
      enum: ["pending", "processing", "shipped", "delivered", "cancelled"],
      default: "pending"
    },
    net_factory_payout: { type: Number, required: true, default: 0 },
    admin_profit_share: { type: Number, required: true, default: 0 },
    is_factory_payout_released: { type: Boolean, default: false },
    payment_status: {
      type: String,
      enum: ["pending", "paid", "failed"],
      default: "pending"
    },
    payment_method: { type: String, enum: ["Prepaid", "COD"], required: true },
    razorpay_order_id: { type: String },
    razorpay_payment_id: { type: String },
    razorpay_signature: { type: String },
    shiprocket_shipment_id: { type: String },
    shiprocket_order_id: { type: String },
    tracking_url: { type: String },
    cancelledAt: { type: Date },
    cancelledBy: {
      id: mongoose.Schema.Types.ObjectId,
      role: String
    }
  },
  { timestamps: true }
);

orderSchema.set("toJSON", {
  virtuals: true,
  versionKey: false,
  transform: function (doc, ret) {
    if (ret.createdAt) {
      ret.created_at = ret.createdAt; 
      delete ret.createdAt; 
    }
    if (ret.updatedAt) {
      ret.updated_at = ret.updatedAt;
      delete ret.updatedAt;
    }
  }
});

const Order = mongoose.model("Order", orderSchema);
module.exports = Order;
