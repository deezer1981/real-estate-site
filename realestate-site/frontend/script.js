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

// اگر نام مشاور از قبل شامل کلمه‌ی «مشاور» باشد (مثل «مشاور آقای علیزاده»)،
// از تکرار آن در برچسب‌هایی که خودمان پیشوند «مشاور:» می‌گذاریم جلوگیری می‌کند
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
  // همیشه تماس اصلی به دفتر اطلس می‌رود (طبق تصمیم کسب‌وکار)
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
// پالت رنگ دقیقاً از خانواده رنگی خود سایت (کرم/عاج، جوهری تیره، برنجی طلایی)
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

const RTL_MARK = "\u202B";

// لوگوی سایت (آیکون پین+خانه) به‌صورت base64 — نیازی به بارگذاری از سرور جداگانه ندارد
const STORY_LOGO_DATA_URI = "data:image/png;base64,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";
let _storyLogoPromise = null;
function loadStoryLogo() {
  if (!_storyLogoPromise) {
    _storyLogoPromise = new Promise((resolve) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => resolve(null);
      img.src = STORY_LOGO_DATA_URI;
    });
  }
  return _storyLogoPromise;
}

function rr(ctx, x, y, w, h, r) {
  const radius = typeof r === "number" ? { tl: r, tr: r, br: r, bl: r } : r;
  ctx.beginPath();
  if (ctx.roundRect) {
    ctx.roundRect(x, y, w, h, r);
    return;
  }
  ctx.moveTo(x + radius.tl, y);
  ctx.lineTo(x + w - radius.tr, y);
  ctx.arcTo(x + w, y, x + w, y + radius.tr, radius.tr);
  ctx.lineTo(x + w, y + h - radius.br);
  ctx.arcTo(x + w, y + h, x + w - radius.br, y + h, radius.br);
  ctx.lineTo(x + radius.bl, y + h);
  ctx.arcTo(x, y + h, x, y + h - radius.bl, radius.bl);
  ctx.lineTo(x, y + radius.tl);
  ctx.arcTo(x, y, x + radius.tl, y, radius.tl);
  ctx.closePath();
}

function setFont(ctx, weight, size) {
  ctx.font = `${weight} ${size}px Vazirmatn, Tahoma, sans-serif`;
}

// متن راست‌به‌چپ را با فاصله‌گذاری اختیاری رسم می‌کند
function rtlText(ctx, text, x, y, { align = "center", spacing = 0 } = {}) {
  ctx.textAlign = align;
  if ("letterSpacing" in ctx) ctx.letterSpacing = spacing ? `${spacing}px` : "0px";
  ctx.fillText(`${RTL_MARK}${text}`, x, y);
  if ("letterSpacing" in ctx) ctx.letterSpacing = "0px";
}

// یک نوار برنجی نازک و ظریف با یک لوزی کوچک در وسط (امضای بصری کارت)
function drawOrnamentDivider(ctx, centerX, y, width) {
  ctx.strokeStyle = STORY_THEME.brass;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(centerX - width / 2, y);
  ctx.lineTo(centerX - 14, y);
  ctx.moveTo(centerX + 14, y);
  ctx.lineTo(centerX + width / 2, y);
  ctx.stroke();

  ctx.save();
  ctx.translate(centerX, y);
  ctx.rotate(Math.PI / 4);
  ctx.fillStyle = STORY_THEME.brass;
  ctx.fillRect(-6, -6, 12, 12);
  ctx.restore();
}

async function ensureStoryFontsReady() {
  if (!document.fonts) return;
  try {
    await Promise.all([
      document.fonts.load('500 32px "Vazirmatn"'),
      document.fonts.load('600 32px "Vazirmatn"'),
      document.fonts.load('700 40px "Vazirmatn"'),
      document.fonts.load('800 56px "Vazirmatn"'),
    ]);
    if (document.fonts.ready) await document.fonts.ready;
  } catch (e) {
    // اگر فونت در دسترس نبود، از فونت جایگزین سیستم استفاده می‌شود
  }
}

