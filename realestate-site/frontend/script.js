// script.js — مدیریت کارت‌ها، API زنده، فیلترها، اشتراک‌گذاری متنی و تولید تصویر استوری

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
// ۱. توابع کمکی ساخت کارت و لاین بازگشت شکیل
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
  const urlParams = new URLSearchParams(window.location.search);
  const isSingleMode = Boolean(urlParams.get("code"));
  
  // لاین بازگشت شکیل و هماهنگ با تم طلایی/سرمه‌ای
  const backBanner = isSingleMode ? `
    <div style="background: var(--ink); color: var(--paper); border-radius: 12px; padding: 12px 18px; margin-bottom: 16px; display: flex; align-items: center; justify-content: space-between; gap: 12px; box-shadow: 0 4px 14px rgba(20,33,61,0.18); border: 1px solid var(--brass);">
      <span style="font-weight: 700; font-size: 0.9rem;">📍 نمایش آگهی کد ${p.code}</span>
      <a href="${window.location.pathname}" style="color: var(--ink); text-decoration: none; display: inline-flex; align-items: center; gap: 6px; background: var(--brass); font-weight: 700; font-size: 0.85rem; padding: 6px 14px; border-radius: 6px; transition: opacity 0.2s;">
        <span>مشاهده همه آگهی‌ها</span>
        <span style="font-size: 1rem; line-height: 1;">←</span>
      </a>
    </div>
  ` : "";

  const priceLine = p.deal_type === "فروش"
    ? `<p class="card-price">💰 ${p.price_total || "توافقی"}</p>`
    : `<p class="card-price">💰 رهن: ${p.rahn || "-"} | اجاره: ${p.ejare || "-"}</p>`;

  const extras = buildExtras(p);
  const shortAddress = truncateAddress(p.address);
  const agentLine = p.agent_name ? `<p class="card-agent">👤 ثبت‌شده توسط: <strong>${p.agent_name}</strong></p>` : "";
  const agentCallBtn = p.agent_phone ? `<a class="agent-call-btn" href="tel:${p.agent_phone}">📞 تماس با ${p.agent_name || "مشاور"}</a>` : "";

  return `
    <div style="grid-column: 1 / -1; max-width: ${isSingleMode ? '540px' : '100%'}; margin: 0 auto; width: 100%;">
      ${backBanner}
      <article class="card" id="card-${p.code || ''}" data-code="${p.code || ''}">
        <div class="card-body">
          <div class="card-top-row">
            <span class="deal-tag ${p.deal_type === "فروش" ? "sale" : "rent"}">${p.deal_type || "آگهی"}</span>
            <button class="share-btn" data-code="${p.code || ''}" type="button" aria-label="اشتراک‌گذاری آگهی">📸 دانلود استوری / 🔗 کپی</button>
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
    </div>
  `;
}

// --------------------------------------------------------------------- //
// ۲. بررسی حالت تک‌آگهی (?code=1013)
// --------------------------------------------------------------------- //
function checkSinglePropertyMode() {
  const urlParams = new URLSearchParams(window.location.search);
  const targetCode = urlParams.get("code");
  if (!targetCode) return false;

  const found = allProperties.find((p) => String(p.code) === String(targetCode));
  if (found) {
    currentFiltered = [found];
    visibleCount = 1;
    if (resultCount) resultCount.textContent = `نمایش آگهی کد ${targetCode}`;
    renderProperties();
    if (loadMoreBtn) loadMoreBtn.hidden = true;
    return true;
  }
  return false;
}

// --------------------------------------------------------------------- //
// ۳. رندر کارت‌ها و بروزرسانی آمار
// --------------------------------------------------------------------- //
function updateStatsRibbon() {
  const urlParams = new URLSearchParams(window.location.search);
  if (!statsText || !allProperties.length || urlParams.get("code")) return;
  const saleCount = allProperties.filter((p) => p.deal_type === "فروش").length;
  const rentCount = allProperties.filter((p) => p.deal_type === "رهن و اجاره").length;
  statsText.textContent = `🏠 ${allProperties.length} فایل فعال — ${saleCount} فروشی، ${rentCount} رهن و اجاره`;
}

