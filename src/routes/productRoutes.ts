import express from "express";
import Product from "../models/Product";
import { protect, authorize, AuthRequest } from "../middleware/authMiddleware";
import { upload } from "../utils/cloudinary";

const router = express.Router();

// GET /products - Get all products (with search & filter)
// GET /products
router.get("/", async (req, res) => {
  try {
    const { search, factory_id, category } = req.query; // <-- Add category
    let query: any = {};

    if (factory_id) query.factory_id = factory_id;

    // --- [ADD THIS FILTER] ---
    if (category && category !== "All") {
      query.category = category;
    }
    // -------------------------

    if (search) query.$text = { $search: search as string };

    const products = await Product.find(query).limit(100);
    res.json(products);
  } catch (error) {
    res.status(500).json({ detail: (error as Error).message });
  }
});

// GET /products/:id - Get single product
router.get("/:id", async (req, res) => {
  try {
    const product = await Product.findById(req.params.id);
    if (product) {
      res.json(product);
    } else {
      res.status(404).json({ detail: "Product not found" });
    }
  } catch (error) {
    res.status(404).json({ detail: "Product not found" });
  }
});

// POST /products - Create Product (Text Only)
router.post("/", protect, authorize("admin", "factory"), async (req: AuthRequest, res) => {
  try {
    const { name, description, price, stock_quantity, sku ,category } = req.body;

    // Duplicate SKU check
    if (sku) {
      const exists = await Product.findOne({ sku });
      if (exists) return res.status(400).json({ detail: "SKU already exists" });
    }

    const product = await Product.create({
      name,
      description,
      price,
      stock_quantity,
      sku,
      category: category || "Others",
      factory_id: req.user._id, // Auto-assign factory ID
      images: []
    });

    res.status(201).json(product);
  } catch (error) {
    res.status(500).json({ detail: (error as Error).message });
  }
});



// PUT /products/:id - Update Product
router.put("/:id", protect, authorize("admin", "factory"), async (req: AuthRequest, res) => {
  try {
    const product = await Product.findById(req.params.id);

    if (!product) return res.status(404).json({ detail: "Product not found" });

    // Check ownership
    if (req.user.role === "factory" && product.factory_id.toString() !== req.user._id.toString()) {
      return res.status(403).json({ detail: "Not authorized to update this product" });
    }

    // Update fields
    Object.assign(product, req.body);
    const updatedProduct = await product.save();
    res.json(updatedProduct);

  } catch (error) {
    res.status(500).json({ detail: (error as Error).message });
  }
});

// POST /products/:id/upload-image - Upload Image
router.post("/:id/upload-image", protect, authorize("admin", "factory"), upload.single("file"), async (req: AuthRequest, res: any) => {
  try {
    const product = await Product.findById(req.params.id);
    if (!product) return res.status(404).json({ detail: "Product not found" });

    // Check ownership
    if (req.user.role === "factory" && product.factory_id.toString() !== req.user._id.toString()) {
      return res.status(403).json({ detail: "Not authorized" });
    }

    if (!req.file || !req.file.path) {
      return res.status(400).json({ detail: "No file uploaded" });
    }

    // Cloudinary returns the URL in req.file.path
    const imageUrl = req.file.path;
    
    product.images.push(imageUrl);
    await product.save();

    res.json(product);

  } catch (error) {
    res.status(500).json({ detail: (error as Error).message });
  }
});

export default router;