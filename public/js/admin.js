const session = requireRoleOrRedirect("admin");
if (session) document.getElementById("userName").textContent = session.user.name;

let products = [];
let todaySummary = null;
let stockFilter = "all";
let allSales = [];
let customers = [];
let suppliers = [];
let purchaseOrders = [];
const paymentLabel = { cod: "Cash on delivery", card: "Card", wallet: "Wallet" };

/* ================= TAB NAVIGATION ================= */

const loadedTabs = {};

async function loadTabData(tab) {
  if (loadedTabs[tab]) return;
  loadedTabs[tab] = true;

  if (tab === "payments") {
    renderPaymentRows();
  } else if (tab === "customers") {
    await loadCustomers();
  } else if (tab === "suppliers") {
    await loadSuppliers();
  } else if (tab === "purchaseorders") {
    await Promise.all([loadSuppliers(), loadPurchaseOrders()]);
  }
}

document.querySelectorAll(".main-nav-btn").forEach((btn) => {
  btn.addEventListener("click", async () => {
    const tab = btn.dataset.tab;
    document.querySelectorAll(".main-nav-btn").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    document.querySelectorAll(".admin-view").forEach((v) => v.classList.remove("active"));
    document.getElementById(`view-${tab}`).classList.add("active");
    await loadTabData(tab);
  });
});

async function loadStats() {
  try {
    todaySummary = await apiFetch("/api/sales/summary/today");
    document.getElementById("statRevenue").textContent = money(todaySummary.revenueToday);
    document.getElementById("statOrders").textContent = todaySummary.ordersToday;
    document.getElementById("statUnits").textContent = todaySummary.unitsSoldToday;
  } catch (err) {
    console.error(err.message);
  }
}

function stockBadge(p) {
  if (p.stock <= 0) return '<span class="badge badge-out">Out of stock</span>';
  if (p.stock <= p.lowStockThreshold) return '<span class="badge badge-low">Low stock</span>';
  return '<span class="badge badge-ok">In stock</span>';
}

// Crops/fits any product image into a small square thumbnail (via CSS
// object-fit: cover) so the In Stock dashboard table stays tidy no matter
// what size or aspect ratio the source image is. Falls back to a placeholder
// icon when a product has no image on file.
function productThumb(p) {
  if (p.imageUrl) {
    return `<div class="product-thumb"><img src="${p.imageUrl}" alt="${p.name}" onerror="this.closest('.product-thumb').classList.add('img-error'); this.remove();" /></div>`;
  }
  return `<div class="product-thumb product-thumb-empty">🧴</div>`;
}

function renderProductRows(list) {
  const rows = document.getElementById("productRows");
  const empty = document.getElementById("productEmpty");

  if (list.length === 0) {
    rows.innerHTML = "";
    empty.style.display = "block";
  } else {
    empty.style.display = "none";
    rows.innerHTML = list.map(p => `
      <tr>
        <td data-label="Photo">${productThumb(p)}</td>
        <td data-label="Product">${p.name}</td>
        <td data-label="SKU" class="mono">${p.sku}</td>
        <td data-label="Category">${p.category || "—"}</td>
        <td data-label="Price" class="mono">${money(p.price)}</td>
        <td data-label="Cost" class="mono">${money(p.cost || 0)}</td>
        <td data-label="Stock">${p.stock} ${stockBadge(p)}</td>
        
      </tr>
    `).join("");
  }
}

async function loadProducts() {
  try {
    products = await apiFetch("/api/products");
    renderProductRows(products);

    const lowCount = products.filter(p => p.stock <= p.lowStockThreshold).length;
    document.getElementById("statLow").textContent = lowCount;
  } catch (err) {
    console.error(err.message);
  }
}

document.getElementById("productSearch")?.addEventListener("input", (e) => {
  const term = e.target.value.trim().toLowerCase();
  const filtered = term
    ? products.filter(p =>
        p.name.toLowerCase().includes(term) ||
        p.sku.toLowerCase().includes(term) ||
        (p.category || "").toLowerCase().includes(term)
      )
    : products;
  renderProductRows(filtered);
});

async function loadSales() {
  try {
    allSales = await apiFetch("/api/sales");
    renderSaleRows();
  } catch (err) {
    console.error(err.message);
  }
}

