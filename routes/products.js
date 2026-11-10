const express = require("express");
const path = require("path");
const fs = require("fs");
const multer = require("multer");
const Product = require("../models/Product");
const { requireAuth, requireRole, optionalAuth } = require("../middleware/auth");

const router = express.Router();

// ---- Image upload (from the admin's computer) ----
const uploadDir = path.join(__dirname, "..", "public", "uploads", "products");
fs.mkdirSync(uploadDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const safeName = `product-${Date.now()}-${Math.round(Math.random() * 1e9)}${ext}`;
    cb(null, safeName);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
  fileFilter: (req, file, cb) => {
    const allowed = /jpeg|jpg|png|gif|webp/;
    const ok = allowed.test(path.extname(file.originalname).toLowerCase()) && allowed.test(file.mimetype);
    cb(ok ? null : new Error("Only image files (jpg, png, gif, webp) are allowed."), ok);
  },
});

// Admin only: upload a product photo from disk, returns the URL to save on the product
router.post("/upload-image", requireAuth, requireRole("admin"), (req, res) => {
  upload.single("image")(req, res, (err) => {
    if (err) return res.status(400).json({ message: err.message });
    if (!req.file) return res.status(400).json({ message: "No image file received." });
    const imageUrl = `/uploads/products/${req.file.filename}`;
    res.status(201).json({ imageUrl });
  });
});

// List products - public (guests browsing the shop see active products too;
// only logged-in admins see inactive/out-of-catalog items).
router.get("/", optionalAuth, async (req, res) => {
  try {
    const filter = req.user && req.user.role === "admin" ? {} : { active: true };
    const products = await Product.find(filter).sort({ createdAt: -1 });
    res.json(products);
  } catch (err) {
    res.status(500).json({ message: "Could not load products.", error: err.message });
  }
});

// Get one product - public
router.get("/:id", optionalAuth, async (req, res) => {
  try {
    const product = await Product.findById(req.params.id);
    if (!product) return res.status(404).json({ message: "Product not found." });
    res.json(product);
  } catch (err) {
    res.status(500).json({ message: "Could not load product.", error: err.message });
  }
});

// Admin only: create product
router.post("/", requireAuth, requireRole("admin"), async (req, res) => {
  try {
    const { name, sku, category, price, cost, stock, lowStockThreshold, description, imageUrl } = req.body;
    if (!name || !sku || price === undefined || stock === undefined) {
      return res.status(400).json({ message: "Name, SKU, price and stock are required." });
    }
    const product = await Product.create({
      name, sku, category, price, cost, stock, lowStockThreshold, description, imageUrl,
    });
    res.status(201).json(product);
  } catch (err) {
    if (err.code === 11000) {
      return res.status(409).json({ message: "A product with this SKU already exists." });
    }
    res.status(500).json({ message: "Could not create product.", error: err.message });
  }
});

// Admin only: update product (details or stock adjustment)
router.put("/:id", requireAuth, requireRole("admin"), async (req, res) => {
  try {
    const updates = { ...req.body };
    delete updates._id;

    const product = await Product.findByIdAndUpdate(req.params.id, updates, {
      new: true,
      runValidators: true,
    });
    if (!product) return res.status(404).json({ message: "Product not found." });
    res.json(product);
  } catch (err) {
    res.status(500).json({ message: "Could not update product.", error: err.message });
  }
});

// Admin only: delete product
router.delete("/:id", requireAuth, requireRole("admin"), async (req, res) => {
  try {
    const product = await Product.findByIdAndDelete(req.params.id);
    if (!product) return res.status(404).json({ message: "Product not found." });
    res.json({ message: "Product deleted." });
  } catch (err) {
    res.status(500).json({ message: "Could not delete product.", error: err.message });
  }
});

module.exports = router;
