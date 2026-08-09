document.getElementById("year").textContent = new Date().getFullYear();

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
// 1) Mobile hamburger drawer
// --------------------------------------------------------------------- //
const menuToggle = document.getElementById("menuToggle");
const mobileDrawer = document.getElementById("mobileDrawer");
const drawerBackdrop = document.getElementById("drawerBackdrop");
const drawerClose = document.getElementById("drawerClose");

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

// --------------------------------------------------------------------- //
// 2) Smart address truncation for property cards
//    Keeps everything up to "لاله X [اصلی/غربی/شرقی]" and drops the rest
//    of the sub-address (کوچه/پلاک/طبقه/زنگ ...) to keep cards clean.
// --------------------------------------------------------------------- //
function truncateAddress(address) {
  if (!address) return "";
  const text = address.trim();
  const match = text.match(/^(.*?لاله\s*[\u06F0-\u06F90-9]+\s*(اصلی|غربی|شرقی)?)/);
  if (match && match[1]) {
    return match[1].trim();
  }
  // Fallback: no "لاله" pattern found — cap at a reasonable length
  return text.length > 40 ? text.slice(0, 40).trim() + "…" : text;
}

// --------------------------------------------------------------------- //
// 3) Mobile bottom-sheet filter
// --------------------------------------------------------------------- //
const searchBar = document.getElementById("searchBar");
const filterFab = document.getElementById("filterFab");
const filterBackdrop = document.getElementById("filterBackdrop");
const sheetClose = document.getElementById("sheetClose");

function openSheet() {
  searchBar.classList.add("open");
  filterBackdrop.classList.add("open");
}
function closeSheet() {
  searchBar.classList.remove("open");
  filterBackdrop.classList.remove("open");
}
filterFab.addEventListener("click", openSheet);
filterBackdrop.addEventListener("click", closeSheet);
sheetClose.addEventListener("click", closeSheet);

// Defensive: prevent any tap/click inside the sheet itself from ever
// bubbling out to the backdrop's close handler (this is what caused
// "touching an input inside the sheet closes it").
searchBar.addEventListener("click", (e) => e.stopPropagation());
searchBar.addEventListener("touchstart", (e) => e.stopPropagation());

// --------------------------------------------------------------------- //
// Property listing state + rendering
// --------------------------------------------------------------------- //
const grid = document.getElementById("propertyGrid");
const resultCount = document.getElementById("resultCount");
const loadMoreBtn = document.getElementById("loadMoreBtn");
let allProperties = [];
let currentFiltered = [];

const PAGE_SIZE = 6;
let visibleCount = PAGE_SIZE;

function propertyCard(p) {
  const priceLine =
    p.deal_type === "فروش"
      ? `<p class="card-price">💰 ${p.price_total || "توافقی"}</p>`
      : `<p class="card-price">💰 رهن: ${p.rahn || "-"} | اجاره: ${p.ejare || "-"}</p>`;

  const extras = [];
  if (p.parking) extras.push("🅿️ پارکینگ");
  if (p.elevator) extras.push("🛗 آسانسور");

  const shortAddress = truncateAddress(p.address);

  return `
    <article class="card">
      <div class="card-body">
        <span class="deal-tag ${p.deal_type === "فروش" ? "sale" : "rent"}">${p.deal_type}</span>
        <h3>${p.property_type || "ملک"} · کد ${p.code || "-"}</h3>
        <p class="card-meta">📍 ${shortAddress || "-"}</p>
        <p class="card-meta">${p.area_m2 ? p.area_m2 + " متر" : ""} ${p.rooms ? "· " + p.rooms + " خواب" : ""}</p>
        ${extras.length ? `<p class="card-meta">${extras.join(" | ")}</p>` : ""}
        ${priceLine}
      </div>
    </article>
  `;
}

function renderProperties() {
  if (!currentFiltered.length) {
    grid.innerHTML = `<p class="loading">فایلی با این مشخصات پیدا نشد.</p>`;
    resultCount.textContent = "";
    loadMoreBtn.hidden = true;
    return;
  }
  const shown = currentFiltered.slice(0, visibleCount);
  grid.innerHTML = shown.map(propertyCard).join("");
  resultCount.textContent = `${shown.length} از ${currentFiltered.length} آگهی`;
  loadMoreBtn.hidden = visibleCount >= currentFiltered.length;
}

