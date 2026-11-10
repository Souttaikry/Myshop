(function () {
  const session = requireRoleOrRedirect("customer");
  if (session) {
    document.getElementById("userName").textContent = session.user.name;
  }

  // Scoped to the logged-in customer, so one browser can't leak another
  // account's invoice after a log-out/log-in switch.
  const STORAGE_KEY = "stockledger_last_invoice_" + (session ? session.user.id : "guest");

  const PAYMENT_LABEL = { cod: "Cash on delivery", card: "Credit / debit card", wallet: "Digital wallet" };
  const STATUS_LABEL = { paid: "Paid", pending: "Pending payment", refunded: "Refunded" };

  function escapeHtml(str) {
    const div = document.createElement("div");
    div.textContent = str == null ? "" : String(str);
    return div.innerHTML;
  }

  function formatDate(iso) {
    const d = new Date(iso);
    if (isNaN(d)) return iso;
    return d.toLocaleString(undefined, {
      year: "numeric", month: "short", day: "2-digit",
      hour: "2-digit", minute: "2-digit",
    });
  }

  function showError(message) {
    document.getElementById("invoiceLoading").style.display = "none";
    const err = document.getElementById("invoiceError");
    err.textContent = message;
    err.style.display = "block";
  }

  function saveLastInvoice(inv) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(inv));
    } catch (_) { /* storage full/unavailable — not critical */ }
  }

  function loadLastInvoice() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (_) {
      return null;
    }
  }

  function render(inv) {
    document.getElementById("invNumber").textContent = inv.invoiceNumber;
    document.getElementById("invDate").textContent = formatDate(inv.createdAt);
    document.getElementById("invCustomerName").textContent = inv.customerName;
    document.getElementById("invCustomerEmail").textContent = inv.customerEmail;
    document.getElementById("invRawId").textContent = inv._id;

    const stamp = document.getElementById("invStatusStamp");
    stamp.textContent = STATUS_LABEL[inv.status] || inv.status;
    stamp.className = "inv-paid-stamp status-" + inv.status;

    document.getElementById("invItemsBody").innerHTML = inv.items.map((item) => `
      <tr>
        <td>${escapeHtml(item.name)}</td>
        <td class="num">${item.quantity}</td>
        <td class="num">${money(item.unitPrice)}</td>
        <td class="num">${money(item.subtotal)}</td>
      </tr>
    `).join("");

    document.getElementById("invSubtotal").textContent = money(inv.subtotal);
    document.getElementById("invTotal").textContent = money(inv.total);

    document.getElementById("invPayMethod").textContent = PAYMENT_LABEL[inv.paymentMethod] || inv.paymentMethod;

    const refRow = document.getElementById("invPayRefRow");
    if (inv.paymentReference) {
      refRow.style.display = "flex";
      document.getElementById("invPayRef").textContent = inv.paymentReference;
    } else {
      refRow.style.display = "none";
    }

    document.getElementById("invFootnote").textContent =
      inv.status === "pending"
        ? "Thank you for your order — pay the amount above in cash when it's delivered."
        : "Thank you for shopping with COSTME. This invoice confirms your payment was received.";

    document.getElementById("invoiceLoading").style.display = "none";
    document.getElementById("invoiceError").style.display = "none";
    document.getElementById("invoiceCard").style.display = "block";
    document.getElementById("invActions").style.display = "flex";

    // Keep the URL in sync so a plain refresh (which re-sends this same
    // URL) keeps working, and remember this invoice for next time this
    // page is opened without an id at all.
    const url = new URL(window.location.href);
    if (url.searchParams.get("id") !== String(inv._id)) {
      url.searchParams.set("id", inv._id);
      window.history.replaceState({}, "", url);
    }
    saveLastInvoice(inv);
  }

  async function load() {
    const params = new URLSearchParams(window.location.search);
    let invoiceId = params.get("id");

    // No id in the URL (e.g. the page was reopened from a bookmark, or
    // navigated to directly) — fall back to the last invoice this
    // customer viewed so the page still shows something useful.
    const cached = loadLastInvoice();
    if (!invoiceId && cached) {
      invoiceId = cached._id;
    }

    if (!invoiceId) {
      showError("No invoice was specified.");
      return;
    }

    try {
      const inv = await apiFetch("/api/invoices/" + invoiceId);
      render(inv);
    } catch (err) {
      // Fetch failed (e.g. connection issue) — show the cached copy
      // instead of a dead end, if we have one for this exact invoice.
      if (cached && String(cached._id) === String(invoiceId)) {
        render(cached);
        return;
      }
      showError(err.message || "Could not load this invoice.");
    }
  }

  document.getElementById("printBtn").addEventListener("click", () => window.print());

  load();
})();