function renderSaleRows() {
  const rows = document.getElementById("saleRows");
  const empty = document.getElementById("saleEmpty");

  if (allSales.length === 0) {
    rows.innerHTML = "";
    empty.style.display = "block";
    return;
  }
  empty.style.display = "none";

  rows.innerHTML = allSales.slice(0, 50).map(s => `
    <tr>
      <td data-label="Date">${new Date(s.createdAt).toLocaleString()}</td>
      <td data-label="Customer">${s.customer ? s.customer.name : "—"}</td>
      <td data-label="Items">${s.items.map(i => `${i.quantity}× ${i.name}`).join(", ")}</td>
      <td data-label="Total" class="mono">${money(s.total)}</td>
      <td data-label="Payment">${paymentLabel[s.paymentMethod] || "Cash on delivery"}${s.paymentReference ? " · " + s.paymentReference : ""}</td>
      <td data-label="Status">
        <select class="order-status-select" data-id="${s._id}" onchange="updateOrderStatus('${s._id}', this.value)">
          <option value="pending" ${s.status === "pending" ? "selected" : ""}>Pending</option>
          <option value="completed" ${s.status === "completed" ? "selected" : ""}>Completed</option>
          <option value="cancelled" ${s.status === "cancelled" ? "selected" : ""}>Cancelled</option>
        </select>
      </td>
    </tr>
  `).join("");
}

async function updateOrderStatus(id, status) {
  try {
    await apiFetch(`/api/sales/${id}/status`, {
      method: "PATCH",
      body: JSON.stringify({ status }),
    });
    const sale = allSales.find(s => s._id === id);
    if (sale) sale.status = status;
    renderSaleRows();
    renderPaymentRows();
    await loadProducts(); // stock may have changed if cancelled/un-cancelled
  } catch (err) {
    alert(err.message);
    renderSaleRows();
  }
}

/* ================= PAYMENTS TAB ================= */

function renderPaymentRows() {
  const rows = document.getElementById("paymentRows");
  const empty = document.getElementById("paymentEmpty");
  const statRow = document.getElementById("paymentStatRow");

  if (allSales.length === 0) {
    rows.innerHTML = "";
    empty.style.display = "block";
    statRow.innerHTML = "";
    return;
  }
  empty.style.display = "none";

  // Totals by payment method, completed orders only
  const totals = { cod: 0, card: 0, wallet: 0 };
  allSales.forEach(s => {
    if (s.status !== "cancelled") totals[s.paymentMethod] = (totals[s.paymentMethod] || 0) + Number(s.total || 0);
  });
  const icons = { cod: "💵", card: "💳", wallet: "📱" };
  const accents = { cod: "accent-teal", card: "accent-green", wallet: "accent-pink" };
  statRow.innerHTML = Object.entries(totals).map(([method, amt]) => `
    <div class="stat-card ${accents[method] || "accent-green"}">
      <div class="stat-icon">${icons[method] || "💳"}</div>
      <div class="label">${paymentLabel[method] || method}</div>
      <div class="value">${money(amt)}</div>
    </div>
  `).join("");

  rows.innerHTML = allSales.slice(0, 50).map(s => `
    <tr>
      <td data-label="Date">${new Date(s.createdAt).toLocaleString()}</td>
      <td data-label="Customer">${s.customer ? s.customer.name : "—"}</td>
      <td data-label="Method">${paymentLabel[s.paymentMethod] || "Cash on delivery"}</td>
      <td data-label="Reference">${s.paymentReference || "—"}</td>
      <td data-label="Amount" class="mono">${money(s.total)}</td>
      <td data-label="Status"><span class="badge ${s.status === "completed" ? "badge-success" : s.status === "cancelled" ? "badge-danger" : "badge-warning"}">${s.status}</span></td>
    </tr>
  `).join("");
}

/* ================= CUSTOMERS TAB ================= */

async function loadCustomers() {
  try {
    customers = await apiFetch("/api/customers");
    renderCustomerRows(customers);
  } catch (err) {
    console.error(err.message);
  }
}

function renderCustomerRows(list) {
  const rows = document.getElementById("customerRows");
  const empty = document.getElementById("customerEmpty");

  if (list.length === 0) {
    rows.innerHTML = "";
    empty.style.display = "block";
    return;
  }
  empty.style.display = "none";

  rows.innerHTML = list.map(c => `
    <tr>
      <td data-label="Name">${c.name}</td>
      <td data-label="Email">${c.email}</td>
      <td data-label="Joined">${new Date(c.createdAt).toLocaleDateString()}</td>
      <td data-label="Orders">${c.totalOrders}</td>
      <td data-label="Total spent" class="mono">${money(c.totalSpent)}</td>
      <td data-label="Last order">${c.lastOrderAt ? new Date(c.lastOrderAt).toLocaleDateString() : "—"}</td>
    </tr>
  `).join("");
}

