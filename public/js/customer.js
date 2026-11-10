// Let visitors browse the shop without logging in first.
// We only require login once they try to actually buy (checkout).
let session = getSession();
if (session && session.user.role !== "customer") session = null;
updateUserBar();

function updateUserBar() {
  const nameEl = document.getElementById("userName");
  const emailEl = document.getElementById("footerEmail");
  const logoutBtn = document.querySelector(".shop-logout");

  if (session) {
    nameEl.textContent = session.user.name;
    emailEl.textContent = session.user.email;
    if (logoutBtn) {
      logoutBtn.textContent = "Log out";
      logoutBtn.onclick = logout;
    }
  } else {
    nameEl.textContent = "Guest";
    emailEl.textContent = "";
    if (logoutBtn) {
      logoutBtn.textContent = "Log in";
      logoutBtn.onclick = () => (window.location.href = "/login.html");
    }
  }
}

// Send the customer to the login page when they need an account —
// used right before checkout ("buy") and before placing an order.
function requireLoginToBuy() {
  if (session) return true;
  toast("Please log in to complete your purchase.");
  window.location.href = "/login.html";
  return false;
}

const GRADIENTS = [
  ["#cfe8b0", "#a7d9e8"],
  ["#f7d6e0", "#f9e79f"],
  ["#c9e4de", "#f6cccb"],
  ["#ffe8d6", "#d0f4de"],
  ["#e0c3fc", "#8ec5fc"],
  ["#fbc4ab", "#ffe5d9"],
];

let allProducts = [];
let ratingSummary = {};
let activeCategory = "All";
let searchTerm = "";
let cart = [];
let wishlist = JSON.parse(localStorage.getItem("stockledger_wishlist") || "[]");
let cartStep = "cart";
let activeProductId = null;
let urlCategoryApplied = false;

function gradientFor(seed) {
  let hash = 0;
  for (const ch of seed) hash = (hash * 31 + ch.charCodeAt(0)) % GRADIENTS.length;
  return GRADIENTS[Math.abs(hash) % GRADIENTS.length];
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str || "";
  return div.innerHTML;
}

function starString(rating) {
  const full = Math.round(rating);
  return "★★★★★".slice(0, full) + "☆☆☆☆☆".slice(0, 5 - full);
}

function toast(msg, isError = false) {
  const el = document.getElementById("toast");
  el.textContent = msg;
  el.classList.toggle("error", isError);
  el.classList.add("show");
  clearTimeout(toast._t);
  toast._t = setTimeout(() => el.classList.remove("show"), 2400);
}

/* ---------- Discount helpers ----------
   Expects each product to optionally carry a `discount` field from the
   API, e.g. p.discount = 15 | 20 | 30 (a percent number). Products with
   no discount, or discount <= 0, are treated as full price. */
function discountPercent(p) {
  const d = Number(p.discount) || 0;
  return d > 0 && d < 100 ? d : 0;
}

function discountedPrice(p) {
  const pct = discountPercent(p);
  return pct > 0 ? p.price * (1 - pct / 100) : p.price;
}

/* ---------- View switching (Shop / Orders) ---------- */
document.querySelectorAll(".shop-nav a").forEach((link) => {
  link.addEventListener("click", (e) => {
    const view = link.dataset.view;
    if (view === "orders" && !requireLoginToBuy()) {
      e.preventDefault();
      return;
    }
    document.querySelectorAll(".shop-nav a").forEach((a) => a.classList.remove("active"));
    link.classList.add("active");
    document.getElementById("shopView").style.display = view === "shop" ? "block" : "none";
    document.getElementById("ordersView").style.display = view === "orders" ? "block" : "none";
    if (view === "orders") loadOrders();
  });
});

/* ---------- Search ---------- */
document.getElementById("searchToggle").addEventListener("click", () => {
  const bar = document.getElementById("searchBar");
  bar.style.display = bar.style.display === "none" ? "block" : "none";
  if (bar.style.display === "block") document.getElementById("searchInput").focus();
});
document.getElementById("searchInput").addEventListener("input", (e) => {
  searchTerm = e.target.value.trim().toLowerCase();
  renderAllSections();
});

