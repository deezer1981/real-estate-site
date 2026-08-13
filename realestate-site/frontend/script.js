// script.js — مدیریت کارت‌ها، API زنده، فیلترها، اشتراک‌گذاری تعاملی و تولید تصویر استوری

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
// ۱. توابع کمکی ساخت کارت و لاین بازگشت
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
  
  const backBanner = isSingleMode ? `
    <div style="background: var(--ink); color: var(--paper); border-radius: 12px; padding: 12px 18px; margin-bottom: 16px; display: flex; align-items: center; justify-content: space-between; gap: 12px; border: 1px solid var(--brass);">
      <span style="font-weight: 700; font-size: 0.9rem;">📍 آگهی انتخاب‌شده (کد ${p.code})</span>
      <a href="${window.location.pathname}" style="color: var(--ink); text-decoration: none; display: inline-flex; align-items: center; gap: 6px; background: var(--brass); font-weight: 700; font-size: 0.85rem; padding: 6px 14px; border-radius: 6px;">
        <span>همه آگهی‌ها</span>
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

  const wrapperStyle = isSingleMode 
    ? 'grid-column: 1 / -1; max-width: 540px; margin: 0 auto; width: 100%;' 
    : 'width: 100%;';

  return `
    <div style="${wrapperStyle}">
      ${backBanner}
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
// ۶. ساخت تصویر استوری
// --------------------------------------------------------------------- //
function generateStoryImage(p) {
  try {
    const canvas = document.createElement("canvas");
    canvas.width = 1080;
    canvas.height = 1920;
    const ctx = canvas.getContext("2d");

    // پس‌زمینه سرمه‌ای
    ctx.fillStyle = "#14213D";
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // حاشیه طلایی
    ctx.strokeStyle = "#B8894F";
    ctx.lineWidth = 12;
    ctx.strokeRect(40, 40, canvas.width - 80, canvas.height - 80);

    // سربرگ بالای استوری
    ctx.fillStyle = "#B8894F";
    ctx.font = "bold 56px sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("گروه مشاورین املاک اطلس", 540, 180);

    // کارت اصلی سفید
    ctx.fillStyle = "#FFFFFF";
    if (ctx.roundRect) {
      ctx.beginPath();
      ctx.roundRect(90, 250, 900, 1350, 32);
      ctx.fill();
    } else {
      ctx.fillRect(90, 250, 900, 1350);
    }

    // تگ معامله
    const isSale = p.deal_type === "فروش";
    ctx.fillStyle = isSale ? "#4A6B5F" : "#B8894F";
    if (ctx.roundRect) {
      ctx.beginPath();
      ctx.roundRect(140, 310, 220, 64, 32);
      ctx.fill();
    } else {
      ctx.fillRect(140, 310, 220, 64);
    }

    ctx.fillStyle = "#FFFFFF";
    ctx.font = "bold 32px sans-serif";
    ctx.textAlign = "center";
    ctx.fillText(p.deal_type || "آگهی", 250, 354);

    // عنوان و کد ملک
    ctx.fillStyle = "#14213D";
    ctx.font = "bold 52px sans-serif";
    ctx.textAlign = "right";
    ctx.fillText(`${p.property_type || "ملک"} · کد ${p.code || "-"}`, 930, 460);

    // آدرس
    ctx.fillStyle = "#555555";
    ctx.font = "36px sans-serif";
    ctx.fillText(`📍 ${truncateAddress(p.address) || "-"}`, 930, 550);

    // متراژ
    ctx.fillStyle = "#2B2B2B";
    ctx.font = "bold 40px sans-serif";
    const areaText = `${p.area_m2 ? p.area_m2 + " متر" : ""} ${p.rooms ? "· " + p.rooms + " خواب" : ""}`;
    ctx.fillText(`📐 ${areaText}`, 930, 640);

    // امکانات
    const extras = buildExtras(p);
    if (extras.length > 0) {
      ctx.font = "34px sans-serif";
      ctx.fillStyle = "#4A6B5F";
      ctx.fillText(extras.join("  |  "), 930, 720);
    }

    // خط جداکننده
    ctx.strokeStyle = "#E4DFD3";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(140, 800);
    ctx.lineTo(940, 800);
    ctx.stroke();

    // قیمت
    ctx.fillStyle = "#14213D";
    ctx.font = "bold 46px sans-serif";
    const priceText = isSale
      ? `💰 قیمت: ${p.price_total || "توافقی"}`
      : `💰 رهن: ${p.rahn || "-"} | اجاره: ${p.ejare || "-"}`;
    ctx.fillText(priceText, 930, 900);

    // اطلاعات مشاور
    if (p.agent_name) {
      ctx.fillStyle = "#4A6B5F";
      ctx.font = "bold 36px sans-serif";
      ctx.fillText(`👤 مشاور: ${p.agent_name}`, 930, 1010);
    }
    if (p.agent_phone) {
      ctx.fillStyle = "#14213D";
      ctx.font = "bold 40px sans-serif";
      ctx.fillText(`📞 ${p.agent_phone}`, 930, 1090);
    }

    // باکس سرمه‌ای پایین
    ctx.fillStyle = "#14213D";
    if (ctx.roundRect) {
      ctx.beginPath();
      ctx.roundRect(140, 1200, 800, 320, 24);
      ctx.fill();
    } else {
      ctx.fillRect(140, 1200, 800, 320);
    }

    ctx.fillStyle = "#B8894F";
    ctx.font = "bold 32px sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("مشاهده جزئیات کامل آگهی در سایت:", 540, 1270);

    ctx.fillStyle = "#FFFFFF";
    ctx.font = "bold 38px sans-serif";
    ctx.fillText(`atlas-amlak.ir/?code=${p.code}`, 540, 1340);

    // آدرس دامنه و لوگو در انتهای کارت
    const logoUrl = ""; // آدرس لوگو بعداً اینجا قرار گیرد

    const downloadCanvas = () => {
      const dataUrl = canvas.toDataURL("image/png");
      const a = document.createElement("a");
      a.href = dataUrl;
      a.download = `story-${p.code || 'property'}.png`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    };

    if (logoUrl) {
      const img = new Image();
      img.onload = () => {
        ctx.drawImage(img, 540 - 30, 1390, 60, 60);
        ctx.fillStyle = "#B8894F";
        ctx.font = "bold 28px sans-serif";
        ctx.fillText("atlas-amlak.ir", 540, 1480);
        downloadCanvas();
      };
      img.onerror = () => {
        ctx.fillStyle = "#B8894F";
        ctx.font = "bold 28px sans-serif";
        ctx.fillText("🌐 atlas-amlak.ir", 540, 1440);
        downloadCanvas();
      };
      img.src = logoUrl;
    } else {
      ctx.fillStyle = "#B8894F";
      ctx.font = "bold 30px sans-serif";
      ctx.fillText("🌐 atlas-amlak.ir", 540, 1440);
      downloadCanvas();
    }

  } catch (err) {
    console.error("خطا در ساخت تصویر استوری:", err);
  }
}