document.getElementById("customerSearch")?.addEventListener("input", (e) => {
  const term = e.target.value.trim().toLowerCase();
  const filtered = term
    ? customers.filter(c => c.name.toLowerCase().includes(term) || c.email.toLowerCase().includes(term))
    : customers;
  renderCustomerRows(filtered);
});

/* ================= SUPPLIERS TAB ================= */

async function loadSuppliers() {
  try {
    suppliers = await apiFetch("/api/suppliers");
    renderSupplierRows();
  } catch (err) {
    console.error(err.message);
  }
}

function renderSupplierRows() {
  const rows = document.getElementById("supplierRows");
  const empty = document.getElementById("supplierEmpty");

  if (suppliers.length === 0) {
    rows.innerHTML = "";
    empty.style.display = "block";
    return;
  }
  empty.style.display = "none";

  rows.innerHTML = suppliers.map(s => `
    <tr>
      <td data-label="Name">${s.name}</td>
      <td data-label="Contact">${s.contactName || "—"}</td>
      <td data-label="Email">${s.email || "—"}</td>
      <td data-label="Phone">${s.phone || "—"}</td>
      <td data-label="Address">${s.address || "—"}</td>
      <td data-label="">
        <button class="icon-btn" onclick="editSupplier('${s._id}')">Edit</button>
        <button class="icon-btn" onclick="deleteSupplier('${s._id}')">Delete</button>
      </td>
    </tr>
  `).join("");
}

function openSupplierModal() {
  document.getElementById("supplierModalTitle").textContent = "Add supplier";
  document.getElementById("supplierForm").reset();
  document.getElementById("supplierId").value = "";
  document.getElementById("supplierAlert").classList.remove("show");
  document.getElementById("supplierModal").classList.add("show");
}

function editSupplier(id) {
  const s = suppliers.find(x => x._id === id);
  if (!s) return;
  document.getElementById("supplierModalTitle").textContent = "Edit supplier";
  document.getElementById("supplierId").value = s._id;
  document.getElementById("sName").value = s.name;
  document.getElementById("sContactName").value = s.contactName || "";
  document.getElementById("sEmail").value = s.email || "";
  document.getElementById("sPhone").value = s.phone || "";
  document.getElementById("sAddress").value = s.address || "";
  document.getElementById("sNotes").value = s.notes || "";
  document.getElementById("supplierAlert").classList.remove("show");
  document.getElementById("supplierModal").classList.add("show");
}

async function deleteSupplier(id) {
  if (!confirm("Delete this supplier? This cannot be undone.")) return;
  try {
    await apiFetch(`/api/suppliers/${id}`, { method: "DELETE" });
    await loadSuppliers();
  } catch (err) {
    alert(err.message);
  }
}

document.getElementById("supplierForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const alertBox = document.getElementById("supplierAlert");
  alertBox.classList.remove("show");

  const id = document.getElementById("supplierId").value;
  const payload = {
    name: document.getElementById("sName").value.trim(),
    contactName: document.getElementById("sContactName").value.trim(),
    email: document.getElementById("sEmail").value.trim(),
    phone: document.getElementById("sPhone").value.trim(),
    address: document.getElementById("sAddress").value.trim(),
    notes: document.getElementById("sNotes").value.trim(),
  };

  try {
    if (id) {
      await apiFetch(`/api/suppliers/${id}`, { method: "PUT", body: JSON.stringify(payload) });
    } else {
      await apiFetch("/api/suppliers", { method: "POST", body: JSON.stringify(payload) });
    }
    closeModal("supplierModal");
    await loadSuppliers();
  } catch (err) {
    alertBox.textContent = err.message;
    alertBox.classList.add("show");
  }
});

/* ================= PURCHASE ORDERS TAB ================= */

let poItemCount = 0;

async function loadPurchaseOrders() {
  try {
    purchaseOrders = await apiFetch("/api/purchase-orders");
    renderPoRows();
  } catch (err) {
    console.error(err.message);
  }
}

