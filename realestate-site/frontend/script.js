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
  // ۱) پین‌شده‌ها اول (عدد pin_order کوچکتر = اولویت بالاتر)
  // ۲) بعد تاریخ ثبت (جدیدتر بالاتر)
  // ۳) در نهایت کد
  const faToEn = (str) =>
    String(str || "").replace(/[۰-۹]/g, (d) => "۰۱۲۳۴۵۶۷۸۹".indexOf(d))
      .replace(/[٠-٩]/g, (d) => "٠١٢٣٤٥٦٧٨٩".indexOf(d));
  const MONTHS = {
    فروردین: 1, اردیبهشت: 2, خرداد: 3, تیر: 4,
    مرداد: 5, شهریور: 6, مهر: 7, آبان: 8,
    آذر: 9, دی: 10, بهمن: 11, اسفند: 12,
  };
  const parseReg = (s) => {
    let t = faToEn(s).trim();
    // YYYY/MM/DD
    let m = t.match(/^(\d{4})\/(\d{1,2})\/(\d{1,2})(?:\s+(\d{1,2}):(\d{1,2}))?/);
    if (m) {
      const y = +m[1], mo = +m[2], d = +m[3];
      const hh = +(m[4] || 0), mm = +(m[5] || 0);
      return y * 1e10 + mo * 1e8 + d * 1e6 + hh * 1e4 + mm * 100;
    }
    // D/ماه/YYYY  مثل 12/شهریور/1405
    m = t.match(/^(\d{1,2})\/([^\s/]+)\/(\d{4})$/);
    if (m && MONTHS[m[2]]) {
      const d = +m[1], mo = MONTHS[m[2]], y = +m[3];
      return y * 1e10 + mo * 1e8 + d * 1e6;
    }
    // YYYY/ماه/D
    m = t.match(/^(\d{4})\/([^\s/]+)\/(\d{1,2})$/);
    if (m && MONTHS[m[2]]) {
      const y = +m[1], mo = MONTHS[m[2]], d = +m[3];
      return y * 1e10 + mo * 1e8 + d * 1e6;
    }
    return 0;
  };
  const codeNum = (x) => {
    const d = String(x.code || "").replace(/\D/g, "");
    return d ? parseInt(d, 10) : 0;
  };
  const pinOrder = (x) => {
    if (!x || !x.pinned) return 9999;
    const n = Number(x.pin_order);
    return Number.isFinite(n) && n > 0 ? n : 1;
  };
  return (list || []).slice().sort((a, b) => {
    const pa = a && a.pinned ? 1 : 0;
    const pb = b && b.pinned ? 1 : 0;
    if (pa !== pb) return pb - pa; // پین‌شده اول
    if (pa && pb) {
      const oa = pinOrder(a), ob = pinOrder(b);
      if (oa !== ob) return oa - ob; // عدد کوچکتر بالاتر
    }
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

function escapeHtml(str) {
  return String(str || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
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
  const pinBadge = p.pinned
    ? `<span class="pin-tag" title="آگهی پین‌شده" aria-label="پین شده">📌</span>`
    : "";
  const overlay = `
    <div class="card-image-overlay">
      <div class="card-overlay-left">
        <span class="deal-tag ${isPresale(p) ? "presale" : (isSale ? "sale" : "rent")}">${isPresale(p) ? "پیش‌فروش" : (p.deal_type || "آگهی")}</span>
        ${pinBadge}
      </div>
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
  if (!isSaleLike(p)) return null;
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

/** قیمت متری نرمال‌شده به «میلیون تومان» برای فیلتر */
function parsePricePerM2(p) {
  if (!isSaleLike(p)) return null;
  let s = cleanPriceText(p.price_per_m2);
  if (!s || s === "-" || /توافقی/.test(s)) return null;
  const m = String(s).match(/([\d,]+(?:\.\d+)?)/);
  if (!m) return null;
  let num = parseFloat(m[1].replace(/,/g, ""));
  if (!Number.isFinite(num)) return null;
  if (/میلیارد/.test(s)) num = num * 1000; // به میلیون تبدیل شود
  return num;
}

/** رهن نرمال‌شده به «میلیون تومان» برای فیلتر */
function parseRahnMillion(p) {
  if (isSaleLike(p)) return null;
  let s = cleanPriceText(p.rahn);
  if (!s || s === "-" || /توافقی/.test(s)) return null;
  const m = String(s).match(/([\d,]+(?:\.\d+)?)/);
  if (!m) return null;
  let num = parseFloat(m[1].replace(/,/g, ""));
  if (!Number.isFinite(num)) return null;
  if (/میلیارد/.test(s)) num = num * 1000; // 1.5 میلیارد → 1500 میلیون
  // اگر فقط عدد بود و خیلی بزرگ (≥100 و بدون واحد مشخص قبلاً میلیارد فرض می‌شد) همان میلیون فرض می‌شود
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
function isSaleLike(p) {
  return Boolean(
    p && (p.is_presale || p.deal_type === "فروش" || p.deal_type === "پیش‌فروش" || p.deal_type === "پیش فروش")
  );
}

function isPresale(p) {
  return Boolean(
    p && (p.is_presale || p.deal_type === "پیش‌فروش" || p.deal_type === "پیش فروش")
  );
}

function labeledPropertyType(p) {
  const type = (p.property_type || "ملک").trim();
  if (isPresale(p)) return `${type} پیش‌فروش`;
  if (isSaleLike(p)) return `${type} فروشی`;
  return `رهن و اجاره ${type}`;
}

/** بلوک جداگانه فیلدهای پیش‌فروش برای بخش «اطلاعات بیشتر» */
function buildPresaleDetails(p) {
  if (!isPresale(p)) return "";
  const rows = [];
  if (p.presale_delivery) {
    rows.push(`<p class="card-meta card-presale-item">📅 زمان تحویل: <strong>${escapeHtml(p.presale_delivery)}</strong></p>`);
  }
  if (p.presale_payment) {
    rows.push(`<p class="card-meta card-presale-item">💳 نحوه پرداخت: <strong>${escapeHtml(p.presale_payment)}</strong></p>`);
  }
  if (p.presale_stage) {
    rows.push(`<p class="card-meta card-presale-item">🏗 مرحله ساخت: <strong>${escapeHtml(p.presale_stage)}</strong></p>`);
  }
  if (!rows.length) return "";
  return `<div class="card-presale-box">
          <p class="card-presale-title">🏗 مشخصات پیش‌فروش</p>
          ${rows.join("\n          ")}
        </div>`;
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

/** حالت ادمین سبک: ?ig=1 در آدرس */
function isIgAdminMode() {
  try {
    return new URLSearchParams(window.location.search).get("ig") === "1";
  } catch (e) {
    return false;
  }
}

/** کپشن آماده اینستاگرام برای یک آگهی */
function buildInstagramCaption(p) {
  if (!p) return "";
  const title = labeledPropertyType(p);
  const code = p.code ? String(p.code) : "";

  const specs = [];
  if (p.area_m2) specs.push(`${p.area_m2} متر`);
  if (p.rooms) specs.push(`${p.rooms} خواب`);
  if (p.floor) specs.push(`طبقه ${p.floor}`);

  const amenities = [];
  if (p.parking) amenities.push("پارکینگ");
  if (p.elevator) amenities.push("آسانسور");
  if (p.storage) amenities.push("انباری");

  const lines = [];
  lines.push(`🏠 ${title}${code ? " · کد " + code : ""}`);
  lines.push("");
  if (p.address) lines.push(`📍 ${String(p.address).trim()}`);
  if (specs.length) lines.push(`📐 ${specs.join(" · ")}`);

  if (p.deal_type === "فروش") {
    const total = formatSaleTotal(p.price_total);
    if (total) lines.push(`💰 ${total}`);
    const m2 = formatPricePerM2(p.price_per_m2);
    if (m2) lines.push(`قیمت متری: ${m2}`);
  } else {
    const rentBits = [];
    if (p.rahn && p.rahn !== "-") {
      const r = formatRentPart(p.rahn);
      if (r) rentBits.push(`رهن ${r}`);
    }
    if (p.ejare && p.ejare !== "-") {
      const e = formatRentPart(p.ejare);
      if (e) rentBits.push(`اجاره ${e}`);
    }
    if (rentBits.length) lines.push(`💰 ${rentBits.join(" · ")}`);
  }

  if (amenities.length) {
    lines.push("");
    lines.push(amenities.join(" · "));
  }
  if (p.documents) lines.push(`مدارک: ${String(p.documents).trim()}`);

  lines.push("");
  lines.push("📞 تماس با دفتر اطلس: 0910 694 3220");

  lines.push("🔗 جزئیات کامل:");
  lines.push(propertyPageUrl(p));

  lines.push("");
  // هشتگ‌ها: ثابت + نوع معامله
  const tags = ["#املاک_باغستان", "#خادم‌آباد", "#شهریار", "#اطلس_املاک", "#فایل_روز"];
  if (p.deal_type === "فروش") {
    tags.push("#آپارتمان_فروشی", "#خرید_آپارتمان_شهریار", "#خرید_ملک_شهریار");
  } else {
    tags.push("#رهن_اجاره", "#رهن_اجاره_شهریار", "#اجاره_آپارتمان");
  }
  if ((p.property_type || "").includes("زمین")) tags.push("#زمین_فروشی");
  if ((p.property_type || "").includes("باغ")) tags.push("#باغ_ویلا", "#باغچه");
  lines.push(tags.join(" "));

  return lines.join("\n");
}

/** متن کوتاه روی تصویر ری‌لز (۲–۴ خط) */
function buildReelOverlayText(p) {
  if (!p) return "";
  const lines = [];
  const code = p.code ? String(p.code) : "";
  lines.push(code ? `کد ${code}` : labeledPropertyType(p));
  if (p.address) {
    const addr = truncateAddress(p.address) || String(p.address).trim();
    if (addr) lines.push(addr);
  }
  const specs = [];
  if (p.area_m2) specs.push(`${p.area_m2} متر`);
  if (p.rooms) specs.push(`${p.rooms} خواب`);
  if (specs.length) lines.push(specs.join(" · "));
  if (p.deal_type === "فروش") {
    const total = formatSaleTotal(p.price_total);
    if (total) lines.push(total);
  } else {
    const rentBits = [];
    if (p.rahn && p.rahn !== "-") {
      const r = formatRentPart(p.rahn);
      if (r) rentBits.push(`رهن ${r}`);
    }
    if (p.ejare && p.ejare !== "-") {
      const e = formatRentPart(p.ejare);
      if (e) rentBits.push(`اجاره ${e}`);
    }
    if (rentBits.length) lines.push(rentBits.join(" · "));
  }
  return lines.join("\n");
}

/** لینک صفحه آگهی */
function propertyPageUrl(p) {
  if (!p) return "https://atlas-amlak.ir/";
  try {
    if (p.is_local || p.deal_type === "محله‌گردی") {
      return `${window.location.origin}/mahale/${encodeURIComponent(p.slug || p.code || "")}.html`;
    }
    return `${window.location.origin}/agahi/${encodeURIComponent(listingSlug(p))}.html`;
  } catch (e) {
    return "https://atlas-amlak.ir/";
  }
}


/** تشخیص لینک مسیریابی / اینستاگرام از فیلد «لینک» محله‌گردی */
function classifyLocalLink(url) {
  const u = String(url || "").trim().toLowerCase();
  if (!u) return null;
  if (u.includes("instagram.com") || u.includes("instagr.am") || u.startsWith("@")) {
    return "instagram";
  }
  if (
    u.includes("maps.google") ||
    u.includes("google.com/maps") ||
    u.includes("goo.gl/maps") ||
    u.includes("maps.app.goo.gl") ||
    u.includes("neshan.org") ||
    u.includes("balad.ir") ||
    u.includes("waze.com")
  ) {
    return "maps";
  }
  return "other";
}

function normalizeInstagramUrl(url) {
  let u = String(url || "").trim();
  if (u.startsWith("@")) u = "https://www.instagram.com/" + u.slice(1).replace(/\/$/, "");
  if (!/^https?:\/\//i.test(u)) u = "https://" + u.replace(/^\/+/, "");
  return u;
}

/** کارت محله‌گردی — همان ظاهر کارت‌های آگهی (یکدست با سایت) */
function localGuideCard(p) {
  const title = escapeHtml(p.title || p.property_type || "محله‌گردی");
  const category = escapeHtml(p.category || p.property_type || "");
  const shortAddress = truncateAddress(p.address);
  const text = p.description ? escapeHtml(p.description) : "";
  const dateLine = p.registered_at
    ? `<p class="card-date">📅 ثبت: ${escapeHtml(p.registered_at)}</p>`
    : "";
  const hoursLine = p.hours
    ? `<p class="card-meta card-hours">🕐 ${escapeHtml(p.hours)}</p>`
    : "";
  const codeBadge = p.code ? `<span class="card-code">کد ${escapeHtml(p.code)}</span>` : "";

  const icon = "🗺️";
  const overlay = `
    <div class="card-image-overlay">
      <div class="card-overlay-left">
        <span class="deal-tag sale deal-tag-local">محله‌گردی</span>
      </div>
      <button class="share-btn share-btn-card" data-code="${escapeHtml(p.code || "")}" type="button" aria-label="اشتراک‌گذاری">🔗 اشتراک</button>
    </div>`;
  let imageBlock;
  if (p.image) {
    imageBlock = `
      <div class="card-image-wrap">
        <img class="card-image" src="${escapeHtml(p.image)}" alt="${title}"
             loading="lazy" decoding="async" width="400" height="280"
             onerror="this.closest('.card-image-wrap').classList.add('no-image'); this.remove();">
        <div class="card-image-fallback"><div class="fallback-icon-circle">${icon}</div><span class="fallback-caption">بدون عکس</span></div>
        ${overlay}
      </div>`;
  } else {
    imageBlock = `
      <div class="card-image-wrap no-image">
        <div class="card-image-fallback"><div class="fallback-icon-circle">${icon}</div><span class="fallback-caption">بدون عکس</span></div>
        ${overlay}
      </div>`;
  }

  // مثل کارت آگهی: call = برنزی primary، msg = سرمه‌ای secondary
  const actions = [];
  if (p.phone) {
    const tel = String(p.phone).replace(/[^\d+۰-۹]/g, "");
    actions.push(
      `<a class="agent-call-btn agent-btn-primary" href="tel:${escapeHtml(tel)}">📞 تماس</a>`
    );
  }
  const linkKind = classifyLocalLink(p.link);
  if (p.link) {
    if (linkKind === "instagram") {
      actions.push(
        `<a class="agent-msg-btn agent-btn-secondary" href="${escapeHtml(normalizeInstagramUrl(p.link))}" target="_blank" rel="noopener">📸 اینستاگرام</a>`
      );
    } else if (linkKind === "maps") {
      actions.push(
        `<a class="agent-msg-btn agent-btn-secondary" href="${escapeHtml(p.link)}" target="_blank" rel="noopener">🗺️ مسیریابی</a>`
      );
    } else {
      actions.push(
        `<a class="agent-msg-btn agent-btn-secondary" href="${escapeHtml(p.link)}" target="_blank" rel="noopener">🔗 لینک</a>`
      );
    }
  }
  const actionsHtml = actions.length
    ? `<div class="card-actions">${actions.join("\n      ")}</div>`
    : "";

  const phoneText = p.phone
    ? `<p class="card-meta card-phone-text">📞 <span dir="ltr">${escapeHtml(String(p.phone).trim())}</span></p>`
    : "";
  // ساعت کاری کنار تلفن، داخل بخش توضیحات
  const notesInner = [
    text ? `<p class="card-meta card-notes">📝 ${text}</p>` : "",
    hoursLine,
    phoneText,
  ].filter(Boolean).join("\n          ");
  const notesBlock = notesInner
    ? `<div class="card-details-notes">${notesInner}</div>`
    : "";
  const moreBtn = notesInner
    ? `<button type="button" class="card-more-btn" aria-expanded="false">اطلاعات بیشتر</button>`
    : "";
  // دسته همیشه بالای دکمه
  const alwaysVisible = category
    ? `<p class="card-meta card-local-cat">🏷️ ${category}</p>`
    : "";
  const tailBlock = dateLine
    ? `<div class="card-details-tail">${dateLine}</div>`
    : "";

  return `
    <div style="width: 100%;">
      <article class="card card-sale card-local" id="card-${escapeHtml(p.code || "")}" data-code="${escapeHtml(p.code || "")}" data-local="1">
        ${imageBlock}
        <div class="card-body">
          <h3 class="card-title">
            <a href="/mahale/${escapeHtml(p.slug || p.code || "")}.html" style="color:inherit;text-decoration:none;">
              ${title} ${codeBadge}
            </a>
          </h3>
          ${shortAddress ? `<p class="card-meta card-address">📍 ${escapeHtml(shortAddress)}</p>` : ""}
          ${alwaysVisible}
          ${moreBtn}
          ${notesBlock}
          ${tailBlock}
          ${actionsHtml}
        </div>
      </article>
    </div>
  `;
}


/** اسلاگ لاتین نوع ملک برای URL زیبای آگهی (بدون رقم) */
const PROPERTY_TYPE_SLUGS = {
  "آپارتمان": "aparteman",
  "ویلا": "villa",
  "ویلایی": "villa",
  "خانه ویلایی": "villa",
  "باغ ویلا": "bagh-villa",
  "باغ": "bagh",
  "باغچه": "baghcheh",
  "زمین": "zamin",
  "کلنگی": "kolangi",
  "تجاری": "tejari",
  "مغازه": "maghaze",
  "اداری": "edari",
};
function codeToAlpha(code) {
  const s = String(code || "");
  const digits = (s.match(/\d/g) || []).join("");
  const letters = (s.match(/[a-zA-Z]/g) || []).join("").toLowerCase();
  let body = "x";
  if (digits) {
    let n = parseInt(digits, 10);
    if (n <= 0) body = "a";
    else {
      const chars = [];
      while (n > 0) {
        chars.push(String.fromCharCode(97 + (n % 26)));
        n = Math.floor(n / 26);
      }
      body = chars.reverse().join("");
    }
  } else if (letters) body = letters;
  if (letters && digits) return letters + body;
  return body || "x";
}
function listingSlug(p) {
  if (p.slug) {
    const s = String(p.slug).toLowerCase().replace(/\s+/g, "-").replace(/[^a-z\-]/g, "").replace(/-+/g, "-").replace(/^-|-$/g, "");
    if (s) return s;
  }
  const typeSlug = PROPERTY_TYPE_SLUGS[p.property_type] || "melk";
  return typeSlug + "-" + codeToAlpha(p.code);
}

function propertyCard(p) {
  if (p.is_local || p.deal_type === "محله‌گردی") {
    return localGuideCard(p);
  }

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
  const priceMain = isSaleLike(p)
    ? `<p class="card-price">💰 ${saleTotal || "توافقی"}</p>`
    : `<p class="card-price">${formatRentPrice(p)}</p>`;
  const priceM2Line = (isSaleLike(p) && saleM2)
    ? `<p class="card-meta card-price-m2">قیمت متری: ${saleM2}</p>`
    : "";
  const negotiateLine = isSaleLike(p)
    ? `<p class="card-meta card-negotiate">💬 قیمت اعلامی مالک است؛ جای مذاکره دارد</p>`
    : "";

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
  const igTools = isIgAdminMode()
    ? `<div class="ig-admin-tools">
        <button type="button" class="ig-caption-btn" data-code="${p.code || ""}" data-ig-action="caption">📋 کپی کپشن اینستا</button>
        <button type="button" class="ig-caption-btn ig-caption-btn-secondary" data-code="${p.code || ""}" data-ig-action="link">🔗 کپی لینک آگهی</button>
        <button type="button" class="ig-caption-btn ig-caption-btn-secondary" data-code="${p.code || ""}" data-ig-action="reel">🎬 کپی متن ری‌لز</button>
      </div>`
    : "";
  const agentActions = `
    <div class="card-actions">
      <a class="agent-call-btn agent-btn-primary" href="tel:${officePhone}">📞 مشاوره / بازدید</a>
      <a class="agent-msg-btn agent-btn-secondary" href="https://ble.ir/${baleUser}?text=${baleMsg}" target="_blank" rel="noopener">💬 پیام</a>
    </div>
    ${igTools}`;

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
  const imageBlock = buildCardImage(p, isSaleLike(p));

  const notesLine = p.description
    ? `<p class="card-meta card-notes">📝 ${escapeHtml(p.description)}</p>`
    : "";

  const presaleBlock = buildPresaleDetails(p);

  // جزئیات میانی (موبایل جمع می‌شود؛ دسکتاپ باز)
  const midBits = [
    specsLine,
    extras.length ? `<p class="card-meta card-extras">${extras.join(" | ")}</p>` : "",
    p.documents ? `<p class="card-meta card-docs">📄 مدارک: ${escapeHtml(p.documents)}</p>` : "",
    priceM2Line,
    presaleBlock,
  ].filter(Boolean).join("\n          ");

  // توضیحات → بعد «ثبت‌شده توسط» و تاریخ
  const midBlock = midBits ? `<div class="card-details-mid">${midBits}</div>` : "";
  const notesBlock = notesLine ? `<div class="card-details-notes">${notesLine}</div>` : "";
  const tailBlock = (agentLine || dateLine)
    ? `<div class="card-details-tail">${[agentLine, dateLine].filter(Boolean).join("\n          ")}</div>`
    : "";

  // ترتیب نمایش: mid → more → notes (توضیحات) → tail (مشاور/تاریخ)
  const needsMore = Boolean(midBits || notesLine);
  const moreBtn = needsMore
    ? `<button type="button" class="card-more-btn" aria-expanded="false">اطلاعات بیشتر</button>`
    : "";
  const expandedClass = isSingleMode ? " is-expanded" : "";

  return `
    <div style="${wrapperStyle}">
      ${backBanner}
      <article class="card ${isPresale(p) ? "card-presale" : (isSaleLike(p) ? "card-sale" : "card-rent")}${expandedClass}" id="card-${p.code || ""}" data-code="${p.code || ""}">
        ${imageBlock}
        <div class="card-body">
          <h3 class="card-title">${titleType} ${titleCode}</h3>
          ${shortAddress ? `<p class="card-meta card-address">📍 ${shortAddress}</p>` : ""}
          ${priceMain}
          ${negotiateLine}
          ${moreBtn}
          ${midBlock}
          ${notesBlock}
          ${tailBlock}
          ${agentActions}
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
    const pageUrl = (found.is_local || found.deal_type === "محله‌گردی")
      ? `${window.location.origin}/mahale/${encodeURIComponent(found.slug || found.code)}.html`
      : `${window.location.origin}/agahi/${encodeURIComponent(listingSlug(found))}.html`;

    // عنوان و توضیح مخصوص همین آگهی (سئو + اشتراک لینک)
    const specsBits = [];
    if (found.area_m2) specsBits.push(found.area_m2 + " متر");
    if (found.rooms) specsBits.push(found.rooms + " خواب");
    if (found.floor) specsBits.push("طبقه " + found.floor);
    const priceShort = found.deal_type === "فروش"
      ? (formatSaleTotal(found.price_total) || "توافقی")
      : ([formatRentPart(found.rahn), formatRentPart(found.ejare)].filter(Boolean).join(" | ") || "توافقی");
    const titleText = `${label} کد ${targetCode} | اطلس املاک`;
    const descParts = [`${label} کد ${targetCode}`];
    if (addr) descParts.push(addr);
    if (specsBits.length) descParts.push(specsBits.join(" · "));
    if (priceShort) descParts.push(priceShort);
    descParts.push("مشاهده جزئیات و تماس با دفتر اطلس املاک خادم‌آباد و باغستان.");
    const descText = descParts.join(" — ");

    document.title = titleText;
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
    setMeta("property", "og:title", titleText);
    setMeta("property", "og:description", descText);
    setMeta("property", "og:url", pageUrl);
    setMeta("property", "og:type", "website");
    // آدرس مطلق عکس (مسیر نسبی در اشتراک شبکه‌های اجتماعی کار نمی‌کند)
    let ogImage = found.image || "https://atlas-amlak.ir/assets/logo.png";
    if (ogImage && !/^https?:\/\//i.test(ogImage)) {
      try {
        ogImage = new URL(ogImage, window.location.origin + window.location.pathname).href;
      } catch (e) {
        ogImage = "https://atlas-amlak.ir/assets/logo.png";
      }
    }
    setMeta("property", "og:image", ogImage);
    setMeta("name", "twitter:title", titleText);
    setMeta("name", "twitter:description", descText);
    setMeta("name", "twitter:image", ogImage);

    let canonical = document.querySelector('link[rel="canonical"]');
    if (!canonical) {
      canonical = document.createElement("link");
      canonical.rel = "canonical";
      document.head.appendChild(canonical);
    }
    canonical.href = pageUrl;

    // JSON-LD آگهی (RealEstateListing + BreadcrumbList)
    const oldLd = document.getElementById("single-ad-jsonld");
    if (oldLd) oldLd.remove();
    const priceForLd = found.deal_type === "فروش"
      ? formatSaleTotal(found.price_total)
      : [formatRentPart(found.rahn), formatRentPart(found.ejare)].filter(Boolean).join(" / ");
    const listingLd = {
      "@type": "RealEstateListing",
      "@id": pageUrl + "#listing",
      "name": `${label} کد ${targetCode}`,
      "description": descText,
      "url": pageUrl,
      "address": {
        "@type": "PostalAddress",
        "streetAddress": found.address || addr,
        "addressLocality": "خادم‌آباد",
        "addressRegion": "تهران",
        "addressCountry": "IR"
      },
      "seller": {
        "@type": "RealEstateAgent",
        "name": "گروه مشاورین املاک اطلس",
        "url": "https://atlas-amlak.ir/",
        "telephone": "+989106943220"
      }
    };
    if (found.registered_at) listingLd.datePosted = found.registered_at;
    if (ogImage) listingLd.image = ogImage;
    const areaN = parseAreaM2(found);
    if (areaN) listingLd.floorSize = { "@type": "QuantitativeValue", "value": areaN, "unitCode": "MTK" };
    const roomsN = parseRooms(found);
    if (roomsN) listingLd.numberOfRooms = roomsN;
    const extraProps = [];
    if (found.parking) extraProps.push({ "@type": "PropertyValue", "name": "پارکینگ", "value": "دارد" });
    if (found.elevator) extraProps.push({ "@type": "PropertyValue", "name": "آسانسور", "value": "دارد" });
    if (found.storage) extraProps.push({ "@type": "PropertyValue", "name": "انباری", "value": "دارد" });
    if (found.floor) extraProps.push({ "@type": "PropertyValue", "name": "طبقه", "value": String(found.floor) });
    if (found.property_type) extraProps.push({ "@type": "PropertyValue", "name": "نوع ملک", "value": String(found.property_type) });
    if (found.deal_type) extraProps.push({ "@type": "PropertyValue", "name": "نوع معامله", "value": String(found.deal_type) });
    if (extraProps.length) listingLd.additionalProperty = extraProps;
    if (priceForLd) {
      listingLd.offers = {
        "@type": "Offer",
        "priceCurrency": "IRR",
        "description": priceForLd,
        "availability": "https://schema.org/InStock",
        "url": pageUrl
      };
    }
    const breadcrumbLd = {
      "@type": "BreadcrumbList",
      "itemListElement": [
        { "@type": "ListItem", "position": 1, "name": "صفحه اصلی", "item": "https://atlas-amlak.ir/" },
        { "@type": "ListItem", "position": 2, "name": `${label} کد ${targetCode}`, "item": pageUrl }
      ]
    };
    const ld = { "@context": "https://schema.org", "@graph": [listingLd, breadcrumbLd] };
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
  const listings = allProperties.filter((p) => !p.is_local && p.deal_type !== "محله‌گردی");
  // بدون ذکر محله‌گردی در نوار بالا
  statsText.textContent = `🏠 ${listings.length} کارت فعال خرید | رهن و اجاره`;
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
    if (typeof window.resetAdvancedFilterUI === "function") window.resetAdvancedFilterUI();
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

  const ptypeVal = (document.querySelector('.filter-chip[data-filter-group="ptype"].active') || {}).getAttribute?.("data-value") || "";
  const areaVal = (document.querySelector('.filter-chip[data-filter-group="area"].active') || {}).getAttribute?.("data-value") || "";
  const roomsVal = (document.querySelector('.filter-chip[data-filter-group="rooms"].active') || {}).getAttribute?.("data-value") || "";
  const priceVal = (document.querySelector('.filter-chip[data-filter-group="price"].active') || {}).getAttribute?.("data-value") || "";
  const pricem2Val = (document.querySelector('.filter-chip[data-filter-group="pricem2"].active') || {}).getAttribute?.("data-value") || "";
  const rahnVal = (document.querySelector('.filter-chip[data-filter-group="rahn"].active') || {}).getAttribute?.("data-value") || "";
  const needParking = isAmenityOn("parking");
  const needElevator = isAmenityOn("elevator");
  const needStorage = isAmenityOn("storage");

  let filtered = allProperties;
  // فیلتر نوع: همه = مخلوط؛ فروش بدون پیش‌فروش؛ پیش‌فروش و محله‌گردی جدا
  if (dealType) {
    if (dealType === "فروش") {
      filtered = filtered.filter((p) => isSaleLike(p) && !isPresale(p));
    } else if (dealType === "پیش‌فروش" || dealType === "پیش فروش") {
      filtered = filtered.filter((p) => isPresale(p));
    } else if (dealType === "محله‌گردی") {
      filtered = filtered.filter((p) => p.is_local || p.deal_type === "محله‌گردی");
    } else if (dealType === "رهن و اجاره") {
      filtered = filtered.filter(
        (p) => !p.is_local && p.deal_type === "رهن و اجاره"
      );
    } else {
      filtered = filtered.filter((p) => p.deal_type === dealType);
    }
  }

  // نوع ملک — آپارتمان/ویلایی/باغ/باغچه (بر اساس همون slug نوع ملک)
  if (ptypeVal) {
    filtered = filtered.filter((p) => {
      if (p.is_local || p.deal_type === "محله‌گردی") return false;
      const slug = PROPERTY_TYPE_SLUGS[(p.property_type || "").trim()] || "";
      if (ptypeVal === "bagh") return slug === "bagh" || slug === "bagh-villa";
      return slug === ptypeVal;
    });
  }

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
      if (p.is_local || p.deal_type === "محله‌گردی") {
        const hay = [p.title, p.category, p.property_type, p.address, p.description, p.code]
          .map((x) => String(x || ""))
          .join(" ");
        return hay.includes(keyword);
      }
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
      if (p.is_local || p.deal_type === "محله‌گردی") return false;
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
      if (p.is_local || p.deal_type === "محله‌گردی") return false;
      const r = parseRooms(p);
      if (roomsVal === "3+") return r >= 3;
      return r === parseInt(roomsVal, 10);
    });
  }

  // بودجه خرید / قیمت کل (میلیارد) — فروش و پیش‌فروش را هم شامل می‌شود
  if (priceVal && dealType !== "رهن و اجاره") {
    filtered = filtered.filter((p) => {
      if (p.is_local || p.deal_type === "محله‌گردی") return false;
      if (!isSaleLike(p)) return false;
      const bil = parseSalePriceBillion(p);
      if (bil == null) return false;
      if (priceVal === "0-5") return bil < 5;
      if (priceVal === "5-8") return bil >= 5 && bil < 8;
      if (priceVal === "8-11") return bil >= 8 && bil < 11;
      if (priceVal === "11+") return bil >= 11;
      return true;
    });
  }

  // قیمت متری (میلیون تومان) — فروش و پیش‌فروش
  if (pricem2Val && dealType !== "رهن و اجاره") {
    filtered = filtered.filter((p) => {
      if (p.is_local || p.deal_type === "محله‌گردی") return false;
      if (!isSaleLike(p)) return false;
      const m2p = parsePricePerM2(p);
      if (m2p == null) return false;
      if (pricem2Val === "0-50") return m2p < 50;
      if (pricem2Val === "50-80") return m2p >= 50 && m2p < 80;
      if (pricem2Val === "80-120") return m2p >= 80 && m2p < 120;
      if (pricem2Val === "120+") return m2p >= 120;
      return true;
    });
  }

  // مبلغ رهن (میلیون تومان) — فقط فایل‌های رهن و اجاره
  if (rahnVal && dealType !== "فروش") {
    filtered = filtered.filter((p) => {
      if (p.is_local || p.deal_type === "محله‌گردی") return false;
      if (p.deal_type === "فروش") return false;
      const mil = parseRahnMillion(p);
      if (mil == null) return false;
      if (rahnVal === "0-200") return mil < 200;
      if (rahnVal === "200-500") return mil >= 200 && mil < 500;
      if (rahnVal === "500-1000") return mil >= 500 && mil < 1000;
      if (rahnVal === "1000+") return mil >= 1000;
      return true;
    });
  }

  // امکانات فقط برای آگهی ملکی معنا دارد
  if (needParking) filtered = filtered.filter((p) => !p.is_local && p.parking);
  if (needElevator) filtered = filtered.filter((p) => !p.is_local && p.elevator);
  if (needStorage) filtered = filtered.filter((p) => !p.is_local && p.storage);

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

  // لینک ثابت صفحه آگهی — برای محله‌گردی صفحه استاتیک mahale
  const isLocal = p.is_local || p.deal_type === "محله‌گردی";
  const localSlug = (p.slug || p.code || "").toString();
  const shareUrl = isLocal
    ? `${window.location.origin}/mahale/${encodeURIComponent(localSlug)}.html`
    : `${window.location.origin}/agahi/${encodeURIComponent(listingSlug(p))}.html`;
  const extras = buildExtras(p);
  const label = isLocal
    ? (p.title || p.category || "محله‌گردی")
    : labeledPropertyType(p);
  const priceText = isLocal
    ? ""
    : (p.deal_type === "فروش"
      ? `💰 قیمت: ${formatSaleTotal(p.price_total) || "توافقی"}`
      : formatRentPrice(p));

  const specsParts = isLocal
    ? [p.category || ""].filter(Boolean)
    : [
        p.area_m2 ? p.area_m2 + " متر" : "",
        p.rooms ? p.rooms + " خواب" : "",
        p.floor ? "طبقه " + p.floor : ""
      ].filter(Boolean);
  const m2Share = formatPricePerM2(p.price_per_m2);
  const priceExtra = (!isLocal && p.deal_type === "فروش" && m2Share) ? `\n📏 قیمت متری: ${m2Share}` : "";
  const shortAddr = truncateAddress(p.address) || "خادم‌آباد";
  const shareText = isLocal
    ? `📍 محله‌گردی · ${label}${p.code ? " · کد " + p.code : ""}

📍 ${shortAddr}
${p.category ? "🏷️ " + p.category + "\n" : ""}${p.description ? "📝 " + p.description + "\n" : ""}
🔗 مشاهده:
${shareUrl}

🌐 atlas-amlak.ir
گروه مشاورین املاک اطلس — خادم‌آباد و باغستان`
    : `🏠 ${label} · کد ${p.code}

📍 ${shortAddr}
📐 ${specsParts.join(" · ")}${priceExtra}
${extras.length ? "✨ " + extras.join(" · ") + "\n" : ""}${priceText}

📞 تماس با دفتر اطلس: ۰۹۱۰۶۹۴۳۲۲۰

🔗 مشاهده آگهی:
${shareUrl}

🌐 atlas-amlak.ir
گروه مشاورین املاک اطلس — خادم‌آباد و باغستان`;

  const smsText = isLocal ? shareText : buildSmsText(p);

  const modalHtml = `
    <div id="shareModal" style="position:fixed;inset:0;z-index:9999;background:rgba(32,28,21,0.55);backdrop-filter:blur(5px);display:flex;align-items:center;justify-content:center;padding:16px;">
      <div style="background:#FFFCFA;border:1px solid #E8DFD0;border-radius:20px;width:100%;max-width:380px;padding:24px;text-align:center;box-shadow:0 16px 40px rgba(32,28,21,0.2);">
        <h3 style="margin:0 0 6px;color:#201C15;font-size:1.2rem;font-weight:800;">اشتراک‌گذاری آگهی</h3>
        <p style="margin:0 0 18px;color:#6B6358;font-size:0.9rem;">کد ${p.code || "—"} · ${label}</p>

        <div style="display:flex;flex-direction:column;gap:11px;">
          <button id="modalNativeShareBtn" type="button" style="background:#201C15;color:#FFFCFA;border:none;padding:15px 14px;border-radius:12px;font-weight:700;font-size:1.02rem;cursor:pointer;line-height:1.35;">
            📤 اشتراک آگهی از طریق برنامه‌ها
          </button>
          <button id="modalLinkBtn" type="button" style="background:#FFFCFA;color:#201C15;border:1px solid #D4C4A8;padding:14px;border-radius:12px;font-weight:700;font-size:0.98rem;cursor:pointer;">
            🔗 کپی لینک آگهی
          </button>
          <button id="modalTextBtn" type="button" style="background:#FFFCFA;color:#201C15;border:1px solid #D4C4A8;padding:14px;border-radius:12px;font-weight:700;font-size:0.98rem;cursor:pointer;">
            📋 کپی متن آگهی
          </button>
          <button id="modalSmsBtn" type="button" style="background:#EFF6FF;color:#1E3A8A;border:1px solid #93C5FD;padding:14px;border-radius:12px;font-weight:700;font-size:0.98rem;cursor:pointer;">
            📱 کپی متن پیامک
          </button>
        </div>

        <button id="modalCloseBtn" type="button" style="background:transparent;border:none;color:#9A9080;font-size:0.9rem;margin-top:16px;cursor:pointer;">
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
    btn.innerHTML = "⏳ در حال آماده‌سازی عکس و متن...";
    btn.disabled = true;
    try {
      // اسکرین‌شات کارت (بدون دکمه‌های تماس/پیام + ریبون atlas-amlak.ir)
      const canvas = await captureCardScreenshot(p);
      const blob = await canvasToBlob(canvas);
      if (!blob) throw new Error("blob empty");

      const file = new File([blob], "card-" + (p.code || "property") + ".jpg", {
        type: "image/jpeg",
        lastModified: Date.now(),
      });

      // ۱) اولویت: عکس + متن با هم
      const withText = {
        title: label + " · کد " + p.code + " | اطلس املاک",
        text: shareText,
        files: [file],
      };
      if (navigator.canShare && navigator.canShare(withText)) {
        try {
          await navigator.share(withText);
          showCopySuccess(shareBtn, "✅ عکس و متن اشتراک شد");
          closeModal();
          return;
        } catch (e) {
          if (e && e.name === "AbortError") {
            btn.innerHTML = originalLabel;
            btn.disabled = false;
            return;
          }
        }
      }

      // ۲) بعضی اپ‌ها فقط فایل را قبول می‌کنند — عکس share + متن کپی
      const filesOnly = { files: [file] };
      if (navigator.canShare && navigator.canShare(filesOnly)) {
        try {
          await navigator.share(filesOnly);
          forceCopyText(shareText);
          showCopySuccess(shareBtn, "✅ عکس اشتراک شد · متن کپی شد");
          closeModal();
          return;
        } catch (e) {
          if (e && e.name === "AbortError") {
            btn.innerHTML = originalLabel;
            btn.disabled = false;
            return;
          }
        }
      }

      // ۳) اگر اشتراک فایل پشتیبانی نشد: دانلود عکس + کپی متن
      forceCopyText(shareText);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "card-" + (p.code || "property") + ".jpg";
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 4000);
      showCopySuccess(shareBtn, "🖼️ عکس دانلود شد · متن کپی شد");
      closeModal();
    } catch (err) {
      if (err && err.name === "AbortError") {
        btn.innerHTML = originalLabel;
        btn.disabled = false;
        return;
      }
      console.error("اشتراک عکس ناموفق:", err);
      // آخرین fallback: فقط متن
      try {
        if (navigator.share) {
          await navigator.share({
            title: label + " · کد " + p.code + " | اطلس املاک",
            text: shareText,
            url: shareUrl,
          });
          showCopySuccess(shareBtn, "✅ متن اشتراک شد");
          closeModal();
          return;
        }
      } catch (e2) {
        if (e2 && e2.name === "AbortError") {
          btn.innerHTML = originalLabel;
          btn.disabled = false;
          return;
        }
      }
      forceCopyText(shareText);
      showCopySuccess(shareBtn, "📋 متن کپی شد");
      closeModal();
    }
  });

  document.getElementById("modalLinkBtn").addEventListener("click", () => {
    forceCopyText(shareUrl);
    showCopySuccess(shareBtn, "🔗 لینک کپی شد");
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
  const moreBtn = e.target.closest(".card-more-btn");
  if (moreBtn) {
    e.preventDefault();
    const card = moreBtn.closest(".card");
    if (!card) return;
    // موقعیت دکمه در صفحه ثابت بماند تا هنگام باز/بسته پرش نکند
    const yBefore = moreBtn.getBoundingClientRect().top;
    const open = card.classList.toggle("is-expanded");
    moreBtn.setAttribute("aria-expanded", open ? "true" : "false");
    moreBtn.textContent = open ? "بستن اطلاعات" : "اطلاعات بیشتر";
    requestAnimationFrame(() => {
      const yAfter = moreBtn.getBoundingClientRect().top;
      const delta = yAfter - yBefore;
      if (delta) window.scrollBy(0, delta);
    });
    return;
  }
});

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

document.addEventListener("click", async (e) => {
  const igBtn = e.target.closest(".ig-caption-btn");
  if (!igBtn) return;
  e.preventDefault();
  const code = igBtn.getAttribute("data-code");
  if (!code) return;
  const p = allProperties.find((item) => String(item.code) === String(code));
  if (!p) return;
  const action = igBtn.getAttribute("data-ig-action") || "caption";
  let text = "";
  let okMsg = "✅ کپی شد";
  if (action === "link") {
    text = propertyPageUrl(p);
    okMsg = "✅ لینک کپی شد";
  } else if (action === "reel") {
    text = buildReelOverlayText(p);
    okMsg = "✅ متن ری‌لز کپی شد";
  } else {
    text = buildInstagramCaption(p);
    okMsg = "✅ کپشن کپی شد";
  }
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(text);
    } else {
      forceCopyText(text);
    }
    showCopySuccess(igBtn, okMsg);
  } catch (err) {
    forceCopyText(text);
    showCopySuccess(igBtn, okMsg);
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
  const citySearchClear = document.getElementById("citySearchClear");
  const searchBtn = document.getElementById("searchBtn");

  // --- شمارنده‌ی فیلترهای فعال: روی دکمه «فیلتر پیشرفته» (فقط پیشرفته‌ها)
  // و روی دکمه «پاک همه» (پیشرفته + نوع معامله + متن جستجو) نشان داده می‌شود
  // تا کاربر همیشه دقیقاً ببیند چند فیلتر روشن است و پاک‌کردن چه اثری دارد. ---
  function getActiveFilterCounts() {
    const advancedCount =
      document.querySelectorAll('.filter-chip[data-filter-group].active:not([data-value=""])').length +
      document.querySelectorAll(".filter-chip[data-amenity].active").length;
    const dealActive = document.querySelector('.filter-chip[data-deal].active:not([data-deal=""])');
    const searchActive = cityInput && cityInput.value.trim() !== "";
    const totalCount = advancedCount + (dealActive ? 1 : 0) + (searchActive ? 1 : 0);
    return { advancedCount, totalCount };
  }

  function updateFilterBadges() {
    const { advancedCount, totalCount } = getActiveFilterCounts();

    const advBadge = document.getElementById("advFilterBadge");
    if (advBadge) {
      advBadge.textContent = String(advancedCount);
      advBadge.hidden = advancedCount === 0;
    }

    if (resetBtn) {
      resetBtn.classList.toggle("is-active", totalCount > 0);
      resetBtn.classList.toggle("is-empty", totalCount === 0);
      const label = resetBtn.querySelector(".filter-clear-label");
      if (label) label.textContent = totalCount > 0 ? `بازنشانی (${totalCount})` : "بازنشانی";
    }

    if (citySearchClear) citySearchClear.hidden = !cityInput || cityInput.value.trim() === "";
  }
  window.updateFilterBadges = updateFilterBadges;

  // --- بازنشانی کامل فیلتر پیشرفته: مقدار چیپ‌ها + برچسب انتخابی هر ردیف +
  // آکاردئون بازشده + پنل باز + متن دکمه «فیلتر پیشرفته» — همه با هم،
  // نه فقط مقدار چیپ‌ها (که قبلاً باعث می‌شد بعد از «پاک همه»، دکمه و
  // برچسب ردیف‌ها همچنان حالت قبلی را نشان بدهند). ---
  function resetAdvancedFilterUI() {
    document.querySelectorAll(".filter-chip[data-filter-group], .filter-chip[data-amenity]").forEach((c) => {
      c.classList.remove("active");
    });
    document.querySelectorAll('.filter-chip[data-filter-group][data-value=""]').forEach((c) => {
      c.classList.add("active");
    });

    document.querySelectorAll("#advancedFilterPanel .filter-row").forEach((row) => {
      row.classList.remove("open");
      const span = row.querySelector(".row-selected");
      if (span) span.textContent = "";
    });

    const advPanel = document.getElementById("advancedFilterPanel");
    const advToggle = document.getElementById("advancedFilterToggle");
    if (advPanel) advPanel.classList.remove("open");
    if (advToggle) {
      advToggle.classList.remove("open");
      const label = advToggle.querySelector(".toggle-label");
      if (label) label.textContent = "فیلتر پیشرفته";
    }

    if (typeof window.resetAdvancedFilterWizard === "function") window.resetAdvancedFilterWizard();

    updateFilterBadges();
  }
  window.resetAdvancedFilterUI = resetAdvancedFilterUI;

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
      updateFilterBadges();
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
      // بازنشانی کامل: مقدار چیپ‌ها + برچسب ردیف‌ها + پنل + متن دکمه فیلتر پیشرفته
      resetAdvancedFilterUI();
      if (typeof applyFilters === "function") applyFilters();
    });
  }

  // چیپ‌های متراژ / خواب / قیمت — تک‌انتخابی در هر گروه
  document.querySelectorAll(".filter-chip[data-filter-group]").forEach((chip) => {
    chip.addEventListener("click", () => {
      const group = chip.getAttribute("data-filter-group");
      document.querySelectorAll(`.filter-chip[data-filter-group="${group}"]`).forEach((c) => c.classList.remove("active"));
      chip.classList.add("active");
      updateFilterBadges();
      if (typeof applyFilters === "function") applyFilters();
    });
  });

  // امکانات — چندانتخابی (toggle)
  document.querySelectorAll(".filter-chip[data-amenity]").forEach((chip) => {
    chip.addEventListener("click", () => {
      chip.classList.toggle("active");
      updateFilterBadges();
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
    // تایپ زنده هم روی دکمه «پاک همه»/دکمه‌ی × اثر بگذارد و هم با یه
    // تأخیر کوتاه لیست آگهی‌ها رو زنده فیلتر کنه، تا همون‌جور که تایپ
    // می‌کنی جابجایی نتایج رو زیر کادر جستجو ببینی (نه فقط با زدن اینتر)
    let citySearchDebounce = null;
    cityInput.addEventListener("input", () => {
      updateFilterBadges();
      if (citySearchClear) citySearchClear.hidden = cityInput.value.trim() === "";
      clearTimeout(citySearchDebounce);
      citySearchDebounce = setTimeout(() => {
        if (typeof applyFilters === "function") applyFilters();
      }, 350);
    });
    if (citySearchClear) {
      citySearchClear.hidden = cityInput.value.trim() === "";
      citySearchClear.addEventListener("click", () => {
        cityInput.value = "";
        citySearchClear.hidden = true;
        cityInput.focus();
        clearTimeout(citySearchDebounce);
        updateFilterBadges();
        if (typeof applyFilters === "function") applyFilters();
      });
    }

    // --- وقتی کیبورد گوشی باز می‌شود، کادر جستجو را کمی بالاتر از کیبورد
    // نگه دار (نه چسبیده به لبه‌اش) تا لیست آگهی‌ها زیرش هم دیده بشه و
    // کاربر حین تایپ، جابجایی نتایج رو ببینه. ---
    function scrollSearchAboveKeyboard() {
      const header = document.querySelector(".site-header");
      const headerH = header ? header.getBoundingClientRect().height : 0;
      const rect = cityInput.getBoundingClientRect();
      const gapUnderHeader = 90;
      const targetY = window.scrollY + rect.top - headerH - gapUnderHeader;
      window.scrollTo({ top: Math.max(targetY, 0), behavior: "smooth" });
    }
    cityInput.addEventListener("focus", () => {
      // به کیبورد گوشی فرصت بده تا باز و viewport ری‌سایز بشه، بعد اسکرول کن
      setTimeout(scrollSearchAboveKeyboard, 350);
    });
    if (window.visualViewport) {
      window.visualViewport.addEventListener("resize", () => {
        if (document.activeElement === cityInput) scrollSearchAboveKeyboard();
      });
    }
  }

  // دکمه/پنل «فیلتر پیشرفته» — روی موبایل جمع‌شده، با کلیک باز می‌شود.
  // با بستن پنل: فیلترهای پیشرفته کامل ریست می‌شوند (چیپ‌ها + برچسب ردیف‌ها +
  // متن دکمه) و لیست به حالت پایه برمی‌گردد.
  const advToggle = document.getElementById("advancedFilterToggle");
  const advPanel = document.getElementById("advancedFilterPanel");
  if (advToggle && advPanel) {
    advToggle.addEventListener("click", () => {
      const open = !advPanel.classList.contains("open");
      if (open) {
        advPanel.classList.add("open");
        advToggle.classList.add("open");
        const label = advToggle.querySelector(".toggle-label");
        if (label) label.textContent = "بستن فیلتر";
      } else {
        resetAdvancedFilterUI();
        if (typeof applyFilters === "function") applyFilters();
      }
    });
  }

  // مقداردهی اولیه‌ی نشان‌ها (همه صفر، دکمه «پاک همه» کم‌رنگ)
  updateFilterBadges();
})();

// --- آکاردئون هر ردیف فیلتر پیشرفته (متراژ / خواب / قیمت / رهن / امکانات) ---
(function initFilterRowAccordion() {
  const rows = document.querySelectorAll("#advancedFilterPanel .filter-row");

  function updateSelectedLabel(row) {
    let span = row.querySelector(".row-selected");
    if (!span) {
      span = document.createElement("span");
      span.className = "row-selected";
      row.querySelector(".filter-row-label").appendChild(span);
    }
    const activeGroupChip = row.querySelector('.filter-chip[data-filter-group].active:not([data-value=""])');
    const activeAmenities = row.querySelectorAll(".filter-chip[data-amenity].active");
    if (activeGroupChip) {
      span.textContent = activeGroupChip.textContent.trim();
    } else if (activeAmenities.length) {
      span.textContent = Array.from(activeAmenities).map((c) => c.textContent.trim()).join(" · ");
    } else {
      span.textContent = "";
    }
  }

  rows.forEach((row) => {
    const label = row.querySelector(".filter-row-label");
    if (!label) return;
    label.addEventListener("click", () => {
      const willOpen = !row.classList.contains("open");
      // فقط ردیف‌های هم‌سطح (داخل همان پله‌ی ویزارد یا همان پنل) بسته می‌شوند
      const group = row.parentElement
        ? row.parentElement.querySelectorAll(":scope > .filter-row")
        : [row];
      group.forEach((r) => r.classList.remove("open"));
      if (willOpen) row.classList.add("open");
    });
    row.querySelectorAll(".filter-chip").forEach((chip) => {
      chip.addEventListener("click", () => updateSelectedLabel(row));
    });
    updateSelectedLabel(row);
  });
})();

// --- ویزارد پله‌ای فیلتر پیشرفته: نوع معامله → (رهن و اجاره) یا (دسته ملک → جزئیات) ---
(function initAdvancedFilterWizard() {
  const panel = document.getElementById("advancedFilterPanel");
  if (!panel) return;

  const stepRent = panel.querySelector('[data-wizard-step="rent"]');
  const stepCategory = panel.querySelector('[data-wizard-step="sale-category"]');
  const stepDetails = panel.querySelector('[data-wizard-step="sale-details"]');

  // --- نوار پیشرفت ویزارد ---
  const progress = document.getElementById("wizardProgress");
  const PROGRESS_LABELS = {
    rent: ["نوع معامله", "بودجه و امکانات"],
    sale: ["نوع معامله", "دسته ملک", "جزئیات"],
  };
  function setProgress(activeIndex, totalSteps, labels) {
    if (!progress) return;
    progress.querySelectorAll("[data-progress-step]").forEach((el) => {
      const idx = Number(el.getAttribute("data-progress-step"));
      el.hidden = idx > totalSteps;
      el.classList.toggle("active", idx === activeIndex);
      el.classList.toggle("done", idx < activeIndex);
      const labelEl = el.querySelector(".wizard-progress-label");
      if (labelEl && labels && labels[idx - 1]) labelEl.textContent = labels[idx - 1];
    });
    progress.querySelectorAll("[data-progress-line]").forEach((line) => {
      const idx = Number(line.getAttribute("data-progress-line"));
      line.hidden = idx + 1 > totalSteps;
    });
  }
  window.resetWizardProgress = function () {
    setProgress(1, 3, PROGRESS_LABELS.sale);
  };

  function setDealTypeValue(value) {
    const dealTypeEl = document.getElementById("dealType");
    if (dealTypeEl) dealTypeEl.value = value;
    document.querySelectorAll('.filter-chip[data-deal]').forEach((c) => {
      c.classList.toggle("active", (c.getAttribute("data-deal") || "") === value);
    });
  }

  function setPtypeValue(value) {
    document.querySelectorAll('.filter-chip[data-filter-group="ptype"]').forEach((c) => {
      c.classList.toggle("active", (c.getAttribute("data-value") || "") === value);
    });
  }

  function showStep(step, direction) {
    [stepRent, stepCategory, stepDetails].forEach((el) => {
      if (el) el.hidden = true;
    });
    if (step && panel.querySelector(`[data-wizard-step="${step}"]`)) {
      const target = panel.querySelector(`[data-wizard-step="${step}"]`);
      target.classList.toggle("wizard-step-back", direction === "back");
      target.hidden = false;
      const stepRows = target.querySelectorAll(":scope > .filter-row");
      stepRows.forEach((r) => r.classList.remove("open"));
      if (stepRows[0]) stepRows[0].classList.add("open");
    } else {
      const dealStep = panel.querySelector(".wizard-step-deal");
      if (dealStep) dealStep.classList.toggle("wizard-step-back", direction === "back");
    }
  }

  function resetWizard() {
    showStep(null);
    panel.querySelectorAll(".wizard-deal-btn").forEach((b) => b.classList.remove("active"));
    panel.querySelectorAll("[data-category]").forEach((b) => b.classList.remove("active"));
    if (typeof window.resetWizardProgress === "function") window.resetWizardProgress();
  }
  window.resetAdvancedFilterWizard = resetWizard;

  function refresh() {
    if (typeof window.updateFilterBadges === "function") window.updateFilterBadges();
    if (typeof applyFilters === "function") applyFilters();
  }

  // پله ۱ → انتخاب نوع معامله
  panel.querySelectorAll(".wizard-deal-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      panel.querySelectorAll(".wizard-deal-btn").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      const kind = btn.getAttribute("data-wizard-deal");
      if (kind === "rent") {
        setPtypeValue("");
        setDealTypeValue("رهن و اجاره");
        showStep("rent", "forward");
        setProgress(2, 2, PROGRESS_LABELS.rent);
      } else {
        panel.querySelectorAll("[data-category]").forEach((c) => c.classList.remove("active"));
        showStep("sale-category", "forward");
        setProgress(2, 3, PROGRESS_LABELS.sale);
      }
      refresh();
    });
  });

  // پله ۲ (خرید و فروش) → انتخاب دسته/نوع ملک
  const CATEGORY_PTYPE = {
    aparteman: "aparteman",
    villa: "villa",
    bagh: "bagh",
    baghcheh: "baghcheh",
    "bagh-villa": "bagh-villa",
    zamin: "zamin",
  };

  if (stepCategory) {
    stepCategory.querySelectorAll("[data-category]").forEach((chip) => {
      chip.addEventListener("click", () => {
        stepCategory.querySelectorAll("[data-category]").forEach((c) => c.classList.remove("active"));
        chip.classList.add("active");
        const cat = chip.getAttribute("data-category");
        if (cat === "presale") {
          setPtypeValue("");
          setDealTypeValue("پیش‌فروش");
        } else {
          setPtypeValue(CATEGORY_PTYPE[cat] || "");
          setDealTypeValue("فروش");
        }
        showStep("sale-details", "forward");
        setProgress(3, 3, PROGRESS_LABELS.sale);
        refresh();
      });
    });
  }

  // دکمه‌های بازگشت به پله‌ی قبل
  panel.querySelectorAll("[data-wizard-back]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const target = btn.getAttribute("data-wizard-back");
      if (target === "1") {
        showStep(null, "back");
        panel.querySelectorAll(".wizard-deal-btn").forEach((b) => b.classList.remove("active"));
        setProgress(1, 3, PROGRESS_LABELS.sale);
      } else {
        showStep(target, "back");
        setProgress(2, 3, PROGRESS_LABELS.sale);
      }
    });
  });
})();

applyMenuOverrides();


// --- هیرو ثابت: کاروسل غیرفعال (سرعت بالاتر، بدون لود عکس‌های about) ---
// اسلایدهای about/IMG*.jpg دیگر در HTML نیستند؛ فقط office.jpg نمایش داده می‌شود.

