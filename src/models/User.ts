import mongoose from "mongoose";

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
    district: {type: String, default: ""},
    state: { type: String, default: "" },
    pincode: { type: String, default: "" },

     is_blocked: {
  type: Boolean,
  default: false,
}

  },
  { timestamps: true }
);

// --- [FIXED SECTION] ---
userSchema.set('toJSON', {
  virtuals: true,
  versionKey: false,
  transform: function (doc, ret) {
    // We cast 'ret' to 'any' to stop TypeScript from complaining
    // about deleting required properties.
    //delete (ret as any)._id;
    delete (ret as any).hashed_password;
  }
});
// -----------------------

const User = mongoose.model("User", userSchema);
export default User;