function renderPoRows() {
  const rows = document.getElementById("poRows");
  const empty = document.getElementById("poEmpty");

  if (purchaseOrders.length === 0) {
    rows.innerHTML = "";
    empty.style.display = "block";
    return;
  }
  empty.style.display = "none";

  const statusBadge = { pending: "badge-warning", received: "badge-success", cancelled: "badge-danger" };

  rows.innerHTML = purchaseOrders.map(po => `
    <tr>
      <td data-label="Date">${new Date(po.createdAt).toLocaleDateString()}</td>
      <td data-label="Supplier">${po.supplier ? po.supplier.name : "—"}</td>
      <td data-label="Items">${po.items.map(i => `${i.quantity}× ${i.name}`).join(", ")}</td>
      <td data-label="Total cost" class="mono">${money(po.totalCost)}</td>
      <td data-label="Status"><span class="badge ${statusBadge[po.status] || "badge-warning"}">${po.status}</span></td>
      <td data-label="">
        ${po.status === "pending" ? `
          <button class="icon-btn" onclick="receivePo('${po._id}')">Mark received</button>
          <button class="icon-btn" onclick="cancelPo('${po._id}')">Cancel</button>
        ` : ""}
        ${po.status !== "received" ? `<button class="icon-btn" onclick="deletePo('${po._id}')">Delete</button>` : ""}
      </td>
    </tr>
  `).join("");
}

async function receivePo(id) {
  if (!confirm("Mark this order received? This will add the ordered quantities to stock.")) return;
  try {
    await apiFetch(`/api/purchase-orders/${id}/receive`, { method: "PATCH" });
    await Promise.all([loadPurchaseOrders(), loadProducts()]);
  } catch (err) {
    alert(err.message);
  }
}

async function cancelPo(id) {
  if (!confirm("Cancel this purchase order?")) return;
  try {
    await apiFetch(`/api/purchase-orders/${id}/cancel`, { method: "PATCH" });
    await loadPurchaseOrders();
  } catch (err) {
    alert(err.message);
  }
}

async function deletePo(id) {
  if (!confirm("Delete this purchase order? This cannot be undone.")) return;
  try {
    await apiFetch(`/api/purchase-orders/${id}`, { method: "DELETE" });
    await loadPurchaseOrders();
  } catch (err) {
    alert(err.message);
  }
}

function poProductOptions(selectedId) {
  return products.map(p => `<option value="${p._id}" ${p._id === selectedId ? "selected" : ""}>${p.name}</option>`).join("");
}

function addPoItemRow() {
  const container = document.getElementById("poItemRows");
  const rowId = poItemCount++;
  const row = document.createElement("div");
  row.className = "po-item-row";
  row.dataset.rowId = rowId;
  row.innerHTML = `
    <div class="field">
      <label>Product</label>
      <select class="po-product-select" onchange="recalcPoTotal()">${poProductOptions()}</select>
    </div>
    <div class="field">
      <label>Quantity</label>
      <input type="number" class="po-qty-input" min="1" value="1" oninput="recalcPoTotal()" />
    </div>
    <div class="field">
      <label>Unit cost</label>
      <input type="number" class="po-cost-input" min="0" step="0.01" value="0" oninput="recalcPoTotal()" />
    </div>
    <button type="button" class="po-remove-btn" onclick="removePoItemRow(${rowId})" title="Remove">✕</button>
  `;
  container.appendChild(row);
  recalcPoTotal();
}

function removePoItemRow(rowId) {
  const row = document.querySelector(`.po-item-row[data-row-id="${rowId}"]`);
  if (row) row.remove();
  recalcPoTotal();
}

function recalcPoTotal() {
  let total = 0;
  document.querySelectorAll(".po-item-row").forEach(row => {
    const qty = parseFloat(row.querySelector(".po-qty-input").value) || 0;
    const cost = parseFloat(row.querySelector(".po-cost-input").value) || 0;
    total += qty * cost;
  });
  document.getElementById("poTotalPreview").textContent = money(total);
}

function openPoModal() {
  const supplierSelect = document.getElementById("poSupplier");
  if (suppliers.length === 0) {
    alert("Add a supplier first before creating a purchase order.");
    return;
  }
  supplierSelect.innerHTML = suppliers.map(s => `<option value="${s._id}">${s.name}</option>`).join("");

  document.getElementById("poItemRows").innerHTML = "";
  poItemCount = 0;
  addPoItemRow();

  document.getElementById("poNotes").value = "";
  document.getElementById("poAlert").classList.remove("show");
  document.getElementById("poModal").classList.add("show");
}

