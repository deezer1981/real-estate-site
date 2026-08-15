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

function cleanAgentName(name) {
  if (!name) return name;
  const stripped = name.replace(/^\s*مشاور[\s:،-]*/, "").trim();
  return stripped || name;
}

function propertyCard(p) {
  const urlParams = new URLSearchParams(window.location.search);
  const isSingleMode = Boolean(urlParams.get("code"));

  const backBanner = isSingleMode ? `
    <div style="background: #FFFFFF; border: 1px solid var(--brass); border-radius: 16px; padding: 14px 18px; margin-bottom: 18px; display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 12px; box-shadow: 0 4px 16px rgba(0,0,0,0.06);">
      <span style="display: inline-flex; align-items: center; gap: 8px; font-weight: 700; font-size: 0.92rem; color: var(--ink);">
        <span style="font-size: 1.1rem; line-height: 1;">📍</span>
        <span>مشاهده‌ی آگهی کد ${p.code}</span>
      </span>
      <a href="${window.location.pathname}" style="text-decoration: none; display: inline-flex; align-items: center; gap: 8px; background: var(--ink); color: var(--paper); font-weight: 700; font-size: 0.85rem; padding: 10px 18px; border-radius: 999px; white-space: nowrap;">
        <span style="font-size: 1rem; line-height: 1;">←</span>
        <span>مشاهده همه آگهی‌ها</span>
      </a>
    </div>
  ` : "";

  const priceLine = p.deal_type === "فروش"
    ? `<p class="card-price">💰 ${p.price_total || "توافقی"}</p>`
    : `<p class="card-price">💰 رهن: ${p.rahn || "-"} | اجاره: ${p.ejare || "-"}</p>`;

  const extras = buildExtras(p);
  const shortAddress = truncateAddress(p.address);
  const agentLine = p.agent_name ? `<p class="card-agent">👤 ثبت‌شده توسط: <strong>${p.agent_name}</strong></p>` : "";
  const agentCallBtn = `<a class="agent-call-btn" href="tel:09106943220">📞 تماس با دفتر اطلس</a>`;

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
// ۶. ساخت تصویر کارت آگهی — طراحی شیک، مدرن و هماهنگ با هویت سایت
// --------------------------------------------------------------------- //
const STORY_THEME = {
  paper: "#FBF6EC",
  paperShade: "#F0E6D2",
  white: "#FFFFFF",
  ink: "#201C15",
  inkSoft: "#57503F",
  muted: "#8A8172",
  brass: "#B4894F",
  brassLight: "#E7D6AF",
  brassDark: "#8A6836",
  sale: "#1E6B4C",
  saleDark: "#154F38",
  rent: "#B4732A",
  rentDark: "#8C5A20",
  hairline: "rgba(32,28,21,0.12)",
};

// تابع رسم مستطیل با زوایای گرد
function drawRoundedRect(ctx, x, y, width, height, radius, fillStyle, strokeStyle = null, lineWidth = 1) {
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.lineTo(x + width - radius, y);
  ctx.quadraticCurveTo(x + width, y, x + width, y + radius);
  ctx.lineTo(x + width, y + height - radius);
  ctx.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
  ctx.lineTo(x + radius, y + height);
  ctx.quadraticCurveTo(x, y + height, x, y + height - radius);
  ctx.lineTo(x, y + radius);
  ctx.quadraticCurveTo(x, y, x + radius, y);
  ctx.closePath();

  if (fillStyle) {
    ctx.fillStyle = fillStyle;
    ctx.fill();
  }
  if (strokeStyle) {
    ctx.strokeStyle = strokeStyle;
    ctx.lineWidth = lineWidth;
    ctx.stroke();
  }
}

// تابع شکستن متن‌های چندخطی برای بالانس متن
function wrapText(ctx, text, maxWidth) {
  if (!text) return [];
  const words = text.split(" ");
  const lines = [];
  let currentLine = words[0] || "";

  for (let i = 1; i < words.length; i++) {
    const word = words[i];
    const width = ctx.measureText(currentLine + " " + word).width;
    if (width < maxWidth) {
      currentLine += " " + word;
    } else {
      lines.push(currentLine);
      currentLine = word;
    }
  }
  lines.push(currentLine);
  return lines;
}

// تولید تصویر کارت آگهی ۱۰۸۰×۱۹۲۰ (مناسب استوری)
async function generatePropertyStoryCanvas(p) {
  const canvas = document.createElement("canvas");
  canvas.width = 1080;
  canvas.height = 1920;
  const ctx = canvas.getContext("2d");

  // پس‌زمینه کرم لوکس
  ctx.fillStyle = STORY_THEME.paper;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  // نوار تزیینی بالا و پایین
  ctx.fillStyle = STORY_THEME.brass;
  ctx.fillRect(0, 0, canvas.width, 18);
  ctx.fillRect(0, canvas.height - 18, canvas.width, 18);

  // هدر و لوگوی برند
  ctx.direction = "rtl";
  ctx.textAlign = "center";

  ctx.font = "bold 80px sans-serif";
  ctx.fillStyle = STORY_THEME.brass;
  ctx.fillText("🏛️", canvas.width / 2, 140);

  ctx.font = "bold 50px 'Vazirmatn', 'Shabnam', 'Tahoma', sans-serif";
  ctx.fillStyle = STORY_THEME.ink;
  ctx.fillText("املاک اطلس", canvas.width / 2, 220);

  ctx.font = "30px 'Vazirmatn', 'Shabnam', 'Tahoma', sans-serif";
  ctx.fillStyle = STORY_THEME.brassDark;
  ctx.fillText("atlas-amlak.ir", canvas.width / 2, 270);

  // خط جداکننده
  ctx.strokeStyle = STORY_THEME.hairline;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(120, 310);
  ctx.lineTo(canvas.width - 120, 310);
  ctx.stroke();

  // کارت اصلی محتوا
  const cardX = 80;
  const cardY = 360;
  const cardW = canvas.width - 160;
  const cardH = 1380;

  ctx.save();
  ctx.shadowColor = "rgba(32, 28, 21, 0.08)";
  ctx.shadowBlur = 24;
  ctx.shadowOffsetY = 10;
  drawRoundedRect(ctx, cardX, cardY, cardW, cardH, 36, STORY_THEME.white, STORY_THEME.brassLight, 2);
  ctx.restore();

  // نشان معامله و کد آگهی
  const isSale = p.deal_type === "فروش";
  const badgeColor = isSale ? STORY_THEME.sale : STORY_THEME.rent;
  const badgeText = p.deal_type || "آگهی";

  drawRoundedRect(ctx, cardX + cardW - 270, cardY + 50, 210, 68, 34, badgeColor);
  ctx.font = "bold 34px 'Vazirmatn', 'Shabnam', 'Tahoma', sans-serif";
  ctx.fillStyle = STORY_THEME.white;
  ctx.textAlign = "center";
  ctx.fillText(badgeText, cardX + cardW - 165, cardY + 96);

  ctx.textAlign = "left";
  ctx.font = "bold 36px 'Vazirmatn', 'Shabnam', 'Tahoma', sans-serif";
  ctx.fillStyle = STORY_THEME.inkSoft;
  ctx.fillText(`کد آگهی: ${p.code || "-"}`, cardX + 60, cardY + 96);

  // عنوان و مشخصات
  ctx.textAlign = "right";
  let currentY = cardY + 220;

  ctx.font = "bold 54px 'Vazirmatn', 'Shabnam', 'Tahoma', sans-serif";
  ctx.fillStyle = STORY_THEME.ink;
  ctx.fillText(p.property_type || "ملک مسکونی", cardX + cardW - 60, currentY);

  currentY += 75;
  const specs = [];
  if (p.area_m2) specs.push(`📐 متراژ: ${p.area_m2} متر`);
  if (p.rooms) specs.push(`🛏️ ${p.rooms} خواب`);

  ctx.font = "36px 'Vazirmatn', 'Shabnam', 'Tahoma', sans-serif";
  ctx.fillStyle = STORY_THEME.inkSoft;
  ctx.fillText(specs.join("   |   ") || "مشخصات کامل ثبت نشده", cardX + cardW - 60, currentY);

  // باکس قیمت
  currentY += 80;
  const priceBoxY = currentY;
  const priceBoxH = 170;
  drawRoundedRect(ctx, cardX + 50, priceBoxY, cardW - 100, priceBoxH, 26, STORY_THEME.paper, STORY_THEME.brassLight, 2);

  ctx.textAlign = "center";
  if (isSale) {
    ctx.font = "30px 'Vazirmatn', 'Shabnam', 'Tahoma', sans-serif";
    ctx.fillStyle = STORY_THEME.muted;
    ctx.fillText("قیمت کل فروش", cardX + (cardW / 2), priceBoxY + 55);

    ctx.font = "bold 50px 'Vazirmatn', 'Shabnam', 'Tahoma', sans-serif";
    ctx.fillStyle = STORY_THEME.brassDark;
    ctx.fillText(p.price_total || "توافقی", cardX + (cardW / 2), priceBoxY + 125);
  } else {
    ctx.font = "bold 38px 'Vazirmatn', 'Shabnam', 'Tahoma', sans-serif";
    ctx.fillStyle = STORY_THEME.brassDark;
    ctx.fillText(`رهن: ${p.rahn || "-"}`, cardX + (cardW / 2), priceBoxY + 70);
    ctx.fillText(`اجاره: ${p.ejare || "-"}`, cardX + (cardW / 2), priceBoxY + 130);
  }

  // موقعیت مکانی
  currentY = priceBoxY + priceBoxH + 85;
  ctx.textAlign = "right";
  ctx.font = "bold 36px 'Vazirmatn', 'Shabnam', 'Tahoma', sans-serif";
  ctx.fillStyle = STORY_THEME.ink;
  ctx.fillText("📍 موقعیت مکانی:", cardX + cardW - 60, currentY);

  currentY += 55;
  ctx.font = "32px 'Vazirmatn', 'Shabnam', 'Tahoma', sans-serif";
  ctx.fillStyle = STORY_THEME.inkSoft;
  const shortAddr = p.address ? p.address.trim() : "خادم‌آباد / باغستان";
  const addressLines = wrapText(ctx, shortAddr, cardW - 120);
  addressLines.slice(0, 2).forEach((line) => {
    ctx.fillText(line, cardX + cardW - 60, currentY);
    currentY += 45;
  });

  // امکانات
  currentY += 25;
  ctx.font = "bold 36px 'Vazirmatn', 'Shabnam', 'Tahoma', sans-serif";
  ctx.fillStyle = STORY_THEME.ink;
  ctx.fillText("✨ امکانات ملک:", cardX + cardW - 60, currentY);

  currentY += 55;
  const extras = buildExtras(p);
  const extrasText = extras.length ? extras.join("   •   ") : "فاقد امکانات ثبت‌شده";
  ctx.font = "32px 'Vazirmatn', 'Shabnam', 'Tahoma', sans-serif";
  ctx.fillStyle = STORY_THEME.inkSoft;
  ctx.fillText(extrasText, cardX + cardW - 60, currentY);

  // مشاور
  if (p.agent_name) {
    currentY += 80;
    const cleanAgent = cleanAgentName(p.agent_name);
    drawRoundedRect(ctx, cardX + 60, currentY, cardW - 120, 75, 20, STORY_THEME.paperShade);
    ctx.textAlign = "center";
    ctx.font = "bold 32px 'Vazirmatn', 'Shabnam', 'Tahoma', sans-serif";
    ctx.fillStyle = STORY_THEME.ink;
    ctx.fillText(`👤 مشاور شما: ${cleanAgent}`, cardX + (cardW / 2), currentY + 48);
  }

  // دکمه تماس
  const footerBoxY = cardY + cardH - 150;
  drawRoundedRect(ctx, cardX + 40, footerBoxY, cardW - 80, 105, 52, STORY_THEME.ink);

  ctx.textAlign = "center";
  ctx.font = "bold 38px 'Vazirmatn', 'Shabnam', 'Tahoma', sans-serif";
  ctx.fillStyle = STORY_THEME.paper;
  ctx.fillText("📞 تماس با دفتر املاک اطلس: ۰۹۱۰۶۹۴۳۲۲۰", cardX + (cardW / 2), footerBoxY + 65);

  ctx.font = "26px 'Vazirmatn', 'Shabnam', 'Tahoma', sans-serif";
  ctx.fillStyle = STORY_THEME.muted;
  ctx.fillText("طراحی شده توسط سامانه هوشمند املاک اطلس — atlas-amlak.ir", canvas.width / 2, canvas.height - 45);

  return canvas;
}

// تولید و اشتراک‌گذاری/دانلود تصویر
async function handleShareProperty(code) {
  const prop = allProperties.find((item) => String(item.code) === String(code));
  if (!prop) return;

  try {
    const canvas = await generatePropertyStoryCanvas(prop);
    canvas.toBlob(async (blob) => {
      if (!blob) return;
      const file = new File([blob], `atlas-property-${code}.png`, { type: "image/png" });

      if (navigator.share && navigator.canShare && navigator.canShare({ files: [file] })) {
        await navigator.share({
          title: `آگهی کد ${code} - املاک اطلس`,
          text: `مشاهده ملک کد ${code} در املاک اطلس:\n${window.location.origin}${window.location.pathname}?code=${code}`,
          files: [file],
        });
      } else {
        const imageUrl = canvas.toDataURL("image/png");
        const link = document.createElement("a");
        link.href = imageUrl;
        link.download = `atlas-property-${code}.png`;
        link.click();
      }
    }, "image/png");
  } catch (err) {
    console.error("خطا در تولید تصویر آگهی:", err);
  }
}

// دکمه‌های اشتراک‌گذاری
document.addEventListener("click", (e) => {
  const shareBtn = e.target.closest(".share-btn");
  if (shareBtn) {
    const code = shareBtn.getAttribute("data-code");
    if (code) handleShareProperty(code);
  }
});

// مقداردهی اولیه دریافت داده‌ها
document.addEventListener("DOMContentLoaded", () => {
  if (allProperties.length) {
    if (!checkSinglePropertyMode()) {
      currentFiltered = allProperties;
      renderProperties();
      updateStatsRibbon();
    }
  } else {
    loadProperties();
  }
});
