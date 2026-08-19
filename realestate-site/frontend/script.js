// script.js — کارت‌ها از snapshot استاتیک، فیلتر، اشتراک، تصویر آگهی (بدون API/Render)

const grid = document.getElementById("propertyGrid");
const resultCount = document.getElementById("resultCount");
const loadMoreBtn = document.getElementById("loadMoreBtn");
const statsText = document.getElementById("statsText");

function sortSaleFirst(list) {
  return (list || []).slice().sort((a, b) => {
    const aSale = a.deal_type === "فروش" ? 0 : 1;
    const bSale = b.deal_type === "فروش" ? 0 : 1;
    if (aSale !== bSale) return aSale - bSale;
    const num = (x) => {
      const d = String(x.code || "").replace(/\D/g, "");
      return d ? parseInt(d, 10) : 0;
    };
    return num(b) - num(a); // کد بالاتر = جدیدتر
  });
}

let allProperties = sortSaleFirst(window.__PRELOADED_PROPERTIES__ || []);
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

// اگر نام مشاور از قبل شامل کلمه‌ی «مشاور» باشد (مثل «مشاور آقای علیزاده»)،
// از تکرار آن در برچسب‌هایی که خودمان پیشوند «مشاور:» می‌گذاریم جلوگیری می‌کند
function cleanAgentName(name) {
  if (!name) return name;
  const stripped = name.replace(/^\s*مشاور[\s:،-]*/, "").trim();
  return stripped || name;
}

function formatRentPrice(p) {
  const parts = [];
  if (p.rahn && p.rahn !== "-") parts.push(`رهن: ${p.rahn}`);
  if (p.ejare && p.ejare !== "-") parts.push(`اجاره: ${p.ejare}`);
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

  const lines = [title];
  if (specs.length) lines.push(specs.join(" · "));

  if (p.deal_type === "فروش") {
    if (p.price_total) lines.push(`قیمت کل: ${p.price_total}`);
  } else {
    const rentBits = [];
    if (p.rahn && p.rahn !== "-") rentBits.push(`رهن ${p.rahn}`);
    if (p.ejare && p.ejare !== "-") rentBits.push(`اجاره ${p.ejare}`);
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
