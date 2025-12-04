

import dotenv from "dotenv";
dotenv.config(); // Load config immediately
import { CorsOptions } from "cors";
import express from "express";
import cors from "cors";

import morgan from "morgan";
import connectDB from "./config/db";
import authRoutes from "./routes/authRoutes";
import productRoutes from "./routes/productRoutes";
import orderRoutes from "./routes/orderRoutes"; 
import paymentRoutes from "./routes/paymentRoutes";
import adminRoutes from "./routes/adminRoutes"; 
import otpRoutes from "./routes/otpRoutes"; 

// --- [CRITICAL FIX: Define ROBUST CORS Options] ---
// This list MUST include all domains that will host the frontend (the client).
const ALLOWED_ORIGINS = [
    "http://localhost:3000", // Local Web Testing
    "http://localhost:8081", // Local Mobile Testing
    
    // 1. YOUR PRIMARY VERCEL URL (Use HTTPS)
    "https://b2b-frontend-kwv9.vercel.app", 

    // 2. WILD CARD FIX: Allows ALL Vercel subdomains (e.g., branch previews)
    /^https:\/\/.+\.vercel\.app$/,
];



const corsOptions: CorsOptions = {
  origin: (origin, callback) => {
    // Allow mobile app (no Origin header)
    if (!origin) {
      return callback(null, true);
    }

    const allowed =
      ALLOWED_ORIGINS.includes(origin) ||
      ALLOWED_ORIGINS.some(p => p instanceof RegExp && p.test(origin));

    if (allowed) {
      callback(null, true);
    } else {
      console.error("CORS blocked origin:", origin);
      callback(new Error("Not allowed by CORS"));
    }
  },
  credentials: true,
  optionsSuccessStatus: 200,
};


// ------------------------------------------

// Connect to Database
connectDB();

const app = express();

// Middleware
app.use(express.json());

app.use(express.urlencoded({ extended: true }));

// CORS ALWAYS BEFORE routes
app.use(cors());

// ROUTES
app.use("/auth", authRoutes);
app.use("/otp", otpRoutes);
app.use("/products", productRoutes);
app.use("/orders", orderRoutes);
app.use("/payments", paymentRoutes);
app.use("/admin", adminRoutes);

// MORGAN MUST BE LAST (AFTER ROUTES)
app.use(morgan("dev"));

// Start Server
const PORT = process.env.PORT || 8000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});