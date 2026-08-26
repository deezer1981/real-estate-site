// script.js — کارت‌ها از snapshot استاتیک، فیلتر، اشتراک، تصویر آگهی (بدون API/Render)

const grid = document.getElementById("propertyGrid");
const resultCount = document.getElementById("resultCount");
const loadMoreBtn = document.getElementById("loadMoreBtn");
const statsText = document.getElementById("statsText");

// مبلغ‌های آماده از شیت گاهی صفرهای اضافه / واحد ناقص / برچسب اشتباه دارن.
// مثال‌ها:
//   «7.000 میلیارد»     -> «7 میلیارد»
//   «4675.000 میلیارد»  -> «4.675 میلیارد»  (عدد بزرگِ اشتباه‌برچسب‌خورده)
//   «55» یا «70» برای متری -> «55 میلیون»
function toEnglishDigits(str) {
  return String(str || "").replace(/[۰-۹]/g, (d) => "۰۱۲۳۴۵۶۷۸۹".indexOf(d))
    .replace(/[٠-٩]/g, (d) => "٠١٢٣٤٥٦٧٨٩".indexOf(d));
}

function trimDecimalZeros(numStr) {
  if (!numStr.includes(".")) return numStr;
  return numStr.replace(/(\.\d*?[1-9])0+$/, "$1").replace(/\.0+$/, "");
}

/** پاکسازی عمومی متن قیمت (اعشار اضافه) */
function cleanPriceText(text) {
  if (text == null || text === "") return text;
  let s = toEnglishDigits(String(text)).trim();
  if (!s || s === "-") return s;
  s = s.replace(/(\d+)\.(\d+)/g, (match, intPart, decPart) => {
    const trimmed = decPart.replace(/0+$/, "");
    return trimmed ? `${intPart}.${trimmed}` : intPart;
  });
  return s;
}

/**
 * نرمال‌سازی قیمت کل فروش.
 * اگر عدد >= 100 و واحد «میلیارد» باشد، معمولاً مقدار به میلیون وارد شده
 * و برچسب اشتباه است → تقسیم بر ۱۰۰۰ و نمایش به میلیارد.
 */
function formatSaleTotal(text) {
  if (text == null || text === "") return "";
  let s = cleanPriceText(text);
  if (!s || s === "-" || /توافقی/.test(s)) return s || "توافقی";

  const m = s.match(/^([\d,]+(?:\.\d+)?)\s*(.*)$/);
  if (!m) return s;
  let num = parseFloat(m[1].replace(/,/g, ""));
  if (!Number.isFinite(num)) return s;
  let unit = (m[2] || "").trim();

  if (/میلیارد/.test(unit) && num >= 100) {
    num = num / 1000;
    unit = "میلیارد";
  }
  if (!unit) unit = "میلیارد";

  const numStr = trimDecimalZeros(String(Math.round(num * 1000) / 1000));
  return `${numStr} ${unit}`.trim();
}

/** قیمت متری: اگر فقط عدد بود، «میلیون» اضافه می‌شود */
function formatPricePerM2(text) {
  if (text == null || text === "") return "";
  let s = cleanPriceText(text);
  if (!s || s === "-") return "";
  // اگر واحدی ندارد
  if (!/(میلیون|میلیارد|هزار|تومان|ریال)/.test(s)) {
    const n = s.replace(/[^\d.]/g, "");
    if (n) return `${trimDecimalZeros(n)} میلیون`;
  }
  return s;
}

/** نمایش یکدست رهن / اجاره */
function formatRentPart(text) {
  if (text == null || text === "") return "";
  let s = cleanPriceText(text);
  if (!s || s === "-") return "";
  if (!/(میلیون|میلیارد|هزار|تومان|ریال|توافقی)/.test(s)) {
    const n = s.replace(/[^\d.]/g, "");
    if (n) return `${trimDecimalZeros(n)} میلیون`;
  }
  return s;
}

/**
 * متن/آیکون دکمه‌های میان‌بر بالای صفحه (خانه فروشی، رهن و اجاره، ...) رو
 * از window.__MENU_ITEMS__ (که از یه تب جدا توی گوگل‌شیت میاد) بازنویسی می‌کنه.
 * اگه اون snapshot خالی یا نبود، همون متن‌های پیش‌فرض توی HTML می‌مونه — هیچی خراب نمی‌شه.
 * فرمت هر آیتم: { text: "متن دکمه", icon: "🏢" } یا { text: "...", image: "https://..." }
 */
function applyMenuOverrides() {
  const items = window.__MENU_ITEMS__;
  if (!items || typeof items !== "object") return;
  Object.keys(items).forEach((key) => {
    const card = document.querySelector(`.quick-card[data-key="${key}"]`);
    if (!card) return;
    const item = items[key] || {};
    const labelEl = card.querySelector(".quick-label");
    if (labelEl && item.text) labelEl.textContent = item.text;
    const iconEl = card.querySelector(".quick-icon");
    if (iconEl && item.image) {
      iconEl.innerHTML = `<img src="${item.image}" alt="" loading="lazy" style="width:28px;height:28px;object-fit:cover;border-radius:8px;">`;
    } else if (iconEl && item.icon) {
      iconEl.textContent = item.icon;
    }
  });
}

function sortNewestFirst(list) {
  // اول تاریخ ثبت (جدیدتر بالاتر)، اگر نبود بر اساس کد
  const parseReg = (s) => {
    const m = String(s || "").trim().match(
      /^(\d{4})\/(\d{1,2})\/(\d{1,2})(?:\s+(\d{1,2}):(\d{1,2}))?/
    );
    if (!m) return 0;
    const y = +m[1], mo = +m[2], d = +m[3];
    const hh = +(m[4] || 0), mm = +(m[5] || 0);
    return y * 1e10 + mo * 1e8 + d * 1e6 + hh * 1e4 + mm * 100;
  };
  const codeNum = (x) => {
    const d = String(x.code || "").replace(/\D/g, "");
    return d ? parseInt(d, 10) : 0;
  };
  return (list || []).slice().sort((a, b) => {
    const da = parseReg(a.registered_at);
    const db = parseReg(b.registered_at);
    if (da !== db) return db - da; // تاریخ جدیدتر اول
    return codeNum(b) - codeNum(a); // در غیر این صورت کد بالاتر
  });
}

