import mongoose from "mongoose";
const productSchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    description: { type: String, required: true },
    price: { type: Number, required: true, default: 0 },
    stock_quantity: { type: Number, required: true, default: 0 },
    sku: { type: String, unique: true, sparse: true },
    images: [{ type: String }],
    
    // --- [ADD THIS] ---
    // In src/models/Product.ts

// ... inside productSchema ...
category: { 
  type: String, 
  required: true, 
  // --- [CHANGE THIS LIST] ---
  enum: [
    "Groceries",      // Rice, Dal, Oil
    "Beverages",      // Cold drinks, Juices
    "Snacks",         // Chips, Biscuits
    "Personal Care",  // Soaps, Shampoo
    "Household",      // Detergents, Cleaners
    "Dairy",          // Milk, Curd, Ghee
    "Others"
  ],
  // --------------------------
  default: "Others",
  index: true 
},
    // ------------------

    factory_id: { 
      type: mongoose.Schema.Types.ObjectId, 
      required: true, 
      ref: "User" 
    },
  },
  { timestamps: true }
);



// Add Text Index for Search
productSchema.index({ name: "text", description: "text" });

// Convert _id to id for frontend compatibility
productSchema.set('toJSON', {
  virtuals: true,
  versionKey: false,
  transform: function (doc, ret) {
    delete (ret as any)._id;
  }
});
// In src/models/Product.ts


const Product = mongoose.model("Product", productSchema);
export default Product;