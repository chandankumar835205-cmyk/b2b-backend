import express from "express";
import jwt from "jsonwebtoken";
import User from "../models/User";
import { sendSmsOtp } from "../utils/notificationService"; // <--- IMPORT THIS

const router = express.Router();

// Store OTPs in memory (In production, use Redis)
const otpStore: Record<string, string> = {};

// POST /otp/generate
router.post("/generate", async (req, res) => {
  const { phone } = req.body;
  if (!phone) return res.status(400).json({ detail: "Phone required" });

  const user = await User.findOne({ phone });
  if (!user) return res.status(404).json({ detail: "User not found with this phone" });

  // Generate 4 digit OTP
  const otp = Math.floor(1000 + Math.random() * 9000).toString();
  otpStore[phone] = otp;

  // --- REAL SMS SENDING ---
  // We call the helper function but don't await it strictly if we want faster response
  // (or await it if you want to confirm sending before responding)
  await sendSmsOtp(phone, otp);
  // ------------------------

  // Log for development debugging (keep this if you want to see it in console too)
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

    delete otpStore[phone]; // Clear used OTP

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

export default router;