import mongoose from "mongoose";

const orderItemSchema = new mongoose.Schema({
  product_id: { type: mongoose.Schema.Types.ObjectId, ref: "Product", required: true },
  name: { type: String, required: true },
  // ⭐ NEW FIELD: Required to track if user bought "5kg" or "10kg"
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
    // We store this so future price changes don't affect past orders.
    net_factory_payout: { type: Number, required: true, default: 0 },

    // [NEW] 2. The Admin's profit (Commission - Discounts) for this specific order
    admin_profit_share: { type: Number, required: true, default: 0 },

    // [NEW] 3. The Switch: Has the admin clicked the "Add Revenue" button?
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
    
    // For cancellations
    cancelledAt: { type: Date },
    cancelledBy: {
      id: mongoose.Schema.Types.ObjectId,
      role: String
    }
  },
  { timestamps: true }
);

orderSchema.set('toJSON', {
  virtuals: true,
  versionKey: false,
  transform: function (doc, ret) {
    const obj = ret as any;
    if (obj.createdAt) {
      obj.created_at = obj.createdAt; 
      delete obj.createdAt; 
    }
    if (obj.updatedAt) {
      obj.updated_at = obj.updatedAt;
      delete obj.updatedAt;
    }
  }
});

const Order = mongoose.model("Order", orderSchema);
export default Order;