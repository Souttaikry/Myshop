const express = require("express");
const Supplier = require("../models/Supplier");
const { requireAuth, requireRole } = require("../middleware/auth");

const router = express.Router();

// Every route here is admin-only.
router.use(requireAuth, requireRole("admin"));

// List all suppliers
router.get("/", async (req, res) => {
  try {
    const suppliers = await Supplier.find().sort({ name: 1 });
    res.json(suppliers);
  } catch (err) {
    res.status(500).json({ message: "Could not load suppliers.", error: err.message });
  }
});

// Create a supplier
router.post("/", async (req, res) => {
  try {
    const { name, contactName, email, phone, address, notes } = req.body;
    if (!name || !name.trim()) {
      return res.status(400).json({ message: "Supplier name is required." });
    }
    const supplier = await Supplier.create({
      name: name.trim(),
      contactName,
      email,
      phone,
      address,
      notes,
    });
    res.status(201).json(supplier);
  } catch (err) {
    res.status(500).json({ message: "Could not create supplier.", error: err.message });
  }
});

// Update a supplier
router.put("/:id", async (req, res) => {
  try {
    const updates = { ...req.body };
    delete updates._id;
    const supplier = await Supplier.findByIdAndUpdate(req.params.id, updates, {
      new: true,
      runValidators: true,
    });
    if (!supplier) return res.status(404).json({ message: "Supplier not found." });
    res.json(supplier);
  } catch (err) {
    res.status(500).json({ message: "Could not update supplier.", error: err.message });
  }
});

// Delete a supplier
router.delete("/:id", async (req, res) => {
  try {
    const supplier = await Supplier.findByIdAndDelete(req.params.id);
    if (!supplier) return res.status(404).json({ message: "Supplier not found." });
    res.json({ message: "Supplier deleted." });
  } catch (err) {
    res.status(500).json({ message: "Could not delete supplier.", error: err.message });
  }
});

module.exports = router;