document.getElementById("poForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const alertBox = document.getElementById("poAlert");
  alertBox.classList.remove("show");

  const items = Array.from(document.querySelectorAll(".po-item-row")).map(row => ({
    productId: row.querySelector(".po-product-select").value,
    quantity: parseInt(row.querySelector(".po-qty-input").value, 10),
    unitCost: parseFloat(row.querySelector(".po-cost-input").value),
  }));

  const payload = {
    supplier: document.getElementById("poSupplier").value,
    items,
    notes: document.getElementById("poNotes").value.trim(),
  };

  try {
    await apiFetch("/api/purchase-orders", { method: "POST", body: JSON.stringify(payload) });
    closeModal("poModal");
    await loadPurchaseOrders();
  } catch (err) {
    alertBox.textContent = err.message;
    alertBox.classList.add("show");
  }
});

// ---- Product modal ----

// Uploads the chosen file from the admin's computer to the server as soon as
// it's picked, then stores the returned path in the hidden pImageUrl field
// and shows a cropped (object-fit: cover) preview of it.
async function handleProductImageSelect(event) {
  const file = event.target.files[0];
  const statusEl = document.getElementById("pImageUploadStatus");
  const box = document.getElementById("pImagePreviewBox");
  const img = document.getElementById("pImagePreview");

  if (!file) return;

  // Show an instant local preview while the upload is in flight.
  const localUrl = URL.createObjectURL(file);
  img.src = localUrl;
  box.style.display = "block";
  statusEl.textContent = "Uploading…";
  statusEl.classList.remove("error");

  try {
    const session = getSession();
    const formData = new FormData();
    formData.append("image", file);

    const res = await fetch("/api/products/upload-image", {
      method: "POST",
      headers: session && session.token ? { Authorization: "Bearer " + session.token } : {},
      body: formData,
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.message || "Upload failed.");

    document.getElementById("pImageUrl").value = data.imageUrl;
    img.src = data.imageUrl;
    statusEl.textContent = "Photo uploaded.";
  } catch (err) {
    statusEl.textContent = err.message;
    statusEl.classList.add("error");
  }
}

function resetProductImageField() {
  document.getElementById("pImageFile").value = "";
  document.getElementById("pImageUrl").value = "";
  document.getElementById("pImagePreview").removeAttribute("src");
  document.getElementById("pImagePreviewBox").style.display = "none";
  document.getElementById("pImageUploadStatus").textContent = "";
  document.getElementById("pImageUploadStatus").classList.remove("error");
}

function openProductModal() {
  document.getElementById("modalTitle").textContent = "Add product";
  document.getElementById("productForm").reset();
  document.getElementById("productId").value = "";
  document.getElementById("pThreshold").value = 0;
  document.getElementById("modalAlert").classList.remove("show");
  resetProductImageField();
  document.getElementById("productModal").classList.add("show");
}

function editProduct(id) {
  const p = products.find(x => x._id === id);
  if (!p) return;
  document.getElementById("modalTitle").textContent = "Edit product";
  document.getElementById("productId").value = p._id;
  document.getElementById("pName").value = p.name;
  document.getElementById("pSku").value = p.sku;
  document.getElementById("pCategory").value = p.category || "";
  document.getElementById("pPrice").value = p.price;
  document.getElementById("pCost").value = p.cost || 0;
  document.getElementById("pStock").value = p.stock;
  document.getElementById("pThreshold").value = p.lowStockThreshold;
  document.getElementById("pDescription").value = p.description || "";

  resetProductImageField();
  document.getElementById("pImageUrl").value = p.imageUrl || "";
  if (p.imageUrl) {
    document.getElementById("pImagePreview").src = p.imageUrl;
    document.getElementById("pImagePreviewBox").style.display = "block";
  }

  document.getElementById("modalAlert").classList.remove("show");
  document.getElementById("productModal").classList.add("show");
}

function closeProductModal() {
  document.getElementById("productModal").classList.remove("show");
}

async function deleteProduct(id) {
  if (!confirm("Delete this product? This cannot be undone.")) return;
  try {
    await apiFetch(`/api/products/${id}`, { method: "DELETE" });
    await loadProducts();
  } catch (err) {
    alert(err.message);
  }
}

document.getElementById("productForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const modalAlert = document.getElementById("modalAlert");
  modalAlert.classList.remove("show");

  const id = document.getElementById("productId").value;
  const payload = {
    name: document.getElementById("pName").value.trim(),
    sku: document.getElementById("pSku").value.trim(),
    category: document.getElementById("pCategory").value.trim(),
    price: parseFloat(document.getElementById("pPrice").value),
    cost: parseFloat(document.getElementById("pCost").value || "0"),
    stock: parseInt(document.getElementById("pStock").value, 10),
    lowStockThreshold: parseInt(document.getElementById("pThreshold").value || "5", 10),
    imageUrl: document.getElementById("pImageUrl").value.trim(),
    description: document.getElementById("pDescription").value.trim(),
  };

  try {
    if (id) {
      await apiFetch(`/api/products/${id}`, { method: "PUT", body: JSON.stringify(payload) });
    } else {
      await apiFetch("/api/products", { method: "POST", body: JSON.stringify(payload) });
    }
    closeProductModal();
    await loadProducts();
  } catch (err) {
    modalAlert.textContent = err.message;
    modalAlert.classList.add("show");
  }
});