async function generateStoryImage(p) {
  try {
    await ensureStoryFontsReady();
    const logoImg = await loadStoryLogo();

    const canvas = document.createElement("canvas");
    const W = 1080;
    const H = 1920;
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext("2d");
    if ("direction" in ctx) ctx.direction = "rtl";

    const T = STORY_THEME;
    const cx = W / 2;

    // ۱. پس‌زمینه کرم گرم (هم‌خانواده با پس‌زمینه سایت)
    const bg = ctx.createLinearGradient(0, 0, 0, H);
    bg.addColorStop(0, T.paper);
    bg.addColorStop(1, T.paperShade);
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W, H);

    // ۲. سربرگ برند — لوگو بالای عنوان
    if (logoImg) {
      const logoSize = 108;
      ctx.drawImage(logoImg, cx - logoSize / 2, 34, logoSize, logoSize);
    }

    ctx.fillStyle = T.brass;
    setFont(ctx, 600, 28);
    rtlText(ctx, "سامانه تخصصی املاک", cx, 178, { spacing: 3 });

    ctx.fillStyle = T.ink;
    setFont(ctx, 800, 56);
    rtlText(ctx, "اطلس املاک خادم‌آباد", cx, 248);

    drawOrnamentDivider(ctx, cx, 288, 220);

    // ۳. بدنه کارت سفید با حاشیه برنجی ظریف و سایه‌ی نرم
    const cardX = 68, cardY = 332, cardW = W - cardX * 2, cardH = 1492;

    ctx.save();
    ctx.shadowColor = "rgba(32,28,21,0.18)";
    ctx.shadowBlur = 40;
    ctx.shadowOffsetY = 18;
    ctx.fillStyle = T.white;
    rr(ctx, cardX, cardY, cardW, cardH, 36);
    ctx.fill();
    ctx.restore();

    ctx.strokeStyle = T.brassLight;
    ctx.lineWidth = 2;
    rr(ctx, cardX, cardY, cardW, cardH, 36);
    ctx.stroke();

    // خط ظریف سرمه‌ای داخل کارت — قاب ظریف به سبک اسناد رسمی
    ctx.strokeStyle = "rgba(32,28,21,0.28)";
    ctx.lineWidth = 1.6;
    rr(ctx, cardX + 14, cardY + 14, cardW - 28, cardH - 28, 26);
    ctx.stroke();

    const padX = cardX + 64;
    const contentW = cardW - 128;

    // ۴. ردیف بالا: کد آگهی (چپ) + برچسب نوع معامله (راست)
    const isSale = p.deal_type === "فروش";
    const dealColor = isSale ? T.sale : T.rent;
    const dealColorDark = isSale ? T.saleDark : T.rentDark;

    ctx.fillStyle = T.paperShade;
    ctx.strokeStyle = T.hairline;
    ctx.lineWidth = 1;
    rr(ctx, padX, cardY + 56, 190, 64, 18);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = T.ink;
    setFont(ctx, 700, 34);
    rtlText(ctx, `کد ${p.code || "-"}`, padX + 95, cardY + 98);

    const dealLabel = p.deal_type || "آگهی";
    setFont(ctx, 700, 32);
    const dealW = Math.max(170, ctx.measureText(dealLabel).width + 70);
    const dealX = cardX + cardW - 64 - dealW;
    ctx.fillStyle = dealColor;
    rr(ctx, dealX, cardY + 56, dealW, 64, 18);
    ctx.fill();
    ctx.fillStyle = T.white;
    rtlText(ctx, dealLabel, dealX + dealW / 2, cardY + 98);

    // ۵. عنوان ملک
    ctx.fillStyle = T.ink;
    setFont(ctx, 800, 66);
    rtlText(ctx, p.property_type || "ملک", cx, cardY + 240);

    ctx.strokeStyle = T.hairline;
    ctx.setLineDash([6, 8]);
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(padX, cardY + 280);
    ctx.lineTo(cardX + cardW - 64, cardY + 280);
    ctx.stroke();
    ctx.setLineDash([]);

    // ۶. باکس مشخصات (متراژ / خواب)
    const specsY = cardY + 320;
    ctx.fillStyle = T.paper;
    ctx.strokeStyle = T.brassLight;
    ctx.lineWidth = 1.5;
    rr(ctx, padX, specsY, contentW, 120, 20);
    ctx.fill();
    ctx.stroke();

    const specParts = [];
    if (p.area_m2) specParts.push(`${p.area_m2} متر`);
    if (p.rooms) specParts.push(`${p.rooms} خواب`);
    ctx.fillStyle = T.ink;
    setFont(ctx, 700, 44);
    rtlText(ctx, specParts.join("   •   "), cx, specsY + 76);

    // ۷. آدرس
    const addrY = specsY + 190;
    ctx.fillStyle = T.ink;
    setFont(ctx, 700, 42);
    rtlText(ctx, `📍 ${truncateAddress(p.address) || "خادم‌آباد"}`, cx, addrY);

    // ۸. امکانات
    const extras = buildExtras(p);
    let extrasBottom = addrY;
    if (extras.length) {
      const extrasY = addrY + 78;
      setFont(ctx, 700, 34);
      const gap = 20;
      const widths = extras.map((e) => ctx.measureText(e).width + 48);
      const totalW = widths.reduce((a, b) => a + b, 0) + gap * (extras.length - 1);
      let ex = cx + totalW / 2;
      extras.forEach((label, i) => {
        const w = widths[i];
        ex -= w;
        ctx.fillStyle = T.paperShade;
        ctx.strokeStyle = T.hairline;
        ctx.lineWidth = 1;
        rr(ctx, ex, extrasY - 40, w, 60, 28);
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = T.ink;
        rtlText(ctx, label, ex + w / 2, extrasY - 2);
        ex -= gap;
      });
      extrasBottom = extrasY + 28;
    }

    // ۹. باکس قیمت — عنصر برجسته و طلایی
    const priceY = extrasBottom + 40;
    const priceH = 168;
    const priceGrad = ctx.createLinearGradient(padX, priceY, padX + contentW, priceY);
    priceGrad.addColorStop(0, T.brassLight);
    priceGrad.addColorStop(1, "#F3E7C9");
    ctx.fillStyle = priceGrad;
    rr(ctx, padX, priceY, contentW, priceH, 24);
    ctx.fill();
    ctx.strokeStyle = T.brass;
    ctx.lineWidth = 1.5;
    rr(ctx, padX, priceY, contentW, priceH, 24);
    ctx.stroke();

    ctx.fillStyle = T.brassDark;
    setFont(ctx, 600, 28);
    rtlText(ctx, isSale ? "قیمت فروش" : "شرایط رهن و اجاره", cx, priceY + 48);

    const priceText = isSale
      ? `${p.price_total || "توافقی"} تومان`
      : `رهن ${p.rahn || "-"}  |  اجاره ${p.ejare || "-"}`;
    ctx.fillStyle = T.ink;
    setFont(ctx, 800, isSale ? 50 : 38);
    rtlText(ctx, priceText, cx, priceY + 118);

    // ۱۰. مشاور
    const agentY = priceY + priceH + 80;
    if (p.agent_name || p.agent_phone) {
      ctx.fillStyle = T.ink;
      setFont(ctx, 700, 40);
      rtlText(ctx, `👤 مشاور: ${cleanAgentName(p.agent_name) || "اطلس املاک"}`, cx, agentY);

      if (p.agent_phone) {
        ctx.fillStyle = T.sale;
        setFont(ctx, 700, 40);
        rtlText(ctx, `📞 ${p.agent_phone}`, cx, agentY + 62);
      }
    }

    // ۱۱. بنر پایانی — دعوت به بازدید از سایت (بزرگ‌تر و پرکنتراست‌تر)
    const ctaH = 400;
    const ctaY = cardY + cardH - 64 - ctaH;
    ctx.fillStyle = T.ink;
    rr(ctx, padX, ctaY, contentW, ctaH, 28);
    ctx.fill();
    ctx.strokeStyle = "rgba(180,137,79,0.55)";
    ctx.lineWidth = 1.5;
    rr(ctx, padX, ctaY, contentW, ctaH, 28);
    ctx.stroke();

    // برچسب کوچک برنجی بالای بنر
    ctx.fillStyle = T.brass;
    setFont(ctx, 700, 26);
    rtlText(ctx, "همین حالا ببینید", cx, ctaY + 48, { spacing: 2 });

    // متن دعوت‌کننده با کنتراست بالا (کرم روشن روی جوهری تیره) — فاصله‌ی بیشتر بین دو خط
    ctx.fillStyle = "#FBF6EC";
    setFont(ctx, 700, 40);
    rtlText(ctx, "برای جزئیات کامل و آگهی‌های مشابه", cx, ctaY + 122);
    rtlText(ctx, "در خادم‌آباد و باغستان", cx, ctaY + 200);

    // دکمه‌ی دامنه
    const btnY = ctaY + 248;
    const btnH = 108;
    ctx.fillStyle = T.brass;
    rr(ctx, padX + 50, btnY, contentW - 100, btnH, 18);
    ctx.fill();

    ctx.fillStyle = T.ink;
    ctx.direction = "ltr";
    ctx.textAlign = "center";
    setFont(ctx, 800, 48);
    ctx.fillText("atlas-amlak.ir", cx, btnY + btnH / 2 + 16);
    ctx.direction = "rtl";

    // دانلود تصویر نهایی — JPEG با کیفیت بالا برای حجم کم و اشتراک‌گذاری راحت
    const dataUrl = canvas.toDataURL("image/jpeg", 0.88);
    const a = document.createElement("a");
    a.href = dataUrl;
    a.download = `card-${p.code || "property"}.jpg`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
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

  modalStoryBtn.addEventListener("click", async () => {
    const original = modalStoryBtn.innerHTML;
    modalStoryBtn.innerHTML = "⏳ در حال ساخت...";
    modalStoryBtn.disabled = true;
    await generateStoryImage(p);
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

// --------------------------------------------------------------------- //
// ۹. فرم ثبت فایل ملک
// --------------------------------------------------------------------- //
const submitForm = document.getElementById("submitPropertyForm");
const isAgentSelect = document.getElementById("submitIsAgent");
const agentNameGroup = document.getElementById("agentNameGroup");

if (isAgentSelect && agentNameGroup) {
  isAgentSelect.addEventListener("change", () => {
    agentNameGroup.style.display = isAgentSelect.value === "yes" ? "block" : "none";
  });
}

if (submitForm) {
  submitForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const statusEl = document.getElementById("submitFormStatus");
    const btn = submitForm.querySelector("button[type=submit]");
    
    const payload = {
      deal_type: document.getElementById("submitDealType").value,
      property_type: document.getElementById("submitPropertyType").value,
      address: document.getElementById("submitAddress").value.trim(),
      area_m2: document.getElementById("submitArea").value.trim(),
      rooms: document.getElementById("submitRooms").value.trim(),
      price_info: document.getElementById("submitPrice").value.trim(),
      parking: document.getElementById("submitParking").checked,
      elevator: document.getElementById("submitElevator").checked,
      storage: document.getElementById("submitStorage").checked,
      description: document.getElementById("submitDescription").value.trim(),
      submitter_name: document.getElementById("submitName").value.trim(),
      submitter_phone: document.getElementById("submitPhone").value.trim(),
      is_agent: document.getElementById("submitIsAgent").value === "yes",
      agent_name: document.getElementById("submitAgentName")?.value.trim() || "",
      source: "website"
    };

    btn.disabled = true;
    btn.textContent = "در حال ارسال...";
    statusEl.textContent = "";
    statusEl.className = "form-status";

    try {
      const res = await fetch(`${BASE_API}/api/pending-properties`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });

      if (!res.ok) throw new Error("خطا در ارسال");

      statusEl.textContent = "✅ فایل با موفقیت ارسال شد. به زودی با شما تماس می‌گیریم.";
      statusEl.classList.add("success");
      submitForm.reset();
      if (agentNameGroup) agentNameGroup.style.display = "none";
    } catch (err) {
      statusEl.textContent = "❌ مشکلی پیش آمد. لطفاً دوباره تلاش کنید یا مستقیم تماس بگیرید.";
      statusEl.classList.add("error");
    } finally {
      btn.disabled = false;
      btn.textContent = "ارسال فایل برای بررسی";
    }
  });
}

