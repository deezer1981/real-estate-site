// ---------------------------------------------------------------------
// common.js — کد مشترک بین همه‌ی صفحات سایت
// ---------------------------------------------------------------------

const yearEl = document.getElementById("year");
if (yearEl) yearEl.textContent = new Date().getFullYear();

const whatsappUrl = `https://wa.me/${WHATSAPP_NUMBER}`;
const rubikaUrl = `https://rubika.ir/${RUBIKA_USERNAME}`;
const baleUrl = `https://ble.ir/${BALE_USERNAME}`;
const phoneUrl = `tel:+${WHATSAPP_NUMBER}`;

const whatsappIds = [
  "whatsappLinkNav", "whatsappLinkBig", "drawerWhatsapp",
  "whatsappCta", "tabWhatsapp"
];
const rubikaIds = [
  "rubikaLinkNav", "rubikaLinkBig", "drawerRubika", "rubikaCta"
];
const baleIds = [
  "baleLinkNav", "baleLinkBig", "drawerBale", "baleCta"
];
const phoneIds = ["phoneLinkBig", "drawerPhone"];

whatsappIds.forEach((id) => {
  const el = document.getElementById(id);
  if (el) el.href = whatsappUrl;
});
rubikaIds.forEach((id) => {
  const el = document.getElementById(id);
  if (el) el.href = rubikaUrl;
});
baleIds.forEach((id) => {
  const el = document.getElementById(id);
  if (el) el.href = baleUrl;
});
phoneIds.forEach((id) => {
  const el = document.getElementById(id);
  if (el) el.href = phoneUrl;
});

// Mobile hamburger drawer
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
