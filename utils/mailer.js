// Sends the email verification code.
// - If SMTP_* values are set in .env, the code is emailed through nodemailer.
// - If not, the code is printed in the server console so you can still test locally.
let nodemailer = null;
try { nodemailer = require("nodemailer"); } catch (_) { /* not installed yet */ }

function smtpConfigured() {
  return Boolean(nodemailer && process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS);
}

let transporter = null;
function getTransporter() {
  if (!transporter) {
    const port = Number(process.env.SMTP_PORT || 587);
    transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port,
      secure: port === 465,
      auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
    });
  }
  return transporter;
}

// Returns { sent: true } when emailed. Throws if the email cannot be sent.
// The code is never printed in the terminal unless DEV_CONSOLE_CODE=true is set in .env.
async function sendVerificationCode(to, name, code) {
  if (!smtpConfigured()) {
    if (process.env.DEV_CONSOLE_CODE === "true") {
      console.log(`[VERIFY CODE] ${to} -> ${code}`);
      return { sent: false };
    }
    throw new Error("Email is not set up on the server (SMTP settings missing in .env).");
  }
  await getTransporter().sendMail({
    from: process.env.MAIL_FROM || process.env.SMTP_USER,
    to,
    subject: "Your COSTME verification code",
    text: `Hi ${name},\n\nYour verification code is ${code}.\nIt expires in 10 minutes.\n\nIf you did not request this, you can ignore this email.`,
    html: `<p>Hi ${name},</p><p>Your verification code is:</p><p style="font-size:28px;letter-spacing:6px;font-weight:700">${code}</p><p>It expires in 10 minutes. If you did not request this, you can ignore this email.</p>`,
  });
  return { sent: true };
}

module.exports = { sendVerificationCode, smtpConfigured };
