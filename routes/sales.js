const express = require("express");
const Product = require("../models/Product");
const Sale = require("../models/Sale");
const Invoice = require("../models/Invoice");
const User = require("../models/User");
const { requireAuth, requireRole } = require("../middleware/auth");
const QRCode = require("qrcode");
const axios = require("axios");

const router = express.Router();

// ============================================================
// KHQR
// ============================================================

async function generateKHQR({ amount, billNumber }) {
  const { BakongKHQR, khqrData, IndividualInfo } =
    await import("bakong-khqr");

  const optionalData = {
    currency: khqrData.currency.usd,
    amount: amount,
    billNumber: billNumber,
    storeLabel: "COSTME",
    terminalLabel: "Web",
  };

  const individualInfo = new IndividualInfo(
    "YOUR_BAKONG_ACCOUNT_ID",
    "COSTME",
    "Phnom Penh",
    optionalData
  );

  const khqr = new BakongKHQR();

  const response = khqr.generateIndividual(individualInfo);

  return response.data.qr;
}

// ============================================================
// TELEGRAM
// ============================================================

async function notifyTelegram(saleDoc) {
  try {
    const itemsList = saleDoc.items
      .map((item) => `${item.quantity}x ${item.name}`)
      .join(", ");

    const text =
      `🛒 New Sale!\n` +
      `Items: ${itemsList}\n` +
      `Total: $${Number(saleDoc.total).toFixed(2)}\n` +
      `Payment: ${saleDoc.paymentMethod}`;

    await axios.post(
      `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`,
      {
        chat_id: process.env.TELEGRAM_CHAT_ID,
        text,
      }
    );
  } catch (err) {
    console.error("Telegram notify failed:", err.message);
  }
}

// ============================================================
// CUSTOMER: CREATE SALE / ORDER
// POST /api/sales
// ============================================================

router.post(
  "/",
  requireAuth,
  requireRole("customer"),
  async (req, res) => {
    try {
      const {
        items,
        paymentMethod,
        paymentReference,
      } = req.body;

      if (!Array.isArray(items) || items.length === 0) {
        return res.status(400).json({
          message: "Add at least one product to buy.",
        });
      }

      const allowedMethods = ["cod", "card", "wallet"];

      const method = allowedMethods.includes(paymentMethod)
        ? paymentMethod
        : "cod";

      const saleItems = [];
      let total = 0;

      // --------------------------------------------------------
      // Check products and stock
      // --------------------------------------------------------

      for (const line of items) {
        const product = await Product.findById(line.productId);

        if (!product || !product.active) {
          return res.status(400).json({
            message: "Product not found or unavailable.",
          });
        }

        const qty = Number(line.quantity);

        if (!Number.isInteger(qty) || qty <= 0) {
          return res.status(400).json({
            message: `Invalid quantity for ${product.name}.`,
          });
        }

        if (product.stock < qty) {
          return res.status(400).json({
            message:
              `Not enough stock for "${product.name}". ` +
              `Only ${product.stock} left.`,
          });
        }

        const subtotal = qty * product.price;

        total += subtotal;

        saleItems.push({
          product: product._id,
          name: product.name,
          unitPrice: product.price,
          quantity: qty,
          subtotal: subtotal,
        });
      }

      // --------------------------------------------------------
      // Reduce stock
      // --------------------------------------------------------

      for (const line of items) {
        const product = await Product.findById(line.productId);

        const qty = Number(line.quantity);

        product.stock -= qty;

        await product.save();
      }

      // --------------------------------------------------------
      // Create Sale document
      // --------------------------------------------------------

      const saleDoc = await Sale.create({
        customer: req.user.id,

        items: saleItems,

        total: total,

        paymentMethod: method,

        paymentReference: String(paymentReference || "").slice(
          0,
          40
        ),

        status: "pending",
      });

      // --------------------------------------------------------
      // Generate KHQR
      // --------------------------------------------------------

      let qrImage = null;

      if (method === "wallet") {
        const qrString = await generateKHQR({
          amount: total,
          billNumber: saleDoc._id.toString(),
        });

        qrImage = await QRCode.toDataURL(qrString);
      }

      // --------------------------------------------------------
      // Create Invoice record — this is the permanent payment
      // record saved in its own MongoDB collection. Card/wallet
      // orders are marked "paid" immediately; cash-on-delivery is
      // "pending" since money hasn't actually been collected yet.
      // --------------------------------------------------------

      const buyer = await User.findById(req.user.id).lean();
      const invoiceNumber = await Invoice.generateNumber();

      const invoiceDoc = await Invoice.create({
        invoiceNumber,
        sale: saleDoc._id,
        customer: req.user.id,
        customerName: buyer?.name || req.user.name || "Customer",
        customerEmail: buyer?.email || "",
        items: saleItems.map((line) => ({
          name: line.name,
          unitPrice: line.unitPrice,
          quantity: line.quantity,
          subtotal: line.subtotal,
        })),
        subtotal: total,
        total: total,
        paymentMethod: method,
        paymentReference: saleDoc.paymentReference,
        status: method === "cod" ? "pending" : "paid",
      });

      // Link the order back to its invoice so anywhere that already
      // loads Sales (e.g. the My Orders page) can jump straight to the
      // real invoice without a second lookup.
      saleDoc.invoice = invoiceDoc._id;
      await saleDoc.save();

      // --------------------------------------------------------
      // Telegram notification
      // --------------------------------------------------------

      notifyTelegram(saleDoc);

      // --------------------------------------------------------
      // Response
      // --------------------------------------------------------

      res.status(201).json({
        ...saleDoc.toObject(),
        qrImage,
        invoiceId: invoiceDoc._id,
        invoiceNumber: invoiceDoc.invoiceNumber,
      });
    } catch (err) {
      console.error("Create sale error:", err);

      res.status(400).json({
        message:
          err.message || "Could not complete purchase.",
      });
    }
  }
);