function renderProperties() {
  if (!grid || !currentFiltered.length) return;
  const urlParams = new URLSearchParams(window.location.search);
  const shown = currentFiltered.slice(0, visibleCount);
  grid.innerHTML = shown.map(propertyCard).join("");
  
  if (!urlParams.get("code")) {
    if (resultCount) resultCount.textContent = `${shown.length} از ${currentFiltered.length} آگهی`;
    if (loadMoreBtn) loadMoreBtn.hidden = visibleCount >= currentFiltered.length;
  }
}

// --------------------------------------------------------------------- //
// ۴. دریافت اطلاعات از API
// --------------------------------------------------------------------- //
async function loadProperties() {
  try {
    const res = await fetch(`${BASE_API}/api/properties`);
    if (!res.ok) throw new Error("API Network Error");
    const data = await res.json();
    if (Array.isArray(data) && data.length > 0) {
      allProperties = data.reverse();
      if (!checkSinglePropertyMode()) {
        currentFiltered = allProperties;
        renderProperties();
        updateStatsRibbon();
      }
    }
  } catch (err) {
    console.log("استفاده از داده‌های preloaded");
  }
}

// --------------------------------------------------------------------- //
// ۵. فیلترها و شیت موبایل
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
// ۶. تولید تصویر استوری (Canvas) و سیستم کپی/اشتراک
// --------------------------------------------------------------------- //
function generateStoryImage(p) {
  const canvas = document.createElement("canvas");
  canvas.width = 1080;
  canvas.height = 1920;
  const ctx = canvas.getContext("2d");

  // پس‌زمینه اصلی (رنگ سرمه‌ای برند --ink)
  ctx.fillStyle = "#14213D";
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  // حاشیه طلایی تزیینی دور کارت استوری (--brass)
  ctx.strokeStyle = "#B8894F";
  ctx.lineWidth = 12;
  ctx.strokeRect(40, 40, canvas.width - 80, canvas.height - 80);

  // سربرگ استوری (عنوان برند)
  ctx.fillStyle = "#B8894F";
  ctx.font = "bold 52px Vazirmatn, Tahoma, sans-serif";
  ctx.textAlign = "center";
  ctx.fillText("گروه مشاورین املاک اطلس", 540, 160);

  ctx.fillStyle = "#F5F1EA";
  ctx.font = "32px Vazirmatn, Tahoma, sans-serif";
  ctx.fillText("atlas-amlak.ir", 540, 220);

  // کادر سفید کارت اصلی
  const cardX = 90;
  const cardY = 280;
  const cardWidth = 900;
  const cardHeight = 1320;
  const cornerRadius = 32;

  ctx.fillStyle = "#FFFFFF";
  ctx.beginPath();
  ctx.roundRect(cardX, cardY, cardWidth, cardHeight, cornerRadius);
  ctx.fill();

  // تگ نوع معامله (فروش / اجاره)
  const isSale = p.deal_type === "فروش";
  ctx.fillStyle = isSale ? "#4A6B5F" : "#B8894F";
  ctx.beginPath();
  ctx.roundRect(140, 340, 220, 64, 32);
  ctx.fill();

  ctx.fillStyle = "#FFFFFF";
  ctx.font = "bold 32px Vazirmatn, Tahoma, sans-serif";
  ctx.textAlign = "center";
  ctx.fillText(p.deal_type || "آگهی", 250, 384);

  // عنوان و کد ملک
  ctx.fillStyle = "#14213D";
  ctx.font = "bold 56px Vazirmatn, Tahoma, sans-serif";
  ctx.textAlign = "right";
  ctx.fillText(`${p.property_type || "ملک"} · کد ${p.code || "-"}`, 930, 490);

  // آدرس
  ctx.fillStyle = "#555555";
  ctx.font = "38px Vazirmatn, Tahoma, sans-serif";
  ctx.fillText(`📍 ${truncateAddress(p.address) || "-"}`, 930, 580);

  // متراژ و تعداد خواب
  ctx.fillStyle = "#2B2B2B";
  ctx.font = "bold 42px Vazirmatn, Tahoma, sans-serif";
  const areaText = `${p.area_m2 ? p.area_m2 + " متر" : ""} ${p.rooms ? "· " + p.rooms + " خواب" : ""}`;
  ctx.fillText(`📐 ${areaText}`, 930, 670);

  // امکانات (آسانسور، پارکینگ، انباری)
  const extras = buildExtras(p);
  if (extras.length > 0) {
    ctx.font = "36px Vazirmatn, Tahoma, sans-serif";
    ctx.fillStyle = "#4A6B5F";
    ctx.fillText(extras.join("  |  "), 930, 750);
  }

  // خط جداکننده
  ctx.strokeStyle = "#E4DFD3";
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(140, 830);
  ctx.lineTo(940, 830);
  ctx.stroke();

  // قیمت
  ctx.fillStyle = "#14213D";
  ctx.font = "bold 50px Vazirmatn, Tahoma, sans-serif";
  const priceText = isSale
    ? `💰 قیمت: ${p.price_total || "توافقی"}`
    : `💰 رهن: ${p.rahn || "-"} | اجاره: ${p.ejare || "-"}`;
  ctx.fillText(priceText, 930, 930);

  // اطلاعات مشاور
  if (p.agent_name) {
    ctx.fillStyle = "#4A6B5F";
    ctx.font = "bold 38px Vazirmatn, Tahoma, sans-serif";
    ctx.fillText(`👤 مشاور: ${p.agent_name}`, 930, 1040);
  }
  if (p.agent_phone) {
    ctx.fillStyle = "#14213D";
    ctx.font = "bold 42px Vazirmatn, Tahoma, sans-serif";
    ctx.fillText(`📞 ${p.agent_phone}`, 930, 1120);
  }

  // کادر دعوت به اقدام پایین کارت (QR یا لینک)
  ctx.fillStyle = "#14213D";
  ctx.beginPath();
  ctx.roundRect(140, 1240, 800, 260, 24);
  ctx.fill();

  ctx.fillStyle = "#B8894F";
  ctx.font = "bold 36px Vazirmatn, Tahoma, sans-serif";
  ctx.textAlign = "center";
  ctx.fillText("برای مشاهده جزئیات بیشتر آگهی در سایت:", 540, 1330);

  ctx.fillStyle = "#FFFFFF";
  ctx.font = "bold 40px Vazirmatn, Tahoma, sans-serif";
  ctx.fillText(`atlas-amlak.ir/?code=${p.code}`, 540, 1410);

  // دانلود خودکار عکس استوری
  const link = document.createElement("a");
  link.download = `Story-Property-${p.code}.png`;
  link.href = canvas.toDataURL("image/png");
  link.click();
}

