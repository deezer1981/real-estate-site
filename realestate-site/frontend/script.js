// script.js — مدیریت کارت‌ها، API زنده، فیلترها، اشتراک‌گذاری تعاملی و تولید تصویر کارت آگهی

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
// ۶. ساخت تصویر کارت آگهی (طراحی فوق‌العاده مدرن، شیک و منظم)
// --------------------------------------------------------------------- //
function generateStoryImage(p) {
  try {
    const canvas = document.createElement("canvas");
    canvas.width = 1080;
    canvas.height = 1920;
    const ctx = canvas.getContext("2d");

    if ('direction' in ctx) {
      ctx.direction = 'rtl';
    }

    const rtl = "\u202B";

    // ۱. پس‌زمینه اصلی (گرادیان مدرن)
    const bgGradient = ctx.createLinearGradient(0, 0, 0, 1920);
    bgGradient.addColorStop(0, "#0F172A");
    bgGradient.addColorStop(1, "#1E293B");
    ctx.fillStyle = bgGradient;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // ۲. هدر بالای کارت
    ctx.fillStyle = "#94A3B8";
    ctx.font = "500 32px Vazirmatn, Tahoma, sans-serif";
    ctx.textAlign = "center";
    ctx.fillText(`${rtl}سامانه تخصصی املاک`, 540, 130);

    ctx.fillStyle = "#FFFFFF";
    ctx.font = "bold 52px Vazirmatn, Tahoma, sans-serif";
    ctx.fillText(`${rtl}اطلس املاک خادم آباد`, 540, 200);

    // ۳. بدنه اصلی کارت سفید
    const cardX = 70;
    const cardY = 260;
    const cardW = 940;
    const cardH = 1560;

    ctx.fillStyle = "#FFFFFF";
    if (ctx.roundRect) {
      ctx.beginPath();
      ctx.roundRect(cardX, cardY, cardW, cardH, 40);
      ctx.fill();
    } else {
      ctx.fillRect(cardX, cardY, cardW, cardH);
    }

    // ۴. نشانگر معامله (فروش/اجاره)
    const dealColor = p.deal_type === "فروش" ? "#059669" : "#D97706";
    ctx.fillStyle = dealColor;
    if (ctx.roundRect) {
      ctx.beginPath();
      ctx.roundRect(120, 310, 160, 60, 30);
      ctx.fill();
    } else {
      ctx.fillRect(120, 310, 160, 60);
    }
    ctx.fillStyle = "#FFFFFF";
    ctx.font = "bold 28px Vazirmatn, Tahoma, sans-serif";
    ctx.fillText(p.deal_type || "آگهی", 200, 352);

    // ۵. عنوان ملک و کد
    ctx.fillStyle = "#0F172A";
    ctx.font = "bold 58px Vazirmatn, Tahoma, sans-serif";
    ctx.textAlign = "center";
    ctx.fillText(`${rtl}${p.property_type || "آپارتمان"}`, 540, 420);

    ctx.fillStyle = "#64748B";
    ctx.font = "500 34px Vazirmatn, Tahoma, sans-serif";
    ctx.fillText(`${rtl}کد آگهی: ${p.code || "-"}`, 540, 480);

    // ۶. باکس مشخصات اصلی (متراژ و تعداد خواب)
    ctx.fillStyle = "#F8FAFC";
    ctx.strokeStyle = "#E2E8F0";
    ctx.lineWidth = 2;
    if (ctx.roundRect) {
      ctx.beginPath();
      ctx.roundRect(120, 520, 840, 120, 20);
      ctx.fill();
      ctx.stroke();
    }

    ctx.fillStyle = "#1E293B";
    ctx.font = "bold 38px Vazirmatn, Tahoma, sans-serif";
    const specsText = `${p.area_m2 ? p.area_m2 + " متر مربع" : ""}   ${p.rooms ? "•   " + p.rooms + " خواب" : ""}`;
    ctx.fillText(`${rtl}${specsText}`, 540, 595);

    // ۷. آدرس ملک
    ctx.fillStyle = "#475569";
    ctx.font = "500 34px Vazirmatn, Tahoma, sans-serif";
    ctx.fillText(`${rtl}📍 ${truncateAddress(p.address) || "محدوده خادم آباد"}`, 540, 700);

    // ۸. امکانات (در صورت وجود)
    const extras = buildExtras(p);
    if (extras.length > 0) {
      ctx.fillStyle = "#64748B";
      ctx.font = "400 32px Vazirmatn, Tahoma, sans-serif";
      ctx.fillText(`${rtl}${extras.join("   |   ")}`, 540, 770);
    }

    // ۹. باکس قیمت (بزرگ و شیک)
    const priceY = extras.length > 0 ? 830 : 770;
    ctx.fillStyle = "#F1F5F9";
    if (ctx.roundRect) {
      ctx.beginPath();
      ctx.roundRect(120, priceY, 840, 130, 24);
      ctx.fill();
    }

    const isSale = p.deal_type === "فروش";
    const priceText = isSale
      ? `قیمت: ${p.price_total || "توافقی"}`
      : `رهن: ${p.rahn || "-"}  |  اجاره: ${p.ejare || "-"}`;

    ctx.fillStyle = "#0F172A";
    ctx.font = "bold 44px Vazirmatn, Tahoma, sans-serif";
    ctx.fillText(`${rtl}💰 ${priceText}`, 540, priceY + 80);

    // ۱۰. اطلاعات مشاور
    const agentY = priceY + 180;
    if (p.agent_name || p.agent_phone) {
      ctx.fillStyle = "#334155";
      ctx.font = "500 34px Vazirmatn, Tahoma, sans-serif";
      ctx.fillText(`${rtl}👤 مشاور: ${p.agent_name || "املاک اطلس"}`, 540, agentY);

      if (p.agent_phone) {
        ctx.fillStyle = "#059669";
        ctx.font = "bold 38px Vazirmatn, Tahoma, sans-serif";
        ctx.fillText(`${rtl}📞 ${p.agent_phone}`, 540, agentY + 60);
      }
    }

    // ۱۱. بنر انتهایی و مدرن دعوت به سایت (CTA)
    const ctaY = 1320;
    ctx.fillStyle = "#0F172A";
    if (ctx.roundRect) {
      ctx.beginPath();
      ctx.roundRect(120, ctaY, 840, 420, 28);
      ctx.fill();
    }

    ctx.fillStyle = "#94A3B8";
    ctx.font = "400 28px Vazirmatn, Tahoma, sans-serif";
    ctx.fillText(`${rtl}جهت مشاهده جزئیات بیشتر این ملک و بررسی`, 540, ctaY + 80);
    ctx.fillText(`${rtl}آگهی‌های مشابه در خادم آباد و باغستان،`, 540, ctaY + 130);

    ctx.fillStyle = "#38BDF8";
    ctx.font = "bold 32px Vazirmatn, Tahoma, sans-serif";
    ctx.fillText(`${rtl}لطفاً به سایت اطلس املاک مراجعه کنید:`, 540, ctaY + 200);

    // آدرس دامنه‌ی انگلیسی در کادر برجسته
    ctx.fillStyle = "#1E293B";
    if (ctx.roundRect) {
      ctx.beginPath();
      ctx.roundRect(180, ctaY + 250, 720, 100, 20);
      ctx.fill();
    }

    ctx.fillStyle = "#38BDF8";
    ctx.font = "bold 44px sans-serif";
    ctx.direction = "ltr";
    ctx.fillText("www.atlas-amlak.com", 540, ctaY + 315);

    // دانلود عکس
    const downloadCanvas = () => {
      const dataUrl = canvas.toDataURL("image/png");
      const a = document.createElement("a");
      a.href = dataUrl;
      a.download = `card-${p.code || 'property'}.png`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    };

    downloadCanvas();

  } catch (err) {
    console.error("خطا در ساخت تصویر آگهی:", err);
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
👤 ${p.agent_name || "اطلس املاک"} ${p.agent_phone ? "· 📞 " + p.agent_phone : ""}

🌐 www.atlas-amlak.com
${shareUrl}`;

  const modalHtml = `
    <div id="shareModal" style="position: fixed; inset: 0; z-index: 9999; background: rgba(30, 41, 59, 0.5); backdrop-filter: blur(4px); display: flex; align-items: center; justify-content: center; padding: 16px;">
      <div style="background: #FFFFFF; border: 1px solid #E2E8F0; border-radius: 20px; width: 100%; max-width: 380px; padding: 24px; text-align: center; box-shadow: 0 10px 30px rgba(0,0,0,0.15); animation: popIn 0.2s ease-out;">
        <h3 style="margin: 0 0 8px; color: #1E293B; font-size: 1.15rem; font-weight: 800;">نحوه اشتراک‌گذاری آگهی</h3>
        <p style="margin: 0 0 20px; color: #64748B; font-size: 0.85rem;">کدام قالب را برای ارسال تمایل دارید؟</p>
        
        <div style="display: flex; flex-direction: column; gap: 12px;">
          <button id="modalStoryBtn" type="button" style="background: #0F172A; color: #FFFFFF; border: none; padding: 12px; border-radius: 12px; font-weight: 700; font-size: 0.9rem; cursor: pointer; display: flex; align-items: center; justify-content: center; gap: 8px;">
            🖼️ دانلود کارت آگهی
          </button>
          <button id="modalTextBtn" type="button" style="background: #F8FAFC; color: #1E293B; border: 1px solid #CBD5E1; padding: 12px; border-radius: 12px; font-weight: 700; font-size: 0.9rem; cursor: pointer; display: flex; align-items: center; justify-content: center; gap: 8px;">
            📋 کپی متن آگهی و لینک
          </button>
        </div>

        <button id="modalCloseBtn" type="button" style="background: transparent; border: none; color: #94A3B8; font-size: 0.85rem; margin-top: 16px; cursor: pointer;">
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
    showCopySuccess(shareBtn, "🖼️ کارت دانلود شد");
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
