const mongoose = require("mongoose");

const saleItemSchema = new mongoose.Schema(
  {
    product: { type: mongoose.Schema.Types.ObjectId, ref: "Product", required: true },
    name: { type: String, required: true },
    unitPrice: { type: Number, required: true, min: 0 },
    quantity: { type: Number, required: true, min: 1 },
    subtotal: { type: Number, required: true, min: 0 },
  },
  { _id: false }
);

const saleSchema = new mongoose.Schema(
  {
    customer: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    items: {
      type: [saleItemSchema],
      required: true,
      validate: { validator: (v) => Array.isArray(v) && v.length > 0, message: "Sale must have at least one item." },
    },
    total: { type: Number, required: true, min: 0 },
    paymentMethod: { type: String, enum: ["cod", "card", "wallet"], default: "cod" },
    paymentReference: { type: String, default: "" },
    status: { type: String, enum: ["pending", "completed", "cancelled"], default: "pending" },
    // Set right after the matching Invoice document is created, so any
    // page that already loads a Sale/order can link straight to its
    // invoice without a second lookup.
    invoice: { type: mongoose.Schema.Types.ObjectId, ref: "Invoice", default: null },
  },
  { timestamps: true }
);

module.exports = mongoose.model("Sale", saleSchema);