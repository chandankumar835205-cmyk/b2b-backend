import mongoose from "mongoose";

// --- START: Pricing Tier Schema ---
// Defines discount rules: e.g., "Buy 10-50 units, get 5% off"
const PricingTierSchema = new mongoose.Schema({
  min_quantity: { type: Number, required: true }, // e.g., 10
  max_quantity: { type: Number }, // e.g., 50 (optional, null means "and above")
  discount_percentage: { type: Number, default: 0 }, // e.g., 5
  // You could also add a fixed 'tier_price' here if you prefer exact prices over percentages
});
// --- END: Pricing Tier Schema ---

// --- START: Selling Unit Sub-Schema Definition ---
const SellingUnitSchema = new mongoose.Schema({
  // e.g., "5 Kg Bag", "20 piece Carton"
  unit_name: { type: String, required: true }, 
  
  // A standard, machine-readable unit type
  unit_type: { 
    type: String, 
    enum: ["KG", "LITRE", "PACKET", "CARTON", "JAR", "PIECE", "SET"],
    required: true, 
  },
  
  // Factory's base price & stock
  factory_unit_price: { type: Number, required: true, default: 0, min: 0 }, 
  unit_stock: { type: Number, required: true, default: 0, min: 0 }, 
  unit_quantity_value: { type: Number, default: 1, min: 1 }, 
  
  // ⭐ NEW FIELD: Bulk Pricing Tiers
  bulk_pricing_tiers: {
    type: [PricingTierSchema],
    default: []
  }
}, { _id: true }); 
// --- END: Selling Unit Sub-Schema Definition ---


const productSchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    description: { type: String, required: true },
    
    // Visibility Flag
    is_active: { type: Boolean, default: false, index: true },

    // Selling Units (with Pricing Tiers inside)
    selling_units: {
      type: [SellingUnitSchema],
      required: true,
      validate: {
        validator: function(v: any) {
          return v && v.length > 0; 
        },
        message: 'A product must have at least one selling unit defined.',
      }
    }, 
    
    // Admin Commission
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
productSchema.set('toJSON', {
  virtuals: true,
  versionKey: false,
  transform: function (doc, ret) {
    delete (ret as any)._id;
  }
});

const Product = mongoose.model("Product", productSchema);
export default Product;