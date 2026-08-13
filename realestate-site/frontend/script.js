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

    // ۲. سربرگ برند
    ctx.fillStyle = T.brass;
    setFont(ctx, 600, 28);
    rtlText(ctx, "سامانه تخصصی املاک", cx, 108, { spacing: 3 });

    ctx.fillStyle = T.ink;
    setFont(ctx, 800, 56);
    rtlText(ctx, "اطلس املاک خادم‌آباد", cx, 178);

    drawOrnamentDivider(ctx, cx, 218, 220);

    // ۳. بدنه کارت سفید با حاشیه برنجی ظریف و سایه‌ی نرم
    const cardX = 68, cardY = 262, cardW = W - cardX * 2, cardH = 1560;

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
    ctx.strokeStyle = "rgba(32,28,21,0.14)";
    ctx.lineWidth = 1.2;
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
    const ctaH = 360;
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
    rtlText(ctx, "همین حالا ببینید", cx, ctaY + 46, { spacing: 2 });

    // متن دعوت‌کننده با کنتراست بالا (کرم روشن روی جوهری تیره) — فاصله‌ی بیشتر بین دو خط
    ctx.fillStyle = "#FBF6EC";
    setFont(ctx, 700, 40);
    rtlText(ctx, "برای جزئیات کامل و آگهی‌های مشابه", cx, ctaY + 112);
    rtlText(ctx, "در خادم‌آباد و باغستان", cx, ctaY + 172);

    // دکمه‌ی دامنه
    const btnY = ctaY + 210;
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
