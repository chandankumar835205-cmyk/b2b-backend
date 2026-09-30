const mongoose = require("mongoose");

const userSchema = new mongoose.Schema(
  {
    full_name: { type: String, default: "" },
    email: { type: String, required: true, unique: true },
    phone: { type: String, unique: true, sparse: true },
    hashed_password: { type: String, required: true },
    role: { 
      type: String, 
      enum: ["admin", "factory", "shop"], 
      default: "shop" 
    },
    is_active: { type: Boolean, default: true },
    address_line_1: { type: String, default: "" },
    city: { type: String, default: "" },
    district: { type: String, default: "" },
    state: { type: String, default: "" },
    pincode: { type: String, default: "" },
    is_blocked: {
      type: Boolean,
      default: false,
    },
    // Stores the Total Revenue (for Factory) or Total GTV (for Admin)
    wallet_balance: { type: Number, default: 0 },
    // Specific wallet for Admin to see pure Profit (Commission - Discounts)
    admin_profit_wallet: { type: Number, default: 0 },
  },
  { timestamps: true }
);

userSchema.set("toJSON", {
  virtuals: true,
  versionKey: false,
  transform: function (doc, ret) {
    delete ret.hashed_password;
  }
});

const User = mongoose.model("User", userSchema);
module.exports = User;
