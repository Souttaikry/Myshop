const mongoose = require("mongoose");
const Counter = require("./Counter");

const invoiceItemSchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    unitPrice: { type: Number, required: true, min: 0 },
    quantity: { type: Number, required: true, min: 1 },
    subtotal: { type: Number, required: true, min: 0 },
  },
  { _id: false }
);

const invoiceSchema = new mongoose.Schema(
  {
    invoiceNumber: { type: String, required: true, unique: true },

    // Link back to the Sale/order this invoice was generated for.
    sale: { type: mongoose.Schema.Types.ObjectId, ref: "Sale", required: true },

    customer: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    // Snapshot the customer's details at the time of purchase, so the
    // invoice still reads correctly even if the account is edited later.
    customerName: { type: String, required: true },
    customerEmail: { type: String, required: true },

    items: {
      type: [invoiceItemSchema],
      required: true,
      validate: { validator: (v) => Array.isArray(v) && v.length > 0, message: "Invoice must have at least one item." },
    },

    subtotal: { type: Number, required: true, min: 0 },
    total: { type: Number, required: true, min: 0 },

    paymentMethod: { type: String, enum: ["cod", "card", "wallet"], default: "cod" },
    paymentReference: { type: String, default: "" },

    // "paid": card/wallet paid at checkout. "pending": cash on delivery,
    // money not collected yet. "refunded": set manually if an order is
    // later cancelled/refunded.
    status: { type: String, enum: ["paid", "pending", "refunded"], default: "paid" },
  },
  { timestamps: true }
);

// Atomically reserve the next invoice number, e.g. INV-2026-00001.
invoiceSchema.statics.generateNumber = async function () {
  const year = new Date().getFullYear();
  const counter = await Counter.findByIdAndUpdate(
    `invoiceNumber:${year}`,
    { $inc: { seq: 1 } },
    { new: true, upsert: true }
  );
  return `INV-${year}-${String(counter.seq).padStart(5, "0")}`;
};

module.exports = mongoose.model("Invoice", invoiceSchema);