// ============================================================
// CUSTOMER: MY ORDERS
// GET /api/sales/me
// ============================================================

router.get(
  "/me",
  requireAuth,
  requireRole("customer"),
  async (req, res) => {
    try {
      const sales = await Sale.find({
        customer: req.user.id,
      })
        .sort({ createdAt: -1 })
        .lean();

      res.json(sales);
    } catch (err) {
      console.error("Load my orders error:", err);

      res.status(500).json({
        message: "Could not load your orders.",
      });
    }
  }
);

// ============================================================
// CUSTOMER: CANCEL OWN ORDER
// PATCH /api/sales/:id/cancel
// ============================================================

router.patch(
  "/:id/cancel",
  requireAuth,
  requireRole("customer"),
  async (req, res) => {
    try {
      const sale = await Sale.findOne({
        _id: req.params.id,
        customer: req.user.id,
      });

      if (!sale) {
        return res.status(404).json({
          message: "Order not found.",
        });
      }

      if (
        ["completed", "cancelled"].includes(
          String(sale.status).toLowerCase()
        )
      ) {
        return res.status(400).json({
          message:
            `Order is already ${sale.status} ` +
            `and can't be cancelled.`,
        });
      }

      // --------------------------------------------------------
      // Restock products
      // --------------------------------------------------------

      for (const line of sale.items) {
        if (line.product) {
          await Product.findByIdAndUpdate(
            line.product,
            {
              $inc: {
                stock: line.quantity,
              },
            }
          );
        }
      }

      sale.status = "cancelled";

      await sale.save();

      res.json(sale);
    } catch (err) {
      console.error("Cancel order error:", err);

      res.status(500).json({
        message: "Could not cancel order.",
      });
    }
  }
);

// ============================================================
// ADMIN: ALL SALES
// GET /api/sales
// ============================================================

router.get(
  "/",
  requireAuth,
  requireRole("admin"),
  async (req, res) => {
    try {
      const sales = await Sale.find()
        .sort({ createdAt: -1 })
        .populate("customer", "name")
        .lean();

      res.json(sales);
    } catch (err) {
      console.error("Load sales error:", err);

      res.status(500).json({
        message: "Could not load sales.",
      });
    }
  }
);

// ============================================================
// ADMIN: TODAY'S SUMMARY
// GET /api/sales/summary/today
// ============================================================

