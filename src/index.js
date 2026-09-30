require("dotenv").config();
const express = require("express");
const cors = require("cors");
const morgan = require("morgan");
const connectDB = require("./config/db");
const authRoutes = require("./routes/authRoutes");
const productRoutes = require("./routes/productRoutes");
const orderRoutes = require("./routes/orderRoutes");
const paymentRoutes = require("./routes/paymentRoutes");
const adminRoutes = require("./routes/adminRoutes");
const otpRoutes = require("./routes/otpRoutes");

// CORS Configuration
const ALLOWED_ORIGINS = [
  "http://localhost:3000",
  "http://localhost:8081",
  "http://10.203.124.214:3000",
  "https://b2b-frontend-kwv9.vercel.app", 
  /^https:\/\/.+\.vercel\.app$/,
];

const corsOptions = {
  origin: (origin, callback) => {
    // Allow mobile app (no Origin header)
    if (!origin) {
      return callback(null, true);
    }

    const allowed =
      ALLOWED_ORIGINS.includes(origin) ||
      ALLOWED_ORIGINS.some((p) => p instanceof RegExp && p.test(origin));

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

// Logger Middleware
app.use(morgan("dev"));

// Start Server
const PORT = process.env.PORT || 8000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
