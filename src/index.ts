import dotenv from "dotenv";
dotenv.config();
import express from "express";

import cors from "cors";
import morgan from "morgan";
import connectDB from "./config/db";
import authRoutes from "./routes/authRoutes";
import productRoutes from "./routes/productRoutes";
import orderRoutes from "./routes/orderRoutes";     // <-- Import
import paymentRoutes from "./routes/paymentRoutes";
import adminRoutes from "./routes/adminRoutes"; // <-- Import
import otpRoutes from "./routes/otpRoutes";



// Connect to Database
connectDB();

const app = express();

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true })); // For x-www-form-urlencoded (Mobile Login)
app.use(cors());
app.use(morgan("dev")); // Logging

// Routes
app.get("/", (req, res) => {
  res.json({ message: "API is running (Node.js)" });
});

// We will create this file in a moment
app.use("/auth", authRoutes);
app.use("/otp", otpRoutes);
app.use("/products", productRoutes);
app.use("/orders", orderRoutes);      // <-- Add
app.use("/payments", paymentRoutes);
app.use("/admin", adminRoutes); // <-- Add this


// Start Server
const PORT = process.env.PORT || 8000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});