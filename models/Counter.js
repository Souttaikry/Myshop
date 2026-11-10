const mongoose = require("mongoose");

// Generic atomic counter collection. One document per sequence name
// (e.g. "invoiceNumber"), incremented with $inc so concurrent checkouts
// never get the same number.
const counterSchema = new mongoose.Schema({
  _id: { type: String, required: true },
  seq: { type: Number, default: 0 },
});

module.exports = mongoose.model("Counter", counterSchema);
