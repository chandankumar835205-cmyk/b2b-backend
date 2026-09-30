const express = require("express");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const User = require("../models/User");
const { protect } = require("../middleware/authMiddleware");

const router = express.Router();

// Helper to generate JWT
const generateToken = (id, role, email) => {
  return jwt.sign({ sub: email, role, id }, process.env.JWT_SECRET_KEY || "secret", {
    expiresIn: "30d",
  });
};

// POST /auth/signup
router.post("/signup", async (req, res) => {
  try {
    const { email, password, role, full_name, phone, address_line_1, city, district, state, pincode } = req.body;

    const userExists = await User.findOne({ email });
    if (userExists) {
      return res.status(400).json({ detail: "Email already registered" });
    }

    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);

    const user = await User.create({
      full_name,
      email,
      phone,
      hashed_password: hashedPassword,
      role: role || "shop",
      address_line_1,
      city,
      district,
      state,
      pincode,
    });

    res.status(201).json(user);
  } catch (error) {
    res.status(500).json({ detail: error.message });
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
        user: {
          ...user.toObject(),
          is_blocked: user.is_blocked
        }
      });
    } else {
      res.status(401).json({ detail: "Incorrect email or password" });
    }
  } catch (error) {
    res.status(500).json({ detail: error.message });
  }
});

// GET /auth/me - Get current user profile
router.get("/me", protect, async (req, res) => {
  if (req.user) {
    res.json(req.user);
  } else {
    res.status(404).json({ detail: "User not found" });
  }
});

// PUT /auth/me - Update User Profile (Address)
router.put("/me", protect, async (req, res) => {
  try {
    const user = await User.findById(req.user._id);

    if (user) {
      user.address_line_1 = req.body.address_line_1 || user.address_line_1;
      user.city = req.body.city || user.city;
      user.district = req.body.district || user.district;
      user.state = req.body.state || user.state;
      user.pincode = req.body.pincode || user.pincode;

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
    res.status(500).json({ detail: error.message });
  }
});

module.exports = router;