/* ---------- URL category deep-linking (e.g. /customer.html?category=skincare) ---------- */
function normalizeCategory(str) {
  return (str || "").toLowerCase().replace(/[\s-_]+/g, "");
}

function applyCategoryFromUrl(cats) {
  if (urlCategoryApplied) return;
  urlCategoryApplied = true;

  const params = new URLSearchParams(window.location.search);
  const catParam = params.get("category");
  if (!catParam) return;

  const target = normalizeCategory(catParam);
  const match = cats.find((c) => normalizeCategory(c) === target);
  if (match) {
    activeCategory = match;
  }
}

/* ---------- Categories ---------- */
function renderCategories() {
  const cats = ["All", ...new Set(allProducts.map((p) => p.category || "General"))];

  // On first load, honor ?category=... from the URL (e.g. links from category.html)
  applyCategoryFromUrl(cats);

  const row = document.getElementById("catRow");
  row.innerHTML = cats.map((c) => `
    <div class="cat-pill ${c === activeCategory ? "active" : ""}" data-cat="${escapeHtml(c)}">
      <span class="dot"></span>${escapeHtml(c)}
    </div>
  `).join("");
  row.querySelectorAll(".cat-pill").forEach((pill) => {
    pill.addEventListener("click", () => {
      activeCategory = pill.dataset.cat;
      renderCategories();
      renderAllSections();
    });
  });
}

/* ---------- Card builder (shared by all grids) ---------- */
function buildProductCard(p) {
  const [a, b] = gradientFor(p.sku || p.name);
  const isOut = p.stock <= 0;
  const isWished = wishlist.includes(p._id);
  const rating = ratingSummary[p._id];
  const pct = discountPercent(p);
  const priceHtml = pct > 0
    ? `<div class="shop-card-price">
         <span class="price-discounted">${money(discountedPrice(p))}</span>
         <span class="price-original">${money(p.price)}</span>
       </div>`
    : `<div class="shop-card-price">${money(p.price)}</div>`;

  return `
    <div class="shop-card">
      <div class="shop-card-media" data-view="${p._id}" style="--card-a:${a}; --card-b:${b};">
        ${p.imageUrl ? `<img src="${p.imageUrl}" alt="${escapeHtml(p.name)}" />` : escapeHtml(p.name)}
        ${pct > 0 ? `<div class="discount-flag">-${pct}%</div>` : ""}
        <div class="stock-flag ${isOut ? "out" : ""}">${isOut ? "Out of stock" : p.stock + " left"}</div>
        <button class="wish-btn ${isWished ? "active" : ""}" data-id="${p._id}">♥</button>
        <button class="add-btn" data-id="${p._id}" ${isOut ? "disabled" : ""}>+</button>
      </div>
      <div class="shop-card-body">
        <div class="shop-card-name" data-view="${p._id}">${escapeHtml(p.name)}</div>
        <div class="shop-card-sub">${escapeHtml(p.category || "General")}</div>
        ${rating ? `<div class="card-rating"><span class="stars">${starString(rating.avg)}</span><span class="count">(${rating.count})</span></div>` : ""}
        ${priceHtml}
      </div>
    </div>
  `;
}

function wireCardEvents(container) {
  container.querySelectorAll(".add-btn").forEach((btn) => {
    btn.addEventListener("click", (e) => { e.stopPropagation(); addToCart(btn.dataset.id); });
  });
  container.querySelectorAll(".wish-btn").forEach((btn) => {
    btn.addEventListener("click", (e) => { e.stopPropagation(); toggleWish(btn.dataset.id); });
  });
  container.querySelectorAll("[data-view]").forEach((el) => {
    el.addEventListener("click", () => openProductDetail(el.dataset.view));
  });
}

/* ---------- List-building helpers ----------
   Each of these returns the actual array of products used by a
   special section (Discounts / Best Sellers / Trending / Favorites).
   "Available now" then excludes any product ID present in ANY of
   these lists, so a product only ever appears in one section. */

