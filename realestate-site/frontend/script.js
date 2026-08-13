// script.js — منطق صفحه‌ی اصلی (نمایش سریع اسنپ‌شات + بروزرسانی زنده از API)

const BASE_API = typeof API_BASE_URL !== "undefined" ? API_BASE_URL : "https://api.atlas-amlak.ir";

// --------------------------------------------------------------------- //
// توابع کمکی
// --------------------------------------------------------------------- //
function truncateAddress(address) {
  if (!address) return "";
  const text = address.trim();
  const match = text.match(/^(.*?لاله\s*[\u06F0-\u06F90-9]+\s*(اصلی|غربی|شرقی)?)/);
  if (match && match[1]) return match[1].trim();
  return text.length > 40 ? text.slice(0, 40).trim() + "…" : text;
}

function buildExtras(p) {
  const extras = [];
  if (p.parking) extras.push("🅿️ پارکینگ");
  if (p.elevator) extras.push("🛗 آسانسور");
  if (p.storage) extras.push("📦 انباری");
  return extras;
}

// --------------------------------------------------------------------- //
// فیلتر کشویی موبایل (Bottom Sheet)
// --------------------------------------------------------------------- //
const searchBar = document.getElementById("searchBar");
const filterFab = document.getElementById("filterFab");
const filterBackdrop = document.getElementById("filterBackdrop");
const sheetClose = document.getElementById("sheetClose");

function openSheet() {
  if (searchBar) searchBar.classList.add("open");
  if (filterBackdrop) filterBackdrop.classList.add("open");
}
function closeSheet() {
  if (searchBar) searchBar.classList.remove("open");
  if (filterBackdrop) filterBackdrop.classList.remove("open");
}
if (filterFab) filterFab.addEventListener("click", openSheet);
if (filterBackdrop) filterBackdrop.addEventListener("click", closeSheet);
if (sheetClose) sheetClose.addEventListener("click", closeSheet);

if (searchBar) {
  searchBar.addEventListener("click", (e) => e.stopPropagation());
  searchBar.addEventListener("touchstart", (e) => e.stopPropagation());
}

// --------------------------------------------------------------------- //
// مدیریت آگهی‌ها
// --------------------------------------------------------------------- //
const grid = document.getElementById("propertyGrid");
const resultCount = document.getElementById("resultCount");
const loadMoreBtn = document.getElementById("loadMoreBtn");
let allProperties = [];
let currentFiltered = [];

const PAGE_SIZE = 6;
let visibleCount = PAGE_SIZE;

function shareText(p) {
  const priceInfo =
    p.deal_type === "فروش"
      ? `💰 قیمت: ${p.price_total || "توافقی"}`
      : `💰 رهن: ${p.rahn || "-"} | اجاره: ${p.ejare || "-"}`;
  const url = `${location.origin}${location.pathname}?code=${encodeURIComponent(p.code || "")}`;
  const extras = buildExtras(p);
  const metaLine = [p.area_m2 ? `${p.area_m2} متر` : "", p.rooms ? `${p.rooms} خواب` : ""].filter(Boolean).join(" · ");

  const lines = [
    `${p.property_type || "ملک"} · کد ${p.code || "-"}`,
    `📍 ${truncateAddress(p.address)}`,
  ];
  if (metaLine) lines.push(`📐 ${metaLine}`);
  if (extras.length) lines.push(extras.join(" "));
  lines.push(priceInfo);
  if (p.agent_name && p.agent_phone) lines.push(`👤 ${p.agent_name} · 📞 ${p.agent_phone}`);
  else if (p.agent_name) lines.push(`👤 مشاور: ${p.agent_name}`);
  else if (p.agent_phone) lines.push(`📞 ${p.agent_phone}`);
  lines.push("🌐 atlas-amlak.ir");
  lines.push(url);

  return { url, text: lines.join("\n") };
}

async function copyToClipboard(text) {
  if (navigator.clipboard && navigator.clipboard.writeText) {
    try { await navigator.clipboard.writeText(text); return true; } catch (err) {}
  }
  try {
    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.style.position = "fixed";
    textarea.style.opacity = "0";
    document.body.appendChild(textarea);
    textarea.focus();
    textarea.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(textarea);
    return ok;
  } catch (err2) { return false; }
}

async function handleShareTextClick(code, btnEl) {
  const p = allProperties.find((item) => String(item.code) === String(code));
  if (!p) {
    const cardEl = document.getElementById(`card-${code}`) || document.querySelector(`[data-code="${code}"]`);
    if (cardEl) {
      const copied = await copyToClipboard(cardEl.innerText + `\n🌐 atlas-amlak.ir/?code=${code}`);
      if (btnEl) btnEl.textContent = copied ? "✅ کپی شد" : "⚠️ کپی نشد";
    }
    return;
  }
  const { url, text } = shareText(p);

  if (navigator.share) {
    try {
      await navigator.share({ title: `${p.property_type || "ملک"} · کد ${p.code || "-"}`, text, url });
      return;
    } catch (err) { if (err.name === "AbortError") return; }
  }

  const copied = await copyToClipboard(text);
  if (btnEl) {
    const original = btnEl.textContent;
    btnEl.textContent = copied ? "✅ کپی شد" : "⚠️ کپی نشد";
    btnEl.disabled = true;
    setTimeout(() => { btnEl.textContent = original; btnEl.disabled = false; }, 1800);
  }
}

function closeShareMenu() {
  document.querySelectorAll(".share-menu").forEach((m) => m.remove());
}