// --------------------------------------------------------------------- //
// ۱۰. فرم تماس (سوالی دارید؟)
// --------------------------------------------------------------------- //
const leadForm = document.getElementById("leadForm");
if (leadForm) {
  leadForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const statusEl = document.getElementById("formStatus");
    const btn = leadForm.querySelector("button[type=submit]");
    const name = document.getElementById("leadName")?.value.trim() || "";
    const phone = document.getElementById("leadPhone")?.value.trim() || "";
    const message = document.getElementById("leadMessage")?.value.trim() || "";

    if (!name || !phone) {
      if (statusEl) {
        statusEl.textContent = "نام و شماره تماس الزامی است.";
        statusEl.className = "form-status error";
      }
      return;
    }

    if (btn) {
      btn.disabled = true;
      btn.textContent = "در حال ارسال...";
    }
    if (statusEl) {
      statusEl.textContent = "";
      statusEl.className = "form-status";
    }

    try {
      const res = await fetch(`${BASE_API}/api/leads`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, phone, message, source: "website" })
      });

      if (!res.ok) {
        const errText = await res.text();
        throw new Error(errText || "خطا در ارسال");
      }

      if (statusEl) {
        statusEl.textContent = "✅ پیام شما ثبت شد. به زودی تماس می‌گیریم.";
        statusEl.classList.add("success");
      }
      leadForm.reset();
    } catch (err) {
      if (statusEl) {
        statusEl.textContent = "❌ مشکلی پیش آمد. لطفاً دوباره تلاش کنید یا مستقیم تماس بگیرید.";
        statusEl.classList.add("error");
      }
      console.error(err);
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.textContent = "ارسال پیام";
      }
    }
  });
}