router.get(
  "/summary/today",
  requireAuth,
  requireRole("admin"),
  async (req, res) => {
    try {
      const startOfDay = new Date();

      startOfDay.setHours(0, 0, 0, 0);

      const sales = await Sale.find({
        createdAt: {
          $gte: startOfDay,
        },
        status: "completed",
      })
        .sort({ createdAt: -1 })
        .populate("customer", "name")
        .lean();

      let revenueToday = 0;

      let unitsSoldToday = 0;

      const revenueByPayment = {
        cod: 0,
        card: 0,
        wallet: 0,
      };

      const unitsByProductMap = {};

      const orders = sales.map((sale) => {
        revenueToday += Number(sale.total || 0);

        const payment =
          sale.paymentMethod || "cod";

        revenueByPayment[payment] =
          (revenueByPayment[payment] || 0) +
          Number(sale.total || 0);

        sale.items.forEach((item) => {
          const quantity = Number(
            item.quantity || 0
          );

          unitsSoldToday += quantity;

          if (!unitsByProductMap[item.name]) {
            unitsByProductMap[item.name] = {
              name: item.name,
              quantity: 0,
              revenue: 0,
            };
          }

          unitsByProductMap[item.name].quantity +=
            quantity;

          unitsByProductMap[item.name].revenue +=
            Number(item.subtotal || 0);
        });

        return {
          time: sale.createdAt,

          customerName:
            sale.customer?.name || "—",

          items: sale.items.map((item) => ({
            name: item.name,
            quantity: item.quantity,
          })),

          total: sale.total,

          paymentMethod:
            sale.paymentMethod,

          paymentReference:
            sale.paymentReference,

          status: sale.status,
        };
      });

      const unitsByProduct =
        Object.values(unitsByProductMap).sort(
          (a, b) => b.quantity - a.quantity
        );

      res.json({
        revenueToday,

        ordersToday: sales.length,

        unitsSoldToday,

        revenueByPayment,

        orders,

        unitsByProduct,
      });
    } catch (err) {
      console.error("Today's summary error:", err);

      res.status(500).json({
        message:
          "Could not load today's summary.",
      });
    }
  }
);

// ============================================================
// ADMIN: SALES & PROFIT ANALYSIS
// GET /api/sales/analysis?range=today|7|30|all
// ============================================================

router.get(
  "/analysis/summary",
  requireAuth,
  requireRole("admin"),
  async (req, res) => {
    try {
      const range = String(req.query.range || "7");

      // --------------------------------------------------------
      // Work out the date window
      // --------------------------------------------------------

      const match = { status: "completed" };

      if (range !== "all") {
        const start = new Date();

        if (range === "today") {
          start.setHours(0, 0, 0, 0);
        } else {
          const days = parseInt(range, 10) || 7;
          start.setHours(0, 0, 0, 0);
          start.setDate(start.getDate() - (days - 1));
        }

        match.createdAt = { $gte: start };
      }

      const sales = await Sale.find(match).lean();

      // --------------------------------------------------------
      // Cost lookup: pull current cost price per product so we
      // can value each historical line item's COGS.
      // --------------------------------------------------------

      const productIds = new Set();
      sales.forEach((sale) => {
        (sale.items || []).forEach((item) => {
          if (item.product) productIds.add(String(item.product));
        });
      });

      const products = await Product.find(
        { _id: { $in: Array.from(productIds) } },
        { cost: 1 }
      ).lean();

      const costByProductId = {};
      products.forEach((p) => {
        costByProductId[String(p._id)] = Number(p.cost) || 0;
      });

      // --------------------------------------------------------
      // Aggregate revenue / cost / profit
      // --------------------------------------------------------

      let totalRevenue = 0;
      let totalCost = 0;

      const byDayMap = {}; // 'YYYY-MM-DD' -> { revenue, cost }
      const byProductMap = {}; // productId -> { name, units, revenue, cost }

      sales.forEach((sale) => {
        const day = new Date(sale.createdAt).toISOString().slice(0, 10);

        if (!byDayMap[day]) byDayMap[day] = { revenue: 0, cost: 0 };

        (sale.items || []).forEach((item) => {
          const qty = Number(item.quantity) || 0;
          const lineRevenue = Number(item.subtotal) || qty * Number(item.unitPrice || 0);

          const unitCost = item.product
            ? costByProductId[String(item.product)] || 0
            : 0;
          const lineCost = unitCost * qty;

          totalRevenue += lineRevenue;
          totalCost += lineCost;

          byDayMap[day].revenue += lineRevenue;
          byDayMap[day].cost += lineCost;

          const key = item.product ? String(item.product) : item.name;
          if (!byProductMap[key]) {
            byProductMap[key] = { name: item.name, units: 0, revenue: 0, cost: 0 };
          }
          byProductMap[key].units += qty;
          byProductMap[key].revenue += lineRevenue;
          byProductMap[key].cost += lineCost;
        });
      });

      const totalProfit = totalRevenue - totalCost;
      const margin = totalRevenue > 0 ? (totalProfit / totalRevenue) * 100 : 0;

      const byDay = Object.keys(byDayMap)
        .sort()
        .map((day) => ({
          date: day,
          revenue: byDayMap[day].revenue,
          cost: byDayMap[day].cost,
          profit: byDayMap[day].revenue - byDayMap[day].cost,
        }));

      const byProduct = Object.values(byProductMap)
        .map((p) => ({
          name: p.name,
          units: p.units,
          revenue: p.revenue,
          cost: p.cost,
          profit: p.revenue - p.cost,
          margin: p.revenue > 0 ? ((p.revenue - p.cost) / p.revenue) * 100 : 0,
        }))
        .sort((a, b) => b.revenue - a.revenue);

      res.json({
        range,
        totalRevenue,
        totalCost,
        totalProfit,
        margin,
        byDay,
        byProduct,
      });
    } catch (err) {
      console.error("Sales analysis error:", err);

      res.status(500).json({
        message: "Could not load sales analysis.",
      });
    }
  }
);

