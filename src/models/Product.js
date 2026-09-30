const mongoose = require("mongoose");

// Pricing Tier Schema
// Defines discount rules: e.g., "Buy 10-50 units, get 5% off"
const PricingTierSchema = new mongoose.Schema({
  min_quantity: { type: Number, required: true },
  max_quantity: { type: Number },
  discount_percentage: { type: Number, default: 0 },
});

// Selling Unit Sub-Schema Definition
const SellingUnitSchema = new mongoose.Schema({
  unit_name: { type: String, required: true }, 
  unit_type: { 
    type: String, 
    enum: ["KG", "LITRE", "PACKET", "CARTON", "JAR", "PIECE", "SET"],
    required: true, 
  },
  factory_unit_price: { type: Number, required: true, default: 0, min: 0 }, 
  unit_stock: { type: Number, required: true, default: 0, min: 0 }, 
  unit_quantity_value: { type: Number, default: 1, min: 1 }, 
  bulk_pricing_tiers: {
    type: [PricingTierSchema],
    default: []
  }
}, { _id: true }); 

const productSchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    description: { type: String, required: true },
    is_active: { type: Boolean, default: false, index: true },
    selling_units: {
      type: [SellingUnitSchema],
      required: true,
      validate: {
        validator: function(v) {
          return v && v.length > 0; 
        },
        message: "A product must have at least one selling unit defined.",
      }
    }, 
    commission_rate: { 
      type: Number, 
      required: true, 
      min: 0, 
      max: 100, 
      default: 0 
    }, 
    sku: { type: String, unique: true, sparse: true },
    images: [{ type: String }],
    category: { 
      type: String, 
      required: true, 
      enum: [
        "Groceries", "Beverages", "Snacks", "Personal Care", "Household", "Dairy", "Others"
      ],
      default: "Others",
      index: true 
    },
    factory_id: { 
      type: mongoose.Schema.Types.ObjectId, 
      required: true, 
      ref: "User" 
    },
  },
  { timestamps: true }
);

// Text Index for Search
productSchema.index({ name: "text", description: "text" });

// Convert _id to id
productSchema.set("toJSON", {
  virtuals: true,
  versionKey: false,
  transform: function (doc, ret) {
    delete ret._id;
  }
});

const Product = mongoose.model("Product", productSchema);
module.exports = Product;