function getDiscountedList() {
  let list = allProducts.filter((p) => discountPercent(p) > 0);
  if (activeCategory !== "All") list = list.filter((p) => (p.category || "General") === activeCategory);
  if (searchTerm) list = list.filter((p) => p.name.toLowerCase().includes(searchTerm));
  return list;
}

function getBestSellerList() {
  return [...allProducts]
    .filter((p) => (p.soldCount || 0) > 0)
    .sort((a, b) => (b.soldCount || 0) - (a.soldCount || 0))
    .slice(0, 6);
}

function getTrendingList() {
  return [...allProducts]
    .filter((p) => ratingSummary[p._id] && ratingSummary[p._id].lastReviewAt)
    .sort((a, b) =>
      new Date(ratingSummary[b._id].lastReviewAt) - new Date(ratingSummary[a._id].lastReviewAt)
    )
    .slice(0, 6);
}

function getFavoriteList() {
  const MIN_REVIEWS = 2; // require at least this many reviews to qualify
  return [...allProducts]
    .filter((p) => ratingSummary[p._id] && ratingSummary[p._id].count >= MIN_REVIEWS)
    .sort((a, b) => {
      const ra = ratingSummary[a._id], rb = ratingSummary[b._id];
      if (rb.avg !== ra.avg) return rb.avg - ra.avg;
      return rb.count - ra.count;
    })
    .slice(0, 6);
}

/* Union of every product ID already claimed by a special section. */
function getFeaturedIdSet() {
  const ids = new Set();
  getDiscountedList().forEach((p) => ids.add(p._id));
  getBestSellerList().forEach((p) => ids.add(p._id));
  getTrendingList().forEach((p) => ids.add(p._id));
  getFavoriteList().forEach((p) => ids.add(p._id));
  return ids;
}

/* ---------- Product grid (Available now — excludes anything featured elsewhere) ---------- */
function renderProducts() {
  const grid = document.getElementById("productGrid");
  const empty = document.getElementById("productEmpty");

  const featuredIds = getFeaturedIdSet();
  let list = allProducts.filter((p) => !featuredIds.has(p._id));
  if (activeCategory !== "All") list = list.filter((p) => (p.category || "General") === activeCategory);
  if (searchTerm) list = list.filter((p) => p.name.toLowerCase().includes(searchTerm));

  if (list.length === 0) {
    grid.innerHTML = "";
    empty.style.display = "block";
    return;
  }
  empty.style.display = "none";

  grid.innerHTML = list.map(buildProductCard).join("");
  wireCardEvents(grid);
}

/* ---------- Product Discounts grid ---------- */
function renderDiscountedProducts() {
  const grid = document.getElementById("discountGrid");
  const empty = document.getElementById("discountEmpty");
  if (!grid) return;

  const list = getDiscountedList();

  if (list.length === 0) {
    grid.innerHTML = "";
    empty.style.display = "block";
    return;
  }
  empty.style.display = "none";

  grid.innerHTML = list.map(buildProductCard).join("");
  wireCardEvents(grid);
}

/* ---------- Best Sellers ----------
   Assumes each product carries a sold-count field from the API.
   Adjust `p.soldCount` below if your API names it differently
   (e.g. p.unitsSold, p.totalSold). Top 6 by units sold. */
function renderBestSellers() {
  const grid = document.getElementById("bestSellerGrid");
  const empty = document.getElementById("bestSellerEmpty");
  if (!grid) return;

  const list = getBestSellerList();

  if (list.length === 0) {
    grid.innerHTML = "";
    empty.style.display = "block";
    return;
  }
  empty.style.display = "none";
  grid.innerHTML = list.map(buildProductCard).join("");
  wireCardEvents(grid);
}

/* ---------- Trending (most recent review activity) ----------
   Assumes /api/reviews/summary returns a `lastReviewAt` timestamp
   per product alongside avg/count. If your summary endpoint doesn't
   include that yet, this section will render empty until it does. */
function renderTrending() {
  const grid = document.getElementById("trendingGrid");
  const empty = document.getElementById("trendingEmpty");
  if (!grid) return;

  const list = getTrendingList();

  if (list.length === 0) {
    grid.innerHTML = "";
    empty.style.display = "block";
    return;
  }
  empty.style.display = "none";
  grid.innerHTML = list.map(buildProductCard).join("");
  wireCardEvents(grid);
}