// ---- Generic modal helpers ----
function closeModal(id) {
  document.getElementById(id).classList.remove("show");
}

document.querySelectorAll(".modal-backdrop").forEach((backdrop) => {
  backdrop.addEventListener("click", (e) => {
    if (e.target === backdrop) backdrop.classList.remove("show");
  });
});

// ---- Revenue today modal ----
function openRevenueModal() {
  document.getElementById("revenueModal").classList.add("show");
  if (!todaySummary) return;

  document.getElementById("revenueTotal").textContent = money(todaySummary.revenueToday);
  const breakdown = document.getElementById("revenueBreakdown");
  const empty = document.getElementById("revenueEmpty");
  const paymentColor = { cod: "var(--gray)", card: "var(--green)", wallet: "var(--pink)" };

  const entries = Object.entries(todaySummary.revenueByPayment || {}).filter(([, amt]) => amt > 0);

  if (entries.length === 0) {
    breakdown.innerHTML = "";
    empty.style.display = "block";
    return;
  }
  empty.style.display = "none";
  const max = Math.max(...entries.map(([, amt]) => amt));
  breakdown.innerHTML = entries
    .sort((a, b) => b[1] - a[1])
    .map(([method, amt]) => `
      <div class="rev-row">
        <div class="rev-row-top">
          <span>${paymentLabel[method] || method}</span>
          <span class="amt">${money(amt)}</span>
        </div>
        <div class="rev-track"><div class="rev-fill" style="width:${(amt / max) * 100}%; background:${paymentColor[method] || "var(--green)"}"></div></div>
      </div>
    `).join("");
}

// ---- Orders today modal ----
function openOrdersModal() {
  document.getElementById("ordersModal").classList.add("show");
  if (!todaySummary) return;

  const orders = todaySummary.orders || [];
  document.getElementById("ordersSub").textContent = `${orders.length} order${orders.length === 1 ? "" : "s"} placed.`;

  const list = document.getElementById("ordersList");
  const empty = document.getElementById("ordersEmpty");

  if (orders.length === 0) {
    list.innerHTML = "";
    empty.style.display = "block";
    return;
  }
  empty.style.display = "none";
  list.innerHTML = orders.map((o) => `
    <div class="stock-row">
      <div class="stock-thumb">🧾</div>
      <div class="stock-info">
        <div class="stock-name">${o.customerName}</div>
        <div class="stock-meta">${o.items.map(i => `${i.quantity}× ${i.name}`).join(", ")} · ${paymentLabel[o.paymentMethod] || o.paymentMethod}</div>
      </div>
      <div class="stock-qty">${money(o.total)}<small>${new Date(o.time).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</small></div>
    </div>
  `).join("");
}

// ---- Units sold today modal ----
function openUnitsModal() {
  document.getElementById("unitsModal").classList.add("show");
  if (!todaySummary) return;

  const items = todaySummary.unitsByProduct || [];
  document.getElementById("unitsSub").textContent =
    `${todaySummary.unitsSoldToday} unit${todaySummary.unitsSoldToday === 1 ? "" : "s"} across ${items.length} product${items.length === 1 ? "" : "s"}.`;

  const list = document.getElementById("unitsList");
  const empty = document.getElementById("unitsEmpty");

  if (items.length === 0) {
    list.innerHTML = "";
    empty.style.display = "block";
    return;
  }
  empty.style.display = "none";
  list.innerHTML = items.map((p) => `
    <div class="stock-row">
      <div class="stock-thumb">📦</div>
      <div class="stock-info">
        <div class="stock-name">${p.name}</div>
        <div class="stock-meta">${money(p.revenue)} in sales today</div>
      </div>
      <div class="stock-qty">${p.quantity}<small>units</small></div>
    </div>
  `).join("");
}

