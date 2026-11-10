// Email verification popup shared by login.html and register.html.
// Usage: const session = await showVerifyModal({ email, emailSent, devCode });
function showVerifyModal({ email, emailSent = true, devCode = "" }) {
  return new Promise((resolve) => {
    const css = document.createElement("style");
    css.textContent = `
      .vm-back{position:fixed;inset:0;background:rgba(0,0,0,.55);display:flex;align-items:center;justify-content:center;z-index:9999;padding:16px}
      .vm-box{background:#fff;color:#222;border-radius:14px;max-width:380px;width:100%;padding:26px;box-shadow:0 20px 60px rgba(0,0,0,.35);font-family:inherit}
      .vm-box h3{margin:0 0 6px;font-size:1.25rem}
      .vm-box p{margin:0 0 14px;font-size:.92rem;line-height:1.45;color:#555}
      .vm-code{width:100%;box-sizing:border-box;font-size:1.6rem;letter-spacing:.5rem;text-align:center;padding:10px;border:1px solid #ccc;border-radius:10px}
      .vm-msg{min-height:20px;margin:10px 0;font-size:.88rem}
      .vm-err{color:#c0392b}.vm-ok{color:#1e8449}
      .vm-dev{background:#fff7d6;border:1px dashed #c9a400;border-radius:8px;padding:8px;margin-bottom:12px;font-size:.85rem;color:#5a4a00}
      .vm-row{display:flex;gap:10px}
      .vm-btn{flex:1;padding:11px;border-radius:10px;border:0;cursor:pointer;font-size:.95rem}
      .vm-primary{background:#222;color:#fff}.vm-ghost{background:#eee;color:#222}
      .vm-btn:disabled{opacity:.55;cursor:not-allowed}`;
    document.head.appendChild(css);

    const back = document.createElement("div");
    back.className = "vm-back";
    const safeEmail = String(email).replace(/[<>&"]/g, "");
    back.innerHTML = `
      <div class="vm-box">
        <h3>Verify your email</h3>
        <p>${emailSent
          ? `We sent a 6-digit code to <strong>${safeEmail}</strong>. Enter it below.`
          : `Enter the 6-digit code we sent to your email.`}</p>
        ${devCode ? `<div class="vm-dev">Test mode — your code is <strong>${devCode}</strong></div>` : ""}
        <input class="vm-code" id="vmCode" inputmode="numeric" maxlength="6" placeholder="••••••" autocomplete="one-time-code" />
        <div class="vm-msg" id="vmMsg"></div>
        <div class="vm-row">
          <button class="vm-btn vm-ghost" id="vmResend" type="button">Resend code</button>
          <button class="vm-btn vm-primary" id="vmVerify" type="button">Verify</button>
        </div>
      </div>`;
    document.body.appendChild(back);

    const codeEl = back.querySelector("#vmCode");
    const msgEl = back.querySelector("#vmMsg");
    const verifyBtn = back.querySelector("#vmVerify");
    const resendBtn = back.querySelector("#vmResend");
    const say = (text, ok) => { msgEl.textContent = text; msgEl.className = "vm-msg " + (ok ? "vm-ok" : "vm-err"); };
    codeEl.focus();

    async function submit() {
      const code = codeEl.value.trim();
      if (!/^\d{6}$/.test(code)) return say("Enter the 6-digit code.", false);
      verifyBtn.disabled = true;
      try {
        const data = await apiFetch("/api/auth/verify-email", { method: "POST", body: JSON.stringify({ email, code }) });
        back.remove(); css.remove();
        resolve(data);
      } catch (err) {
        say(err.message, false);
        verifyBtn.disabled = false;
      }
    }

    let cooldown = null;
    async function resend() {
      resendBtn.disabled = true;
      try {
        const data = await apiFetch("/api/auth/resend-code", { method: "POST", body: JSON.stringify({ email }) });
        say("A new code has been sent.", true);
        if (data.devCode) say("A new code has been sent. Test code: " + data.devCode, true);
      } catch (err) {
        say(err.message, false);
      }
      let left = 30;
      resendBtn.textContent = `Resend (${left}s)`;
      cooldown = setInterval(() => {
        left -= 1;
        if (left <= 0) { clearInterval(cooldown); resendBtn.disabled = false; resendBtn.textContent = "Resend code"; }
        else resendBtn.textContent = `Resend (${left}s)`;
      }, 1000);
    }

    verifyBtn.addEventListener("click", submit);
    resendBtn.addEventListener("click", resend);
    codeEl.addEventListener("keydown", (e) => { if (e.key === "Enter") submit(); });
  });
}