/* ---------- Customer Favorites (highest rated, min review count) ---------- */
function renderCustomerFavorites() {
  const grid = document.getElementById("favoriteGrid");
  const empty = document.getElementById("favoriteEmpty");
  if (!grid) return;

  const list = getFavoriteList();

  if (list.length === 0) {
    grid.innerHTML = "";
    empty.style.display = "block";
    return;
  }
  empty.style.display = "none";
  grid.innerHTML = list.map(buildProductCard).join("");
  wireCardEvents(grid);
}

/* Re-renders every section in the right order.
   Special sections are rendered FIRST so their picks are locked in,
   then "Available now" is rendered LAST, excluding whatever the
   special sections already claimed. */
function renderAllSections() {
  renderDiscountedProducts();
  renderBestSellers();
  renderTrending();
  renderCustomerFavorites();
  renderProducts();
}

function toggleWish(id) {
  if (wishlist.includes(id)) wishlist = wishlist.filter((w) => w !== id);
  else wishlist.push(id);
  localStorage.setItem("stockledger_wishlist", JSON.stringify(wishlist));
  renderAllSections();
}

/* ---------- Product detail modal ---------- */
async function openProductDetail(productId) {
  const p = allProducts.find((x) => x._id === productId);
  if (!p) return;
  activeProductId = productId;

  const [a, b] = gradientFor(p.sku || p.name);
  const media = document.getElementById("pdMedia");
  media.style.setProperty("--card-a", a);
  media.style.setProperty("--card-b", b);
  media.innerHTML = p.imageUrl ? `<img src="${p.imageUrl}" alt="${escapeHtml(p.name)}" />` : escapeHtml(p.name);

  document.getElementById("pdCategory").textContent = p.category || "General";
  document.getElementById("pdName").textContent = p.name;
  document.getElementById("pdPrice").textContent = money(p.price);
  document.getElementById("pdStock").textContent = p.stock > 0 ? `${p.stock} in stock` : "Out of stock";
  document.getElementById("pdDesc").textContent = p.description || "No description provided yet.";
  document.getElementById("pdQtyValue").textContent = "1";

  const rating = ratingSummary[productId];
  document.getElementById("pdRatingSummary").innerHTML = rating
    ? `<span>${starString(rating.avg)}</span><span>${rating.avg}</span><span class="count">(${rating.count} review${rating.count === 1 ? "" : "s"})</span>`
    : `<span class="count">No reviews yet — be the first.</span>`;

  document.getElementById("pdAddBtn").disabled = p.stock <= 0;

  resetStarInput();
  document.getElementById("pdComment").value = "";
  document.getElementById("pdReviewList").innerHTML = `<div class="review-empty">Loading reviews…</div>`;

  document.getElementById("pdBackdrop").classList.add("show");

  try {
    const reviews = await apiFetch(`/api/reviews/${productId}`);
    renderReviewList(reviews);
  } catch (err) {
    document.getElementById("pdReviewList").innerHTML = `<div class="review-empty">Could not load reviews.</div>`;
  }
}

function renderReviewList(reviews) {
  const list = document.getElementById("pdReviewList");
  if (reviews.length === 0) {
    list.innerHTML = `<div class="review-empty">No reviews yet — be the first to share your thoughts.</div>`;
    return;
  }
  list.innerHTML = reviews.map((r) => `
    <div class="review-row">
      <div class="review-top">
        <span class="review-name">${escapeHtml(r.customerName)}</span>
        <span class="review-date">${new Date(r.createdAt).toLocaleDateString()}</span>
      </div>
      <div class="review-stars">${starString(r.rating)}</div>
      ${r.comment ? `<div class="review-comment">${escapeHtml(r.comment)}</div>` : ""}
    </div>
  `).join("");
}

document.getElementById("pdClose").addEventListener("click", closeProductDetail);
document.getElementById("pdBackdrop").addEventListener("click", (e) => {
  if (e.target.id === "pdBackdrop") closeProductDetail();
});
function closeProductDetail() {
  document.getElementById("pdBackdrop").classList.remove("show");
  activeProductId = null;
}