// ---- Low / out of stock modal ----
function openStockModal() {
  setStockFilter(stockFilter);
  document.getElementById("stockModal").classList.add("show");
}

function setStockFilter(filter) {
  stockFilter = filter;
  document.querySelectorAll(".stock-tab").forEach((tab) => {
    tab.classList.toggle("active", tab.dataset.filter === filter);
  });
  renderStockList();
}

function renderStockList() {
  const outItems = products.filter(p => p.stock <= 0);
  const lowItems = products.filter(p => p.stock > 0 && p.stock <= p.lowStockThreshold);
  const allItems = [...outItems, ...lowItems];

  document.getElementById("countAll").textContent = allItems.length;
  document.getElementById("countOut").textContent = outItems.length;
  document.getElementById("countLow").textContent = lowItems.length;

  const shown = stockFilter === "out" ? outItems : stockFilter === "low" ? lowItems : allItems;

  const list = document.getElementById("stockList");
  const empty = document.getElementById("stockEmpty");

  if (shown.length === 0) {
    list.innerHTML = "";
    empty.style.display = "block";
    return;
  }
  empty.style.display = "none";
  list.innerHTML = shown.map((p) => {
    const isOut = p.stock <= 0;
    const pct = p.lowStockThreshold > 0
      ? Math.min(100, Math.round((p.stock / p.lowStockThreshold) * 100))
      : (isOut ? 0 : 100);

    return `
      <div class="stock-row ${isOut ? "out" : "low"}">
        <div class="stock-thumb">${isOut ? "🚫" : "⚠️"}</div>
        <div class="stock-info">
          <div class="stock-name">${p.name}</div>
          <div class="stock-meta">${p.sku} · ${p.category || "General"}</div>
          <div class="stock-bar-track"><div class="stock-bar-fill" style="width:${pct}%"></div></div>
        </div>
        <div class="stock-qty">${p.stock}<small>of ${p.lowStockThreshold}</small></div>
      </div>
    `;
  }).join("");
}

// ---- Clear old orders modal ----
function openCleanupModal() {
  const alertBox = document.getElementById("cleanupAlert");
  alertBox.classList.remove("show");
  alertBox.textContent = "";
  document.getElementById("cleanupModal").classList.add("show");
}

document.getElementById("cleanupForm")?.addEventListener("submit", async (e) => {
  e.preventDefault();

  const days = document.getElementById("cleanupDays").value || "30";
  const status = document.getElementById("cleanupStatus").value;
  const btn = document.getElementById("cleanupSubmitBtn");
  const alertBox = document.getElementById("cleanupAlert");

  const confirmed = confirm(`Delete orders older than ${days} day(s)? This cannot be undone.`);
  if (!confirmed) return;

  btn.disabled = true;
  btn.textContent = "Deleting…";
  alertBox.classList.remove("show");

  try {
    const result = await apiFetch(
      `/api/sales/cleanup?days=${encodeURIComponent(days)}&status=${encodeURIComponent(status)}`,
      { method: "DELETE" }
    );

    closeModal("cleanupModal");

    // Refresh today's stats and the sales table so the deleted
    // orders disappear immediately.
    await Promise.all([loadStats(), loadSales()]);

    alert(result.message || "Old orders cleared.");
  } catch (err) {
    alertBox.textContent = err.message;
    alertBox.classList.add("show");
  } finally {
    btn.disabled = false;
    btn.textContent = "Delete";
  }
});


function updateProfitChart() {
  const entries = Object.entries(dailyByDayCache).sort(([a], [b]) => a.localeCompare(b));
  const labels = entries.map(([date]) => date);
  const salesData = entries.map(([, day]) => day.revenue); // adjust field name to your data shape
  renderProfitChart(labels, salesData);
}

// ---- Init ----
async function init() {
  await Promise.all([loadStats(), loadProducts(), loadSales()]);
}
init();