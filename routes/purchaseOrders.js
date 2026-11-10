const express = require("express");
const PurchaseOrder = require("../models/PurchaseOrder");
const Product = require("../models/Product");
const Supplier = require("../models/Supplier");
const { requireAuth, requireRole } = require("../middleware/auth");

const router = express.Router();

// Every route here is admin-only.
router.use(requireAuth, requireRole("admin"));

// List all purchase orders, newest first
router.get("/", async (req, res) => {
  try {
    const orders = await PurchaseOrder.find()
      .sort({ createdAt: -1 })
      .populate("supplier", "name");
    res.json(orders);
  } catch (err) {
    res.status(500).json({ message: "Could not load purchase orders.", error: err.message });
  }
});

// Create a purchase order (does NOT touch stock yet - stock is only
// added once the order is marked "received")
router.post("/", async (req, res) => {
  try {
    const { supplier, items, notes } = req.body;

    if (!supplier) return res.status(400).json({ message: "Choose a supplier." });
    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ message: "Add at least one item to the order." });
    }

    const supplierDoc = await Supplier.findById(supplier);
    if (!supplierDoc) return res.status(404).json({ message: "Supplier not found." });

    const poItems = [];
    let totalCost = 0;

    for (const line of items) {
      const product = await Product.findById(line.productId);
      if (!product) return res.status(400).json({ message: "One of the selected products was not found." });

      const qty = Number(line.quantity);
      const unitCost = Number(line.unitCost);

      if (!Number.isFinite(qty) || qty <= 0) {
        return res.status(400).json({ message: `Enter a valid quantity for "${product.name}".` });
      }
      if (!Number.isFinite(unitCost) || unitCost < 0) {
        return res.status(400).json({ message: `Enter a valid unit cost for "${product.name}".` });
      }

      const subtotal = qty * unitCost;
      totalCost += subtotal;

      poItems.push({
        product: product._id,
        name: product.name,
        quantity: qty,
        unitCost,
        subtotal,
      });
    }

    const po = await PurchaseOrder.create({
      supplier,
      items: poItems,
      totalCost,
      notes: (notes || "").trim(),
      status: "pending",
    });

    await po.populate("supplier", "name");
    res.status(201).json(po);
  } catch (err) {
    res.status(500).json({ message: "Could not create purchase order.", error: err.message });
  }
});

// Mark a purchase order received - this is what actually adds the
// ordered quantities to each product's stock.
router.patch("/:id/receive", async (req, res) => {
  try {
    const po = await PurchaseOrder.findById(req.params.id);
    if (!po) return res.status(404).json({ message: "Purchase order not found." });
    if (po.status === "received") return res.status(400).json({ message: "This order was already marked received." });
    if (po.status === "cancelled") return res.status(400).json({ message: "This order was cancelled." });

    for (const line of po.items) {
      await Product.findByIdAndUpdate(line.product, { $inc: { stock: line.quantity } });
    }

    po.status = "received";
    po.receivedAt = new Date();
    await po.save();
    await po.populate("supplier", "name");
    res.json(po);
  } catch (err) {
    res.status(500).json({ message: "Could not mark order received.", error: err.message });
  }
});

// Cancel a still-pending purchase order
router.patch("/:id/cancel", async (req, res) => {
  try {
    const po = await PurchaseOrder.findById(req.params.id);
    if (!po) return res.status(404).json({ message: "Purchase order not found." });
    if (po.status !== "pending") {
      return res.status(400).json({ message: "Only pending orders can be cancelled." });
    }
    po.status = "cancelled";
    await po.save();
    await po.populate("supplier", "name");
    res.json(po);
  } catch (err) {
    res.status(500).json({ message: "Could not cancel purchase order.", error: err.message });
  }
});

// Delete a purchase order (only if it never affected stock)
router.delete("/:id", async (req, res) => {
  try {
    const po = await PurchaseOrder.findById(req.params.id);
    if (!po) return res.status(404).json({ message: "Purchase order not found." });
    if (po.status === "received") {
      return res.status(400).json({ message: "Received orders can't be deleted since they already added stock." });
    }
    await po.deleteOne();
    res.json({ message: "Purchase order deleted." });
  } catch (err) {
    res.status(500).json({ message: "Could not delete purchase order.", error: err.message });
  }
});

module.exports = router;
