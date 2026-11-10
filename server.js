require("dotenv").config();
const path = require("path");
const express = require("express");
const cors = require("cors");
const connectDB = require("./config/db");

const authRoutes = require("./routes/auth");
const productRoutes = require("./routes/products");
const saleRoutes = require("./routes/sales");
const reviewRoutes = require("./routes/reviews");
const paymentRoutes = require("./routes/payment");
const supplierRoutes = require("./routes/suppliers");
const purchaseOrderRoutes = require("./routes/purchaseOrders");
const customerRoutes = require("./routes/customers");
const invoiceRoutes = require("./routes/invoices");

const app = express();

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));
app.use("/images", express.static(path.join(__dirname, "images")));

// API routes
app.use("/api/auth", authRoutes);
app.use("/api/products", productRoutes);
app.use("/api/sales", saleRoutes);
app.use("/api/reviews", reviewRoutes);
app.use("/api/payment", paymentRoutes);
app.use("/api/suppliers", supplierRoutes);
app.use("/api/purchase-orders", purchaseOrderRoutes);
app.use("/api/customers", customerRoutes);
app.use("/api/invoices", invoiceRoutes);

// Fallback: send customer page for unknown routes so the app works as SPA-ish
app.get("*", (req, res, next) => {
  if (req.path.startsWith("/api/")) return next();
  res.sendFile(path.join(__dirname, "public", "customer.html"));
});

const PORT = process.env.PORT || 5000;

// Start listening and open the shop page immediately — don't make the
// customer wait on the database connection before the page even opens.
app.listen(PORT, async () => {
  console.log(`Server running on http://localhost:${PORT}`);
  if (!require("./utils/mailer").smtpConfigured()) {
    console.warn("WARNING: SMTP_* settings are missing in .env, so verification emails cannot be sent. See README.");
  }
  const open = (await import("open")).default;
  open(`http://localhost:${PORT}/customer.html`);
});

// Connect to MongoDB in the background. The page is already open by the
// time this resolves; API calls will simply fail with a clear error until
// the connection is ready.
connectDB().catch((err) => {
  console.error("MongoDB connection failed:", err.message);
});