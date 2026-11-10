// Checks your email settings by sending a test code.
// Run:  npm run test-mail -- you@example.com
require("dotenv").config();
const { sendVerificationCode, smtpConfigured } = require("../utils/mailer");

const to = process.argv[2];
if (!to) { console.log("Usage: npm run test-mail -- you@example.com"); process.exit(1); }
if (!smtpConfigured()) {
  console.log("SMTP is not configured. Fill SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS in .env (and run npm install).");
  process.exit(1);
}
sendVerificationCode(to, "Test", "123456")
  .then(() => console.log("Sent! Check the inbox (and spam folder) of " + to))
  .catch((e) => { console.error("Failed: " + e.message); process.exit(1); });