function openShareMenu(anchorBtn, code) {
  closeShareMenu();
  const menu = document.createElement("div");
  menu.className = "share-menu";
  menu.style.position = "absolute";
  menu.style.zIndex = "9999";
  menu.innerHTML = `<button type="button" data-action="text">📋 کپی متن آگهی</button>`;
  document.body.appendChild(menu);

  const rect = anchorBtn.getBoundingClientRect();
  menu.style.top = `${rect.bottom + window.scrollY + 6}px`;
  menu.style.left = `${Math.max(8, rect.right - 220)}px`;

  menu.addEventListener("click", (e) => {
    e.stopPropagation();
    closeShareMenu();
    handleShareTextClick(code, anchorBtn);
  });

  setTimeout(() => {
    window.addEventListener("click", function outsideCloser(e) {
      if (!menu.contains(e.target)) {
        closeShareMenu();
        window.removeEventListener("click", outsideCloser);
      }
    });
  }, 50);
}

function propertyCard(p) {
  const priceLine =
    p.deal_type === "فروش"
      ? `<p class="card-price">💰 ${p.price_total || "توافقی"}</p>`
      : `<p class="card-price">💰 رهن: ${p.rahn || "-"} | اجاره: ${p.ejare || "-"}</p>`;

  const extras = buildExtras(p);
  const shortAddress = truncateAddress(p.address);
  const cardId = `card-${p.code || Math.random().toString(36).slice(2)}`;

  const agentLine = p.agent_name ? `<p class="card-agent">👤 ثبت‌شده توسط: <strong>${p.agent_name}</strong></p>` : "";
  const agentCallBtn = p.agent_phone ? `<a class="agent-call-btn" href="tel:${p.agent_phone}">📞 تماس با ${p.agent_name || "مشاور"}</a>` : "";

  return `
    <article class="card" id="${cardId}" data-code="${p.code || ""}">
      <div class="card-body">
        <div class="card-top-row">
          <span class="deal-tag ${p.deal_type === "فروش" ? "sale" : "rent"}">${p.deal_type || "آگهی"}</span>
          <button class="share-btn" data-code="${p.code || ""}" type="button">🔗 اشتراک</button>
        </div>
        <h3>${p.property_type || "ملک"} · کد ${p.code || "-"}</h3>
        <p class="card-meta">📍 ${shortAddress || "-"}</p>
        <p class="card-meta">${p.area_m2 ? p.area_m2 + " متر" : ""} ${p.rooms ? "· " + p.rooms + " خواب" : ""}</p>
        ${extras.length ? `<p class="card-meta">${extras.join(" | ")}</p>` : ""}
        ${priceLine}
        ${agentLine}
        ${agentCallBtn}
      </div>
    </article>
  `;
}

function renderProperties() {
  if (!grid || !allProperties.length) return;
  if (!currentFiltered.length) {
    grid.innerHTML = `<p class="loading">فایلی با این مشخصات پیدا نشد.</p>`;
    if (resultCount) resultCount.textContent = "";
    if (loadMoreBtn) loadMoreBtn.hidden = true;
    return;
  }
  const shown = currentFiltered.slice(0, visibleCount);
  grid.innerHTML = shown.map(propertyCard).join("");
  if (resultCount) resultCount.textContent = `${shown.length} از ${currentFiltered.length} آگهی`;
  if (loadMoreBtn) loadMoreBtn.hidden = visibleCount >= currentFiltered.length;
}

if (grid) {
  grid.addEventListener("click", (e) => {
    const btn = e.target.closest(".share-btn");
    if (btn) {
      e.stopPropagation();
      openShareMenu(btn, btn.dataset.code);
    }
  });
}

// --------------------------------------------------------------------- //
// دریافت اطلاعات از API و جایگزینی بدون حالت Loading
// --------------------------------------------------------------------- //
async function loadProperties() {
  // اگر هیچ کارتی داخل HTML وجود نداشته باشد، لودینگ نمایش داده می‌شود
  const hasHTMLCards = grid && grid.querySelectorAll(".card").length > 0;
  if (!hasHTMLCards && grid) {
    grid.innerHTML = `<p class="loading">در حال بارگذاری آگهی‌ها...</p>`;
  }

  try {
    const res = await fetch(`${BASE_API}/api/properties`);
    if (!res.ok) throw new Error("API failed");
    const data = await res.json();
    if (Array.isArray(data) && data.length > 0) {
      allProperties = data.reverse();
      currentFiltered = allProperties;
      renderProperties();
      updateStatsRibbon();
    }
  } catch (err) {
    console.warn("API Error, using fallback HTML cards if available.", err);
    if (!hasHTMLCards && grid) {
      grid.innerHTML = `<p class="loading">خطا در دریافت اطلاعات. لطفاً دوباره رفرش کنید.</p>`;
    }
  }
}

function updateStatsRibbon() {
  if (!allProperties.length) return;
  const saleCount = allProperties.filter((p) => p.deal_type === "فروش").length;
  const rentCount = allProperties.filter((p) => p.deal_type === "رهن و اجاره").length;
  const el = document.getElementById("statsText");
  if (el) el.textContent = `🏠 ${allProperties.length} فایل فعال — ${saleCount} فروشی، ${rentCount} رهن و اجاره`;
}

function applyFilters() {
  if (!allProperties.length) return;
  const citySearchEl = document.getElementById("citySearch");
  const dealTypeEl = document.getElementById("dealType");
  const keyword = citySearchEl ? citySearchEl.value.trim() : "";
  const dealType = dealTypeEl ? dealTypeEl.value : "";

  let filtered = allProperties;
  if (dealType) filtered = filtered.filter((p) => p.deal_type === dealType);
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

const searchBtn = document.getElementById("searchBtn");
if (searchBtn) {
  searchBtn.addEventListener("click", () => {
    applyFilters();
    closeSheet();
  });
}

// اجرا کردن بارگذاری زنده
loadProperties();