document.addEventListener("click", async (e) => {
  const shareBtn = e.target.closest(".share-btn");
  if (!shareBtn) return;

  const code = shareBtn.getAttribute("data-code");
  if (!code) return;

  const p = allProperties.find((item) => String(item.code) === String(code));
  const shareUrl = `${window.location.origin}${window.location.pathname}?code=${code}`;

  // ۱. ساخت و دانلود خودکار عکس استوری
  if (p) {
    generateStoryImage(p);
  }

  // ۲. آماده‌سازی متن اشتراک‌گذاری
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

  const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);

  if (isMobile && navigator.share) {
    try {
      await navigator.share({
        title: `آگهی ملک کد ${code}`,
        text: shareText
      });
      return;
    } catch (err) {
      if (err.name === "AbortError") return;
    }
  }

  forceCopyText(shareText, shareBtn);
});

function forceCopyText(text, btnElement) {
  const textArea = document.createElement("textarea");
  textArea.value = text;
  textArea.style.position = "fixed";
  textArea.style.top = "0";
  textArea.style.left = "-9999px";
  document.body.appendChild(textArea);
  textArea.focus();
  textArea.select();

  let successful = false;
  try {
    successful = document.execCommand('copy');
  } catch (err) {
    successful = false;
  }
  document.body.removeChild(textArea);

  if (successful) {
    showCopySuccess(btnElement);
  } else if (navigator.clipboard) {
    navigator.clipboard.writeText(text).then(() => {
      showCopySuccess(btnElement);
    });
  }
}

function showCopySuccess(btnElement) {
  const originalText = btnElement.innerHTML;
  btnElement.innerHTML = "📸 استوری دانلود شد / ✅ لینک کپی شد";
  btnElement.style.color = "#10b981";
  setTimeout(() => {
    btnElement.innerHTML = originalText;
    btnElement.style.color = "";
  }, 2500);
}

// --------------------------------------------------------------------- //
// ۷. اجرای فوری پس از لود شدن اسکریپت
// --------------------------------------------------------------------- //
if (allProperties.length > 0) {
  if (!checkSinglePropertyMode()) {
    currentFiltered = allProperties;
    updateStatsRibbon();
  }
}
loadProperties();