document.getElementById("pdQtyMinus").addEventListener("click", () => {
  const el = document.getElementById("pdQtyValue");
  el.textContent = Math.max(1, parseInt(el.textContent, 10) - 1);
});
document.getElementById("pdQtyPlus").addEventListener("click", () => {
  const p = allProducts.find((x) => x._id === activeProductId);
  const el = document.getElementById("pdQtyValue");
  const next = parseInt(el.textContent, 10) + 1;
  el.textContent = p && next > p.stock ? p.stock : next;
});
document.getElementById("pdAddBtn").addEventListener("click", () => {
  const qty = parseInt(document.getElementById("pdQtyValue").textContent, 10) || 1;
  addToCart(activeProductId, qty);
});

/* Star input for writing a review */
function resetStarInput() {
  document.querySelectorAll("#pdStarInput span").forEach((s) => s.classList.remove("filled"));
  document.getElementById("pdStarInput").dataset.value = "0";
}
document.querySelectorAll("#pdStarInput span").forEach((star) => {
  star.addEventListener("click", () => {
    const v = parseInt(star.dataset.v, 10);
    document.getElementById("pdStarInput").dataset.value = v;
    document.querySelectorAll("#pdStarInput span").forEach((s) => {
      s.classList.toggle("filled", parseInt(s.dataset.v, 10) <= v);
    });
  });
});

document.getElementById("pdSubmitReview").addEventListener("click", async () => {
  const rating = parseInt(document.getElementById("pdStarInput").dataset.value || "0", 10);
  const comment = document.getElementById("pdComment").value.trim();

  if (!rating) {
    toast("Pick a star rating first.", true);
    return;
  }
  try {
    await apiFetch("/api/reviews", {
      method: "POST",
      body: JSON.stringify({ productId: activeProductId, rating, comment }),
    });
    toast("Review submitted — thank you!");
    const [reviews, summary] = await Promise.all([
      apiFetch(`/api/reviews/${activeProductId}`),
      apiFetch("/api/reviews/summary"),
    ]);
    ratingSummary = summary;
    renderReviewList(reviews);
    const r = ratingSummary[activeProductId];
    document.getElementById("pdRatingSummary").innerHTML = r
      ? `<span>${starString(r.avg)}</span><span>${r.avg}</span><span class="count">(${r.count} review${r.count === 1 ? "" : "s"})</span>`
      : "";
    renderAllSections();
  } catch (err) {
    toast(err.message, true);
  }
});

/* ---------- Cart ---------- */
function addToCart(productId, quantity = 1) {
  const product = allProducts.find((p) => p._id === productId);
  if (!product || product.stock <= 0) return;

  const line = cart.find((l) => l.productId === productId);
  if (line) {
    const next = line.quantity + quantity;
    if (next > product.stock) {
      toast(`Only ${product.stock} of "${product.name}" available.`, true);
      line.quantity = product.stock;
    } else {
      line.quantity = next;
    }
  } else {
    const [a, b] = gradientFor(product.sku || product.name);
    cart.push({
      productId,
      name: product.name,
      price: discountedPrice(product),
      quantity: Math.min(quantity, product.stock),
      stock: product.stock,
      gradient: [a, b],
    });
  }
  toast(`Added "${product.name}" to cart.`);
  renderCart();
}

function changeQty(productId, delta) {
  const line = cart.find((l) => l.productId === productId);
  if (!line) return;
  line.quantity += delta;
  if (line.quantity <= 0) {
    cart = cart.filter((l) => l.productId !== productId);
  } else if (line.quantity > line.stock) {
    line.quantity = line.stock;
    toast(`Only ${line.stock} available.`, true);
  }
  renderCart();
}

function removeLine(productId) {
  cart = cart.filter((l) => l.productId !== productId);
  renderCart();
}

function cartTotal() {
  return cart.reduce((sum, l) => sum + l.price * l.quantity, 0);
}

