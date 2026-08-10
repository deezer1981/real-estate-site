// ---------------------------------------------------------------------
// common.js — کد مشترک بین همه‌ی صفحات سایت (منوی همبرگری، لینک‌های
// تماس، سال فوتر). این فایل باید بعد از config.js و قبل از هر اسکریپت
// دیگه‌ای (مثل script.js که فقط توی index.html هست) لود بشه.
// ---------------------------------------------------------------------

const yearEl = document.getElementById("year");
if (yearEl) yearEl.textContent = new Date().getFullYear();

const botUrl = `https://t.me/${TELEGRAM_BOT_USERNAME}`;
const whatsappUrl = `https://wa.me/${WHATSAPP_NUMBER}`;
const rubikaUrl = `https://rubika.ir/${RUBIKA_USERNAME}`;
const phoneUrl = `tel:+${WHATSAPP_NUMBER}`;

[
  "botLinkNav", "botLinkBig", "tabTelegram", "drawerTelegram",
].forEach((id) => {
  const el = document.getElementById(id);
  if (el) el.href = botUrl;
});
["whatsappLinkNav", "whatsappLinkBig", "drawerWhatsapp"].forEach((id) => {
  const el = document.getElementById(id);
  if (el) el.href = whatsappUrl;
});
["rubikaLinkNav", "rubikaLinkBig", "drawerRubika"].forEach((id) => {
  const el = document.getElementById(id);
  if (el) el.href = rubikaUrl;
});
["phoneLinkBig", "drawerPhone"].forEach((id) => {
  const el = document.getElementById(id);
  if (el) el.href = phoneUrl;
});

// --------------------------------------------------------------------- //
// Mobile hamburger drawer
// --------------------------------------------------------------------- //
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
