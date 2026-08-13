// script.js — مدیریت کامل کارت‌ها، API زنده، فیلترها و اشتراک‌گذاری هوشمند املاک

const BASE_API = typeof API_BASE_URL !== "undefined" ? API_BASE_URL : "https://api.atlas-amlak.ir";

const grid = document.getElementById("propertyGrid");
const resultCount = document.getElementById("resultCount");
const loadMoreBtn = document.getElementById("loadMoreBtn");
const statsText = document.getElementById("statsText");

let allProperties = window.__PRELOADED_PROPERTIES__ || [];
let currentFiltered = [];
const PAGE_SIZE = 6;
let visibleCount = PAGE_SIZE;

// --------------------------------------------------------------------- //
// ۱. توابع کمکی ساخت کارت و خلاصه سازی
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

function propertyCard(p) {
  const priceLine = p.deal_type === "فروش"
    ? `<p class="card-price">💰 ${p.price_total || "توافقی"}</p>`
    : `<p class="card-price">💰 رهن: ${p.rahn || "-"} | اجاره: ${p.ejare || "-"}</p>`;

  const extras = buildExtras(p);
  const shortAddress = truncateAddress(p.address);
  const agentLine = p.agent_name ? `<p class="card-agent">👤 ثبت‌شده توسط: <strong>${p.agent_name}</strong></p>` : "";
  const agentCallBtn = p.agent_phone ? `<a class="agent-call-btn" href="tel:${p.agent_phone}">📞 تماس با ${p.agent_name || "مشاور"}</a>` : "";

  return `
    <article class="card" id="card-${p.code || ''}" data-code="${p.code || ''}">
      <div class="card-body">
        <div class="card-top-row">
          <span class="deal-tag ${p.deal_type === "فروش" ? "sale" : "rent"}">${p.deal_type || "آگهی"}</span>
          <button class="share-btn" data-code="${p.code || ''}" type="button" aria-label="اشتراک‌گذاری آگهی">🔗 اشتراک</button>
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

// --------------------------------------------------------------------- //
// ۲. بروزرسانی بنر آمار و لیست آگهی‌ها
// --------------------------------------------------------------------- //
function updateStatsRibbon() {
  if (!statsText || !allProperties.length) return;
  const saleCount = allProperties.filter((p) => p.deal_type === "فروش").length;
  const rentCount = allProperties.filter((p) => p.deal_type === "رهن و اجاره").length;
  statsText.textContent = `🏠 ${allProperties.length} فایل فعال — ${saleCount} فروشی، ${rentCount} رهن و اجاره`;
}

function renderProperties() {
  if (!grid || !currentFiltered.length) return;
  const shown = currentFiltered.slice(0, visibleCount);
  grid.innerHTML = shown.map(propertyCard).join("");
  if (resultCount) resultCount.textContent = `${shown.length} از ${currentFiltered.length} آگهی`;
  if (loadMoreBtn) loadMoreBtn.hidden = visibleCount >= currentFiltered.length;
}

// --------------------------------------------------------------------- //
// ۳. دریافت اطلاعات زنده از API
// --------------------------------------------------------------------- //
async function loadProperties() {
  try {
    const res = await fetch(`${BASE_API}/api/properties`);
    if (!res.ok) throw new Error("API Network Error");
    const data = await res.json();
    if (Array.isArray(data) && data.length > 0) {
      allProperties = data.reverse();
      currentFiltered = allProperties;
      renderProperties();
      updateStatsRibbon();
    }
  } catch (err) {
    console.log("استفاده از آرایه Preloaded پیش‌فرض");
  }
}

// --------------------------------------------------------------------- //
// ۴. فیلترها و شیت موبایل
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

if (loadMoreBtn) {
  loadMoreBtn.addEventListener("click", () => {
    visibleCount += PAGE_SIZE;
    renderProperties();
  });
}

// --------------------------------------------------------------------- //
// ۵. سیستم اشتراک‌گذاری دسکتاپ و موبایل
// --------------------------------------------------------------------- //
document.addEventListener("click", async (e) => {
  const shareBtn = e.target.closest(".share-btn");
  if (!shareBtn) return;

  const code = shareBtn.getAttribute("data-code");
  if (!code) return;

  const p = allProperties.find((item) => String(item.code) === String(code));
  const shareUrl = `${window.location.origin}${window.location.pathname}?code=${code}`;

  let shareText = "";
  if (p) {
    const extras = buildExtras(p);
    const priceText = p.deal_type === "فروش" 
      ? `💰 قیمت: ${p.price_total || "توافقی"}`
      : `💰 رهن: ${p.rahn || "-"} | اجاره: ${p.ejare || "-"}`;

    shareText = `${p.property_type || "ملک"} · کد ${p.code}
📍 ${p.address || "خادم‌آباد"}
📐 ${p.area_m2 ? p.area_m2 + " متر" : ""} ${p.rooms ? "- " + p.rooms + " خواب" : ""}
${extras.length ? extras.join(" ") + "\n" : ""}${priceText}
👤 ${p.agent_name || "مشاور املاک اطلس"} ${p.agent_phone ? "· 📞 " + p.agent_phone : ""}

🌐 atlas-amlak.ir
${shareUrl}`;
  } else {
    shareText = `مشاهده مشخصات کامل آگهی کد ${code} در املاک اطلس:\n${shareUrl}`;
  }

  // ۱. اگر مرورگر از Web Share API پشتیبانی کند (موبایل‌ها)
  if (navigator.share) {
    try {
      await navigator.share({
        title: `آگهی ملک کد ${code}`,
        text: shareText
      });
      return;
    } catch (err) {
      if (err.name === "AbortError") return; // انصراف کاربر
    }
  }

  // ۲. کپی در حافظه با متد قدرتمند برای لپ‌تاپ/دسکتاپ
  copyTextToClipboard(shareText, shareBtn);
});

function copyTextToClipboard(text, btnElement) {
  if (navigator.clipboard && window.isSecureContext) {
    navigator.clipboard.writeText(text).then(() => {
      showCopySuccess(btnElement);
    }).catch(() => {
      fallbackCopyText(text, btnElement);
    });
  } else {
    fallbackCopyText(text, btnElement);
  }
}

function fallbackCopyText(text, btnElement) {
  const textArea = document.createElement("textarea");
  textArea.value = text;
  textArea.style.position = "fixed";
  textArea.style.left = "-999999px";
  textArea.style.top = "-999999px";
  document.body.appendChild(textArea);
  textArea.focus();
  textArea.select();

  try {
    document.execCommand('copy');
    showCopySuccess(btnElement);
  } catch (err) {
    alert("امکان کپی خودکار وجود ندارد. لینک آگهی:\n" + text);
  }
  document.body.removeChild(textArea);
}

function showCopySuccess(btnElement) {
  const originalText = btnElement.innerHTML;
  btnElement.innerHTML = "✅ کپی شد";
  btnElement.style.color = "#10b981";
  setTimeout(() => {
    btnElement.innerHTML = originalText;
    btnElement.style.color = "";
  }, 2000);
}

// --------------------------------------------------------------------- //
// ۶. اجرای اولیه
// --------------------------------------------------------------------- //
if (allProperties.length > 0) {
  currentFiltered = allProperties;
  updateStatsRibbon();
}
loadProperties();