function renderCart() {
  const itemsEl = document.getElementById("cartItems");
  const countEl = document.getElementById("cartCount");
  const totalEl = document.getElementById("cartTotal");

  const count = cart.reduce((n, l) => n + l.quantity, 0);
  countEl.textContent = count;
  countEl.style.display = count > 0 ? "flex" : "none";

  if (cart.length === 0) {
    itemsEl.innerHTML = `<div class="cart-empty">Your cart is empty. Add something from the shop.</div>`;
  } else {
    itemsEl.innerHTML = cart.map((l) => `
      <div class="cart-line">
        <div class="cart-line-swatch" style="--card-a:${l.gradient[0]}; --card-b:${l.gradient[1]};"></div>
        <div class="cart-line-info">
          <div class="cart-line-name">${escapeHtml(l.name)}</div>
          <div class="cart-line-price">${money(l.price)} each</div>
        </div>
        <div class="cart-qty">
          <button data-id="${l.productId}" data-delta="-1">−</button>
          <span>${l.quantity}</span>
          <button data-id="${l.productId}" data-delta="1">+</button>
        </div>
        <button class="cart-remove" data-remove="${l.productId}">✕</button>
      </div>
    `).join("");

    itemsEl.querySelectorAll("[data-delta]").forEach((btn) => {
      btn.addEventListener("click", () => changeQty(btn.dataset.id, parseInt(btn.dataset.delta, 10)));
    });
    itemsEl.querySelectorAll("[data-remove]").forEach((btn) => {
      btn.addEventListener("click", () => removeLine(btn.dataset.remove));
    });
  }

  totalEl.textContent = money(cartTotal());
  document.getElementById("paySummaryTotal").textContent = money(cartTotal());
  updateFooter();
}

function updateFooter() {
  const btn = document.getElementById("checkoutBtn");
  const foot = document.getElementById("cartFoot");

  if (cartStep === "success") {
    foot.style.display = "none";
    return;
  }
  foot.style.display = "block";

  if (cartStep === "cart") {
    btn.textContent = "Checkout";
    btn.disabled = cart.length === 0;
  } else if (cartStep === "payment") {
    btn.textContent = `Confirm & pay ${money(cartTotal())}`;
    btn.disabled = false;
  }
}

function setCartStep(step) {
  cartStep = step;
  document.getElementById("cartItems").style.display = step === "cart" ? "block" : "none";
  document.getElementById("paymentPanel").style.display = step === "payment" ? "block" : "none";
  document.getElementById("successPanel").style.display = step === "success" ? "block" : "none";
  updateFooter();
}

document.getElementById("cartToggle").addEventListener("click", () => {
  setCartStep("cart");
  document.getElementById("cartDrawer").classList.add("show");
  document.getElementById("cartBackdrop").classList.add("show");
});
function closeCart() {
  document.getElementById("cartDrawer").classList.remove("show");
  document.getElementById("cartBackdrop").classList.remove("show");
}
document.getElementById("cartClose").addEventListener("click", closeCart);
document.getElementById("cartBackdrop").addEventListener("click", closeCart);
document.getElementById("paymentBack").addEventListener("click", () => setCartStep("cart"));
document.getElementById("continueShoppingBtn").addEventListener("click", () => {
  closeCart();
  setCartStep("cart");
});

/* ---------- NEW: Dynamic KHQR generation for wallet payment ---------- */
async function generateWalletQR() {
  const img = document.getElementById("walletQrImage");
  const status = document.getElementById("walletQrStatus");
  img.style.display = "none";
  status.textContent = "Generating QR…";

  try {
    const result = await apiFetch("/api/payment/khqr", {
      method: "POST",
      body: JSON.stringify({ amount: cartTotal() }),
    });
    img.src = result.qrImage;
    img.style.display = "block";
    status.textContent = `Scan to pay ${money(cartTotal())}`;
  } catch (err) {
    status.textContent = "Could not load QR code — try again.";
  }
}

/* Payment method field toggling */
document.querySelectorAll('input[name="payMethod"]').forEach((radio) => {
  radio.addEventListener("change", () => {
    const method = document.querySelector('input[name="payMethod"]:checked').value;
    document.getElementById("cardFields").style.display = method === "card" ? "flex" : "none";
    document.getElementById("walletFields").style.display = method === "wallet" ? "flex" : "none";
    if (method === "wallet") generateWalletQR();
  });
});

