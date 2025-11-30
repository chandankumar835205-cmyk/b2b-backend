import dotenv from "dotenv";
dotenv.config(); // Load config immediately

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

// --- [CRITICAL FIX: Define CORS Options] ---
// Get your specific Vercel URL from the error logs or your Vercel dashboard.
const ALLOWED_ORIGINS = [
  "http://localhost:3000", // Local Web Testing
  "http://localhost:8081", // Local Mobile Testing
  
  // REPLACE THIS WITH YOUR LIVE VERCEL DOMAIN
  // Example domain from your previous log: "https://b2b-frontend-kwv9.vercel.app"
  "https://b2b-frontend-kwv9.vercel.app", 
];

const corsOptions = {
  origin: (origin: string | undefined, callback: (err: Error | null, allow?: boolean) => void) => {
    // If the origin is in our allowed list, or if it's a non-browser request (like cURL or Mobile App), allow it.
    if (!origin || ALLOWED_ORIGINS.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'), false);
    }
  },
  credentials: true, // Allows JWTs and session cookies to be sent
};
// ------------------------------------------

// Connect to Database
connectDB();

const app = express();

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true })); 
app.use(morgan("dev")); 

// Apply the WHITELISTED CORS policy
app.use(cors(corsOptions)); 

// Routes
app.get("/", (req, res) => {
  res.json({ message: "API is running (Node.js)" });
});

app.use("/auth", authRoutes);
app.use("/otp", otpRoutes);
app.use("/products", productRoutes);
app.use("/orders", orderRoutes); 
app.use("/payments", paymentRoutes);
app.use("/admin", adminRoutes); 


// Start Server
const PORT = process.env.PORT || 8000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});