const express = require("express");
const Invoice = require("../models/Invoice");
const { requireAuth } = require("../middleware/auth");

const router = express.Router();

// ============================================================
// LIST: my invoices (admins see everyone's)
// GET /api/invoices
// ============================================================

router.get("/", requireAuth, async (req, res) => {
  try {
    const filter = req.user.role === "admin" ? {} : { customer: req.user.id };
    const invoices = await Invoice.find(filter).sort({ createdAt: -1 }).lean();
    res.json(invoices);
  } catch (err) {
    console.error("Load invoices error:", err);
    res.status(500).json({ message: "Could not load invoices." });
  }
});

// ============================================================
// SINGLE INVOICE (the page shown right after checkout)
// GET /api/invoices/:id
// ============================================================

router.get("/:id", requireAuth, async (req, res) => {
  try {
    const invoice = await Invoice.findById(req.params.id).lean();

    if (!invoice) {
      return res.status(404).json({ message: "Invoice not found." });
    }

    // Customers can only view their own invoice; admins can view any.
    if (req.user.role !== "admin" && String(invoice.customer) !== String(req.user.id)) {
      return res.status(403).json({ message: "You don't have access to this invoice." });
    }

    res.json(invoice);
  } catch (err) {
    console.error("Load invoice error:", err);
    res.status(404).json({ message: "Invoice not found." });
  }
});

module.exports = router;