// --------------------------------------------------------------------- //
// ۷. سیستم پاپ‌آپ تعاملی اشتراک‌گذاری
// --------------------------------------------------------------------- //
function showShareModal(p, shareBtn) {
  const oldModal = document.getElementById("shareModal");
  if (oldModal) oldModal.remove();

  const shareUrl = `${window.location.origin}${window.location.pathname}?code=${p.code}`;
  const extras = buildExtras(p);
  const priceText = p.deal_type === "فروش" 
    ? `💰 قیمت: ${p.price_total || "توافقی"}`
    : `💰 رهن: ${p.rahn || "-"} | اجاره: ${p.ejare || "-"}`;

  const shareText = `${p.property_type || "ملک"} · کد ${p.code}
📍 ${p.address || "خادم‌آباد"}
📐 ${p.area_m2 ? p.area_m2 + " متر" : ""} ${p.rooms ? "- " + p.rooms + " خواب" : ""}
${extras.length ? extras.join(" ") + "\n" : ""}${priceText}
👤 ${p.agent_name || "مشاور املاک اطلس"} ${p.agent_phone ? "· 📞 " + p.agent_phone : ""}

🌐 atlas-amlak.ir
${shareUrl}`;

  const modalHtml = `
    <div id="shareModal" style="position: fixed; inset: 0; z-index: 9999; background: rgba(20, 33, 61, 0.6); backdrop-filter: blur(4px); display: flex; align-items: center; justify-content: center; padding: 16px;">
      <div style="background: #FFFFFF; border: 1px solid var(--brass); border-radius: 20px; width: 100%; max-width: 380px; padding: 24px; text-align: center; box-shadow: 0 10px 30px rgba(0,0,0,0.25); animation: popIn 0.2s ease-out;">
        <h3 style="margin: 0 0 8px; color: var(--ink); font-size: 1.15rem; font-weight: 800;">نحوه اشتراک‌گذاری آگهی</h3>
        <p style="margin: 0 0 20px; color: #666; font-size: 0.85rem;">کدام قالب را برای ارسال تمایل دارید؟</p>
        
        <div style="display: flex; flex-direction: column; gap: 12px;">
          <button id="modalStoryBtn" type="button" style="background: var(--ink); color: var(--paper); border: none; padding: 12px; border-radius: 12px; font-weight: 700; font-size: 0.9rem; cursor: pointer; display: flex; align-items: center; justify-content: center; gap: 8px;">
            📸 دانلود عکس استوری
          </button>
          <button id="modalTextBtn" type="button" style="background: #F5F1EA; color: var(--ink); border: 1px solid var(--brass); padding: 12px; border-radius: 12px; font-weight: 700; font-size: 0.9rem; cursor: pointer; display: flex; align-items: center; justify-content: center; gap: 8px;">
            📋 کپی متن آگهی و لینک
          </button>
        </div>

        <button id="modalCloseBtn" type="button" style="background: transparent; border: none; color: #888; font-size: 0.85rem; margin-top: 16px; cursor: pointer;">
          انصراف
        </button>
      </div>
    </div>
  `;

  document.body.insertAdjacentHTML("beforeend", modalHtml);

  const modal = document.getElementById("shareModal");
  const modalStoryBtn = document.getElementById("modalStoryBtn");
  const modalTextBtn = document.getElementById("modalTextBtn");
  const modalCloseBtn = document.getElementById("modalCloseBtn");

  const closeModal = () => modal.remove();

  modalCloseBtn.addEventListener("click", closeModal);
  modal.addEventListener("click", (e) => {
    if (e.target === modal) closeModal();
  });

  modalStoryBtn.addEventListener("click", () => {
    generateStoryImage(p);
    showCopySuccess(shareBtn, "📸 عکس دانلود شد");
    closeModal();
  });

  modalTextBtn.addEventListener("click", () => {
    forceCopyText(shareText);
    showCopySuccess(shareBtn, "📋 متن کپی شد");
    closeModal();
  });
}

