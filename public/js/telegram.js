// Sends order/payment info to the admin's Telegram chat using the Bot API.
// Requires TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID to be set in .env.
// Fails silently (just logs) so a Telegram outage never blocks a checkout.

async function sendTelegramMessage(text) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;

  if (!token || !chatId) {
    console.warn("[telegram] TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID not set — skipping admin notification.");
    return { ok: false, skipped: true };
  }

  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        parse_mode: "HTML",
        disable_web_page_preview: true,
      }),
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.ok) {
      console.error("[telegram] sendMessage failed:", res.status, data.description || data);
      return { ok: false, error: data.description || `HTTP ${res.status}` };
    }
    return { ok: true };
  } catch (err) {
    console.error("[telegram] sendMessage error:", err.message);
    return { ok: false, error: err.message };
  }
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function formatOrderMessage(sale, customer) {
  const paymentLabel = { cod: "Cash on delivery", card: "Credit / debit card", wallet: "Digital wallet (QR)" };
  const lines = sale.items
    .map((i) => `• ${i.quantity}× ${escapeHtml(i.name)} — $${i.subtotal.toFixed(2)}`)
    .join("\n");

  return [
    "🛒 <b>New order paid</b>",
    `Customer: <b>${escapeHtml(customer.name)}</b>${customer.email ? ` (${escapeHtml(customer.email)})` : ""}`,
    `Payment: ${paymentLabel[sale.paymentMethod] || sale.paymentMethod}${sale.paymentReference ? ` — ${escapeHtml(sale.paymentReference)}` : ""}`,
    "",
    lines,
    "",
    `Total: <b>$${sale.total.toFixed(2)}</b>`,
    `Order ID: <code>${sale._id}</code>`,
    `Time: ${new Date(sale.createdAt).toLocaleString()}`,
  ].join("\n");
}

module.exports = { sendTelegramMessage, formatOrderMessage };