let allProperties = sortNewestFirst(window.__PRELOADED_PROPERTIES__ || []);
let currentFiltered = [];
const PAGE_SIZE = 6;
let visibleCount = PAGE_SIZE;

// --------------------------------------------------------------------- //
// ۱. توابع کمکی ساخت کارت و لاین بازگشت
// --------------------------------------------------------------------- //
function truncateAddress(address) {
  if (!address) return "";
  const text = address.trim();
  // فقط تا «لاله X» (+ جهت) — جزئیات دقیق‌تر نشان داده نمی‌شود
  const match = text.match(/^(.*?لاله\s*[\u06F0-\u06F90-9]+\s*(?:اصلی|غربی|شرقی)?)/);
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

// آیکون جایگزین وقتی آگهی عکس ندارد — بر اساس نوع ملک
function placeholderIcon(propertyType) {
  const t = (propertyType || "").trim();
  if (t.includes("آپارتمان")) return "🏢";
  if (t.includes("ویلایی")) return "🏡";
  if (t.includes("تجاری")) return "🏬";
  if (t.includes("زمین")) return "🟫";
  if (t.includes("باغ")) return "🌳";
  return "🏠";
}

/** بخش عکس کارت: اگر آگهی عکس داشت نمایش لود-تنبل، وگرنه جایگزین سبک
 *  برچسب معامله و دکمه اشتراک روی خود عکس قرار می‌گیرند تا فضای بدنه کارت خلوت بماند */
function buildCardImage(p, isSale) {
  const icon = placeholderIcon(p.property_type);
  const overlay = `
    <div class="card-image-overlay">
      <span class="deal-tag ${isSale ? "sale" : "rent"}">${p.deal_type || "آگهی"}</span>
      <button class="share-btn share-btn-card" data-code="${p.code || ""}" type="button" aria-label="اشتراک‌گذاری آگهی">🔗 اشتراک</button>
    </div>`;
  if (p.image) {
    return `
      <div class="card-image-wrap">
        <img class="card-image" src="${p.image}" alt="${labeledPropertyType(p)} کد ${p.code || ""}"
             loading="lazy" decoding="async" width="400" height="280"
             onerror="this.closest('.card-image-wrap').classList.add('no-image'); this.remove();">
        <div class="card-image-fallback"><div class="fallback-icon-circle">${icon}</div><span class="fallback-caption">بدون عکس</span></div>
        ${overlay}
      </div>`;
  }
  return `
    <div class="card-image-wrap no-image">
      <div class="card-image-fallback"><div class="fallback-icon-circle">${icon}</div><span class="fallback-caption">بدون عکس</span></div>
      ${overlay}
    </div>`;
}

// اگر نام مشاور از قبل شامل کلمه‌ی «مشاور» باشد (مثل «مشاور آقای علیزاده»)،
// از تکرار آن در برچسب‌هایی که خودمان پیشوند «مشاور:» می‌گذاریم جلوگیری می‌کند
function cleanAgentName(name) {
  if (!name) return name;
  const stripped = name.replace(/^\s*مشاور[\s:،-]*/, "").trim();
  return stripped || name;
}


/** عدد متراژ از متن فارسی/انگلیسی */
function parseAreaM2(p) {
  const raw = toEnglishDigits(String(p.area_m2 || "")).replace(/[^\d.]/g, "");
  const n = parseFloat(raw);
  return Number.isFinite(n) ? n : 0;
}

/** عدد خواب */
function parseRooms(p) {
  const raw = toEnglishDigits(String(p.rooms || "")).replace(/[^\d]/g, "");
  const n = parseInt(raw, 10);
  return Number.isFinite(n) ? n : 0;
}

/**
 * قیمت فروش نرمال‌شده به «میلیارد» برای فیلتر عددی.
 * همان منطق formatSaleTotal: عدد >=100 با برچسب میلیارد → تقسیم بر ۱۰۰۰
 */
function parseSalePriceBillion(p) {
  if (p.deal_type !== "فروش") return null;
  let s = cleanPriceText(p.price_total);
  if (!s || s === "-" || /توافقی/.test(s)) return null;
  const m = String(s).match(/([\d,]+(?:\.\d+)?)/);
  if (!m) return null;
  let num = parseFloat(m[1].replace(/,/g, ""));
  if (!Number.isFinite(num)) return null;
  if (/میلیارد/.test(s) && num >= 100) num = num / 1000;
  else if (/میلیون/.test(s) && !/میلیارد/.test(s)) num = num / 1000;
  return num;
}

function getActiveFilterValue(group) {
  const el = document.querySelector(`[data-filter-group="${group}"].active, .filter-chip.active[data-filter-group="${group}"]`);
  // chips use class on button
  const chip = document.querySelector(`.filter-chip[data-filter-group="${group}"].active`);
  return chip ? (chip.getAttribute("data-value") || "") : "";
}

function isAmenityOn(name) {
  const chip = document.querySelector(`.filter-chip[data-amenity="${name}"].active`);
  return Boolean(chip);
}

function formatRentPrice(p) {
  const parts = [];
  if (p.rahn && p.rahn !== "-") {
    const r = formatRentPart(p.rahn);
    if (r) parts.push(`رهن: ${r}`);
  }
  if (p.ejare && p.ejare !== "-") {
    const e = formatRentPart(p.ejare);
    if (e) parts.push(`اجاره: ${e}`);
  }
  if (!parts.length) return "💰 توافقی";
  return `💰 ${parts.join(" | ")}`;
}

/** عنوان با نوع معامله: آپارتمان فروشی / رهن و اجاره آپارتمان */
function labeledPropertyType(p) {
  const type = (p.property_type || "ملک").trim();
  if (p.deal_type === "فروش") return `${type} فروشی`;
  return `رهن و اجاره ${type}`;
}

/** متن کوتاه مناسب SMS (حدود ۱ تا ۲ پیامک) */
function buildSmsText(p) {
  const title = labeledPropertyType(p);
  const specs = [];
  if (p.area_m2) specs.push(`${p.area_m2} متر`);
  if (p.rooms) specs.push(`${p.rooms} خواب`);
  if (p.floor) specs.push(`طبقه ${p.floor}`);

  const amenities = [];
  if (p.parking) amenities.push("پارکینگ");
  if (p.elevator) amenities.push("آسانسور");
  if (p.storage) amenities.push("انباری");

  const lines = [title];
  if (specs.length) lines.push(specs.join(" · "));
  if (amenities.length) lines.push(amenities.join(" · "));

  if (p.deal_type === "فروش") {
    if (p.price_total) lines.push(`قیمت کل: ${formatSaleTotal(p.price_total)}`);
  } else {
    const rentBits = [];
    if (p.rahn && p.rahn !== "-") rentBits.push(`رهن ${formatRentPart(p.rahn)}`);
    if (p.ejare && p.ejare !== "-") rentBits.push(`اجاره ${formatRentPart(p.ejare)}`);
    if (rentBits.length) lines.push(rentBits.join(" · "));
  }

  const addr = truncateAddress(p.address);
  if (addr) lines.push(addr);

  lines.push("");
  lines.push("مشاور: کریمی");
  lines.push("۰۹۱۰۶۹۴۳۲۲۰");
  lines.push("اطلس املاک");
  if (p.code) lines.push(`کدفایل: ${p.code}`);
  lines.push("www.atlas-amlak.ir");
  lines.push("فایل‌های بیشتر و به روز در سایت خادم آباد");

  return lines.join("\n");
}

function propertyCard(p) {
  const urlParams = new URLSearchParams(window.location.search);
  const isSingleMode = Boolean(urlParams.get("code"));

  /* بنر بالای کارت فقط راهنما — دکمه برگشت اینجاست حذف شد تا با «بازگشت به همه آگهی‌ها» تکراری نباشد */
  const backBanner = isSingleMode ? `
    <div class="single-ad-banner single-ad-banner-info">
      <div class="single-ad-banner-text">
        <span class="single-ad-kicker">آگهی اختصاصی</span>
        <strong>کد ${p.code} · ${labeledPropertyType(p)}</strong>
      </div>
    </div>
  ` : "";

  const saleTotal = formatSaleTotal(p.price_total);
  const saleM2 = formatPricePerM2(p.price_per_m2);
  const priceLine = p.deal_type === "فروش"
    ? `<p class="card-price">💰 ${saleTotal || "توافقی"}</p>${saleM2 ? `<p class="card-meta card-price-m2">قیمت متری: ${saleM2}</p>` : ""}`
    : `<p class="card-price">${formatRentPrice(p)}</p>`;

  const extras = buildExtras(p);
  const shortAddress = truncateAddress(p.address);
  const agentLine = p.agent_name
    ? `<p class="card-agent">👤 ثبت‌شده توسط: <strong>${p.agent_name}</strong></p>`
    : "";
  const dateLine = p.registered_at
    ? `<p class="card-date">📅 ثبت: ${p.registered_at}</p>`
    : "";
  const officePhone = (typeof OFFICE_PHONE !== "undefined") ? OFFICE_PHONE : "09106943220";
  const baleUser = (typeof BALE_USERNAME !== "undefined") ? BALE_USERNAME : "Nobody_Mohsen";
  const baleMsg = encodeURIComponent(`سلام، در مورد آگهی کد ${p.code || ""} از سایت اطلس املاک پیام می‌دم.`);
  /* اشتراک فقط روی عکس کارت (مثل صفحه اصلی) — دکمه جدا پایین حذف شد */
  const agentActions = `
    <div class="card-actions">
      <a class="agent-call-btn agent-btn-primary" href="tel:${officePhone}">📞 مشاوره / بازدید</a>
      <a class="agent-msg-btn agent-btn-secondary" href="https://ble.ir/${baleUser}?text=${baleMsg}" target="_blank" rel="noopener">💬 پیام</a>
    </div>`;

  const bottomBack = isSingleMode
    ? `<div class="single-ad-bottom">
         <a href="${window.location.pathname}" class="single-ad-back-bottom">← همه آگهی‌ها</a>
       </div>`
    : "";

  const wrapperStyle = isSingleMode
    ? "grid-column: 1 / -1; max-width: 560px; margin: 0 auto; width: 100%;"
    : "width: 100%;";

  const specsParts = [];
  if (p.area_m2) specsParts.push("📐 " + p.area_m2 + " متر");
  if (p.rooms) specsParts.push("🛏️ " + p.rooms + " خواب");
  if (p.floor) specsParts.push("🏢 طبقه " + p.floor);
  const specsLine = specsParts.length
    ? `<p class="card-meta">${specsParts.join(" · ")}</p>`
    : "";

  const titleType = labeledPropertyType(p);
  const titleCode = p.code ? `<span class="card-code">کد ${p.code}</span>` : "";
  const imageBlock = buildCardImage(p, p.deal_type === "فروش");

  return `
    <div style="${wrapperStyle}">
      ${backBanner}
      <article class="card ${p.deal_type === "فروش" ? "card-sale" : "card-rent"}" id="card-${p.code || ""}" data-code="${p.code || ""}">
        ${imageBlock}
        <div class="card-body">
          <h3 class="card-title">${titleType} ${titleCode}</h3>
          ${shortAddress ? `<p class="card-meta card-address">📍 ${shortAddress}</p>` : ""}
          ${specsLine}
          ${extras.length ? `<p class="card-meta card-extras">${extras.join(" | ")}</p>` : ""}
          ${p.documents ? `<p class="card-meta card-docs">📄 مدارک: ${p.documents}</p>` : ""}
          ${priceLine}
          ${agentLine}
          ${agentActions}
          ${dateLine}
        </div>
      </article>
      ${bottomBack}
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
    if (resultCount) resultCount.textContent = `آگهی کد ${targetCode}`;
    renderProperties();
    if (loadMoreBtn) loadMoreBtn.hidden = true;

    // حس صفحه جزئیات: عنوان تب، مخفی کردن فیلتر/هیرو اضافه، اسکرول به کارت
    document.body.classList.add("single-ad-mode");
    const label = labeledPropertyType(found);
    const addr = truncateAddress(found.address) || "خادم‌آباد و باغستان";
    const pageUrl = `${window.location.origin}${window.location.pathname}?code=${targetCode}`;
    const descText = `${label} کد ${targetCode} — ${addr}. مشاهده جزئیات و تماس با دفتر اطلس املاک خادم‌آباد.`;
    document.title = `${label} کد ${targetCode} | اطلس املاک`;
    const desc = document.querySelector('meta[name="description"]');
    if (desc) desc.setAttribute("content", descText);

    // Open Graph / Twitter برای اشتراک لینک
    const setMeta = (attr, key, val) => {
      if (!val) return;
      let el = document.querySelector(`meta[${attr}="${key}"]`);
      if (!el) {
        el = document.createElement("meta");
        el.setAttribute(attr, key);
        document.head.appendChild(el);
      }
      el.setAttribute("content", val);
    };
    setMeta("property", "og:title", `${label} کد ${targetCode} | اطلس املاک`);
    setMeta("property", "og:description", descText);
    setMeta("property", "og:url", pageUrl);
    setMeta("property", "og:type", "website");
    if (found.image) setMeta("property", "og:image", found.image);
    setMeta("name", "twitter:title", `${label} کد ${targetCode} | اطلس املاک`);
    setMeta("name", "twitter:description", descText);

    let canonical = document.querySelector('link[rel="canonical"]');
    if (!canonical) {
      canonical = document.createElement("link");
      canonical.rel = "canonical";
      document.head.appendChild(canonical);
    }
    canonical.href = pageUrl;

    // JSON-LD آگهی
    const oldLd = document.getElementById("single-ad-jsonld");
    if (oldLd) oldLd.remove();
    const priceForLd = found.deal_type === "فروش"
      ? formatSaleTotal(found.price_total)
      : [formatRentPart(found.rahn), formatRentPart(found.ejare)].filter(Boolean).join(" / ");
    const ld = {
      "@context": "https://schema.org",
      "@type": "RealEstateListing",
      "name": `${label} کد ${targetCode}`,
      "description": descText,
      "url": pageUrl,
      "datePosted": found.registered_at || undefined,
      "address": {
        "@type": "PostalAddress",
        "streetAddress": found.address || addr,
        "addressLocality": "خادم‌آباد",
        "addressRegion": "تهران",
        "addressCountry": "IR"
      }
    };
    if (found.image) ld.image = found.image;
    if (found.area_m2) ld.floorSize = { "@type": "QuantitativeValue", "value": parseAreaM2(found), "unitCode": "MTK" };
    if (priceForLd) ld.offers = { "@type": "Offer", "priceCurrency": "IRR", "description": priceForLd };
    const scriptLd = document.createElement("script");
    scriptLd.type = "application/ld+json";
    scriptLd.id = "single-ad-jsonld";
    scriptLd.textContent = JSON.stringify(ld);
    document.head.appendChild(scriptLd);
    const clearBtn = document.getElementById("clearDeepLinkBtn");
    if (clearBtn) {
      clearBtn.hidden = false;
      clearBtn.onclick = () => { window.location.href = window.location.pathname; };
    }
    // بعد از رندر، نرم برو سر کارت
    requestAnimationFrame(() => {
      const card = document.getElementById("card-" + targetCode);
      if (card) card.scrollIntoView({ behavior: "smooth", block: "start" });
    });
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
  if (!currentFiltered || currentFiltered.length === 0) {
    showEmptyState("آگهی‌ای با این فیلتر پیدا نشد.");
    const rc = document.getElementById("resultCount");
    if (rc) rc.textContent = "۰ آگهی";
    return;
  }

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
// فقط از snapshot داخل صفحه استفاده می‌شود (بدون Render / API)

function showSkeleton(count = 6) {
  const grid = document.getElementById("propertyGrid");
  if (!grid) return;
  grid.innerHTML = Array.from({ length: count }, () => `
    <article class="card skeleton-card" aria-hidden="true">
      <div class="card-image-wrap sk-image"></div>
      <div class="card-body">
        <div class="sk-line sk-tag"></div>
        <div class="sk-line sk-title"></div>
        <div class="sk-line"></div>
        <div class="sk-line sk-short"></div>
        <div class="sk-line sk-price"></div>
      </div>
    </article>
  `).join("");
}

function showEmptyState(msg) {
  const grid = document.getElementById("propertyGrid");
  if (!grid) return;
  grid.innerHTML = `
    <div class="empty-state">
      <p>${msg || "آگهی‌ای با این فیلتر پیدا نشد."}</p>
      <button type="button" class="filter-reset-btn" id="emptyResetBtn">نمایش همه آگهی‌ها</button>
    </div>`;
  document.getElementById("emptyResetBtn")?.addEventListener("click", () => {
    document.querySelectorAll(".filter-chip").forEach((c) => c.classList.remove("active"));
    document.querySelector('.filter-chip[data-deal=""]')?.classList.add("active");
    document.querySelectorAll('.filter-chip[data-filter-group][data-value=""]').forEach((c) => c.classList.add("active"));
    document.querySelectorAll("#citySearch").forEach((q) => { q.value = ""; });
    currentFiltered = allProperties.slice();
    visibleCount = 6;
    renderProperties();
    if (typeof updateStatsRibbon === "function") updateStatsRibbon();
  });
}

function loadProperties() {
  // allProperties از قبل با window.__PRELOADED_PROPERTIES__ پر شده
  if (!allProperties.length) {
    showEmptyState("فعلاً آگهی فعالی ثبت نشده است.");
    return;
  }
  if (!checkSinglePropertyMode()) {
    allProperties = sortNewestFirst(allProperties);
    currentFiltered = allProperties.slice();
    renderProperties();
    updateStatsRibbon();
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

  const areaVal = (document.querySelector('.filter-chip[data-filter-group="area"].active') || {}).getAttribute?.("data-value") || "";
  const roomsVal = (document.querySelector('.filter-chip[data-filter-group="rooms"].active') || {}).getAttribute?.("data-value") || "";
  const priceVal = (document.querySelector('.filter-chip[data-filter-group="price"].active') || {}).getAttribute?.("data-value") || "";
  const needParking = isAmenityOn("parking");
  const needElevator = isAmenityOn("elevator");
  const needStorage = isAmenityOn("storage");

  let filtered = allProperties;
  if (dealType) filtered = filtered.filter((p) => p.deal_type === dealType);

  if (keyword) {
    const isGardenSearch = keyword === "باغ";
    const isGardenType = (t) => {
      t = (t || "").trim();
      if (!t) return false;
      if (t.includes("باغستان")) return false;
      if (t.includes("باغچه")) return true;
      if (t.includes("باغ‌ویلا") || t.includes("باغ ویلا") || t.includes("باغ-ویلا")) return true;
      if (t === "باغ" || t.startsWith("باغ ")) return true;
      if (t.includes("باغ") && !t.includes("آپارتمان")) return true;
      if (t === "ویلا" || t.startsWith("ویلا ")) return true;
      return false;
    };
    filtered = filtered.filter((p) => {
      const addr = p.address || "";
      const ptype = p.property_type || "";
      const code = String(p.code || "");
      if (isGardenSearch) return isGardenType(ptype);
      return addr.includes(keyword) || ptype.includes(keyword) || code.includes(keyword);
    });
  }

  // متراژ
  if (areaVal) {
    filtered = filtered.filter((p) => {
      const a = parseAreaM2(p);
      if (!a) return false;
      if (areaVal === "0-70") return a <= 70;
      if (areaVal === "70-100") return a > 70 && a <= 100;
      if (areaVal === "100-150") return a > 100 && a <= 150;
      if (areaVal === "150+") return a > 150;
      return true;
    });
  }

  // خواب
  if (roomsVal) {
    filtered = filtered.filter((p) => {
      const r = parseRooms(p);
      if (roomsVal === "3+") return r >= 3;
      return r === parseInt(roomsVal, 10);
    });
  }

  // قیمت فروش (میلیارد) — با فعال شدن، فقط فایل‌های فروشیِ داخل بازه می‌مانند
  if (priceVal && dealType !== "رهن و اجاره") {
    filtered = filtered.filter((p) => {
      if (p.deal_type !== "فروش") return false;
      const bil = parseSalePriceBillion(p);
      if (bil == null) return false;
      if (priceVal === "0-5") return bil < 5;
      if (priceVal === "5-8") return bil >= 5 && bil < 8;
      if (priceVal === "8-11") return bil >= 8 && bil < 11;
      if (priceVal === "11+") return bil >= 11;
      return true;
    });
  }

  if (needParking) filtered = filtered.filter((p) => p.parking);
  if (needElevator) filtered = filtered.filter((p) => p.elevator);
  if (needStorage) filtered = filtered.filter((p) => p.storage);

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
// ۶. اسکرین‌شات از خود کارت آگهی (به‌جای کارت Canvas جدا)
// --------------------------------------------------------------------- //
function loadHtml2Canvas() {
  return new Promise((resolve, reject) => {
    if (window.html2canvas) return resolve(window.html2canvas);
    const s = document.createElement("script");
    s.src = "https://cdn.jsdelivr.net/npm/html2canvas@1.4.1/dist/html2canvas.min.js";
    s.async = true;
    s.onload = () => {
      if (window.html2canvas) resolve(window.html2canvas);
      else reject(new Error("html2canvas loaded but missing"));
    };
    s.onerror = () => reject(new Error("بارگذاری html2canvas ناموفق بود"));
    document.head.appendChild(s);
  });
}

function canvasToBlob(canvas) {
  return new Promise((resolve) => {
    if (canvas.toBlob) {
      canvas.toBlob((blob) => resolve(blob), "image/jpeg", 0.92);
    } else {
      const dataUrl = canvas.toDataURL("image/jpeg", 0.92);
      fetch(dataUrl).then((r) => r.blob()).then(resolve);
    }
  });
}

/**
 * اسکرین‌شات تمیز از کارت آگهی روی صفحه.
 * دکمه‌های اکشن و اشتراک موقتاً مخفی می‌شوند تا تصویر شلوغ نباشد.
 */
async function captureCardScreenshot(p) {
  const h2c = await loadHtml2Canvas();
  const card = document.getElementById("card-" + (p.code || ""));
  if (!card) throw new Error("کارت آگهی روی صفحه پیدا نشد (کد: " + (p.code || "—") + ")");

  // عناصر UI که نباید در تصویر باشند (حذف کامل تا فضای خالی نماند)
  const toHide = card.querySelectorAll(".card-actions, .share-btn");
  const prev = [];
  toHide.forEach((el) => {
    prev.push({ el, display: el.style.display });
    el.style.display = "none";
  });

  // فوتر کوچک موقت برای برندینگ
  const foot = document.createElement("div");
  foot.className = "card-capture-footer";
  foot.setAttribute("data-capture-temp", "1");
  foot.style.cssText = [
    "display:flex",
    "align-items:center",
    "justify-content:center",
    "gap:8px",
    "padding:10px 14px 12px",
    "border-top:1px solid rgba(32,28,21,0.08)",
    "background:#FBF6EC",
    "font-family:Vazirmatn,Tahoma,sans-serif",
    "font-size:0.82rem",
    "font-weight:700",
    "color:#57503F",
    "letter-spacing:0.02em",
  ].join(";");
  foot.textContent = "atlas-amlak.ir";
  card.appendChild(foot);

  // کمی صبر تا layout پایدار شود
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));

  const opts = {
    scale: 2,
    useCORS: true,
    allowTaint: false,
    backgroundColor: "#FFFCFA",
    logging: false,
    imageTimeout: 8000,
    onclone: (doc, node) => {
      node.querySelectorAll(".card-actions, .share-btn").forEach((el) => {
        el.style.display = "none";
      });
      node.style.transform = "none";
      node.style.boxShadow = "0 4px 16px rgba(20,33,61,0.10)";
    },
  };

  let canvas;
  try {
    try {
      canvas = await h2c(card, opts);
    } catch (corsErr) {
      // بعضی عکس‌های خارجی CORS ندارند — یک‌بار دیگر بدون عکس امتحان می‌کنیم
      console.warn("html2canvas CORS issue, retry without foreign images:", corsErr);
      opts.onclone = (doc, node) => {
        node.querySelectorAll(".card-actions, .share-btn").forEach((el) => {
          el.style.display = "none";
        });
        node.querySelectorAll("img.card-image").forEach((img) => {
          img.style.display = "none";
          const wrap = img.closest(".card-image-wrap");
          if (wrap) wrap.classList.add("no-image");
        });
        node.style.transform = "none";
        node.style.boxShadow = "0 4px 16px rgba(20,33,61,0.10)";
      };
      canvas = await h2c(card, opts);
    }
  } finally {
    prev.forEach(({ el, display }) => {
      el.style.display = display;
    });
    const tmp = card.querySelector('[data-capture-temp="1"]');
    if (tmp) tmp.remove();
  }

  return canvas;
}

async function generateStoryImage(p) {
  try {
    const canvas = await captureCardScreenshot(p);
    const blob = await canvasToBlob(canvas);
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "card-" + (p.code || "property") + ".jpg";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  } catch (err) {
    console.error("خطا در ساخت تصویر آگهی:", err);
    alert("ساخت تصویر کارت ناموفق بود. لطفاً دوباره تلاش کنید.");
  }
}


function showShareModal(p, shareBtn) {
  const oldModal = document.getElementById("shareModal");
  if (oldModal) oldModal.remove();

  const shareUrl = `${window.location.origin}${window.location.pathname}?code=${p.code}`;
  const extras = buildExtras(p);
  const label = labeledPropertyType(p);
  const priceText = p.deal_type === "فروش"
    ? `💰 قیمت: ${formatSaleTotal(p.price_total) || "توافقی"}`
    : formatRentPrice(p);

  const specsParts = [
    p.area_m2 ? p.area_m2 + " متر" : "",
    p.rooms ? p.rooms + " خواب" : "",
    p.floor ? "طبقه " + p.floor : ""
  ].filter(Boolean);
  const m2Share = formatPricePerM2(p.price_per_m2);
  const priceExtra = (p.deal_type === "فروش" && m2Share) ? `\n📏 قیمت متری: ${m2Share}` : "";
  const shortAddr = truncateAddress(p.address) || "خادم‌آباد";
  const shareText =
`🏠 ${label} · کد ${p.code}

📍 ${shortAddr}
📐 ${specsParts.join(" · ")}${priceExtra}
${extras.length ? "✨ " + extras.join(" · ") + "\n" : ""}${priceText}

📞 تماس با دفتر اطلس: ۰۹۱۰۶۹۴۳۲۲۰

🔗 مشاهده آگهی:
${shareUrl}

🌐 atlas-amlak.ir
گروه مشاورین املاک اطلس — خادم‌آباد و باغستان`;

  const smsText = buildSmsText(p);

  const modalHtml = `
    <div id="shareModal" style="position:fixed;inset:0;z-index:9999;background:rgba(32,28,21,0.55);backdrop-filter:blur(5px);display:flex;align-items:center;justify-content:center;padding:16px;">
      <div style="background:#FFFCFA;border:1px solid #E8DFD0;border-radius:20px;width:100%;max-width:380px;padding:24px;text-align:center;box-shadow:0 16px 40px rgba(32,28,21,0.2);">
        <h3 style="margin:0 0 6px;color:#201C15;font-size:1.15rem;font-weight:800;">اشتراک‌گذاری آگهی</h3>
        <p style="margin:0 0 18px;color:#6B6358;font-size:0.85rem;">کد ${p.code || "—"} · ${label}</p>

        <div style="display:flex;flex-direction:column;gap:10px;">
          <button id="modalNativeShareBtn" type="button" style="background:#201C15;color:#FFFCFA;border:none;padding:13px;border-radius:12px;font-weight:700;font-size:0.92rem;cursor:pointer;">
            📤 اشتراک عکس کارت آگهی (بله / روبیکا / استوری و ...)
          </button>
          <button id="modalStoryBtn" type="button" style="background:#B4894F;color:#201C15;border:none;padding:13px;border-radius:12px;font-weight:700;font-size:0.92rem;cursor:pointer;">
            🖼️ دانلود اسکرین کارت آگهی
          </button>
          <button id="modalTextBtn" type="button" style="background:#FFFCFA;color:#201C15;border:1px solid #D4C4A8;padding:13px;border-radius:12px;font-weight:700;font-size:0.92rem;cursor:pointer;">
            📋 کپی متن آگهی
          </button>
          <button id="modalSmsBtn" type="button" style="background:#EFF6FF;color:#1E3A8A;border:1px solid #93C5FD;padding:13px;border-radius:12px;font-weight:700;font-size:0.92rem;cursor:pointer;">
            📱 کپی متن پیامک
          </button>
        </div>

        <button id="modalCloseBtn" type="button" style="background:transparent;border:none;color:#9A9080;font-size:0.85rem;margin-top:16px;cursor:pointer;">
          بستن
        </button>
      </div>
    </div>
  `;

  document.body.insertAdjacentHTML("beforeend", modalHtml);

  const modal = document.getElementById("shareModal");
  const closeModal = () => modal.remove();

  document.getElementById("modalCloseBtn").addEventListener("click", closeModal);
  modal.addEventListener("click", (e) => { if (e.target === modal) closeModal(); });

  document.getElementById("modalNativeShareBtn").addEventListener("click", async () => {
    const btn = document.getElementById("modalNativeShareBtn");
    const originalLabel = btn.innerHTML;
    btn.innerHTML = "⏳ در حال آماده‌سازی...";
    btn.disabled = true;
    try {
      // اول تلاش برای اشتراک مستقیم «عکس کارت آگهی» — همون چیزی که توی روبیکا/بله/استوری
      // به‌صورت پیام تصویری میره، نه فقط لینک متنی
      const canvas = await captureCardScreenshot(p);
      const blob = await canvasToBlob(canvas);
      const file = new File([blob], `card-${p.code || "property"}.jpg`, { type: "image/jpeg" });
      const shareData = {
        title: `${label} · کد ${p.code} | اطلس املاک`,
        text: shareText,
        files: [file],
      };
      if (navigator.canShare && navigator.canShare(shareData)) {
        await navigator.share(shareData);
        showCopySuccess(shareBtn, "✅ اشتراک‌گذاری شد");
        closeModal();
        return;
      }
      // مرورگرهایی که اشتراک فایل رو پشتیبانی نمی‌کنن (مثل بعضی نسخه‌های دسکتاپ):
      // فقط متن + لینک رو با همون شیت اشتراک‌گذاری بفرست
      if (navigator.share) {
        await navigator.share({ title: shareData.title, text: shareText, url: shareUrl });
        showCopySuccess(shareBtn, "✅ اشتراک‌گذاری شد");
        closeModal();
        return;
      }
      throw new Error("share not supported");
    } catch (err) {
      if (err && err.name === "AbortError") {
        btn.innerHTML = originalLabel;
        btn.disabled = false;
        return;
      }
      forceCopyText(shareText);
      showCopySuccess(shareBtn, "📋 متن کپی شد (اشتراک مستقیم روی این مرورگر پشتیبانی نمی‌شود)");
      closeModal();
    }
  });

  document.getElementById("modalStoryBtn").addEventListener("click", async () => {
    const btn = document.getElementById("modalStoryBtn");
    btn.innerHTML = "⏳ در حال ساخت...";
    btn.disabled = true;
    await generateStoryImage(p);
    showCopySuccess(shareBtn, "🖼️ کارت دانلود شد");
    closeModal();
  });

  document.getElementById("modalTextBtn").addEventListener("click", () => {
    forceCopyText(shareText);
    showCopySuccess(shareBtn, "📋 متن کپی شد");
    closeModal();
  });

  document.getElementById("modalSmsBtn").addEventListener("click", () => {
    forceCopyText(smsText);
    showCopySuccess(shareBtn, "📱 متن پیامک کپی شد");
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
// فرم ثبت فایل حذف شده

// --------------------------------------------------------------------- //
// ۱۰. فرم تماس (سوالی دارید؟)
// --------------------------------------------------------------------- //
const leadForm = document.getElementById("leadForm");
if (leadForm) {
  leadForm.addEventListener("submit", (e) => {
    e.preventDefault();
    const statusEl = document.getElementById("formStatus");
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

    let msg = "پیام از سایت اطلس املاک\n\n";
    msg += "👤 نام: " + name + "\n";
    msg += "📱 شماره: " + phone + "\n";
    if (message) {
      msg += "💬 پیام: " + message + "\n";
    }

    if (statusEl) {
      statusEl.textContent = "کانال ارسال را انتخاب کنید…";
      statusEl.className = "form-status success";
    }

    if (typeof window.openMessageChooser === "function") {
      window.openMessageChooser(null, msg);
    } else {
      // fallback: بله
      const baleUser = (typeof BALE_USERNAME !== "undefined") ? BALE_USERNAME : "Nobody_Mohsen";
      window.open("https://ble.ir/" + baleUser + "?text=" + encodeURIComponent(msg), "_blank");
    }

    setTimeout(() => {
      leadForm.reset();
      if (statusEl) statusEl.textContent = "";
    }, 2000);
  });
}

// --------------------------------------------------------------------- //
// ۱۱. دکمه‌های دسترسی سریع (فروش / رهن / نوع ملک)
// --------------------------------------------------------------------- //
function filterByDealType(dealType) {
  const dealTypeEl = document.getElementById("dealType");
  if (dealTypeEl) dealTypeEl.value = dealType || "";
  document.querySelectorAll(".filter-chip").forEach((c) => {
    c.classList.toggle("active", (c.getAttribute("data-deal") || "") === (dealType || ""));
  });
  if (typeof applyFilters === "function") applyFilters();
  const listings = document.getElementById("listings");
  if (listings) listings.scrollIntoView({ behavior: "smooth" });
}

function filterListings(dealType, query) {
  const dealTypeEl = document.getElementById("dealType");
  const cityInput = document.getElementById("citySearch");
  if (dealTypeEl) dealTypeEl.value = dealType || "";
  if (cityInput) cityInput.value = query || "";
  document.querySelectorAll(".filter-chip").forEach((c) => {
    c.classList.toggle("active", (c.getAttribute("data-deal") || "") === (dealType || ""));
  });
  // نوار جستجو همیشه باز است — فقط مقدار را پر می‌کنیم
  const cityInputFocus = document.getElementById("citySearch");
  if (query && cityInputFocus) {
    cityInputFocus.focus();
  }
  if (typeof applyFilters === "function") applyFilters();
  const listings = document.getElementById("listings");
  if (listings) listings.scrollIntoView({ behavior: "smooth" });
}

document.querySelectorAll(".quick-card[href='#listings']").forEach((card) => {
  card.addEventListener("click", (e) => {
    e.preventDefault();
    const deal = card.getAttribute("data-filter-deal") || "";
    const q = card.getAttribute("data-filter-q") || "";
    filterListings(deal, q);
  });
});



(function initListingsFilter() {
  const chips = document.querySelectorAll(".filter-chip[data-deal]");
  const moreBtn = document.getElementById("filterMoreBtn");
  const advanced = document.getElementById("filterAdvanced");
  const dealTypeEl = document.getElementById("dealType");
  const resetBtn = document.getElementById("filterResetBtn");
  const cityInput = document.getElementById("citySearch");
  const searchBtn = document.getElementById("searchBtn");

  function setActiveChip(deal) {
    chips.forEach((c) => {
      c.classList.toggle("active", (c.getAttribute("data-deal") || "") === deal);
    });
    if (dealTypeEl) dealTypeEl.value = deal;
  }

  chips.forEach((chip) => {
    chip.addEventListener("click", () => {
      const deal = chip.getAttribute("data-deal") || "";
      setActiveChip(deal);
      // وقتی «همه» انتخاب می‌شود، کلمه جستجو هم پاک شود تا به همه آگهی‌ها برگردد
      if (!deal && cityInput) cityInput.value = "";
      if (typeof applyFilters === "function") applyFilters();
    });
  });

  if (moreBtn && advanced) {
    moreBtn.addEventListener("click", () => {
      const open = advanced.classList.toggle("open");
      moreBtn.classList.toggle("open", open);
      moreBtn.textContent = open ? "بستن فیلتر ▴" : "فیلتر بیشتر ▾";
      if (open && cityInput) cityInput.focus();
    });
  }

  if (resetBtn) {
    resetBtn.addEventListener("click", () => {
      setActiveChip("");
      if (cityInput) cityInput.value = "";
      document.querySelectorAll(".filter-chip[data-filter-group], .filter-chip[data-amenity]").forEach((c) => {
        c.classList.remove("active");
      });
      document.querySelectorAll('.filter-chip[data-filter-group][data-value=""]').forEach((c) => c.classList.add("active"));
      if (typeof applyFilters === "function") applyFilters();
    });
  }

  // چیپ‌های متراژ / خواب / قیمت — تک‌انتخابی در هر گروه
  document.querySelectorAll(".filter-chip[data-filter-group]").forEach((chip) => {
    chip.addEventListener("click", () => {
      const group = chip.getAttribute("data-filter-group");
      document.querySelectorAll(`.filter-chip[data-filter-group="${group}"]`).forEach((c) => c.classList.remove("active"));
      chip.classList.add("active");
      if (typeof applyFilters === "function") applyFilters();
    });
  });

  // امکانات — چندانتخابی (toggle)
  document.querySelectorAll(".filter-chip[data-amenity]").forEach((chip) => {
    chip.addEventListener("click", () => {
      chip.classList.toggle("active");
      if (typeof applyFilters === "function") applyFilters();
    });
  });

  if (searchBtn && !searchBtn.dataset.bound) {
    searchBtn.dataset.bound = "1";
    searchBtn.addEventListener("click", () => {
      if (typeof applyFilters === "function") applyFilters();
    });
  }

  if (cityInput) {
    cityInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        if (typeof applyFilters === "function") applyFilters();
      }
    });
  }

  // دکمه/پنل «فیلتر پیشرفته» — روی موبایل جمع‌شده، با کلیک باز می‌شود
  // با بستن پنل: فیلترهای پیشرفته ریست می‌شوند و لیست به حالت پایه برمی‌گردد
  function resetAdvancedFiltersOnly() {
    document.querySelectorAll(".filter-chip[data-filter-group], .filter-chip[data-amenity]").forEach((c) => {
      c.classList.remove("active");
    });
    document.querySelectorAll('.filter-chip[data-filter-group][data-value=""]').forEach((c) => {
      c.classList.add("active");
    });
  }

  const advToggle = document.getElementById("advancedFilterToggle");
  const advPanel = document.getElementById("advancedFilterPanel");
  if (advToggle && advPanel) {
    advToggle.addEventListener("click", () => {
      const open = advPanel.classList.toggle("open");
      advToggle.classList.toggle("open", open);
      const label = advToggle.querySelector(".toggle-label");
      if (label) {
        label.textContent = open
          ? "بستن فیلتر پیشرفته"
          : "فیلتر پیشرفته (متراژ، خواب، قیمت، امکانات)";
      }
      // بسته شدن = ریست متراژ/خواب/قیمت/امکانات + نمایش مجدد آگهی‌ها
      if (!open) {
        resetAdvancedFiltersOnly();
        if (typeof applyFilters === "function") applyFilters();
      }
    });
  }
})();

applyMenuOverrides();
