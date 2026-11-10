// Small helpers shared by every page

async function apiFetch(url, options = {}) {
  const session = getSession();
  const headers = { "Content-Type": "application/json", ...(options.headers || {}) };
  if (session && session.token) headers.Authorization = "Bearer " + session.token;

  const res = await fetch(url, { ...options, headers });
  let data = {};
  try { data = await res.json(); } catch (_) { /* no body */ }

  if (!res.ok) {
    if (res.status === 401) clearSession();
    const err = new Error(data.message || "Something went wrong. Please try again.");
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}

function saveSession(data) {
  localStorage.setItem("stockledger_session", JSON.stringify(data));
}

function getSession() {
  const raw = localStorage.getItem("stockledger_session");
  return raw ? JSON.parse(raw) : null;
}

function clearSession() {
  localStorage.removeItem("stockledger_session");
}

function requireRoleOrRedirect(role) {
  const session = getSession();
  if (!session || session.user.role !== role) {
    window.location.href = "/login.html";
    return null;
  }
  return session;
}

function logout() {
  clearSession();
  window.location.href = "/login.html";
}

function money(n) {
  return "$" + Number(n).toFixed(2);
}
