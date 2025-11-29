import express from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import User from "../models/User";
import { protect, AuthRequest } from "../middleware/authMiddleware"; // <--- 1. Import this

const router = express.Router();

// Helper to generate JWT
const generateToken = (id: string, role: string, email: string) => {
  return jwt.sign({ sub: email, role, id }, process.env.JWT_SECRET_KEY || "secret", {
    expiresIn: "30d",
  });
};

// POST /auth/signup
router.post("/signup", async (req, res) => {
  try {
    // 1. Accept full_name and phone
    const { email, password, role, full_name, phone, address_line_1, city, district, state, pincode } = req.body;

    const userExists = await User.findOne({ email });
    if (userExists) {
       res.status(400).json({ detail: "Email already registered" });
       return;
    }

    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);

    const user = await User.create({
      full_name, // Save Name
      email,
      phone,     // Save Phone
      hashed_password: hashedPassword,
      role: role || "shop",
      address_line_1, city, district, state, pincode
    });

    res.status(201).json(user);
  } catch (error) {
    res.status(500).json({ detail: (error as Error).message });
  }
});

// POST /auth/login
router.post("/login", async (req, res) => {
  try {
    const email = req.body.email || req.body.username; 
    const password = req.body.password;

    const user = await User.findOne({ email });

    if (user && (await bcrypt.compare(password, user.hashed_password))) {
      const access_token = generateToken(user._id.toString(), user.role, user.email);
      
      res.json({
        access_token,
        token_type: "bearer",
        user
      });
    } else {
      res.status(401).json({ detail: "Incorrect email or password" });
    }
  } catch (error) {
    res.status(500).json({ detail: (error as Error).message });
  }
});

// --- [THIS IS THE NEW PART] ---
// GET /auth/me - Get current user profile
router.get("/me", protect, async (req: AuthRequest, res) => {
  // The 'protect' middleware has already found the user and put it in req.user
  if (req.user) {
    res.json(req.user);
  } else {
    res.status(404).json({ detail: "User not found" });
  }
});
// ------------------------------
// ... existing imports and routes ...

// --- [ADD THIS NEW ROUTE] ---
// PUT /auth/me - Update User Profile (Address)
router.put("/me", protect, async (req: AuthRequest, res) => {
  try {
    const user = await User.findById(req.user._id);

    if (user) {
      // Update fields if they are provided in the body
      user.address_line_1 = req.body.address_line_1 || user.address_line_1;
      user.city = req.body.city || user.city;
      user.district = req.body.district || user.district;
      user.state = req.body.state || user.state;
      user.pincode = req.body.pincode || user.pincode;
      
      // If you added a 'name' field to your User model, update it here too:
      // user.name = req.body.name || user.name;

      const updatedUser = await user.save();
      
      res.json({
        _id: updatedUser._id,
        email: updatedUser.email,
        role: updatedUser.role,
        address_line_1: updatedUser.address_line_1,
        city: updatedUser.city,
        state: updatedUser.state,
        pincode: updatedUser.pincode,
      });
    } else {
      res.status(404).json({ detail: "User not found" });
    }
  } catch (error) {
    res.status(500).json({ detail: (error as Error).message });
  }
});
// ----------------------------


export default router;