document.getElementById("checkoutBtn").addEventListener("click", async () => {
  if (cartStep === "cart") {
    if (cart.length === 0) return;
    if (!requireLoginToBuy()) return;
    setCartStep("payment");
    return;
  }
  if (cartStep === "payment") {
    if (!requireLoginToBuy()) return;
    await placeOrder();
  }
});

async function placeOrder() {
  const method = document.querySelector('input[name="payMethod"]:checked').value;
  let paymentReference = "";
  if (method === "card") {
    const num = document.getElementById("cardNumber").value.replace(/\s+/g, "");
    if (num.length < 4) { toast("Enter a card number to continue.", true); return; }
    paymentReference = "Card ending " + num.slice(-4);
  } else if (method === "wallet") {
    paymentReference = `Paid via ABA KHQR (${money(cartTotal())})`;
  } else {
    paymentReference = "Pay on delivery";
  }

  const btn = document.getElementById("checkoutBtn");
  btn.disabled = true;
  btn.textContent = "Placing order…";

  try {
    const result = await apiFetch("/api/sales", {
      method: "POST",
      body: JSON.stringify({
        items: cart.map((l) => ({ productId: l.productId, quantity: l.quantity })),
        paymentMethod: method,
        paymentReference,
      }),
    });

    console.log("Order placed successfully:", result); // temporary debug line

    cart = [];
    renderCart();

    // Payment is done and the invoice is already saved in MongoDB —
    // take the customer straight to their invoice page.
    if (result.invoiceId) {
      window.location.href = "/invoice.html?id=" + result.invoiceId;
      return;
    }

    document.getElementById("successMessage").textContent =
      `Your order total was ${money(cartTotal())}, paid by ${method === "cod" ? "cash on delivery" : method === "card" ? "card" : "wallet"}.`;
    setCartStep("success");
    await loadProducts();
  } catch (err) {
    console.error("Order failed:", err); // temporary debug line — check browser console for this
    toast(err.message || "Order failed — check console for details.", true);
    updateFooter();
  }
}

/* ---------- Data loading ---------- */
async function loadProducts() {
  try {
    const [products, summary] = await Promise.all([
      apiFetch("/api/products"),
      apiFetch("/api/reviews/summary"),
    ]);
    allProducts = products;
    ratingSummary = summary;
    renderCategories();
    renderAllSections();
  } catch (err) {
    toast(err.message, true);
  }
}

async function loadOrders() {
  try {
    const orders = await apiFetch("/api/sales/mine");
    const panel = document.getElementById("ordersPanel");
    const empty = document.getElementById("orderEmpty");

    if (orders.length === 0) {
      panel.innerHTML = "";
      empty.style.display = "block";
      return;
    }
    empty.style.display = "none";
    const paymentLabel = { cod: "Cash on delivery", card: "Card", wallet: "Wallet" };
    panel.innerHTML = orders.map((o) => `
      <div class="order-row">
        <div class="order-date">${new Date(o.createdAt).toLocaleDateString()}</div>
        <div class="order-items">${o.items.map((i) => `${i.quantity}× ${escapeHtml(i.name)}`).join(", ")}</div>
        <div class="order-total">${money(o.total)}</div>
        <div class="order-status">${paymentLabel[o.paymentMethod] || "Cash on delivery"}</div>
        <div class="order-status">${o.status}</div>
      </div>
    `).join("");
  } catch (err) {
    toast(err.message, true);
  }
}

document.querySelectorAll('input[name="payMethod"]').forEach((radio) => {
  radio.addEventListener("change", () => {
    const method = document.querySelector('input[name="payMethod"]:checked').value;
    document.getElementById("cardFields").style.display = method === "card" ? "flex" : "none";
    document.getElementById("walletFields").style.display = method === "wallet" ? "flex" : "none";
    if (method === "wallet") {
      document.getElementById("walletAmountValue").textContent = cartTotal().toFixed(2);
    }
  });
});

async function init() {
  await loadProducts();
  renderCart();
}
init();