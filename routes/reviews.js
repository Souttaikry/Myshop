const express = require("express");
const Review = require("../models/Review");
const { requireAuth, requireRole, optionalAuth } = require("../middleware/auth");

const router = express.Router();

// Average rating + count for every product, keyed by product id.
// Used to show star ratings on product cards without fetching every review.
// Public - guests browsing the shop should see ratings too.
router.get("/summary", optionalAuth, async (req, res) => {
  try {
    const rows = await Review.aggregate([
      {
        $group: {
          _id: "$product",
          avg: { $avg: "$rating" },
          count: { $sum: 1 },
        },
      },
    ]);
    const summary = {};
    rows.forEach((r) => {
      summary[r._id.toString()] = { avg: Math.round(r.avg * 10) / 10, count: r.count };
    });
    res.json(summary);
  } catch (err) {
    res.status(500).json({ message: "Could not load ratings.", error: err.message });
  }
});

// All reviews for one product, newest first - public
router.get("/:productId", optionalAuth, async (req, res) => {
  try {
    const reviews = await Review.find({ product: req.params.productId }).sort({ createdAt: -1 });
    res.json(reviews);
  } catch (err) {
    res.status(500).json({ message: "Could not load reviews.", error: err.message });
  }
});

// Customer: write or update their own review for a product
router.post("/", requireAuth, requireRole("customer"), async (req, res) => {
  try {
    const { productId, rating, comment } = req.body;
    const ratingNum = Number(rating);

    if (!productId || !ratingNum || ratingNum < 1 || ratingNum > 5) {
      return res.status(400).json({ message: "Pick a rating from 1 to 5 stars." });
    }

    const review = await Review.findOneAndUpdate(
      { product: productId, customer: req.user.id },
      {
        product: productId,
        customer: req.user.id,
        customerName: req.user.name,
        rating: ratingNum,
        comment: (comment || "").trim(),
      },
      { new: true, upsert: true, runValidators: true }
    );

    res.status(201).json(review);
  } catch (err) {
    res.status(500).json({ message: "Could not save your review.", error: err.message });
  }
});

// Customer: remove their own review
router.delete("/:id", requireAuth, requireRole("customer"), async (req, res) => {
  try {
    const review = await Review.findOne({ _id: req.params.id, customer: req.user.id });
    if (!review) return res.status(404).json({ message: "Review not found." });
    await review.deleteOne();
    res.json({ message: "Review removed." });
  } catch (err) {
    res.status(500).json({ message: "Could not remove review.", error: err.message });
  }
});

module.exports = router;
