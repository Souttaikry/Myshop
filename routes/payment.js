const express = require("express");
const QRCode = require("qrcode");
const { BakongKHQR, khqrData, IndividualInfo } = require("bakong-khqr");
const { requireAuth } = require("../middleware/auth");

const router = express.Router();

const BAKONG_ACCOUNT_ID = "yourname@aba"; // replace with your real Bakong Account ID
const MERCHANT_NAME = "TAIKRY SOUT";
const MERCHANT_CITY = "Phnom Penh";

router.post("/khqr", requireAuth, async (req, res) => {
  try {
    const { amount } = req.body;
    if (!amount || amount <= 0) {
      return res.status(400).json({ message: "A valid amount is required." });
    }

    const optionalData = {
      currency: khqrData.currency.usd,
      amount: Number(amount),
    };

    // Correct constructor order: accountID, currency, merchantName, merchantCity, optionalData
    const individualInfo = new IndividualInfo(
      BAKONG_ACCOUNT_ID,
      khqrData.currency.usd,
      MERCHANT_NAME,
      MERCHANT_CITY,
      optionalData
    );

    const khqr = new BakongKHQR();
    const response = khqr.generateIndividual(individualInfo);

    console.log("KHQR response:", response); // temporary - lets us see what's happening in the terminal

    if (response.status.code !== 0 || !response.data?.qr) {
      return res.status(500).json({ message: response.status.message || "Could not generate QR payload." });
    }

    const qrImage = await QRCode.toDataURL(response.data.qr, { width: 300 });
    res.json({ qrImage, md5: response.data.md5, amount: Number(amount) });
  } catch (err) {
    console.error("KHQR generation error:", err); // temporary - prints full error in your terminal
    res.status(500).json({ message: "Could not generate QR code.", error: err.message });
  }
});

module.exports = router;