// ============================================================
// ADMIN: UPDATE ORDER STATUS
// PATCH /api/sales/:id/status
// ============================================================

router.patch(
  "/:id/status",
  requireAuth,
  requireRole("admin"),
  async (req, res) => {
    try {
      const allowed = ["pending", "completed", "cancelled"];
      const { status } = req.body;

      if (!allowed.includes(status)) {
        return res.status(400).json({ message: "Invalid status." });
      }

      const sale = await Sale.findById(req.params.id);
      if (!sale) return res.status(404).json({ message: "Order not found." });

      const wasCancelled = sale.status === "cancelled";
      const willCancel = status === "cancelled";

      // Restock if we're cancelling an order that wasn't cancelled before,
      // or reverse that if an admin un-cancels it.
      if (willCancel && !wasCancelled) {
        for (const line of sale.items) {
          if (line.product) {
            await Product.findByIdAndUpdate(line.product, { $inc: { stock: line.quantity } });
          }
        }
      } else if (!willCancel && wasCancelled) {
        for (const line of sale.items) {
          if (line.product) {
            await Product.findByIdAndUpdate(line.product, { $inc: { stock: -line.quantity } });
          }
        }
      }

      sale.status = status;
      await sale.save();
      res.json(sale);
    } catch (err) {
      console.error("Update order status error:", err);
      res.status(500).json({ message: "Could not update order status." });
    }
  }
);

// ============================================================
// ADMIN: CLEAR OLD ORDERS
// DELETE /api/sales/cleanup?days=30&status=completed,cancelled
// ============================================================

router.delete(
  "/cleanup",
  requireAuth,
  requireRole("admin"),
  async (req, res) => {
    try {
      const days = parseInt(req.query.days, 10) || 30;
      const statusParam = req.query.status || "completed,cancelled";
      const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

      const filter = { createdAt: { $lt: cutoff } };
      if (statusParam !== "all") {
        filter.status = { $in: statusParam.split(",") };
      }

      const result = await Sale.deleteMany(filter);
      res.json({
        message: `Deleted ${result.deletedCount} old order(s).`,
        deletedCount: result.deletedCount,
      });
    } catch (err) {
      console.error("Cleanup orders error:", err);
      res.status(500).json({ message: "Could not clear old orders." });
    }
  }
);

module.exports = router;