document.addEventListener("click", (e) => {
  const shareBtn = e.target.closest(".share-btn");
  if (!shareBtn) return;

  const code = shareBtn.getAttribute("data-code");
  if (!code) return;

  const p = allProperties.find((item) => String(item.code) === String(code));
  if (p) {
    showShareModal(p, shareBtn);
  }
});

function forceCopyText(text) {
  const textArea = document.createElement("textarea");
  textArea.value = text;
  textArea.style.position = "fixed";
  textArea.style.top = "0";
  textArea.style.left = "-9999px";
  document.body.appendChild(textArea);
  textArea.focus();
  textArea.select();

  try {
    document.execCommand('copy');
  } catch (err) {}
  document.body.removeChild(textArea);
}

function showCopySuccess(btnElement, text) {
  const originalText = btnElement.innerHTML;
  btnElement.innerHTML = text;
  setTimeout(() => {
    btnElement.innerHTML = originalText;
  }, 2500);
}

// --------------------------------------------------------------------- //
// ۸. اجرای فوری پس از لود شدن اسکریپت
// --------------------------------------------------------------------- //
if (allProperties.length > 0) {
  if (!checkSinglePropertyMode()) {
    currentFiltered = allProperties;
    updateStatsRibbon();
  }
}
loadProperties();