loadMoreBtn.addEventListener("click", () => {
  visibleCount += PAGE_SIZE;
  renderProperties();
});

async function loadProperties() {
  grid.innerHTML = `<p class="loading">در حال بارگذاری آگهی‌ها...</p>`;
  try {
    const res = await fetch(`${API_BASE_URL}/api/properties`);
    if (!res.ok) throw new Error("request failed");
    allProperties = (await res.json()).reverse(); // جدیدترین‌ها اول
    updateStatsRibbon();
    applyFilters();
  } catch (err) {
    grid.innerHTML = `<p class="loading">اتصال به سرور برقرار نشد. لطفاً چند لحظه صبر کنید و صفحه را رفرش کنید (سرور رایگان گاهی چند ثانیه طول می‌کشد بیدار شود).</p>`;
  }
}

function updateStatsRibbon() {
  const saleCount = allProperties.filter((p) => p.deal_type === "فروش").length;
  const rentCount = allProperties.filter((p) => p.deal_type === "رهن و اجاره").length;
  const el = document.getElementById("statsText");
  if (el) {
    el.textContent = `🏠 ${allProperties.length} فایل فعال — ${saleCount} فروشی، ${rentCount} رهن و اجاره`;
  }
}

// اسلایدر تصاویر بالای صفحه
function initCarousel() {
  const slides = document.querySelectorAll(".carousel-slide");
  const dots = document.querySelectorAll(".dot");
  if (slides.length <= 1) return;

  let current = 0;
  function goTo(index) {
    slides[current].classList.remove("active");
    dots[current].classList.remove("active");
    current = index;
    slides[current].classList.add("active");
    dots[current].classList.add("active");
  }
  dots.forEach((dot, i) => dot.addEventListener("click", () => goTo(i)));
  setInterval(() => goTo((current + 1) % slides.length), 4500);
}
initCarousel();

// جستجو: همیشه روی کل داده‌ی گوگل‌شیت اجرا می‌شود، نه فقط آگهی‌های نمایش‌داده‌شده
function applyFilters() {
  const keyword = document.getElementById("citySearch").value.trim();
  const dealType = document.getElementById("dealType").value;

  let filtered = allProperties;
  if (dealType) {
    filtered = filtered.filter((p) => p.deal_type === dealType);
  }
  if (keyword) {
    filtered = filtered.filter(
      (p) =>
        (p.address || "").includes(keyword) ||
        (p.property_type || "").includes(keyword) ||
        (p.code || "").includes(keyword)
    );
  }
  currentFiltered = filtered;
  visibleCount = PAGE_SIZE;
  renderProperties();
}

document.getElementById("searchBtn").addEventListener("click", () => {
  applyFilters();
  closeSheet();
  document.getElementById("listings").scrollIntoView({ behavior: "smooth" });
});

document.getElementById("quickSale").addEventListener("click", (e) => {
  e.preventDefault();
  document.getElementById("dealType").value = "فروش";
  applyFilters();
  document.getElementById("listings").scrollIntoView({ behavior: "smooth" });
});
document.getElementById("quickRent").addEventListener("click", (e) => {
  e.preventDefault();
  document.getElementById("dealType").value = "رهن و اجاره";
  applyFilters();
  document.getElementById("listings").scrollIntoView({ behavior: "smooth" });
});

// --------------------------------------------------------------------- //
// 4) Lead form -> save to backend AND open a pre-filled WhatsApp chat
// --------------------------------------------------------------------- //
document.getElementById("leadForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const statusEl = document.getElementById("formStatus");
  const name = document.getElementById("leadName").value.trim();
  const phone = document.getElementById("leadPhone").value.trim();
  const message = document.getElementById("leadMessage").value.trim();

  statusEl.textContent = "در حال ارسال...";

  const payload = { name, phone, message, source: "website" };

  try {
    await fetch(`${API_BASE_URL}/api/leads`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
  } catch (err) {
    // حتی اگر ذخیره در سرور ناموفق بود، همچنان کاربر را به واتساپ می‌فرستیم
  }

  const waText = encodeURIComponent(
    `سلام، من ${name} هستم.\nشماره تماس: ${phone}\n${message ? "پیام: " + message : ""}`
  );
  window.open(`${whatsappUrl}?text=${waText}`, "_blank");

  statusEl.textContent = "درخواست شما ثبت شد و چت واتساپ باز شد.";
  e.target.reset();
});

loadProperties();
