const express = require("express");
const User = require("../models/User");
const Sale = require("../models/Sale");
const { requireAuth, requireRole } = require("../middleware/auth");

const router = express.Router();

// =====================================================
// ADMIN ONLY
// =====================================================
router.use(requireAuth, requireRole("admin"));

// =====================================================
// GET ALL CUSTOMERS
// GET /api/customers
// =====================================================
router.get("/", async (req, res) => {
    try {
        // Get customers from users collection
        const customers = await User.find({
            role: "customer"
        })
            .select("-password")
            .sort({ createdAt: -1 })
            .lean();

        // Get order/sales statistics
        const stats = await Sale.aggregate([
            {
                $match: {
                    status: {
                        $ne: "cancelled"
                    }
                }
            },
            {
                $group: {
                    _id: "$customer",
                    totalOrders: {
                        $sum: 1
                    },
                    totalSpent: {
                        $sum: {
                            $ifNull: ["$total", 0]
                        }
                    },
                    lastOrderAt: {
                        $max: "$createdAt"
                    }
                }
            }
        ]);

        // Convert statistics to a map
        const statsMap = {};

        stats.forEach((s) => {
            if (s._id) {
                statsMap[s._id.toString()] = s;
            }
        });

        // Combine users + sales statistics
        const result = customers.map((customer) => {

            const customerId = customer._id.toString();

            const stat = statsMap[customerId];

            return {
                _id: customer._id,
                name: customer.name,
                email: customer.email,
                role: customer.role,
                createdAt: customer.createdAt,

                totalOrders: stat
                    ? stat.totalOrders
                    : 0,

                totalSpent: stat
                    ? stat.totalSpent
                    : 0,

                lastOrderAt: stat
                    ? stat.lastOrderAt
                    : null
            };
        });

        res.json(result);

    } catch (err) {

        console.error("GET CUSTOMERS ERROR:", err);

        res.status(500).json({
            message: "Could not load customers.",
            error: err.message
        });
    }
});

module.exports = router;