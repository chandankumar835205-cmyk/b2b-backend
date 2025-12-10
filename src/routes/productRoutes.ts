import express from "express";
import Product from "../models/Product";
import { protect, authorize, AuthRequest } from "../middleware/authMiddleware";
import { upload } from "../utils/cloudinary";

const router = express.Router();

// Helper to calculate final prices
const augmentProductData = (product: any) => {
    const p = product.toObject ? product.toObject({ virtuals: true }) : product; 
    const commissionRate = p.commission_rate || 0;
    
    if (p.selling_units && p.selling_units.length > 0) {
        const augmentedUnits = p.selling_units.map((unit: any) => ({
            ...unit,
            final_unit_price: Math.ceil(unit.factory_unit_price * (1 + commissionRate / 100)), 
        }));
        
        const cheapest = augmentedUnits.reduce((min: any, u: any) => 
            u.final_unit_price < min.final_unit_price ? u : min, augmentedUnits[0]);

        return { ...p, selling_units: augmentedUnits, min_selling_price: cheapest.final_unit_price };
    }
    return p;
};

// 1. PUBLIC GET
router.get("/", async (req, res) => {
  try {
    const { search, factory_id, category } = req.query; 
    let query: any = {};

    if (factory_id) {
        query.factory_id = factory_id;
    } else {
        query.is_active = true; 
    }

    if (category && category !== "All") query.category = category;
    if (search) query.$text = { $search: search as string };

    const products = await Product.find(query).limit(100);
    res.json(products.map(augmentProductData));
  } catch (error) {
    res.status(500).json({ detail: (error as Error).message });
  }
});

// 2. ADMIN GET (All Products)
router.get("/admin/all", protect, authorize("admin"), async (req, res) => {
    try {
        const { search } = req.query;
        let query: any = {};
        if (search) query.$text = { $search: search as string };
        const products = await Product.find(query).sort({ createdAt: -1 }).limit(100);
        res.json(products.map(augmentProductData));
    } catch (error) {
        res.status(500).json({ detail: (error as Error).message });
    }
});

router.get("/suggest", async (req, res) => {
    try {
      const search = (req.query.search as string) || "";
      if (!search.trim()) return res.json([]);
      const regex = new RegExp("^" + search, "i");
      const products = await Product.find({ name: { $regex: regex }, is_active: true }, { name: 1 }).limit(8);
      res.json(products.map((p: any) => p.name || ""));
    } catch (error: any) { res.status(500).json({ detail: error.message }); }
});

// GET /products/:id - Get single product (with Factory Details)
router.get("/:id", async (req, res) => {
  try {
    // ⭐ FIXED: Populate factory_id to get name and email
    const product = await Product.findById(req.params.id)
      .populate("factory_id", "full_name email _id"); 

    if (product) {
      res.json(augmentProductData(product));
    } else {
      res.status(404).json({ detail: "Product not found" });
    }
  } catch (error) {
    res.status(404).json({ detail: "Product not found" });
  }
});

// 3. POST (Create)
router.post("/", protect, authorize("admin", "factory"), async (req: AuthRequest, res) => {
  try {
    const { name, description, selling_units, sku, category } = req.body;

    if (!selling_units || !Array.isArray(selling_units) || selling_units.length === 0) {
        return res.status(400).json({ detail: "Product must have at least one selling unit." });
    }

    const product = await Product.create({
      name,
      description,
      selling_units,
      commission_rate: 0,
      is_active: false,
      sku,
      category: category || "Others",
      factory_id: req.user._id, 
      images: []
    });

    res.status(201).json(product);
  } catch (error) {
    res.status(500).json({ detail: (error as Error).message });
  }
});

// 4. PUT (Update - FULL ADMIN POWER)
router.put("/:id", protect, authorize("admin", "factory"), async (req: AuthRequest, res) => {
  try {
    const product = await Product.findById(req.params.id);
    if (!product) return res.status(404).json({ detail: "Product not found" });

    // Factory Restrictions
    if (req.user.role === "factory") {
      if (product.factory_id.toString() !== req.user._id.toString()) {
        return res.status(403).json({ detail: "Not authorized" });
      }
      delete req.body.commission_rate;
      delete req.body.is_active; 
    }

    // Common Updates (Admin & Owner Factory)
    if (req.body.name) product.name = req.body.name;
    if (req.body.description) product.description = req.body.description;
    if (req.body.category) product.category = req.body.category;
    if (req.body.sku) product.sku = req.body.sku;
    
    // ⭐ Allow updating images array (e.g. for deletion/reordering)
    if (req.body.images && Array.isArray(req.body.images)) {
        product.images = req.body.images;
    }

    if (req.body.selling_units && Array.isArray(req.body.selling_units) && req.body.selling_units.length > 0) {
        product.selling_units = req.body.selling_units;
    }

    // Admin Specific Logic
    if (req.user.role === "admin") {
        if (req.body.commission_rate !== undefined) {
            product.commission_rate = req.body.commission_rate;
            // Activate if commission is set (and product was inactive)
            product.is_active = true; 
        }
        if (req.body.is_active !== undefined) {
            product.is_active = req.body.is_active;
        }
    }

    const updatedProduct = await product.save();
    res.json(updatedProduct);

  } catch (error) {
    res.status(500).json({ detail: (error as Error).message });
  }
});

// 5. Upload Image
router.post("/:id/upload-image", protect, authorize("admin", "factory"), upload.single("file"), async (req: AuthRequest, res: any) => {
    try {
        const product = await Product.findById(req.params.id);
        if (!product) return res.status(404).json({ detail: "Not found" });
        
        // Admin can upload to ANY product. Factory only their own.
        if (req.user.role === "factory" && product.factory_id.toString() !== req.user._id.toString()) {
            return res.status(403).json({ detail: "Not authorized" });
        }

        if (!req.file) return res.status(400).json({ detail: "No file" });
        product.images.push(req.file.path);
        await product.save();
        res.json(product);
    } catch (e) { res.status(500).json({ detail: (e as Error).message }); }
});

export default router;