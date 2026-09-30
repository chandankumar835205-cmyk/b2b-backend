const express = require("express");
const jwt = require("jsonwebtoken");
const User = require("../models/User");
const { sendSmsOtp } = require("../utils/notificationService");

const router = express.Router();

// Store OTPs in memory (In production, use Redis)
const otpStore = {};

// POST /otp/generate
router.post("/generate", async (req, res) => {
  const { phone } = req.body;
  if (!phone) return res.status(400).json({ detail: "Phone required" });

  const user = await User.findOne({ phone });
  if (!user) return res.status(404).json({ detail: "User not found with this phone" });

  // Generate 4 digit OTP
  const otp = Math.floor(1000 + Math.random() * 9000).toString();
  otpStore[phone] = otp;

  await sendSmsOtp(phone, otp);

  console.log(`🔑 Debug OTP for ${phone}: ${otp}`);

  res.json({ message: "OTP sent successfully" });
});

// POST /otp/verify
router.post("/verify", async (req, res) => {
  const { phone, otp } = req.body;
  
  // Check if OTP matches
  if (otpStore[phone] === otp) {
    const user = await User.findOne({ phone });
    if (!user) return res.status(404).json({ detail: "User not found" });

    delete otpStore[phone];

    const access_token = jwt.sign(
      { sub: user.email, role: user.role, id: user._id }, 
      process.env.JWT_SECRET_KEY || "secret", 
      { expiresIn: "30d" }
    );

    res.json({
      access_token,
      token_type: "bearer",
      user
    });
  } else {
    res.status(400).json({ detail: "Invalid OTP" });
  }
});

module.exports = router;
