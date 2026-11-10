const express = require("express");
const crypto = require("crypto");
const jwt = require("jsonwebtoken");
const User = require("../models/User");
const { sendVerificationCode } = require("../utils/mailer");

const router = express.Router();

const CODE_TTL_MS = 10 * 60 * 1000;   // code valid for 10 minutes
const RESEND_COOLDOWN_MS = 30 * 1000; // wait 30s between emails
const MAX_ATTEMPTS = 5;

function signToken(user) {
  return jwt.sign(
    { id: user._id, role: user.role, name: user.name },
    process.env.JWT_SECRET,
    { expiresIn: "7d" }
  );
}

function authPayload(user) {
  return {
    token: signToken(user),
    user: { id: user._id, name: user.name, email: user.email, role: user.role },
  };
}

const hashCode = (code) => crypto.createHash("sha256").update(String(code)).digest("hex");

// Only an explicit `false` needs verification (old accounts have no field; admins skip it).
const needsVerification = (user) => user.role !== "admin" && user.emailVerified === false;

// Creates a fresh 6-digit code, stores its hash, and emails it.
async function issueCode(user) {
  const code = String(crypto.randomInt(0, 1000000)).padStart(6, "0");
  user.verifyCodeHash = hashCode(code);
  user.verifyCodeExpires = new Date(Date.now() + CODE_TTL_MS);
  user.verifyAttempts = 0;
  user.verifyLastSent = new Date();
  await user.save();

  let mail;
  try {
    mail = await sendVerificationCode(user.email, user.name, code);
  } catch (err) {
    console.error("Could not send verification email:", err.message);
    const e = new Error("We could not send the verification email. Please try again later.");
    e.mailFailed = true;
    throw e;
  }

  const body = { needsVerification: true, email: user.email, emailSent: mail.sent };
  // Local testing only: set SHOW_CODE_ON_SCREEN=true in .env to display the code in the popup.
  if (process.env.SHOW_CODE_ON_SCREEN === "true") body.devCode = code;
  return body;
}

// Public: create a customer account, then ask for the emailed code
router.post("/register", async (req, res) => {
  try {
    const { name, email, password } = req.body;

    if (!name || !email || !password) {
      return res.status(400).json({ message: "Name, email and password are required." });
    }
    if (password.length < 6) {
      return res.status(400).json({ message: "Password must be at least 6 characters." });
    }

    const existing = await User.findOne({ email: email.toLowerCase() });
    if (existing) {
      return res.status(409).json({ message: "An account with this email already exists." });
    }

    // Anyone who registers through this public form becomes a customer.
    // Admin accounts are created separately (see scripts/seedAdmin.js).
    const user = await User.create({ name, email, password, role: "customer", emailVerified: false });
    let body;
    try {
      body = await issueCode(user);
    } catch (err) {
      // Don't leave a half-created account behind if the email could not be sent.
      await User.deleteOne({ _id: user._id });
      throw err;
    }
    res.status(201).json(body);
  } catch (err) {
    if (err.mailFailed) return res.status(502).json({ message: err.message });
    res.status(500).json({ message: "Could not create account.", error: err.message });
  }
});

// Public: log in as admin or customer (same endpoint, role comes from the DB)
router.post("/login", async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ message: "Email and password are required." });
    }

    const user = await User.findOne({ email: email.toLowerCase() });
    if (!user) {
      return res.status(401).json({ message: "Incorrect email or password." });
    }

    const ok = await user.comparePassword(password);
    if (!ok) {
      return res.status(401).json({ message: "Incorrect email or password." });
    }

    if (needsVerification(user)) {
      const recent = user.verifyLastSent && Date.now() - user.verifyLastSent.getTime() < RESEND_COOLDOWN_MS;
      const stillValid = user.verifyCodeExpires && user.verifyCodeExpires.getTime() > Date.now();
      // Don't spam a new email if one was just sent and is still valid.
      if (recent && stillValid) {
        return res.status(403).json({ message: "Please verify your email.", needsVerification: true, email: user.email, emailSent: true });
      }
      const body = await issueCode(user);
      return res.status(403).json({ message: "Please verify your email.", ...body });
    }

    res.json(authPayload(user));
  } catch (err) {
    if (err.mailFailed) return res.status(502).json({ message: err.message });
    res.status(500).json({ message: "Login failed.", error: err.message });
  }
});

// Public: submit the 6-digit code. On success the user is logged in.
router.post("/verify-email", async (req, res) => {
  try {
    const { email, code } = req.body;
    if (!email || !code) {
      return res.status(400).json({ message: "Email and code are required." });
    }

    const user = await User.findOne({ email: String(email).toLowerCase() });
    if (!user || !user.verifyCodeHash) {
      return res.status(400).json({ message: "No pending verification. Please request a new code." });
    }
    if (user.emailVerified === true) {
      return res.json(authPayload(user));
    }
    if (!user.verifyCodeExpires || user.verifyCodeExpires.getTime() < Date.now()) {
      return res.status(400).json({ message: "This code has expired. Please request a new one." });
    }
    if (user.verifyAttempts >= MAX_ATTEMPTS) {
      return res.status(429).json({ message: "Too many wrong attempts. Please request a new code." });
    }

    if (hashCode(String(code).trim()) !== user.verifyCodeHash) {
      user.verifyAttempts += 1;
      await user.save();
      return res.status(400).json({ message: "Incorrect code. Please try again." });
    }

    user.emailVerified = true;
    user.verifyCodeHash = undefined;
    user.verifyCodeExpires = undefined;
    user.verifyAttempts = 0;
    await user.save();
    res.json(authPayload(user));
  } catch (err) {
    res.status(500).json({ message: "Verification failed.", error: err.message });
  }
});

// Public: send a new code
router.post("/resend-code", async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ message: "Email is required." });

    const user = await User.findOne({ email: String(email).toLowerCase() });
    // Same reply whether or not the account exists, so emails can't be probed.
    const generic = { message: "If this account needs verification, a new code has been sent." };
    if (!user || !needsVerification(user)) return res.json(generic);

    if (user.verifyLastSent && Date.now() - user.verifyLastSent.getTime() < RESEND_COOLDOWN_MS) {
      return res.status(429).json({ message: "Please wait a few seconds before requesting another code." });
    }
    const body = await issueCode(user);
    res.json({ ...generic, ...(body.devCode ? { devCode: body.devCode } : {}) });
  } catch (err) {
    if (err.mailFailed) return res.status(502).json({ message: err.message });
    res.status(500).json({ message: "Could not send a new code.", error: err.message });
  }
});

module.exports = router;
