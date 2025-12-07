import mongoose from "mongoose";

const orderItemSchema = new mongoose.Schema({
  product_id: { type: mongoose.Schema.Types.ObjectId, ref: "Product", required: true },
  name: { type: String, required: true },
  quantity: { type: Number, required: true },
  price: { type: Number, required: true },
  image_url: { type: String },
   seller_details: {
    name: String,
    address: String,
    gstin: String,
    phone: String,
    email: String,
   }

   ,
   factory_id: { 
  type: mongoose.Schema.Types.ObjectId, 
  ref: "User",
  required: true 
},

});




const orderSchema = new mongoose.Schema(
  {
    shop_id: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },

    // Will contain only items from this factory
   

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
  },
  { timestamps: true }
);


// --- [FIXED SECTION] ---
orderSchema.set('toJSON', {
  virtuals: true,
  versionKey: false,
  transform: function (doc, ret) {
    // Cast 'ret' to any for ALL operations to stop TypeScript errors
    const obj = ret as any;

    //delete obj._id;
    
    // Map createdAt -> created_at
    if (obj.createdAt) {
      obj.created_at = obj.createdAt; 
      delete obj.createdAt; 
    }

    // Map updatedAt -> updated_at
    if (obj.updatedAt) {
      obj.updated_at = obj.updatedAt;
      delete obj.updatedAt;
    }
  }
});
// -----------------------

const Order = mongoose.model("Order", orderSchema);
export default Order;