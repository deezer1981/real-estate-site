// common.js — لینک‌های تماس + منوی موبایل + سال فوتر + انتخاب پیام
const yearEl = document.getElementById("year");
if (yearEl) yearEl.textContent = new Date().getFullYear();

const whatsappUrl = `https://wa.me/${WHATSAPP_NUMBER}`;
const baleUrl = `https://ble.ir/${BALE_USERNAME}`;
const phoneUrl = `tel:+${WHATSAPP_NUMBER}`;
const smsPhone = String(WHATSAPP_NUMBER || "").replace(/^\+?98/, "0");

["whatsappLinkNav", "whatsappLinkBig", "drawerWhatsapp", "whatsappCta"].forEach((id) => {
  const el = document.getElementById(id);
  if (el) el.href = whatsappUrl;
});
["baleLinkNav", "baleLinkBig", "drawerBale", "baleCta"].forEach((id) => {
  const el = document.getElementById(id);
  if (el) el.href = baleUrl;
});
["phoneLinkBig", "drawerPhone"].forEach((id) => {
  const el = document.getElementById(id);
  if (el) el.href = phoneUrl;
});

/**
 * منوی انتخاب کانال پیام
 * @param {Event} [e]
 * @param {string} [prefillText] متن از پیش پرشده برای SMS / بله / واتساپ
 */
function openMessageChooser(e, prefillText) {
  if (e) e.preventDefault();

  const old = document.getElementById("msgChooser");
  if (old) old.remove();

  const text = (prefillText || "").trim();
  const enc = text ? encodeURIComponent(text) : "";

  const smsHref = text
    ? `sms:${smsPhone}?body=${enc}`
    : `sms:${smsPhone}`;
  // برخی اندرویدها &body= می‌خواهند
  const smsHrefAlt = text
    ? `sms:${smsPhone}&body=${enc}`
    : `sms:${smsPhone}`;

  const baleHref = text
    ? `https://ble.ir/${BALE_USERNAME}?text=${enc}`
    : baleUrl;

  const waHref = text
    ? `https://wa.me/${WHATSAPP_NUMBER}?text=${enc}`
    : whatsappUrl;

  const html = `
    <div id="msgChooser" style="position:fixed;inset:0;z-index:10000;background:rgba(15,23,42,0.45);display:flex;align-items:flex-end;justify-content:center;padding:16px;">
      <div role="dialog" aria-label="انتخاب روش پیام" style="background:#FFFCFA;border-radius:20px 20px 16px 16px;width:100%;max-width:420px;padding:20px 18px 16px;box-shadow:0 -8px 32px rgba(0,0,0,0.15);">
        <p style="margin:0 0 14px;text-align:center;font-weight:800;font-size:1.05rem;color:#0F172A;">پیام به دفتر اطلس</p>
        <p style="margin:0 0 16px;text-align:center;font-size:0.88rem;color:#64748B;">از کدام راه پیام می‌دهید؟</p>
        <div style="display:flex;flex-direction:column;gap:10px;">
          <a id="msgChooserSms" href="${smsHref}" style="display:flex;align-items:center;justify-content:center;gap:8px;background:#F1F5F9;color:#0F172A;text-decoration:none;font-weight:700;font-size:0.95rem;padding:14px;border-radius:12px;border:1px solid #E2E8F0;">
            📱 پیامک (SMS)
          </a>
          <a href="${baleHref}" target="_blank" rel="noopener" style="display:flex;align-items:center;justify-content:center;gap:8px;background:#EFF6FF;color:#1E3A8A;text-decoration:none;font-weight:700;font-size:0.95rem;padding:14px;border-radius:12px;border:1px solid #93C5FD;">
            💬 بله
          </a>
          <a href="${waHref}" target="_blank" rel="noopener" style="display:flex;align-items:center;justify-content:center;gap:8px;background:#ECFDF5;color:#065F46;text-decoration:none;font-weight:700;font-size:0.95rem;padding:14px;border-radius:12px;border:1px solid #6EE7B7;">
            ✅ واتساپ
          </a>
        </div>
        <button type="button" id="msgChooserClose" style="display:block;width:100%;margin-top:14px;background:transparent;border:none;color:#94A3B8;font-weight:600;font-size:0.9rem;padding:12px;cursor:pointer;">
          بستن
        </button>
      </div>
    </div>
  `;
  document.body.insertAdjacentHTML("beforeend", html);

  const sheet = document.getElementById("msgChooser");
  const close = () => sheet && sheet.remove();
  document.getElementById("msgChooserClose").addEventListener("click", close);
  sheet.addEventListener("click", (ev) => {
    if (ev.target === sheet) close();
  });

  // fallback برای SMS روی بعضی گوشی‌ها
  const smsLink = document.getElementById("msgChooserSms");
  if (smsLink && text) {
    smsLink.addEventListener("click", (ev) => {
      // اگر ?body کار نکرد، کاربر هنوز می‌تواند دستی بفرستد
      smsLink.href = smsHref;
    });
  }

  sheet.querySelectorAll("a").forEach((a) => {
    a.addEventListener("click", () => setTimeout(close, 250));
  });
}

// در دسترس برای script.js
window.openMessageChooser = openMessageChooser;

const tabMsg = document.getElementById("tabWhatsapp");
if (tabMsg) {
  tabMsg.removeAttribute("target");
  tabMsg.href = "#";
  tabMsg.addEventListener("click", (e) => openMessageChooser(e));
}

const menuToggle = document.getElementById("menuToggle");
const mobileDrawer = document.getElementById("mobileDrawer");
const drawerBackdrop = document.getElementById("drawerBackdrop");
const drawerClose = document.getElementById("drawerClose");

if (menuToggle && mobileDrawer && drawerBackdrop && drawerClose) {
  function openDrawer() {
    mobileDrawer.classList.add("open");
    drawerBackdrop.classList.add("open");
    menuToggle.classList.add("open");
    menuToggle.setAttribute("aria-expanded", "true");
    mobileDrawer.setAttribute("aria-hidden", "false");
    document.body.style.overflow = "hidden";
  }
  function closeDrawer() {
    mobileDrawer.classList.remove("open");
    drawerBackdrop.classList.remove("open");
    menuToggle.classList.remove("open");
    menuToggle.setAttribute("aria-expanded", "false");
    mobileDrawer.setAttribute("aria-hidden", "true");
    document.body.style.overflow = "";
  }
  menuToggle.addEventListener("click", () => {
    mobileDrawer.classList.contains("open") ? closeDrawer() : openDrawer();
  });
  drawerClose.addEventListener("click", closeDrawer);
  drawerBackdrop.addEventListener("click", closeDrawer);
  document.querySelectorAll(".drawer-link").forEach((link) => {
    link.addEventListener("click", closeDrawer);
  });
}
