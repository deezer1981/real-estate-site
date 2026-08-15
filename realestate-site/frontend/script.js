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
const STORY_LOGO_DATA_URI = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAZAAAAGQCAIAAAAP3aGbAAEAAElEQVR42uy9d5xl11UlvNY+595XqbNytLJkZSta0VGyHDFgY/DMAPMNMwQHGDDYGGyGAWwYGHAkDmNjBhgGbJxzkmRJtnLOuZWlVqeqeu/dc/b6/jj3VVdLclQbW/is31OruvrVq/fuvWfdvffZey1KQkVFRcVTAVYPQUVFRSWsioqKikpYFRUVlbAqKioqKmFVVFRUVMKqqKiohFVRUVFRCauioqKiElZFRUUlrIqKiopKWBUVFRWVsCoqKiphVVRUVFTCqqioqKiEVVFRUQmroqKiohJWRUVFRSWsioqKSlgVFRUVlbAqKioqKmFVVFRUwqqoqKiohFVRUVFRCauioqISVkVFRUUlrIqKiopKWBUVFZWwKioqKiphVVRUVMKqqKioqIRVUVFRUQmroqKiElZFRUVFJayKioqKSlgVFRWVsCoqKioqYVVUVFRUwqqoqKiEVVFRUVEJq6KioqISVkVFRSWsioqKikpYFRUVFZWwKioqKmFVVFRUVMKqqKioqIRVUVFRCauioqKiElZFRUVFJayKiopKWBUVFRWVsCoqKioqYVVUVFTCqqioqKiEVVFRUVEJq6KiohJWRUVFRSWsioqKH3DEegh+sKHJF9z+6yd4BgRy+x8QWL47eZ4AUNjuiZOna7vXfuJftvSrJJLbv4XHvkJFJayKHyy2EhJ7AuAyJtASQUEQ+y8gLbEaBXcnCS4xj0kAIQkEkJeRkyiw/xWUPAMkWZ4OGEMhqeVs1f+V5SkE1P8qVsaqhFXxgwgCpm2VAW4fC/V8MWEydwqCAYXFMkHSCg8JIlDoywHIzcjlYZGrpzIJHpgII0wiYI8JmkgAKkGa4IXOHBAlINTz9oN8yS7d1ip+kBNCTCIc9jQDAHJNCEx9tgdQyMpOgFEOSQEgaRBIkvLChH2ERUmCGCYRlOQiXQQZyksaS/wFKU9IEstiLlOhTEFAUyOsGmFV/KCnhnBoUoWiiaZJ3DUJt5yC5BkKwQgYHKH8e4YndeOcU5KnlHN2Ay0EsxBitBBi08BCeUmZqOhAJ5/EYCRB+BKNTtJU9vmnUHitokZYNcL6QWYqB4RtfxKEYLLogBxwETB6oJf0MedhGo8WN2/euunh+a2bNj780MLGRzUajYaLo+GwG4+70bAbjxViaGJomqYdNIPBzMxcMzU1Pbty1Zp1q1atnV2zy8zKVWEwbWEKYJayJ+VsZmYimvLm2BfwXeWvJEjSauG9RlgVP8i3rVL6DskTXaS5uys7QqA3Bno33Propocf2rD+rgfW333fvXdvfvTR0ZYNuRt6N6J7gAwwuUEGkuxYYjY64AJoDjrNQjs1mJpeuWZuzZqdd99jpz3322nv/dbstNtgxdoOBnjKDnUwBpYilwINcIbCoJQMWL6HWFEjrIofDJTQxUudCUw+hicyCpoKJMfzjz78wF133nXzTffcduOGB+7X/DzGQyo3IRhAygJLcalxGuXlJQmVCjvZV78QYEGkuwTlvJjkYCObjnNrVuy0254HHLLfwYftue/+U6vWjrzLQmATQLMgWKasr7nTELCszlVRCaviBwVZ8KVNQfecx/CubQNT98j6u9Zfd8lNV1923913ajQM6tqIJgS4mzFLGUGQAVAmQS8JXGGqUp2nyFI6NwsSBQmi0eQ0mEwZY1cWx1IzmN5tn/0OPOL4vQ59+ro99rLBbJclgjYQg8FC2T0UDazNDZWwKn4AIywXmJXhmfRIjDc/fOfN19909VXrb74+PXSf+SgYY2PIXSN1gAALMRMZfaeW9f1Z7CtgAkW30LdPkSjFdQkl2jITIM8N3TzDJEVZcM+jlJMNZtbusdcBBx90zDP2PPCQ6bU7dQmOaGibEMsFyxphVcKq+DeMsv/HyX5b37MuSBmS4MHUzW+6+dorrrvo/PU3XYvRfBvUkIZUKkeUQ8jGgAinQ0afUBJUCuQ2idckk3Hy+0pPAlS66Q1EF0xS9BQFeTZTtsZpAsQ47jTOXZye2+2Aww575hmHHHHsYMVaTxEqzVv97mHhLC37hKRqPb4SVsVTjZ62P6cCRMBhYoIbXJILSdnIqQbDLRtvuvKSa792/gO3Xc/FhdlIMLHnKKoET/JCOMERZAkqrQ8szfCUhSC5lAWRgQiTYj6McOVCkABglkxyN8EQoIAgR5482RJjhFOYT+ri9O4HH3bkcWcccvTJg5WrF5MHhNCPBVFWymSkBLhRxrqPVAmr4ilLWA4RJCiJItxFdyJ7F4KHPL7juqsv/dLn199wdTPaMt14JFzZQYmO6ARpMPfcNTCXG0hBARDNQpYDzJ5JZE8SYczJ6WYxgJCyGQE0IdCdhOSYTB8md4vRQYgEDRNSc4Hw0GRilJI4u++hRx/z7OftfciRoZ3JDsngshBCiID31Aga6zx/JayKpyxnJWYTgswdTmZ59i4YB8E33n/75V/+7FUXnKutm1c0jBrJO5h1IGILNwmAl4JTMCuBFYKlnMc5O+CgLDDEph3EtlUICDE2gxhawFKXPI+Vk3KXxsPcjb1LVCa8IZpgTYB7grIb5UFoRCNgGoMm0uGOHN0i2vlx0spVh5x0+vHPPnvt7k8bppAzGrNoRmQQYgD6gaCKSlgVT8nSVYabZEB2JWGkBB9Nqbvlkosu/PSHF+6/q2G2SFc2ZAqEdYKbUWw8ByMchkCLC6PchdCBHEzNrl6zat3Oq9eu3WnX3WdXrJpbuWp65aowNcPYmIUQGpnlcaeclJKPhgtbNm7ZsmnL5k0bHnhg04ZHNj5y/8KmR7G4daAuwpuWIDPMvaSZ6jcXkRjIHEK2aFxUXjCb2XXvU5//kkNPOKNjS4SmCVQmTQxAqIRVCaviKYzsRW1BKaec86Dl/Ib7LvzMR2+44NywsHkmeFZKISQGGugyVySTMokGdHCc1CEqDKZX7bRu73123/fAnfbYZ+c991qxelUzmBJMIGjGJgN5+1FoQJJH0qDsTsjc03i0cfPDj95/36N333nvbTc8dO8dixs35m5r02gQIpydQgMEpewZEaSFFAiMmT3G1OWunT345DNPecEPrdp591GXYogRUSAQrM7vVMKqeEplghORF0qgREquDHWG8QO33/qFD/3fe2+9ekWTZ+Q5JYjGkGGZcLgxRs+mHEKYT9wKzq1et/t+B+1z5DH77nvQ3M67NjMriAbuLpfQ7xSWaWazXmkBZJFXmIxRF3UaSEYaJUNAhFIabtn8yH333HXrLVdf+sDtN4we2dBS1sToColu6CwZERwEEiwztJ7HxGa3XQ48/Dkvf+WeBxzWeTBrDCYwhLC0GUrV7odKWBXf96UrcfKFyyXPI+XxNPONl1zwhQ/9c970SNt0Hjp4F72FaBDlkNwIRoOlDouJXLvbEaeeduQJx6/eZbcwswZAcrgjIIAMBgAke7WsMoFTdg3h/STzpAQuhaVBZsDlLtAlkiGQ8DTauPHeu6694LzrLr1ouGXDDDAFEzhm8tBRMFAyh6I7jU5b8NZW7vzsl/zI4SedMWaTAYsxWDvRtamEVQmr4vsbXhrN0VOJu1JO8MUWo0s+/fFLPv0Jjuen4GDXhc4JqhVEpOCKgBiHzvmEuZ32PPzEMw465tR1e+9jg8azHOZEACNDCZhse+3Q7SRG5egJq0hulYnlZYmqJrKAXpSvsiMLjjTccP+dt1x+8bUXnTu8/75pQ2h8bNlozDC4kYk0IriAZoxm0QYnnfXSk8560SjEMcJ0u8JISEQZ267yWZWwKr7P4iqgV+X0og8Kc3cCXRoHIxY2nPupD136xc/MamzoCDfB5CRToMMhWAhyLowxtW63A4896ehnnrHrvgc6Bt1YRaVPDkQLECSaFUmYbZdRoYhtX2uZbDIfFwTKQQOoXMpcWUrKklFoIuWjh+++9YavfuXGS76ysPnBJloLjzlTcGgcTGAQogjALWzK4cjTnvusl78Ss6uVY4wNYSX4Y3lXXNImrKiEVfE9pqvMnrDopYsTTDl57sDsi1u+/MH/e9VXPjc7ELRocCeCrE2MGV1wmMHa+QSP0/sffdzxz3nhbk87GLEdZxjYMEjQZO/OAKdEBmGZOPJEx3gS2UnaLqQqRfi+tOZlvKfvZzV3uWBSNhgQOk+Jak3WjR6885ZLzvvULZddFEfzKyLcPRMUcohCiJ4M48gwVNjqzYEnPev5P/of4uxKwUKYIgArBb0yjs06f1gJq+J7z1eOjkKR5cwAZAak8ciYum7rZ/7hAzef/6W1A4mjDDciw7LyVMZc5tA0ZDPvceVeB570/JccetyJYTA77jwYDaEscC77cxsnbcsF8Xgx+G8WzQjbq7OXqEvopdwTmB3IeRCUh/M3XX3pRZ/96KN33rgi5JYpyMeIY2thajVslN3RodmEmQOPO+PsV72qnV2XNQgWCIqSdRSDmsKTtapVCaviexxhAbmczZxpsKxkymn+kc98+B+uv+jcOeUpppyGRjLEjJCRTN4yDJMN26kDjj3h5LNestPeB406uCxYaAIMzLLlhFVcJwp28EeQlsSR+xhMlIScKMWBbbj31gs/9ZE7Lr/ERlumg7InDyFDQblB9kyFZsRm3uOhJ5521g+/qlmxU0Y0lsYMBxDQcGkYu6ISVsX3jLAkIQsJTrplIfs4YvjlD/39JZ//2IpWhJDTgEB20hDaJKXAzV1uZnc5/QUvOv5Zz/EwldUgTkFmyMZMEYxPGCh9N4KUSaq4FJxZbyTmnnKKoeN48fIvf/GCz35yvPH+2SZHdVkO0tA4YpKXmcJNKRx75vOe+6M/PrYp12AQY6ABtLKbWeOrSlgV32vCcilL3kt8mo8XN37pI/94zXmfXWljk3dwA0KXWzOXPDRjxi1s9jj82NPPesme+x7ksBAaeVAMhAU4kAnDv+oW25JVDyeVp76dStmlMZRNfs/tt1zwuY/efe3FsxpGz0Z03rhCbIJ8GIDO2nm3w085/YyXvSLOrjNMRWshyHIWosVKWJWwKr63NayEDLo55Ez0rZ/54N9e9YVPromMPvLsHiJdrZzyzrgY2hGnjznjnFNe9srB9Ny4c7NgMCfNEBEm+u72vQpHyjVJshj3JDmJnDPcY2NpuPmiT/7zJZ//+EwetspEcNEIaUwAYSoxbBynI8987vNf8e/dVhoGkfSQnQiIdXbnKY3wW7/1W/UoPKVvOdmzGRwhuUJIl53/ya9++p9XoovuhEPmZiZGIRsXgw3j1Kkv/NFTX/CjaFaOM0JsGAxQIGKxeSh+g9/dhe1Lud8TfSZO9h37uSKAZAAtZ4Uw2O/Ag9vB9K033xi9awxBSXLRaMxKARoY77n73mZqZt8DD03ed1yYBavOO09xVC2Op3wBi1KSJ3gMuvvGqy/8xEdmfBQxBnLxLC0tT52FRcbFMDj9BS87+bnnZDbI3gYGKACRCEubd/+qOeA3oWOAgQxAoCLRhpDdRhgce+Y5p7/olYvNisUsJ6AMItNA0jVwzSJf9JlP3nHDlW0U5EYz1T6sSlgV3wuSKnD34lLq7hbyePP9F3z8n7Th4SkH5TK4BYcjjQF0sZ0PM6ee8yMnPO9lQ84iDmKwUExMt1vJ/HYIZcdzlvAY4iwt8TAUtVHFYLBmiPb457341Be9YtjMjRgV6PKMSf+qpxadtjx43sf+cXHj/bSclTQ5cvUSqoRV8T2jLkcwIYw3f+1zH3rw5qtnI6OHiOns5haNHoyKzeYcjjntrBPOeGm2FbCBWWDRWSjZH400wJbY8F+LsPS4mKq43WvZk4r0Q5+jGnKkQojJBs941llHnnnORh90YRo05rGRieqCg+OZ0N13y9UXfP7DyFscqSuj2hPOqsxVCasC/6qLnBTQOYPxvpuvveL8z06xAxIymSzKPCfALdrW3B143AlnnPNy2iqpjcFIF51mJXYBghCW1a30Pfg424V42m7wp5DpJPozIgbLspFNnXrOjxx20pnzOcBsAA/ZSeZAwVtipemK8794541XN5RnL9PgwhIjV86qhFXxXUyfHHJXdu/cPQPuXcu0sGnDeZ/4eLuwOcZxRyRD8NGUu3HabGpr52v3OeSsH351s2pNMpEe4IEyBojsfSQm7vA97Lt8bdiyBx/3b4ElpOrfyuRN0mghhGgWA62xQA+DqZXPf/krdtvvkJQYLZqSKdGpHD1pQHK4cO5nPr710QfaoOw5yQWXOpV+EKBDr3IvrwljJayKHZgBFkYBSXOyhAqN+bUXX3DbDVc2jYWk4C64giW5QYsdmzV7PvulP75i7Z5JwQYNY5m5+T43fOfX/36Zx2Ywa9uBwJkV6579kh9t1u62JTvNHO6GbCYC7itic88NN15zyVcDElkso/vN0KV5yMpSlbAqdmzW1OulSCBNMonuyagN99599YVfmhnYGJS3DWH0jkRsCI1tcNwZL9j36ccujhIZYAEwhzmop/DZdxWvQxrMxh72PPSYZzz3RQtxbszgtAwkOqIFoO3SGvDqr5z78PrbYoCKfWxpT5VscmBR6ni1S6sSVsWTZCvfPghwQX1Z2gPTVRd+6ZF7bm+BoMYV4YHyDO9i3Np1Bxx94rGnPS9nxmjopfYUev3ip/pREQknGZtR5tFnPO+gE561sTOgbRANJpdD5nkuaMu9d15x/hfQDV0pQ95vjfahZnWSroRVsQNXpyZhRem7IhngedCEB++968ZLzp+JuZEXTy4iULBgi103vXbnZz7/JWHFuiQaA2kGRNJYxKKekmtUMsBA9KLLpIkSrZ075bkvXrHbnl2CZZoIWnmu0mjG/MYrLnro7tsGZb+hF5AGRUqU17ywElbFjqnlhFJtcUCZJYHJIDznxSu+9pWtj9w/AJAS5JI6udhENBnhqDOes+v+h3TjbKFhaAJl6r2ZCQ/QUzEDYi+tZSQC0QAkLVhKvvNe+x518uljDgLiIAOuDIxNaqyNWtzw4FUXno+0aFb2LrwIdFWmqoRV8V1Yp1ZCI0lZ7BjSQ/feevMVX4tBUSkCFJyQRdG2jH2X/Z9+1KnPy4oWolkAwOW9AtunmU/B65Z9AR7ZLMeAJtBdR576rD0OPmKxI8SoADAbOzrhM4G3XHPZg+tvDpazpyI/z2UkWFEJq2KHJUJlZbkkICsHpLuvu3r40P1tIPM4AiLNAuQiUjM46pTnzq7ZY5QFi5jkT0tE9W8gqlgyCELfANtIYW7Nbsc884zUtImQJ4K5N4b2mWCjh++/7arLgzqnXGRpo+89KyoqYVXsoKwQxeEP6oeGDYubNt58xWVtHkcxAE4lGoSGadgN9zzo6QcefcI4kyFOrLcAmvr9QQJWdh13EJ3q8d9Zjh16PDKQ1fdwQYxAdFmWydqc4/6HH7Hn0w+ZR0I0uVNFCQvuucnd7VdfNb/hESNAOifT1WJdC5WwKnZkNNGTAOTK0bT+1hseXn9HE0AZLCQikTknyRHbI085Y3rVzg4z61mptEQU/c28TKX4yeSGmhDT8lKQtoVyegyj7Qjqekx0aI5+bkdEJhadzZp1h59yam6mJDMxknTI6cCgwcP33Hn7Dde20Zw59+6NdVKnElbFjiQrL83eVpqFLCB1t172VWzd2IZA+shCYoxKFn0xc+2+Bz/t0KOyp8AchUgGWgF7XT4CFIthTf7O1mrGhISyQ3D3lLN7ApKryz7OnvpZGO+fCsDd/UmFdQQCEJa68w0sfaQRaI1N5Dhrv4OP2nOvg0ddRmD2ZDK6ka7oWtx8+5WXezd2KNMzOzDVDvdKWBU7krJY8kCSrsaw5ZGH7rr1xjYI6pK6DIeyoRN9MfCQ4585vWpnyEIxD9R2y52TiZilws13sFeoZa1LNCsdnKG44kguz1IWyuAe+g4KkuhNW3dAivxEfwFaC0AzWLHTYcedNLbg/ed3kRJMPtXYvXfc+uiD9za2vHq1rcBXUQmr4snyFftWT1LZoPW33bS4ZWPTtFlepJGJRFPKWLFml6cderTblPuSDh8fQ1hLiRt7kYZvm7Ao9JNBLM40yvQMkczJiRCt8eQCM7Tc3vW7WN0mJcmzhGTNvkccNbfb7ovZQyDgoiRzWdO0WzY+dOct10UQEhQAI1WV/SphVeyYhYheuB0Cjcrd4s3XXZHHwzJaaLSAUNoWRhn7HXzM6p33GWcPgf3s4eOW4hJ96MkEFktbjlSpj4lKLsRm83B8/yOPshmMc+5yzu5k+Qj+XWSsIgdvakhlzu2y+95HHDvyAJjBARkC2Ag0jW67/orUbQ0gRcBEF7xeapWwKnbAMpRAKQvZZcatGx68/65bB6ZAmAAZHAQhs3Z2nyOOyYOpooO+vL/oG+zZfecFHPYTPhSiO10ZnM/6gz/9s596/euvv/uutm3hCiCUoDT5Rd+Vq658VBcJS1mKM/sedkwYzCmjpKLmNKdSN0D3yN23bH7wnkApQ/6YvLmiElbFd85YgpAhKCtlwDbcf8/ioxuaCCm5GxCDALJLYeXOe+61/wGAQMsAUdrfl5I4yH1ZN5aW/+nb+OybL16h7Fcqu5ABd++8S57J//HO97zn/R/48qWXv/6Nb7r+rrviYCpnee4Hi1zKE+nPHXeE+rdNWIQRbsGSwp777L9ut71TFk0B6PXcDW1ji5s2bLj/XhJlUlMy1AirElbFjgse3KwM6OQH19+h4Xwwk2SBLE0FjENx1333n1mxExGaICJxe+qRJLJYU/ikSaLnqiz2Jak+avrGhEKWPFABpuxdl9zCKOP3/uRd733f+3xqarBu3UXXXveaN/76zffcg0GTZFAEgos7PJbhNkCEGRtaAOdWrt3jaQd2iEKAZzJnZAsEpG708L13SWNS1iv2sIZZlbAqdsiKdIMLclrqxg+sv6PxMZUFes6UmwW3gHZ2zwMODYNpwE3ZACA8QTTiPQR0Ugd18KSclEW43N0n7U7fYAGXPnHk1DmQLQzFP/yzP3/n//6brp0aMyxIYcWKi6666jW/+ms33nlXbOOC5wx39KqfXO5TvwPTZ6DsBloWw/QeBxzm7UyWmTGjQ2RSNuWQ0wN33ZFGi6Dnvu3CKl1VwqrYIYtQhEOKMQznN2944P6BQZ5BM8gsid45BrMrd9pzH0EGmGgIQtkC25Y3EaBZCNFCpIXGQmthEGIbmyZE9WX40lGvr1vn6hWGVdqqhtkXaG//i7/8k/e/XzMzObbZQcGFdsWqC6648rVv+o0r77wTbTvMicqRmcbvRhdB2Ut1UHSDw7l2j73j3OqxQ6AHOZ0EhWh89MGHRvNbLFBFhEZWB3S+/xHrIXgqcBYlgAjExkcf3vzoozMSYe4MNKkj0XVp3dp1O+2ya3YCxQpHopO2RHylYPPAww8/tHGjE2CIxf5vopO1x847r5qdo1SEanoX5mU1rz5b7OkvZ88y62B/8J4/fef7/hpT0xkGh9EoZXkGBqtWn3/F5a9781ve8bbfPWLvvfJoMZQxbbJPQB/Lz3iyxFHeuQmu1et2Wb3zro9suFuRCXJ4CTwD45ZNmx7d8PDMuj1KRU6qM9CVsCqefAxMulNsJGRoYcMDHG6SxQQYmAkymDfKWLnL7lMrVgzdAxrAgNJM0NMNje6yEP7uw//yjvf972ZmpTLdCMkcMI/d6H++9a0vfc5zRt2wQQNZLluPE0kDBzplgAEwuXt2s6Hb77/zT9/1/g9geiYBWcloJqLPK9lJg7k1X73y2tf82pve+/tvO2LvvUbDUQw5Gl0gzUDZUl1MguzJyTf38jNQgk/PrFy9yx4P3mA0ZxZN9AA0UVgYb1xY2OCIRbTH2LN2TT5qSljxJCOGfmcvAI8+8IB3I7Nt9fQMSQiMu+21lyzQjIHgEy15EsCW4eieRzasf+TR9Y9suPuhDXc/8uj6DRvvenTz+g0bt45GWOZXUzYWt9GAUAI3l4Y5Zdliwh/+2V++9/1/i8F051BWFJjlrlxiQlCuzj3OTF981VW/9MY3XX3rbc3UoMvJIYSQydwLdPUmXnwybLWkIkrQKANC2HXPvSwYhQgrY9Cu0rPlo4UFAgyGyVZDRSWsih1Txiq+7Ytbt8jztuVVogIXQly5Zh1gxWVG1NLMM5Y29SADYhPDYBCaxpomxBhjDCHGEJvYsshmlRkgwBx0gRAluigjLTuyw7mY8v/40z/9/T99r2anx4ApRERzA+mBvZwn6IBLydXOzl1wyeVvePN/u+62OwdTM9nhLrkAOXrLGurJdhf0zbKgaKAB3GmnnUJsupy9r+cJJhLIGi+MCMF3RB5aUQmrYnKSaEW7z7OnsVmf4/UxBZE9D2bnVq5dS7DPr7ZfgMvqUOUvnst+ID3Rx/SknJZX2bdTW5Dgrgzlpfp0Z/YHf/EX7/zr97UrVo1zZjDKIDooY4lg2CtEQIFFMHV6zdqvXHHVa9705hvvvseadpiSCMh7X4iJtcSTaGRdai0rGw0EbOWq1VOzc1nCRLlChY89D4cLnESSrlzHCSthVeyAAIsQiyFySqPR4kSooEQLbgBIxTiYnZmkbktl5McUkumAk0KQ6CgvHIiAoumgXil9G+Wx/x6BQHiXxinNy9/+Z3/+rv/9AZuaExpPlCMbkiFTBBowmPUFdYMIpzpgPuewetXXrrvhNW988xW33c7BYOTJ6QZYCQF7lfUnEeyUQyPQDWKCD1assKaRGBDK2HVp7YA0Hi4A7ph0ctSieyWsiicPl7tnAu45p0RJcCoXeXYCY8kGgxBb935FgkYGAlDu46pJi7sX0bql5EnqDWQcXHZNOOBAhnIp+TjS2GHs6H/wnnf/8V/9L5+aSYLnJLjnLHMEoHBhGmM4bORQApxyF6QAxi4jzqz88qWX/9JvvPWmu9eHZpATkOVdds996/yTzJ4Ly7OPPS3GQTudhbJdQHgiEByeMEqEW9E2tLoWKmFV7JAK1pKAn+eUUlmKJRgxM4DJNTO3oh1M97YK2+ZeloUMy+rKAilSLHPL2wxFue1nCpM56S535KwsjS3+j7/4q3f/zQc4M92pF20JRguAkiFPtew2P3ry0w/5dy97cRwuTrk3UCQDQunLzNQQuV218uJrrv3FN/76rffcE9vBMOXOvQgdawe1aC0V8kMMM3NzqS+XweX9sZB8PEbOvfxqvdIqYVXsAPQzJyUYkuduaa6mzOYZSbPYDiw2kMFLUpgfu3gnjGT93t/yfUQBosDlY8ClycBTNEtJXUYX4tve9e53/vUHfDAzdnTODPPS8aQcaJFc3LzppKMO/x+/8eY/+a3f/M+v/jEN59te40Z93Z9weQfazNyFl1/1ul/5tWtvuyNOzXRlW8GdysB3rvFXGiO2pYdGa5o4GIBGmi1ZPpfsM2doW3NZHc2phFXx5CMFbSsiw3NKJRpakrWiC5LFEEI0BCuifU9Qjvl6UjJaVipb/oUCFEHvkmhD8nfe+Z53/vX7c9tkGhQCLVPJlOEWNDBLW+efecSR7/jd3zvm0EM4WnzDa37+tT/zn3y4YMqly4lyeg4qCqWcWrH6wiuu/sU3/+b1d93dTM2U/vhCplomofXtycNPjgswOXAhWAgqG4RSv4VINGbjxcWUEiam9bXmXgmrYsclhr2ep9OWQiOaGSH3PDU9FSxITmJZyLDdIt6u0MMi716mdbb7iSWeIJRSEtkF++O//Mt3vv/9eXqQjRLIQAjIbhA80kabHz3qgP3e8Tv//diDD/Th4lSwlVNTb/iF1/zHV/+ELy60RCQol3LZL8jyoXuzatWFV131ujf++k3r77Gm7TwLci3zutY3H2t8ojqWlsaHCA6mBnK5q+gpqx8DR/Kkye8iaitWJayKHUFV7LMWAgwMJgtyiAFOhxRpllKXci5aCIYMpNzXgpb1YXKpSNXXrmQijTJzBvUxWIZnycVxl5I0BN7+7nf/z7/8X5ya6chUhG40Ft2EAcNsbNPmTccddsi7f/9tRx20/3hxSxPYhCYknyZ/7bWv/dmffPV48yP0cWgCaaJlKpscSG7N3LoLrrj2v/zKr151553eDrLnhJSUHNk9y7X0vr+VQ+WwXkxVbi5zMDON3EALOSG5A4iBU+6yIFJQnMRXS/LRdV1Uwqp4EqRVOj/NGGPT7/ItVcpBEIvDxdR1MorfjtSUG0URTngpf5VqvjtyttAueH7be9717v/9vzgYOKTkTJIoC64cgEYYb9x04uFH/PHv/t7Rhxw8Hi4EC7AgIIZgnlc1za/9/Gte8x9/KqZOo1EbjJ6D597JGhrR46oVF1115S//5ltvv/f+pplO3cRkB+4sXbKcaMB8c+rqdxcIUiBz9tFoiH431EEYLKVMampqOjYNHusvW1EJq+LJgCxJDi2EGF1aKmEDyIAZvRtLTprkoCbb+t/kda0QFqSgSUQGgp69yz6f89vf+6d/+L/+Kg2mOtLBiBBRzBsUAwI9zW95xYtf+Kd/+IfHHXIwutEghp7xjFlqGBrXCsa3vP6Xf/sNv7rbirm8MD8IFqUgJ9zpCRrLp1evueDiy3/9t3/v+rvujs2gG2eoOKE6lATvJQO/YWrYm+hMbDUkRTNIXTcC1XmCqbS2B1ByxhYW5V4YsV5olbAqdkiAVTqxHDBa8H5mbqmj3QDNz2/sxsMyLNdXZL5Z4WdS2XKVMeTiKw1IGAND4++95z3v+cAHwopVI1lyJZd7Cd+8DTZl5Hjhp171I3/w2289cM/d03CxKQLzsXGaAAYTFMkpszbrP//Ej//Rb//WPjuvw2ghWKCDZAADIFc3zlMrV3/iS+f/zC//2o133h2mp8ZZRIBUZIy/1VC0KIj25OOQpzRcnN8KigxEMIBKNMswxkYslj6qW4SVsCp2ZEpoZiGEthmUolZfWiZAmDGNRnm8yF7d/YnDKy7/szd6L/2kYhmrKb4ztLHZH/75n73rff9b7bQQyIm0lgU3wBQ8Y8vWn/mxV/23N7xhzqjRYiStN/MyAIKBtBDKt4OrWxyefeYZb3vLm3dbu7rrxrFtA8wkpMQsgENXXL3qouuvf82b33zDnXeHth1neSHgiVsGv4XsTX3HhkAY5d2oGy0WWVE5CFlQVgdrm8GUimC+u1inCSthVTxpqurv/IQQLcRmasppYJESDYS7d0b6eLz46KayBUYLRU4Z1jsCTl6rtL33DfJlYgaEgchC6Z8Hx9Ifvve9f/RXf47pWVhMnUPlQpGbh8jo3m3a/P+94pW//rrXzcU20pq2YQQMwYxEJKMxmDEYAt3AQWga5uH8i8581u+/5S27rlqTFoeNlRFDD6FUv1PnXbNi7iuXX/X6N/7G9XfcpXYwdAmxb+vI8uSlvtWLpj6216FogamMEpX0dnHjpvF4ZBaKKKHKfiGzmTXTc8YBIcB6++qKSlgVTzq8EijJYSFOTYlw0q1vdCAQgTQ/v/XRDZNBQGEpyvjGFZ/iBU0j6a7s6uS//+53v+d97w/TK8a05DCRyekCZAaD+8KW//TjP/Ybb/ivs23r3TjGQAZjMfFhr1I8aeAkjSFkA0IYNLFbWHjBaaf94Vt/Y4+Vc3k4NBJmovcCxS5kn1q58vwrrvjZX33jzffco2awkLKDnjMmE9/Y1k7bf738c/nS5xME37xxw2hxPqBoJ5tcdBHIZDMYLB2MakFRCatih9axiARMr1rD0GQwU4JK63YArOs2PPwgkKltPe6PjxpsErYtxW8ocQeNTYtB+/b3/tmfvO99XTM9VoRoKLbOdMqoxnPasuln//1PvPW/vn4uWlRugxloJBmWe7JyYo1TuvLpYhayN5TGwx961ul/8ttv3XXlTBotNDE4Jk4QkDx3rsHq1V+99vrX/tqbb7rjrtgORim7Y7lw8xJhPa5YXvQeAMiMhDY8+KC6LpI0y0IIFo2SFMPUzGy/G1kLWJWwKnYUHL3FssPXrNtJMeacAwko932PbsgP33+PpzENX9ep6/EpTwZlcIpmU4O/+If/+56/+YCaqSSTgjndPVMKsICWyls2/+dXvfLXX/u6lYMBlaPRikHqZLYHy9xr2Ju8MoCNGIFgIcbYxOCLW88589Q/+d3/vuvKlWlhcWBRyUs3Z6aJTEmzK1ZffPlVv/ym37z+zru9aUby0qS6LVXW9roOvYtYr3YsAS54vv/e9ea5yLbSTHLAHYLZYGY2+7agtKISVsWOOU0TKwquXLlqenYFQcsygGaAGMjGHnn4wa0bNxKA+/IQankNa7uUUKVFsl/zizmdd9mlC4RCkPcGYDJmkwVOxaDR8D/9+E/85ut+cUVokD00DYwhROPE6KKvuG1vYFHSWTjMSLMQ2tC0wfJo8azTT/+j3/5ve65ejdG4DQGQyvAz6UBytXOzF15xxS/+2ptuWX+PDQZdyn2yKcn9CWgdfRRWVAEJLG7d+vAD98cliXqZoER3aNBMT0/PbRNCrKiEVfGkQdAkGUOUsctz63afWrNHdp9GZsrmJrCDArHp4Qcefeg+ozlddHmxQaYDRWLGNMnZSqO75ESiMpJy5+5x0IxhSSaDIxMWgNZCQE7zG3/mx1/x39/wK6unZ5QVLZqHwAY0M5MBLG6H3mdscsqhLGRRHgJIs2BW9hxbIPjiwsuefeYf//e37LyiHaeFNjYxm2WTU/BO4wXluGrlRdde/5pf/fWb71rftgOXZ3XuYyCrNwzTkriqA6JR2SA5GZpHHr536yP3tsr04IpMAoLHtsthbsVOq3fZNWssa8gQqh5WJayKHcJYZUvPaBIGcytW77pbhkGSMfXanohEmt9y/123U5IogZAtKcVAwPI4aLuogtZPo7jDJyoOpZ4UzOhJWxf+44+88k2ve/10DKQG0w2XmfhpIlGz7IGlrwmCRWq+qDZAEoxN0zQxjheHZ59++tvf/ObdV65Mi/NtU7YZc+GjsnvZzq68+MprfunXfv3qW29HMzXucmHHJHduF9CV2W0rMaYByvffeWu3sKltgsttoiLjSaLttPueUzNzAEsfRu1qqIRVsQMgwBj6ArOFEAe7P22/FGOHIDMFKwFTBKK6e26+Pi1uhYWsiVowZaARpLYrAIESJz1Lpe5kkC0vczFQSGlh63/6sVf+9q/8yorYKKcmREAIhG1riuIyhnr8g4Jp20yjCDeYWSDbaHl+4aXPfe6fvPWtu69aMRpusSCaDDAzkBkaZx+sXHXepVe8/jfees1dd8fBzLhT3qYAX9Ql+p1GIhNefKxTt7D+luuYhorKQROddzM22W2nvfexZgqi9TIOtYpVCatiRzBWYZW+/0jafe/9wszKRSGjyOtJWZbzgHr47ls3PXx/bwqzXOu4r/w4lnovi+ixtsuCfFv9WaRMnQ0Xfu7fvfqtb3jDbGxidiNc2UqTBbPg6qVJJ3LME2XAx67+JUIge135rNJd1Rpt3L3wjGe94/d+d7c1q/JoIXJbKJjkbj7yPFi79oIrr/2FN/7GDXfdw6lBl8oMZC6yz+UhlCQUMrNomx++/6E7bh0wZ+9yH9ullFNOaAerdnnaQeDSESiMVTmrElbFk84JezLoZTKxy657rlq36xiMMUbJYMXcrzGf3/TInbdcTyh5UZYq84GCttGKVBo8g1noJ3h6xb++PdPIYGxjSAtbXvnCc97yul+cpQWpbVoLRaldRrrc6SVQm7QGlKqVJ3exREBL8jA995aO9T45JEHFGBoLeXHxnNNO/f9e/RMYD+GZsDI3WCxZs3yYcrtyxVevvuY1b3zTtXfcFQdTw5RAwqWyR1Cmo0WAHTLo99x608JDD02xODsiZAEZxpy1eufd1+2+t5wGK7ucS7I8FZWwKp4MXyGQYDDACCgMZlftccChyQ3Jzc1IZ0xCQEIe33TNlT7aGi33A8OCsuCQ0BFdKUuDcBeykIrbVi8obDC4UYMQu82bTjnyqF/5uZ+fiRGeQjS3peEd95wMMsGKtIMAl7IjJ+REZUruufOUpFzCl5yQk5SITFFgoAVGp0Kwto3j4eJ//vEff81P/aRGi41ZVGCeOPHAhTz2NJibOf/yy1/3pjdfd9f62E7nJLg8u7Jc6lzZYgZApOHCrddcEcajSEowWAAhGGPn3OOAQ+ZWr3HByhyTBcBqhFUJq2IH1LC8KPdRfTgUmgMOOTxOr3DvdZy8bCYCg6AH7rjhobtvbQJdTjhLqYrowLHogIzZXQZRvbjBJO80IFBTptHmDUcfcuCf/N7vHrT33jmNaRPbevTtTcpQpjJygjs9w3NWciXBYTK4K2UtsUnynDyNPXfyxJyyC13JUc1ykJsHYGXTvvV1v/hzP/7qvGVLGxhJqowmugVk5VHO7Zo1X7v2ute98ddvu/e+0A5SBmDunj2DEi25WsND99xx1y3XTzUlTY3mBMTQZMU4t2qfw45QmNIy7dYq4FcJq2LH5oWlMdOy2277HbRytz2HGcFCLzLD4LIpg2/ecP3FF3o39kz1E4IJrpQli1tTvuX2O5oYWVQQlixaCZMHcEAOH330+MMOf/fb33bkfvthPJxuopm5S6IxJFcWYzsVYxtiY00MMVoTYtvEQRMGbWxauTwrhrZpWjaNNTG0MUy1zfQgtG1sYjNonMqegaLFlYyMMTTygfQbr/2Fn//JV3dbNzVUkOCyEtkZZOjEdmbFV6+4+rVveNO1d9yNwdQwCcaljU65rFu44ZLzx5sfCk3OIDQA6ZYEG3c+s3anXfY7ILmWlKRL7loDrO9/xHoIvv9TQpssLBecyG5Tq9bt8/Qjrrjz5g6ZEGFCEBCyTwG3XHHp0ac8f93eB7rLmElkycmF7O94z59+4jOfDbFJ6r0OS4HbJCNbMm3detKRR//Rf//vzzjowPHC1rZpQMGsn7UTDDaCf/LTn776ppvioHWUFyIFQmk0fsYRT3/emc9uDLetX/+PH/vYonsMDaFAcygTkM9ZeOFZZ++/1570HEKQs98MNcnTTMCvv+7nafzTv/n7OD1btHK6nC2YQGZm2tTK1edfdvlr3/jmP3777x249x6ddw2ADDPEGDbde8ctV140HVKnDEUzOrMshxzltt+hh8+tXesgzVjsW43B+zCzxlmVsCqeLGf1syilN4FIwKFHH3P9hV/sNj08oAAlBQOp0SDGDY8+cP3lF5259/7FWBAuWUywP3nvn733r9+HduA0LCV5pfXA1QYbbdl0zCEH/snbf+fIAw5Iw1EoPRMh9Pb1ApxwWdt85Iufe98H/r5dvbpz77vIgWgcb9r4Mz/9U8967nNb4M777n/bO94xZHCaXAY6oUCoW2PxmKOOPmTfffNoJFIwBwlFIIJZeSaEX3/tL8jDe/7278PstMvLUA3NDMzZsyGuXHXRNde9/jd+851v/92n77VHGi1GC55TaHDDlRdvfujeta08SSQpMjvVyaZWrD3kyGPHNGaYkXIHNdlYragpYcWTR+/rZXJSRuau233v/XY+8ODNOQdjyFlW2tYN8JngN1x+wUP33hJi7sbD7FqQ/vCd73n3X/+tT63o2iZ5Ri7dTgRgxkFgt2XzcYcd9u63v/2YAw7Io8WmYWyihRgQIkPfXYosy0a2s3Nh3dq4dk27Zt1g5U7tql3i6l3Cup1t7do4PR0AAnF6emrV2rh6bVy9c7t213b12qlVa9uVa+Lc6nbl6iY2JDxA5qQslNEdkGhiQ2GG9puvf83P/+SP5/lNVCaMMDqkztllz53MZtedf8V1P/vLv3L9HbdzMD0cpWjhkbtvv+qrXxqEpKzogQhDA1wDt8WkdYcctsf+BzMV9lU2OJ1wlBnuylqVsCp2QIzVD9WUfa6SPbWHH3NCmF01drmcyGJ2QvJBwKb77rrygi8hjSLiQud/8Kd/+q73/W+1zdgwyhkM5rBcNBIwFUJeXHzG4Yf/z7f97hEHH7wwXGhisElv+pIrIgAzlDRK8uzeJe9SKo9xyqlzd4c8TBooutyNUu5cXdI4Y5yRMpIrTewAWbYsBRQFPRpDkIWmbd1zY3rDL/zcL/y7fx/H46bv0ZCbSh4rcew+mJu55Korf/mNb7761tua2Rl2C9dcdP7Ge9YPLLiySrZKUERinFpxyNHPCFMzfQ8pQKh6TlTCqtiRkEqzkwFFMUUhNK64/6FH77rPwfMJITaN3HIi3c1yyrPGa752wfrbbrapuT/66/f//p/9ZZpuExPlAQawKB8EaTqE8ebNxxxy8B+//XeOOejAPBq1ZsVbvsiWLreRVqGwfmDIinw7lgwNAXjZe0ToHwwkgFwGC+Fa0iPktrHjouvAsmdp5gzJPcRI9znDb/3yL/2XV/94mt/UBDLQFaVAkEyOBeXxylVrvnrl1b/01rfcdN+dD91/2zVf+9LqYDEjApRMOQrRBqMRd95z//0POyJLAqNFYqKfU8cIaw2rYkcXsnqrLyM8w72ZWbXL0c888/N33JzG80EejSPvnMFsapphYeNDF37+4zd++HPv+bt/nFq5egyh8yAQ1lHJ0AYOhIUNjx5z2CHv+P23HX7A/t1ocWAWzEBS9pj0qLdG7FWp2A9TE9vN4anXbQZ6V1QDsjJIWVFbX243jSJfRVnpjJ18V0QQvW1C7nLO6c2ve627/8Xf/V1oB+CMq5gquiFBtthxZm7lJZd99Y1vfO2PHnPQeOP9q0jQDEGE5QQ2nbNr54489czZtbumbCEEVy+YhT5+rJRVI6yKHcJVfZc7seSfTFqIY8fBRx67y9MOXMiiBSmLMjrdmfKqBndff/m5n/lQ9HEU3YMUnQBlIdAQA7utW0848sh3/+EfHH7Afnm0MBUZA6xcFGbLQrxl0nmCLc3eiaXNvMgvEwIDzEpbfSYylUtr1qQTHTIo9HOMZQ6wGHBNulxdgnrlHJExsIG3ufuN173m5//dq8N41GAczWlmFonoIY7NFnOeDli8784Hb7l+ZUOjd0IHyop7mRZd6w44aP8jj81OY+w90iYzBEKdy6mEVbGjUsJ+ZTmRAe8Vk4OQ1cytPuq0Z3VTs45GMJoVSiJzUJ7B+OSn77H3yujz840HD22GiaJ8gDDatPkZhz/9HW9/21EHHuDjxRYepCKrECyQBMNkrpkA6Cp7jgCC0cA2sIkhBjbB2tAEmpmRIQHlYbTGYowhUGY0ItJbY0N6Lp8JkhFmRfy4SHSRxiI0nxNdzAFqjb/2+tf/wn/491rYZOiMoitaA7axidG6vWebU/ffe02gPCdacSV0wWKQKzWDI888fWrVmpxBK4ltqbCbJsONtRGrpoQVOyYb3KZUDoAwlp5163I+5OgTbr3yilsu+PLK2UHWuHcXlJOJOe8ywAn77rTx2vsfydNdmLZg5nnKONy86ZgD9//j3/udIw98Whp3g9iGnFls6GET7XRt9y5KBJQzorrhyOe3jtuQPCGLIsgQg2/dMhou9qmrMNwy702TaS7BDC5JWXk8puU8KdCFxziZ0gFDoDEYHIA1rZkrhvBrP//z427xzz7wd+3sKmfokiN4g/EqLZ687x77BNrCAmLIFkr/f85yaiFr7yMPP/DY40dCZICL7Mtx6g2fWbPCSlgVOwq+LCL2fpnTiqVCaFc847Tn3XnjDaOFRwJhBvMkghYbqRmOjtx5zaN7dV+6c8NwymBxKgy6DRtOPuKwP3zb7xx+0AGjhcWZqQElWJgkSkub+9pGmKUXKyeS7n7Ifvs999RTmtkpz9kE0KRsIXTD4REHHEA5abOD5lknHa/Y5MlrLFklzphWTM94yrTopXI/iSY5EdKzUttiyCwT3tm70TTwm7/0X9vQvvd9fxtmVyVg4GmwuPGYfdYeuvPKsLjRjGMLGTBXhBI4cnJu3TPOPJvTq7sUGwZAlJdBJ05YE6iF96fCzbtaGz2FCGui4dJXkFzuLrk3Pjz/4//8tU9/cEUcwRcCBDWuxmDm3sXBI2w+fPXt188jzu40/8jGZz794D/5vf922CEHLw4XBgwhBBgjlhnB918UwXMT6RByKhINY+PW8bgbd6WaFUCqz+0EzMQ4N2hALY67LQtDhFA0F7Dk8QoKWNNMDRrzQIEGBFuK6eQ0w5KbBFOxDkRWzshyaxbG6Q/+7M/e8dd/MzW3wtLW/WfSSw/fb2/mZjTftWHRzJSncjbnqI2bFJ/x7Jc8+4dePWSL0AxoJgeymwmhTEQX/9VQ3Z9rhFWx4ypZfcFRYi9nBTNDYsymY09/9h03XLnhzutmrJHGIp1GUWbMwzUDnHTg3huuvfveRx48+sBD3/W2tx1x8L7z3cJ00waVyG1bSsRyG+MTJqcMwTznuZnpdnam+P9FkBMVZgeohG4MYqZppldN0WLhomJMUaaLHAhjB+SeaQFGZzH66v/zUl4VCISixicZg0Wmzuea5ld+7mcX0/h/vf/9u0zhlAP3263NmF9QEwUQHpBMDg5GHtbstd9xZz5PYdAgspefV/nI+XGJd0UlrIonD1u+oLTdvBsJd/fZtTs96yU//KG/fiAPNxUGiX3cYMFM4637r1599J6rD4ir3vbbv33k/k8bbt5qM02ABzMVfSpAcC7pGvdKWkUCvvcTK00K0eJDj26aX5hnIKEgmtgpKwSXr52e2nXlSjkXFocPbX54JIQQAS+9ZF56shx7rlo90zQhmpCA4AggTATYs6f13V0mkmTuW2fbNgy7NIjNb73+dbtqdMMFn9l/JT1tTI3JY0JqcybcLS5aHE+vOufFr1ixbq9xhjXW9sKt5bKf7ClwO2nnikpYFTs0jd8Wc0GQ0R3ssu1z6NHHP/vsiz7x4bngIY1gcsqUAKPYdKOjdl9z2gtfceTBT9sy2jo11UTrBdfLDt2y4oBQjLqWFd37IeGcocDIv/7bv/3gJz85mJuVu4kUHWIMw61bXvHCc371F36hibz+zjt/8S2/uUCE0LjnEjHBLLnPxvA/3/wbJx55ROpGFiAJxQSCvYKC8JghZJqZRMmlRMDka9v4w8859SP3XRa7TQ3oDDlAFDPJmNEueHzGqc8+4PCjhwDMIjhxBnsCq5zKVpWwKv4VEkUROcY2Z+vQPePZZ99xyw0P3XDpyiIIY+bmEmltK67Ji/deeuGmZxzX7rbP0DWjYGFbK3sxkZ40b07oQttxRiBTl52895GHr77pFlu5UlkGK6JdoYl544YTTnh4TIjYnEZX3nrzPAOsQe4bQi0E97yq0eJwWPRBRRi0rf69XbDT56gCSpOqnKVTKxgfuveucz/zoXY0P8cGmR6YrGuU6VBoFzvsftAhJz/3BZ0NxNgw2DLN6GJfaFbbep6CuUbFUzjaKvGCpIDE0KxYd+bLXt6uXjfyEKw1QTB3gAEpzzBtuOv6Cz/5IesWIM/O7BMX1F67eGl30PU429XynOJ9wxBsaiZOzdj0jE1N2fTApmc4aG0w1Q6mjGyAQJsaTLftdNvOhHauaVc2g9mmnY7N1GBqulTZMyAvM0Ba+t1LqsqCXL48ngSRQYM3eXjhFz72yN03z5hZLkIPDPToCrFZdITV6579sh+eWrUzrI0WAyY20bWwXgmr4nvHVgBCb/IOdFm77/f0Z5798nGYGbsANylCpmRKzOPZxm+4+Lwbvvrl2QjIvS9SlfEUw5LXzhMGc9imdONeRPo8yzulrCwfS8nzmMqxDBLKlJASsoJ73/5e9jWTcqIABFqQFSfmyS5oeRO9j7NP/GyWZn5kmmpx6yXn33Thl9aFHJEyxm7Z5cxgZlIcxamTX/Ci3Q8+LDsMFrykmdq++FeZqxJWxb82Z8EIGg1oDQ1Dzjz61Ofte8wz5vO4kbUZJJMSLMMCoAGGX/3Ehx+4+cYY6bmDZ8kFeu8asdRYz+UxlqDQ678ETNoeKEF5oobQiy1TOUwqYQ6AdGYFObKYM7OoiYIW+v1OLb1eb25TstRiygWHyyH3nMbdKBofuuuWr3z8/63otjbKcE+ATBFuCBamtnba78hjjzjtzJEachCKy5ltR1ATEYqKSlgV/7qUJRDywGTIcHePaubOeMmPrtzjaQuZROsSgjKV6dkwHdA9dM+Fn/qX0daHo0me0XvclBG+JS0bPUG9jCwGyxnF5DACgbAiJlEmouFLtl9iUaShYJ3YiUmWZJ1tK5Gpn+d+bORokyIWvTRhMUNdS/eFjed98l/mH7xrJgLumVLoX8nRbM5xbo/9Tn3BSzGYS2zE3hhRgleGqoRV8f1wEiWHcukbiKEdua3eff9TzvnhYTs9gpsJUpaRLUR3TLV26zWXXPnlTweNsieYwCyjl0HBxxCipKXgSz3DBLO+F4JQT5olraSC+WTahZDBqRxyjtljRnREB7JPTFVZhqXzMitTbStnweUmmBf/Lo/Ml3/lc7deccnKJsrdaZmNOynArIPmw+DEs1+06/6HukdDWNoO1KRntV4ulbAqvmcQ4MyTzMrEAGMMYTTKhxxz8hFnPHdTyAqgm6HN2Sk6WmcYWLrkcx+/8/prm2CeE+AZ6u15in7CE8kXaElKITs8mbqgLqqLSgG5QZZysWPN6BvIo7J56s2eYVSAgsEoCsjuWcXidam6vqzBQpJYvE7ds0W74+abLvrsx2eUjSHRslGQMVLRafPePf2UUw87/pnjEcytKU2idJkMCKohViWsiu8DziKNjGCAhUySCIyKsyec/dJV++6/deyNDQIUQqLBFGK26eDjrQ+d+6mPDR/dyOyeczE35WR0ZiL2vn24hYnVV0qWR7Ebxm7UdKM2jds0brpxzKlx7xsylek55NR6Dmnc5C7mHJJb5yHnZbM/egyTsKSRxSwRdHNXMvOFzQ9/+VMfSRsfmg7K2TMJytAZcmCzONZO++x32jkv9sE02URr5UsCXi6IdQrt30IFpJ7FfwOEtezr0k7lrq4btoNwy+UXfOxv/nyw+OiUdfJR5AA+yMg5dNlsYTR17HNe8pwf+w+LQmMxAFDwELIUoLCsx7LYpwLI7k5ccc01N995R2haTKwsXDBSXXfg05527JFHZfmDGx658KKvJgnBShND6e+SewBOPfHEtatXhyIzajQLS4SSQOutn5nAlDuyG2D0pQ///Vc//ZG1wcwXewNpKRCK2pq9G+z8olf/l0NOPG04TiG0gZE26WAnqDrcXAmr4vuQv+SkSfKcsqeIfO2FX/jCP30gjjZNWyKZMmTM6gIbV7MQZk55yY+c+PwXjr2x2EYYyTJ+zO2TQffe0z3n1DStkY9nTAAZSCkBMjOzEL7O+xy5e84xWFGpDxb6/tXSD08CykKWpzSasu7SL33yKx/5x3a0adqYvUNRN5YojGLcEganv+zfHf+sF4lGC5DRDCqxZ00j/u2gdrr/mwy5+gK4WdMJR558+sYHH/japz8yIIWcggsy9SZ/Tdpy4cf/abfddt/ryJNHHiwyIAeUuvk2tiktl0bK1YSmG49zDEsT0wYwZ07U/mwi/JBTl100y7bdGzSHkRaCyw3FcxpFnYoA5RDcLEHuo6mY77rhynM/9sHBcOs0BU8wFrHTRCgMHhnl45979gmnvWCYbTCIJOFLm5w1qqo1rIrv55iZ1gfNpJkRIdnUCc954e6HHLklhcxIg9GDmYQMb6PCcNOXP/rP8w/dG+WjbtTlLHcp9SHV8gJWGYuGzGyKNiDLowEZzKJZsFim/oq0AxlCMLKFDWADWAtraU0wIygPk0nG5bQIQXIX3NPAusUN93zxw/+PWzfMGZklRWMTQLlyGGz2sNtBR5x61othbWNxor28XW9ERSWsiu/blJDbFj8IWEKYWrf7aS/+4bhm184NruCSZ9GNbsizUZvuvuX8T34I3aPuo3F2KXhmIaxtpjmk3EvLZUn1ipVfkRsOMmT1xaJgxYGi1I0I9v/vK0qloEQrulf9QHJRlSnbkEYzz/KUNFo4/1Mfeej2G1ZHWBoTgFrlgCwIY8W4Yqdnv+ilszvvlCMVS3j3OGuMikpYFd+vEVbfxj0hEgshdDntc/Chxz33+Qu0xptBLlrIEuUwwuaCbr74Czde/KWZGAUmKCMUC8KljnCWcKmUpqw0q3sZR6aJJrPisSxSiIZAmsGMRps0QVlpMF0Gs4lWhPpxnCRlp3ueMr/pssuuvuCClSHAu0x3Wi+Lao7QDHN73Bln73fYUSmLZkC0/lfGEl/WdvZKWBVPIfJiFAMN4Nhx3BnPOuCo4+YzFQKNIjJiUrGSHw+6hYs/97FH77190FhS7uf3gOVB1vLXRh/LmAod9RZ//YPLmBOPezwORa/YC4USkKdo40333fnVz3xiOo3b7IHWGcaRss45zFFb5fsdfvSJZz63Q+OK6ptLKyphVTyFSculDJrYxMHKM17w8qmdd59PCozmME+BypJDgxi23Lv+3I/8sxY3h22eXt/opb/h4xs+d1kKO6HEPoE0MmUXM8bz53/yw4+uv23GFJQF0IIAeRcCtubcrtv1jHNe0sysTmoQWmM0bq9LU1EJq+KpVM+Ccj+VTCJ6tp323O+ZL3jZMM6Os0VZ47lRApKH0HmcaafuuPLiq7/4qYF36CWsvlG17PGPbYz0mL9+vTe4NGq9DIFoza+58Nybr/jqTCv3EQB3GkIUaaHLIYfVJz33h3ba58CRQ7GVrG/PR3Wer4RV8RSNrkAT+mEaUmbZmsNOPPXgE05dyCYzIKjrIh1wGWmYYbr4Mx+599brYvSUu+XaCY9RntH2jwmJaXtO+9a7/Mrv8ZxSa7rvluvP/+SHB3lk6FjGhGhFakahWczx4CNPOfqU54wZZL25LMoIT/UWrIRV8VTmLKPMgEiE2IoN49zp5/zQqv0O2phMoTEasywjKFlabJHS1g3nf/yDow0PUil5554nM38uZakf/ivp29JjW51/Uj77BhIuRdxZcsEFlyfI3VPOndQtbrzvKx/7J224d5pZoiM4DfCQs0LYlLBirwPPeMkrLM7EODUI7YCKFCwko2oyWAmr4imcFfaKWX2XgSyMk1btsscpZ52DFWsXFRQbiIGkXE7AB43fddMVl3zxEw07KGXvAGWUDidfXpXaIVkrAZo5IIrm0dLF537urhuvWdEGIDmSzOAeTCIWFTi79tSzXrh6tz3FgIlUKTnpn6iohFXxFI6witFEvz0ng2KMwy4fcsxxx5x2xjjD3cAINGTjbDIMSFOhu+z8T99+zaVtEMTO6VrqR+2LYk8mluE2vS1CJsWMkIFI3XbdFZd+4VOzcKRcdNedipHK2diOxvb0Z5566PEnDVNyo7a1dvXblvWMV8KqeMqGV4BvqzIV/RgnLTQDhalnPucFexx46JbOZU12yUFKDEAYBPjWDV/+2D9vvPdOo0u9Ct6S4rrzyb83lXhNTnckdyM33H/3F//lH7m4KTLDzBiDw9PYJbd2a4c99jv09Oe/xMMU4kBAUV3GsjGcyliVsCqeugWspQU8EWQnHQa2GXF69S6nveRH4067L4o0BCbzsXmiy3Kea7nhnltvu+HKpjVncjomaaVD/uSYoZTxnfBJ67t7CpauueQrj66/dTrm7KNsGaYgb+QuLjLYmp3OeNnL5tbsmrwBGiBGhm1NEUVIphbdK2FVPJVPcNk6EyUDAs2sjMW04w57H3LkSc974VYPDDHQo7L1klgBblPK1110wcb77mqiM3WOJPdCfpOa2JMIsNyhokjqzD6IYcuD995y1aUtkywhoJi5Sm4WPQy25nD0s5+396FHDsc5hCaGECaN+ESEAoBe27miElbFUzkvLAM7Vib7+k09FC2HcOwpZxx0/ImPjjuPgSbBYVGKwcO08cE7bjzvE/8URlupTp5LlxMBw5PajnMSNINByMqOxdht+crHP/zInbcNGjiK/ZjDGWyA2G5Kvu8Rx51w5lkdWmPsZeL7jxaWdinrya6EVfHUr2L1J9qEQG2rlgsmxWZm7ennvHx2t70XEjwEAULI2cyhlKeCX3/p+Vdc9OXAxOxCKLJ5Tya+Kmp/kFEGeMLIQnf91869+eIL5iwgwRQNwWigstJi8nbtrme88OXN7JqUEENb2IrLE9/ecbWiElbFvwXeMsFEiEazMs9nxmCh67hu9/1PPuulwzCziIhgVCYFpUBGo6XRVz77ifvvuq0JnrNLIJYrsH9nb6joQCB5Z8EfuvfO8z794Wa80IBEsNwERc/u8Bw5tHjaWS/efd9DvLNBE4HiOVGqVqhVq0pYFf9m0G/7FykETkxKAZEqwgdkXEzx8BNOe/pJZ2zOQSC8M2TQIYfybBvmH3rgvE99ZDzcykDvRd2piTnz4z2iJ4GUvs43FQgrIjNAHi1++RMf3Xr/3TPMyJ0RDdxclCm0850OP+m0I048vUsxsClhl/ooTZrEa5WzKmFV/Js5xUU8oVe0myRPZjBQFtnG1uLcyWe/bO2+By3kovzpboYAQoMurzXeefUVl5z3OeN81khOZEpZ6Bwpw73ETC65oNKvkPvMr7AaALiKrY4cQpKP0AXmq7903t0XX7LGGoNgOSCbUpIQ4yiH1Xse8cyzfhQza72JiJo4i9GdxX41AFYbRithVfzbi7Ue/zdChIeALmP1rnud9oKX+/SqEQ3RHEperhAFdAMOL/nSp++47qpIjbsuT5oJSrvmdkIMKtEXhe11kftSkwHmWblL0fL6W66+9Asfn0EyeqI7kd2TDCGOxHEzc/JZL169276OyGgwL2bSvfzfhH8rW1XCqvgBKGxNJGQcim2bcjj4yBOOOvU5806ZG+RsxJDhrtGs5W7Dg+d+7KNbH34ERIJScaRQP78nUkY3yiiaw3wpB6TY17wI0B2SBWO38eHzP/7B0Yb10zFnjbN5mXp0IpMLziOf+azDnnFidhhyQ1JB3ksKmrG4gdXzWAmr4gcj5ioGhn2/gxEB1pzy/BfvduiRWztnCKGoikIOR+5WDuIjt9542Rc+RS06OxHkJMSRRO+LXn1paWI8CAdcoDTJEgEgmy9cce6n1l9z+VzD7KNsqbcOlBDjQvZ1Tzv4lLNerNCCinTzDk4smTlXVMKq+MGKsAAhgEaidCrkjMGqXU574Q+3q3bpPATCIJjBIsAmd6tCd+V5n7rl6osGMWXPyeXe61BRolSKSks9D0Sp8ktgBrNTgufURNx27aVf+9xHVzduSpmuIvHuMLOR2Kze6VkvecXsTnskGRkJSC6TJvrK9fRVwqr4gatqcXINmLkZEMLYfd+Dn3786WcvdkHw6JnZ3KNk7iPDKAw3XvTxD22657bWUk7jnMelR6HQU5DTQSFI1otouUB3QaB7zuNgeeN9t53/yQ9iuDlEOgm28ujuVIK4dYxjTn32fk8/ZtRJaFhUGfoCWOWqSlgVP9BhlhMZyKI7ld0z4jPOeN6+R5+4NXeIkQoBgYArBXSrWm1af+tFn/4YxvMNUwgQHEZNDOdVDG3ApShOEExkpjk5ls9f9PmPPXjnjdMNutxlCQi0ABCx2TrWfkcef/wZz88WyyR2dte2ti/VHoZKWBU/sHTF3s6mtAiYNda6xzCz7pQX/8jULnttzTBGjjtCjE12Wc6rGrvhkguu+9oF0Xw0Hrmxkxzs27N6Lwhti+RkAOHI3agNfu3FF1xz0fkzAUZFa4RY/jXGwdYcmp32OPWcl0+t2kmyxmIsQ4U0MPSGO3VXsBJWxQ9ocFVaDRSgAEVmGBjZjjN33ufA457/Q2lqpYA2wMwzIWtdLRxN6i749Mfuv+3mqUHsPKsoZE16SDVR1dNE+KrIu7chPHzbbRd+8uNhNBwY4Tm7G2OQgntyH8epE8956R77HTzORSs1G2TFLqymgxWVsH7gA6ysfriFE2m+4roVFh2Hn/Cc3fc7dDgeBgrIcnehAwHOBCzce9f5n/pYHs4HZIOXfqyJu2BJ3HoJZEFSklIeLZz/2U9sXn/HTLTg2dwDFOAmD8bF4fDAo48+8tQzOgWzlhYA06RTtJ6tikpYP9AgGBBIgxUZZZJkbGTWNDFanJpdeeTJpwzbqSGj1JItzJ0JMHOubnD3tZdd9IXPNCZ18yl3CXREOajOlLPkMsjg8tQZ8dVzv3jLFRevbjygc8HUREk+zkgdmGdWHnnyaW07C6OZyBwijCLIIskAVE3RSlgVP9is9US94iSCWefpkGOPP/L0523MRGxNIq2oj0IyaeCLl37xY3ffeGUw5jSG5BJBipL1re60LqfGcN/N11782Y8NfGTMUBbgKI0QQghbMp9+/On7HvD0lHKwsM3Mop6iikpYFU/MXtsXidylMHPi81+6Zr9DN48SacjFekeEC2xN2nTfFz78DwtbNg6CkMZABgE2ghkEpZTHRo0XNn/xw/9gmx6cDkyAmAUhxmRADPNJs3vsf9JZPxQGq8BAohh3uXs9KRWVsCq+2WVBMzIydG5zu+5z2ot+RHNrR2oIg7J7cmUwyLVyEB66+dqLPvVhpgXkDspZ4+zKzpyTy+Vd8IWvfuajD91yzYqYU+7Ya4XmlEdi6Bh9Zs2zXvrKNXvsn9QQgajCoRWVsCq+fkJYHgb2j76b3GIzNRQPOOrY45/1/PlMs4g0DkEgiEwas69u/NrzP3Pz1Zc1TSxq7xkSRbPkCMZbrr74ii99eqUlaGTBpeTKMSBSMGxNOO605x1y9PFJgRaXK4jWjvaKSlgV3yQl7CVcEGiBkJEJ8aQzX7DvYUcvdtlMUIYhec6gOxupSVsu+MyHH93wgMWGghmNyMpNsIWHH7jw0x/h+NG+px0OZEeWw4wLXbfnQUec/NxzwMbEYEYrJfb+US/RikpYFd9a8EUzsgGU1cyuPuXsl3LVukVZAmW0EAgRlGMqto/edct5H/+/nhYkMY2Yh/JOGp//uY9vuPu26YgupyQSZjJaq9AsJNrsumee9dJ25U4pC0r9C9ajX1EJq+LbggBJkJsUre0Udz/4yJPPeemwmUkMcghuzIAEY84rzG/62heuvPCLIQSD08cD03UXnXf9hV+ek0fPMIiBKrryoVNY5NRJz33JvoceM8xEaIyscscVlbAqvsMIq7elUSgqNBl2+CnP3vvIE+eTZSIXZXeVqeZE5IGPL/rUhx6488YQQ4jh4btuv/hjH5pdnG9BMJRRQ2aYB4Bbx9rrsOOPPvWsTpGhQWhkEeyb4isqKmFVfNthlhjAYGATo1kTZtee8eJXrN37oIWk0slJ9uJ9JAYB4wfvvOAT/zyc3zAabz3/c59YvO+OFSFD7jIBphwkWlzstHav/Z710h8brNoN1gQzgBkEjDXIqvgG91GpXh8V3zAxnARc2TPUBR/dc+uNH/k/7+sevHUGKUoZBpPoIORcSOHpJ5yMwKu++tU1ATEPHepCDLDQdQhhK2Ncu9uLX/0f93j6caPcxtgQMCS4kQFFgr6iokZYFd9Zbsj+WnGTMsJehxx54tkvXYxTY2syAkmXsuTOiDjDfPNl51/3tfNnQkeNMjwzugJgMIxNC9Yc//xz9nr60eMEmGUVAYZe3hRUrWRVVMKq+E4CrO0TNDIEWOiyjj3p5EOPP2VrCuJAjkAEgLDstNAEs0FjBoc8sqUGQS3cEON85sHHnXL0M5+Xchs5FRQmKstkr3xaY/6KSlgV32lGuMRZDlPvZ0izcOYLXr7zvgfPuxCM7nQZICo7XFEus5hFOZqskB3BtiSs3vOA08/+YWvmyIYMVNHK6l1RUbtFKyphVXzHdLWUFQog6aIrZMQuhTW7P+30s1/kMzMjQlZCJBHJlFrlNmW5owluWRwBqSPGUzPPPPvF6/Z8Wkous0yxGF0UWWWi35ysczkVlbAqvl0QtkQfBhgZQrAYzMyatutw0NHHHXPGs7YmTxbc3D2DTsvBc0NJlhjG7BjGjHljlw4/9fmHHHfGqHNrGxLB3OgGJ0AEINRjXlEJq2JHkpiRZkYajR7bk5/3gl0OOGQ+S2ghMxCmjI5wCCnLQlDAVuR1T9v/1LNektiKAXAwT2KrKslQUQmr4rvGWQSL72DKHKzc7dkv+7G4YuexDAbJ5Wahya4QA2HuXJR106uf90M/Mbdmj+wWLJYCO3uBdgqmbbuRteZeUQmr4slBEuGEIEEykrDAwTCFvQ8++qRnvThxkCWjEU32oBCT55Yg2y2aPu45P7T3gcd1HdsYSBgaqoEiFFE6HorY32P3JSsqKmFVfPtstfQleg14iHAJ1iwqHnPq8/c/9BnjbNnhyjIlY6CifHGY9zn0uOPOeGHmNC2ILhYdedWLsKISVsV3Iwns5bFK5b2YmlJmQTFAGMRVu5z80ldNrd03C7SxzD0zyIZZza57nvnSV02t2jmBpBnM6KVRdPLKy3WaWa/JikpYFTuawUCajAxiG0IH7bLfASec/aKtYSqhDW7BYqcwauZOePYLd3vaIXK1DWiOfkMQdSasohJWxb9imgiXIziCRHLo+YjTzzzoxDMWxoGZIOaz9jvi+ONOOzsrENnQAUkwKuBx+vEVFZWwKr6bURZQvAgDcoAD9Dh7+tk/usu+hw4RFzJW77X/s1/2KrRzkhthEBHEAGiZtGlFRSWsin8VypKZCCDDs7HpcrN6t/1Oev6Lh81samefedaLVuy+31ih92Yt7QskqOLXWo9gxbeLWA9BxXeYE1ICnNmQgwcSJnSOg4478Yi7bqH8sGc8czF1tKZI8glmfWBVb5MV3/FNstY+K74jvnJkR4QSkUyRil12GIzdaPFRJg3mVo0EhGBSw0iaen8L1dC+ohJWxb8yYQki4IADQV5ISAkdAi2bewrRHOZioBmKNmmtRVRUwqr412csAMrlKnLQ4YZMOWAOA2hyyGnRYSAIJxwywGC1glXxnaDe6CqeFGNBgijQ+mtJIImgMrrDIAhwAUv2XVKVj6moEVbFvz5l9fqg7COmnoqo/uvlw8xcGhKU6g5hRSWsiu8NZ2Gpr6qiohJWRUVFRY9aw6qoqKiEVVFRUVEJawfiu5cOf9uvrCf8cge8VS3DjvqRb+vVvldn9nv7Dr+V375D3uT3/7nYsag1rB8gUv7WS+P9T32d5wsCYN/HzQmaeIZ9H/5G1V3Sf8MR1g/aDeQbhzzf1jF5Mofu+98e8OvFgNre3nAHXjzLX+rJBLzf4Jvf1st+K+f3397aid/nF2X5wsv47Ne5jz3mrDzmX0mqjwm+vSjjWzjfRXizvPY3uW0+4ZtcuuJKT6Wgiezmdi/l7uUnln/8b3yjfsI1sOzHn/hHH/MmHctaPQn7OkPL5VPsEHr7RsdQmDR9faNT4+5FCsJ927Fa/rLS5GLgsl+LZZfIt0ZY7k6zvq1DMrNvevE8/jbwGNL5tsK0J/ot3L6isN11osd9RKl0+fZq1WashPWk+Grp6MtF69sR9RjKeFzpR+7Lz7oK2ZHlzH2TgHzbylOfL0/O8/Y/xd4VWfAl4vrWQv3HLrlJ76Uk792Pl3rCt/sh0sr73/b2oGXU1r/wY15/28dfIh6J5avHvtvHHmCVQ4/JD/HxBLK05IRvR4NhOWNs6zDlpE9+2zO2PdHlS+t+W3ilZWeDWM4d2386La1eTbiJKucNkjse9/G+LkcQZYmrv9L0uONGPo4svj69fgd38W3XNgA5trsGlt2ntd1CgC9nLPXXgsulyaUQlo6Uvl/NbL9PCUuSkAURYpYhjLoUYjAaQbAPa9j/CYLej+HKXISye2EBowE0M0EZCBQF8InshSV5WT0OuBgEZoggJQBWYpzJS5kU3CFXsBKCfKO7Y7kESEAuIWcSyv312uVssYkxPqGOQULOXUpdF5qWLoPJtMRrE45zgCKTUnCQzA4JNAWaSAFGy56pTAoKZiap8OCEOZNcZMiO4j6ovs7p5l4MVR0UEVSCjP7CJpDoMAYXRZlR25btZH2UVcPyiuw9cgobZtIkuhxLoZx6/3rBS0u9iphWlsimbZ7wSDuQszxlUMHKhUIayzVlZpJnOkEmmJkEmUSZCzT1r1HeHikCdCs3pyj0dNevcJdTbhCR3a1cbISJNG7n/yMIzEDWuCGMDWiCBEexOHORpMHdw7ZgzSWRAWS5mQUQQpaXV3TQ2DlNsADCE0S3mLKiMUAwiSaAIhyAnEsMRXgWhHIZZElSYAaNts2HuxLWtxpa0VCOMbkwHG8eDRljhNFo0GMIC7CiHyDAXU1sZmZmBsDYc9elQHpKFowsqk1f50QQKFGxvNBKch97Ho46Ax3a9u+AgOmpqca9CQYRZo+J0J7wIy3doB3uIszGKbVt2zbthsXF226/4867737gwQcXtsyPFhdWrVo5Oze7x1577bv3Xnvvttt0E4bdOGSP1oQQBCesRHkqDhH9vZcON6nLeetoXNaBSEHmmGriTBvLB+wJgMtv+MiuYRqOxhkWaAQ8e56dmpqxkNV//MlapBldgDDquoVu7NGYEcHMCT/3UZImOX1/dFzsybBUUiUDpgat0cysxHT9eSVTLoEsU84MsRm0m1O665719z/40D3r79n06KOS07hy1apddt35abvtuccuu66cnhqnrutGTYwGmsxohfRAWR+n2OJovJDGjBEgUw7GQkhLFonlPWa6E5QV9ixHoBy5DIly+XQzmGliiVseG05JnnOGLSgNx4uRIBJIwSGHc9C2bQgBom/T3imuH+SSuxCXqJ8Gd7k46sbjbthZEC0C8kQyie1galpOuDEALgT0NxAoS4ZRyqNxl7MzEBaY86zFwWBy9y9+kawR1rdayZiEDbDsakL4zJe/8Ff/8A9xatBbrIj9PU4iIO/voGWZJObZudkD9t3vqMMPO/aoo/fYaedRNzL5gIS77BuVk9WXkAxwl9PCF8499/3/5x9C2449kWYMygpAMP7ia3/uGYcdmnO2QPk3LgGUm/yyFFVMLg8WBlN3P/DgZ8899wvnnX/J1Vc/uHHjOKVxlyiRaJs4mJ46YI+9Tjn++Bc+/3nHH3XkXNN02YPCZD0RzOyVXSapigSGW2+/9W3veufmlEJoQKMyhqOffvW/e8lzn+NpXA7ZY7T0Okgx/uX7/+YL550/mF3hcsC78einf/xVP/z8sz0no6zPDwFRRuVsId50201vf8+7FjwbozlyOU09TffThhBQwhHSEZZ8vizQFxaOPvzpr/+5n51pmwYk5SXjBqAi9dCMU7J2sGU4/MpFX/v4F7/wlcsuXX/vfePhuOs6yc3IYBZtn912P+6Io55/xhnPO/WUXVau9C7FJrAo0BNGc8AAzwpN+MQnPvU3H/yndmaOMqUk67PTSQIZMEkhnR4AEF5iRIAoARxcyXL++Z/8yeeeemrquoj4+OsgK3fE3/7zP33q85+ZmppVpkhXjsR4cXTiMce85j//zHSgGRnCpPA6uRzRG0FO4lVJSNljbL58wQV//bd/r6mphGDuwDjGsDC/+JJzzvnpV/6Id2MTBBMl0KyXBDKLXzz3/L/6wN+EwWwprHUL8z/yghf8hx/7USkbYXpska8S1rdQ4Si3YkLAHfc98Onzzg8rV+TsJRLuAwOVrKLc+QXJIDGLCOR0jIfsv99P/tirXvHyl80OYk5dJCc1qSeoN6mEUYLR3F1CNnzkU5/5l89+fnr1mrE8S4aIrIHZeGHhsKOPPPKww0ySsmhCsG9etSm+fsggmjhM6UMf/fhfv+9vrr7l5g5EM8ih4WCqoUkwY855S0pX3XnP1bfe9nf/8i8vO+t5b3rdL+6z2y7j7I0tjRYXRuhrK0HKgoW4ZWH42a9c8HDXmUXPaggbDp915rNK7mx9OKbH1AE74NLrrvvkl74cVq/OKbdN6BYXzjj1VJaTMfHkKiGuQ1mu7I/Mb/nkeedv8UQ2ZTWC7PkUS2cKkPcCfsF8clRCCHnzxgX318YIA5CXkrul45mzx7a97IYb/+i97/3seRdsXhxy0Ma2xWCqmZoxBnkWXOStD2+4+ZOf+vCnPv3Mo45+/X/8Ty989hk5pWB9eUykQLiXWuAt6+/+2Je+3K7eqVvM0awzR3lffZi1bHXQWdIp9nVGiISZEZ7ZjV7+whdaCSZLWLhUzRIgWQzzi8NPfPlLn/ril5qZ1TlLNJpHAmO/4dZbX3DO2ccedFAaDRuzyVUie0y1D9sGxx2gcf399338i1/k3KqRGyGoiwalfMfd95x09FHHHHyApzFjX5nKkAFytWZ33HvPp847X1NzWWxCGG/eeMiBB7pRbqH3nfw+LcB/v0ZYWBr9FwAbNM3cHOdWoi/6ZLI3CaYomgUIDs9WqkQ0uTrlK268+Ybf/p0719/9X3/+Z9c0kTnLvmlpnPKckyPG29ffc8nV18zstDOmZk0eIuVgLnE0zr3oaz/9Y6/cY9Ws+jVm+jqdS+ornqLkOTukZvDg5s2//853/v0/fWhxnJqZ2cCQIBFZQHaAOSkwWGgUPbbtyNPf/vMH5zfP//5v/9Zua9aMxuMmBJKODCIy9ulmqYYQiM1g5ap2nBia7N4S1syHQet9bCbpsXfRIHNhMJiOq1fHFassezQ6ybYty5AA3JeKtC5ZsCYYQpiemx1nyVrIYNbvWDD0HJHLx3frV7AMdJBUNAMUpmdVcsMJj5ZCYV/gjuGiy6/4pbe85cqbb56aXTM1N7AYht3ISVJGdwcZ3BWaQTs3Bc/nXXblDTf9+lt+7Zd/4odfzvFwYGahlI1KnapcV9PNmrWYWTmYDtkVTVqqhZYitMASYAGgwb2UuUp5kLJAi3Drhs1guuyMTMKgvtJKwN2bprl9/a3X3XJLXLdLbGYsQzQxRbIR1z/yyPkXf+24Qw7xsrVB9NsvfSynZVlHvzZCCACsadoVKzS3InsgEMzhXRubW+657/9++KNPf8N/ZVZDR+h75kgLFhwI7aBdsTJPzxE0C62nOD3t29Uuvk85y75PIyyV9ZHhiZOydHbPnrvkykAuqnEiHFTK2XO54OGunHMGxuJgdjWnZ9/xV3/5/n/8B4RGKnt5S7tzvt3GCkCpxM05e7BwyRVX37r+nhzjOKeUcpdS9m6cxwspqYnX3HjjTbfd2oRG3pc3vhEDl/qHe8ruFh7YtPlX3/LW//V//j7FQZhbObIwKokcrWVoaBEcMLQwc7hrLOQQVqzb+WNf/OIbfuMtD27a5MYsdwgIKptocigzWMkQZUhA1/k4eU4aZR8lz5rs81uglW0G5bJ+XcEUaRRSl5OjE7qUlXMgrd8WdFmpLIr0QIouwIwp53H25BorpzQejxdzN/Ju5N0Qeeg+co2zxknjpM6Te5Lcc1buch4nukezYFGS8mS7kBy5soXrbr3tdW968xW33T5Yu1MXwkga5s5iDMEEF9xMIMwMCTmrE8PKlY+k9Jbf/x+f/NKXrB10OUFyuAOCySigg3e5S8id51Jo8s45do2zp+xdl/M4dWPvxnk88nFKzjSWEpSK84ZykjI9wfPyLTmiDyhd7g5l4GuXXbr+vgctTI+SMujuOdko2aL7iDjvwovmx2PE6EuUOsmnpe2yDqKXQzTAiE557Em56/JolNI452HXhenZD37yM5deeVXTTrtEd2a3UjKb5CaL3bjrupy77KPOR0kZQJCIgCVps0pY32KEpcn76qu8cJZrQDQa0Zg3MRuGCcOE4ZCjMcdjjTofdQGglR0eW0wpBeP09F/97f+59tZbERvfthn+BOFQKei7iyEupvyFr3xljD5sCsboOaRkcldmDJu2bvn05z4/8lTqQd+UhmkgjRZHjj9697s/+tnPtitX5WAdoGBNEyPli1vHmzemLZu7LRuHmzaMt25umacCqZyzhtmbuRUf+dzn/+Bd7+6AccoGlEK1GVke2zc1lc170krsaYAthS29kJWxFGfo/ZNFeBHk6z0jKG7rMcBkbw9GOJAJJyiwxK4BDnigNTEEIhoCPNKjeQwIESEymKJ5oAfzaIoNy+qe7B1OYjiBZoue//gv/uLaO+9oV6wcujKJYJDG85vT/KbWuwFySOO8sBXDxQgY6VJHs5mZDYvD33/Hu9Y/+NCgnVJWKT0LKIRlQJAaeYMclVvlVqmlt1JQYWYHvVxNFhCCginIGyIKhGJj8BTcbdJ1wW0yYGKfGtuWhcULL74YIbobZFL2PC5xj0thMHPF9TdeccMNjE1W6W/xkj7AsLQ7sVxdDFrawcmEkwp9wY+ZQju45+EN5192uZu5i14iSwe9bHyW02qTtjQSgQiTvY5tmw41Jfz2YizQZEuln3KvMdDpbbTd16yZjiGnsaxUvC0lLS4sPvzAgwohzs0JJGOX3ZrB7evv/fyXz3vGAQekVJLN7TXmlkpmOZNyZcZ2/YMPXHbdtQohAZSagN12Wrdx48at82NaJOQxfvmCCx945NG9dlrr3Tg23+TzCEgutvFDH/3E+/7x/9nMXNd36zhdaTxscj7xsENPOPbYvfbaEyEszC9cd90NF11y6T0PPjCYm1Nsu5xzoK1a+YEPfvC5zzrjxaefPh4utk1Lp5bt93FZyaMUuMoVaIIJVhpxqW09k5Lg5KTO3TckkBNp0Mla3FaT8sloDvs6IhlM7u4yorEIs+HWrUgJ9GB0z/3eWt9Tpr4bWAItL2wdLc67UhZLQ5QBQZRrKoTzL7/4c185v5mbS6BIE81zk9NLn/fc008+ceedd2pjuzAc3XX3+nPP/cpXL70sx5ZNm5N3SXFu5dU33/qhj3/il3/6p0qmRaCUowyw8ZhbtxqDZxB904PKVl8bbTBwFGsghNiA2YcLSF1JFR10w3iMmHLwXNLGpd63pUZXzx5ivOmuWy+9+lprp8CglFfODlbMrHrgkQ3OYIFsBvc+/OiXL/raM486yvMSXRD9HuGybSKJy3K1chUvdQ42ZgLd4UYxfPb8C179ih/ZdWYmJw/Rskq3SelUoYkGy9KkMLlsU3Npo7AS1rcTZpVq1KSDUP2yIeHd4t577fOu3/vdnVbMWs40F4MYPGlxfuGaq659/z//82U338Q4JUcOZIhu8arrblgcp2iTs8wn3Mzrs51k/OL5X7n9nntsMCUiyDlOP/Hyl1144UXnfuWSdsUgKbONd99776133r33zjurlJC+UWEspyyL7dU33/4nf/4XI5jFmLMz+1TTpMWtxxx2yL//kR8964zT99hp3XQIGeiAzYuL191w4z988EMf/dznHx2NrW1cstCMuu59f/cPJx111C4r5pDJWCq1fTdgub6t19YrHTgsRdwJc5XbqiSnWUlfQMnKAResbHe4SmTLSb9lz1EwlbZLo7PvTxMImhmUc06xwytf+MIjDzkQOQUgsNwlmMutyNzE0kkfQE/dXrvtNm2RpUOYdMlAAyWcd8EFD23cGFesZUIbAnJa2Ta/9DP/5Wde9Yq109PbGtGAn/rhl//NP33wzz/wfx5eHLJpxp5IDqbaz3/xS696yYv32mkdcjIiUwBdOuvMM9euWe0hAooMGRLdSMbm/Msu+78f+5SFkMvHdp8N+Jn/+FMH7bOPjzszy6ATyXNLM89HH3GEpEBb6uDou+fNQH7+/AvXP/iQzayAkEajQw/b9wUvOPt/vvs9Cyk5LTJ2WZ8///yfftWP7bpi7v9n773j5LrK++Hnec65d8o2rXpvlmVZsmVJtmW529i422CMqSEQWoCQkEBCaL8QeompaZBQQgi9G4Nxb7J6l63ee1mttu/Mved5nvePc+7MbJEs24HXCl74GFnszNy595znPOVb0PfussnGwOFzbQIkRMF7W9WSqIAAimiurm7xqlX/9ZMf/c2b3mwVUBQMSo0LSHYu+D+aPvBYfOHaGtkXZnrVLydVpQwDpEQEKeTETh83YXxDHWYdQgYwAM7BgrPPmnzm1D/9q/e09SSIRhQRSQGOtrV1l8pDCnGljTUoqkFVjTEtXV33PHB/bzmJ47woaJqOHDrklTfehD3lRx9+EhpRiSxQV0/3pm3brrpgngCqKBJo1sDoA50OWT2mjr/53e9u3LbNDhlSVkXEyBKXel+64KK7Pv6xqaNGulIZSyVnkEkFsd7SJXPPu3DunElTpnzqq/+MGDtVUc7n8gsXLVq6YsXt11zjUgdKGUmoSl/BmqNTMwH22m+KFVRRVmgoBCRkNu+qEJpUgxEh1kDKlYLvPCJKKDRVkJBUbbn3tqsvf/0NL/XP5ZmbuAKuXCZFREw9BE8FgTrLpac3bhBEZkEmBCn3ds+et+Dtb/rTQpq4UjehsAKSUaARjY1//fa3tLa1feHrXzf5vBhJBCl1K1cs375rx4QRw1nV+MSR0CjMnTlj3swZkjVH/CUyAAFYMj/92a8lR0gGFUhcXvi2yy+/dM6cQVdsqsIiHuOngRagKmJMfLS9676HH0nDsEGR3fzZs++85abv/+D7Ow4eRhuzSFxXXL1h4yNPLnrNjdcLa1jr4ZwYDGJQLc+N+CGLAoo2NjS2d3eLaqpOSf/129++6Nzzrps/PymlZFDASMDigoJidjqpxwNXe/qAL5aEz25IqH68jepXO9akWqgAalGhVNZiQVU8YUUBHCKLckrTJ0+ePmnKonXr44IHExGQYREHAoi+cVMbGFUrHU5gBorN9r371m7YFEWxsoIxziXnnXnm1NGjz599bl19scwpGItgEtXHli995ctvbY5yrM54P3akmtjgj0llTSOb37xz70OLF1F9nQMgh0SGXXlYXf49b3vL1FEjk1ISWQOxBdAI1YogokvKMdk33vnKx5cseeCJhfm6OnIOULs7j69cseLl11wjpAjsMdmERkHE130BHmkAiFFJVcEIhjFYAE8Sgoon+QT4NKGqoACxgAAaK2KBiQAMEqLJTmBAIFVlD1Dy8DYFnxN5FEDJ9ToRdYl6YBah+NGbn76JAxVEBDLKjBSRtUgooCbMq1hQE057yiVLhogcSkQ2JMwBtg1AZE0EaEAldWXU3BvuePnQIfVkDCACKzm2IONGDBcQREI0EXm+AYhIhfEThqcqTlxsc5qmDsX53hCJONGI0iQREceJ8Z09IED0fXyLBpCUlBBJVdQZNawICOu2bN68ezdGkSooSD4Xn3/uOVOam+bOnLll1958LlYVNdReLj+w8PFXXH+dYTWYAhEaIghnQThjEf2JFLYDIqoiiSEEJ4o4f/75K1csPdTWTrZg4obDrce+/ZOfXjLn/JzvUiIIiIIJ2HZypKBgBASVBDw7QAO9EF8sCZ97zqWQEaNEFSwwKoOynzeDz4gVEMGAOJc651QwhA8EYQBtKBYKNgIFPDHCU0H9ln58yZKjx1tzhcZeVrIK7ObPOa8ecfrUKdOmTlq/cy+iFQCbyy9ds3rrrp2XzpjJLqCDA7K1b6kpAIC0av363QcPQWO9OAEGJFvq6X7pjS+bO/vcxLk4sojAwuDXIRICWKI0TRvz8T/8zXtecdNNUWSFFVAkTc6ecoZz0pdC0Zdciag+Z0IkIARUESeeUkOAHvGORJ6dh8yaeryOonLAzSOQpwf0r9grwbjao/PIIxEVIXIKHEBIvo8fEA2oCMi+olRCIFAhUvVA8zDWz5IIqkxuPX4BoVAoPLVxw933/OZ1t95sVdMkSVONrBKQBeOcmzl5ynlv/3OoSRERwLEDlhpEi8dmokEDlakcoioaVEMUPDMQVfzQAhgRDBIRQUToofpGA/g2oKagWnCphwWy6hOLFrd1dJq6vAg6TiaPGnHOWWcWAC+54IJfPfgoKrIn3hAtX7V6x759Z48bxy6xPiA+U2ZawaQjUrlcmjltaoPVH/zyl6axIE7jYt1Djz1x78OP3HnDteUkIUDfxKwwKQHg9JK6OU2s6msmu6QAkiAKkBprhRkxg20jMnM+F2/ZvmPzjp2YyzEqKpMqsJs1fVpdIedKvZHJZc+4H51XQQUI23tLjy9arEqihATCbuSQIZdcMA9Bxg4fftEF81Zv3ZHL1TnmfL6w78jRJ5csXTBjpogYMgEgWSUwIwKyOAQqO161dl3KYiu9IHb1hfy1V15RH+dcWvaTfM8X00pizhwhGsALzjrrkrPPrh1KCICkaaa+EOJBf4qyB9N6fBOBzUURkcvlB86uFYAsCIAaVBS0ihoEIrDKq9YaCDvVdHwBNesR+08CJWMskeRi2zd2IICC8alzaGnFnq3k+2OI4GnqiABxFA1tHg5h2oYMghZbe7s++JlPb9y88eXXXz9tytT6+joLWQ0lqUt6RZAiI4AA4lRFIWetRSM1JG4vfxFGqVohe2Woz2xWkQGiPB8Jq83wAJnykZsGlG0oImzg4LFjTyxZwp4QiKBJMnvWWZPGjGSQSy88f9KY0TsOHoI4AtU4yu09cGjp8lWzJk5wLmvcPyMlW0BFWMgYI2UhkTe97k8eePCRtjRVmyOMjnd2/uf//M/Vl11cLOREHYkCRIqoSKKg4GmplQrmxYD1v9aBJ6ye5AiAnaXkSFenHz9ZJFIScUm5vGnLjrv+7WudvWUoFJy6CNGmSVNd3VULLgIQDUS4wZYCArMzceGpLRvXP73JRAVHSAhJb8/Zc887+6zpqUua8vlrL730f37+qzIwkHGKrPj40qVvftWrhuRizTDnlckaeRy6AJBpOd6xeet2MlbFky2MS5Npk8fPPHO6MBv0pBdRZQLDiApEAGQJVVUEHCeSGCRRVkMOlEANEKLRk2ApstmVIJAxi1evyeViTdlzoVFVFSUMn8ShQhTtOLCP4lhCmYwIgeF2UuiGZqNIzbYz7j18ZOWOnWkqhhRr3L4oA7P76WTKaZ3NnzVpUgGRAi6DEBGQRLQ+zs2afuavH3gAVRNmIWJla21r4u76xre++4tfzTpr+jnnzDxv1syzpp4xZtiwkUOb80BcLkvqjEGxZJEQLGXjyRMWO1mYkky8ELPGM2bCGFVgR79bgViTpoVfSEUxyq166ukN27ZrZFmBRKzyxfNmNxfryml5xpQpc2fO2LZ7T65YTMplY6iUuvseefQVN99QoIxrBXzS55uBgNGrw1D7sbYFM2ded9kV37/3vmhITgVtXf3ypzf84oGHXnv7bZymBQmJq6eXanBqU9AXA9b/YrzCiq4Riijmi7tbjr37Qx/JWxIURQSGCAwodHV379y593hvL0axqqIqsiu3tb3x7W+dP2dOwok1pjb76JdksaqALly2/GDr8VxTcyqaM0js5pwza2hDA5e7BdMLZs46a+LkNbv2UFxw7ChfWLNh49Obt1w5dy5zajD0qxnDn1CVGdDalvb2vYePCBlDBCJEwOzGjR49dsQIfxEc4DzqSHsdJ35+E3oiAqCkEGkACDgAgwhoSLRK7++fM9Y0tREwin527/0/+eWvLBpF6+8Ph46UEKkAi2hUqIvy9cwKRoNSwglCVW0PX6s1u7Aqmdy/f+u//uu/f0RAEpr16geUCMIQemE2olJv1/Tx4779la9OGTWKU4fW+LQGlQiFAC69aH7Tt/+rrVyObD5Fn1UgkM03jzpWTu5fsfr+pcvysR3VPHTyhPHzzztv/py5559zzviRw5U5dUnOxD5lExXKpClqkGpQM3bI2Jg1vVQvoqCpJyNWwAXZmCFrgko1OwvDPUVJAZauWNXa2WUaGxVBnBvV3HTReeciCLAUI7rsgvN/fd9DoqqGUlWK45VPP7Vtz97zpp8hzlkDGhqSdJKGL3q0mId0idQBvOnVr3p8xfL97Z02zitRr+g3v/f9BZfMnzpiBLgyZHoUihnX+fSpDE+THpbf+aDiGwom6iq7hatWq3J2owkYEREsojVxIc6wQ4TKr3vZy/76rW+LjCmrs2Qy/SakikiWH2+pWhsfaG9/ctlytBELEiJLWhfHl51/vgVAQ8Ju9LChF19w/uqtO0wOHUNsokPHjj22dMmlc+eKhKISERHFFxEeWWQA27u6D7cex8iKiEESBVAZO2pUQ7EAzGTCoarMQObr3/324ytWFIsN4tQgMTCQGgRkRjBkTKmn+7orr/izV79aWBCUNNAkMUN4+qmPhE4tqYIaZbQm1+RSB2R8ea2ZpoqCICgqMxhVFFRVQfBF7iBYQs2o4qF2UczUVxQEFKmjK2nT1O8ICXMI31ADUasKgBRHhss9Izq6hRlAMiEcDEhUNamT888777Ybb/j2D3+Sb8qBqmCYbJRSRcrFhYhQ1aWHjnfsO7LmyWWrCoXvTz/zjFuvueaO668/Y8IEEUFmsmRMEGyoyIphDXTNz1i1IhOhqkGKQlWCbozW4KMq+VQtxSkbQCOLosHWtvbFq9eqjRQB1HC559w5506fNk1VImMAYMGc88aPGrn9eCvGsTqhXO7AsaNPLF9x3vRpnrPhH17FhDZEFhGsCmGEhoAf4VpjROGieXOuu/Lyb/z051G+4FKO8oV1mzf/+Oe/eP8735kCxll0IkUv6EXQp7cnA1jxLwasZ51h+XMrdElYQbVQKAqAEqWEIGgUBRUIRF2aSESRU2Vxt9/+ss/+3XubTC5NyzZnQYBMYKRXZdW8FhQzRfG2XbtXP/VUFOcEASxIOZ0yYcKsGTO8IAyqxsZcMv+C7/z8ZyVXRiQRFaKHFi58++tfP7RQFFUDoCJkkLNaya+G9o7OMqcQGVUQBrIGVAu5XEykznkVLkQyBh3S0nVrfvPAfaZ+CLFJFQGd38LACgomjvj48dEjR1oyLsMWIgyQnISMwoGoAE4YUVlFDCKRClVbNICoaESRDEuAIz67OiFTrkQCJWQF9XM6NIq1bTAVBBWDgKokBoQjYy0F3DWACtbAgkQ4MvR3f/WX+w8dvv+xhfmGJjbGiaaOAYicYxL/dkRRLp8XxLLw6s3bn9q07Se/+PVbX/vqN97xyrrIOpdGUZRpJp7619JnmmcD1EjAQKbGISrGxms3PL1x+zYqxAAAygR60QXzmop1zqVEtszptKlT55w3e/O998ZxrERImKo+unDhG25/WXMuVpUMVXfyZhZiJtfjQAmhjsxrbnvFvY8vbGnrtjZWQDHRj+/57W03XH/uhEmVBe+BjlWcC7ww2Th9fk4T15zsPoqo12FTg4woiIyEYFAJFMGrsAEiEbNDFUO4cNGir379P1o626NcTp0aMgFQlP34CQugp+zS40uXHW1rA2tFhFRdb+8lc+eNHzHCOcdoBDF16bnnnD1l8nhOeg0BENli3VNbt6966unIWn+BAfYXrltUgQCSNElBRYHQ6+8hqFjjj8qqhiSzAgBFeapriBqHmrqmYt2QuG5I1NBk65ttw1BqHB43DKOGIZTLOwAJN0X67UPFmn+qqnhcJBhAi2QEYjQxUIwmRorBRGCJrIoaT11GISLCTHXsVA6VrC3iD20LvgATVEZ2xIwiHgFMyiiMwsCKTqFWLsuPPiCo9RkCSXqHN9V96ZMfe+urX2VKvd0dx5jLJiYbk9e2U6NCkAKWBFJGQYu5Oqxr2Hzw8Ic/e9ff/uPHW7u7MYpF5NRilZ5qwKqNGDWDBVU1aBTgsScWtnV2kY0UlJ1rrC8uuOACUnHMqiqcNuTiKy6an4tjEAUFFjVxYfVTT23cvt0aowIios84KKyAelEdAQIkpdJF55179YKL0nK3NcQMFBe37T7w3Z/9IvU8MzAVjOvp5YhBp0m8qjZKvSCdqpR7epJyr+vt4u5OLnWnpW4udWqpixKXM8YaIiRU3H/o8Be+/rX3f/LjB1qOxWiF/VC/eh76jjMCkrHHunuWrVkDUSy+c8wun7OXX3pxXRQbiiIbxSZnFc8cM/bqiy+VNEVAEUQTH+/sfHzpksSziANnNetgZQLFNvIimeSkghbAVHwDGlmVgTWTziIkBaNOHIvzRGERZmZRZOJERNVpprCrFTZIjYxStXklBGJAIwROS0lXe9rdlXZ2lLvay11tSefxpLM96epIujqTrg7X062urOIQRLzIjuqphCwfqIJQGQKjpuqYE5GycK+6Xk17IS1JUpK0JGm3uG7lkqS9kpYkSdDfByQgk5WzikhIYAnJpWOHDfn0h/7+63d97rarrxwem/R4a9rVzmmPAYkNkAETGzVkSEGYFFTV5vK2qel7d9/9j1/8YltviTOl02eXUlVUQ056DzTjKKkCixii4+0dK1asAjSggMqSlKZOmTRjxlmKZHN5sjaO8wBwyYL5kyeOd2lCCM4x2fhwa9vipctSFvF6sCe9XPG1oPiDVwPWVKFgacHc2bmYlJ1RC2Lyhbpf/uZ3K9avB4CGhnqLBPxCZg2e1iVh1t4kD5BJ0mJkJ0ydHFsrCKpkgEBUUQD5yKGjLcfbo8Z6VjWAkItN3nz/N7+eMn7iR9/9l6lIHFGfuiCo8Iq1dsOmTes3bLL5oopaQuZ02LChzaNG7GppQZbEYCyCLJzPnTH9zGJdXSICQMIC1jyxZOmeIy1TRwyXNDWZNJYAmGxF1BWLxm8AIlURYQDo6ulNRCIiDl03VQXnc0mnoIAqpIrgZRV8WRhqY0I0fhBYI/Jdo4he6R6LUTSg4NKzJ00cNXyYsHhhL/RNfvAxQvzbb9uz50hbu6JBr94yYGJ/0grJB2ol0mIxzhlLKp45iAAYJpKAyESkGoGAxDqkrggVhWrPF8gQ+IgY2cgSMLM10Z3XX3vNFZeuWL320SeXLVmzavve3S0dbeXeVAxSVIijgmVgAWZhQSJTFo6HNH7vlz9fMP/8P7nlNk4SQqVnXwA+M7U9A3oICItYi+s3bNi+e3dcyKcqBhUknTx5Yq9Ldx08SDZGUJAUGchGEydN2rxnLwAQGVEQxAceeeRNr7h9aENDhio5sUouovg+l3gFa0UAQygsL73silnTfvz0lr02n09E0JiDR49++3++t+Dcc4HIKHA2Jcw4p6dB9HrhBixFQvWaSKDgfG+ASSKMXTkdN2nst77wuTFNTayiQIroBadI5NCBAz+4++7/+tUvgAxAlKYMsc0NGfa9u39x6zUvOX/2uSDi8d3eOkKAQEVEHMBjK1YfOHa82Dg86S25WIGgo6vnLz7wYUtAIgDOILGg2FzJqdpImT3BwcR167fuWLl+/RnXXK0qourIIBD5QRwJAjTmc8V81JUkCLEIkDqI4OCRQ929vQ3FIjJasMBB/bwAWlSXR+csR4JGkBG6UcvgABTIAoEgWgAHImh91A3SxNqn94eMAOgMQNm98ZV3vPnOO0tpkkNLAA5BqkAqD9Cmv/3Yx3/8m9/auMmiAgkAB7U9zBBHioJIHhoFZAAJSDGTBUAyiMCl97z57bdccWVaLhEiV5N5JajqnauqMsfWDhk2zPmGW9AVMOKJjEpEGEh5Ai5Jh9j4uksWXHnJgmMdnbv27t2wedP2PXs2bNny9JYtew8f7nVYLDYggUMQdcpiI1NG/MXvfnf7ddcXoxgG8fgJWTEJincHIGBCQTUKCCgqCqIYTiEfVT2ZPGvDAyqKH7uqOiAAeOiJJS0dvba5CVlYMa6re3zZ0pe96c8kTYmsMpOKJQNkj3b3Ui5OQY1aATGFujVbtq/ftu3a+Rcm5V4xhrKbpwDgs+oMLIZ+OGAQUEHIM9KFQB1PGzv2tbfe9tHPfZGlrDZKEW2h/jcPP/b42vWmUJBgAhBgHCSnR6r1wlVrqJ3TV4c5fqYsmgccO6R5/JBGDz6soZvIxOHDzpk1Uwx948c/08gCGmGwNtpz+MiDixZecN654oUCtCrQBgBoTEtX15NLlyiAc4yGBB0Allh3HT7q1QEtqgKyQyALJooijwBVACRjOtvbn3jyyVdec3WYswCgAvnZmKiCDmlqHD18+JE9e601YkDVgaEDhw/tP3Jo1uSpwmyMBSJW0ZTf/ea3vOJlL8M49iVGXZx7fPmKL37zGxTlUBWDHphWpcfxhDV/qBYIkbAujofl86VcFIGp6NMHwCaoExUyOTLgHRmENeu2nQjFiFWzgmyWhQACxDxtzLgLz5gqWeqBg6UkmRqEiohR79ETdK9VBZEYVLJaCxUQ0YGoEycyrL5uxKyZl8yamQB0lHq379i1fN3ae+9/ZPGq1U6RoogBiIgVTFzYsn3Hzj17zz1zGjs95TWYVUzPVDhVIGaoCqrWmkPHjz+2eLEQsXq1tEhRWzp6j7Z2EKoAekqZJes9K8QCKikSGgLQ9s7jC5cuu/KCedovde67OyrteK0UrVrVXktd+oqbbv7NfQ89sW4D1dU7AIyj1iNtP/31PRdeejFGFmpqDH/WvfCb7i/QgFWZ44bBE1IF4IbAXuHNsRNmFYdkCVEBCVTZJc41FoqvvfW2n/z6t8dTJrQqrAyquGHbju4kKSBVmeoVXzlrNm7dumHLpnyh4Dy/TFQVQaLIFNl4rp2QIhgkJEAUcRoQAYLGYD5esXbNgSMt44YPZXEGEEHJU7iQnEhzY9PEsWOf2rmbsq9lbf7AoaObt+2YPXlqNkBnYy2qXnjOrMrELwWIAdp6urx5BYIJacigrpzQx/ap79jQO1opiBfZUSLCTKICQK2qEw+4QEJy4BC0n72ZqtY44vT75NCi990sl6aqWi73UmQR/E1HAT/LxWrtqqoghIhofRtLUbzKSypio8jUdFsRIAXgNIkIUQQdMyKANkW5C2eePX/m2a+55bZv/OCHn//Pr/eqEFrnlMgKSUtb276DB887c5qrksOx77SvbzTAGgUqfObOtNfbQQDHbGy8bsOmbfv3mEJOxHOcDAgQGogjAv/8/PsaABRJAhhCgUSJVIgeXbjwja965ejhzRUZ0uqAM5tL+tOwpqIL5y8atGAcu7EjRrzq9pcvXbseSBNlx1Rsavztgw/nhjQ3DWk+3HKcTNS3e/Bi0/05t61qfDvCUE/DSAxQ1CftFOxqKiM/JPISoEPq6hoKBRAhIgASBTS29djxNHVkKNukDCgA4JgF4ImlS44ebwUkQPSFHhqjZBwgK7ESI7ExaohBWR2hWkMYrHowigubd+56ZNGThkjFX2P4AsZYcdxUVzxvxgxkRwCeMGQwau/qffjxJ7tT5xBTdUgKwIqunPaWk97UldKkVO7uSlT37t+bpIm1Vr3yuIR9cvJzvxq/RMC7aPnRKAKSRyQSIREZIkNYA6ysMd5U7NPbH3RhBxGlSiQjo174ziCQWgJDSASEaCioWnqvNTWIREDG68gpsm8lg6GyyMadu5Zt3rxi27alW7cs27pl6eZN2w4ecIgiqhk30Bgj4iRJSr29OYR3v/mNr3nZy9JSL5EhY1URyHSVSt09PX10CAcBYJ4o/p9ab1oBRJFMqvDokiWtvb1qCIQthQm0ATRAIOBEGZARGURACCDyyy6AUMXmorWbNq5avy4y8QDgLg54wr7z1/fXUK0hl6bXXXXlFfMvKHW2GX+UGHO0veOBRx5NnPQBi74Ia3i+Y8G+0+UsHwryGGFI7xWSUTFISApmCivMwuwMoggzKFtSQvHy4bUmvX7EQtjS0bls1WpGYE/PUkUEC2qEDTO51HDZOIepI8fEHKlY/1/0sk2KZDq6u+9//LFuZkO2gpoOXWvSmPCCOec1FgoqjAYFgAGjXPG+Rx5ftXGjiWNH4Mf+qGq9CCQiIebjfEep98klS8DYzGaOQIkVk5pqYWDZhRXzh8rYDTBT8vM6opnKuapWiq+QcQn03d/6TOtZK2NcBGRgVlElAJtNTkVF+3SNEIEICBVVMOgJoyICi2OVhPWuf/63O//kja97+zte9fZ3vO4df3HHG9/80U9/urO3BEgijIhAIshkAUitRUSpI7p47rwIjP80P7o3RBUPNw9uGgThgDV1UTbqVZV+UtqDfnUCL1cPxsZH27oWrVgp4fl5FgEgiiorpyIOVZQZPLBDUlIhUYOesSDMqTGmp5wsXLIsqaVrDngQVfpytSKRmu2jRnXc8OFveNUr660xIkCQgkA+t2P/vvbuLoyMVE4gfTHDen4td8mUEX2bU7LBsgEx4L0N0DlWVnbgUidJygknZVdKUjS4bsfWY50dhgyqIAFaVJCmpvoojkWcT6wICBWEmeLoqa3b1m/canMNooqq1mAErk6lzkC9pk2a1qOr07RO0iKkdcgF5YJy5JxhNWT8ro/yudVPbdi+74AX8PAynogezUQMMHvmrDMmTEiTHgLwXDkbxQfb2u7693/f294mNi6l4lIltQBWFJyTUuooso8sWvzIk0vifJ06AIwFLaCtGNh5FXdBUW/s4C1PAcWLHgOqYLW5AVVvdq9qLL71roCISn6HkAapBqxYLKMSYUWNFFlFkGuOmCCHT0AIhsBatAbRGCtkibwBniUySoRESBbIeOwbkEUiVa3g7QkjVFNXyDePGHrkePvh9s4D7V1729tbU37wycWPLF5soyhlFVAIWCxA41lMwIgppwKs6EMWiktzUVxfLGYKFqDS3yDet9KIvH4DSLUSRMikjjl8e/Ga3VpL/FYRcB7quW7TU1t27KB8nhUVjQEhSGKS2IglLlgpWq0zUodcJC6iFEhzqpQkpOxbjSpA+fzCVSt3798fGSMiKuJ5YxlXO8utyaJXBK8p0ymIOCARqOOXXnHlVRdfrOVyjKii4huUhEHEGVCR0MNJMHM7f6FSC1+wPSytmYsAAmHVhRRUlYw1+aKNrRlwwgvAki1b//m/vt2jEmNYawIMwBPHjc1by5xaY/weVwp1z5PLlh9qb9eGoqQSE2FSGtFQ/NB73zNh/AQtu8gaDzpUQvUcFBW00fadez71pS+3lsrGximn+WJxT8vRJ1euOGfSBM68mcNmR3UumTByxA3XXL3q61uiPLAIGSsEcX39o08u+dTnv/iR97138tAhXreIWdVESCZGfGzVms//87+WRA0a5qzJWnPyevbGIFJvQSQds9m4Vp1QoXJ5wZbZ2zZqBXYkmV2qZowz3zCpAcRVImBVUAxAVbxiS8p8vKenO03BUAyIAgIgVG0hZy16JUUCjQjrczEGnywE0Qhh/rx5//Wjn6i1pKpkVaGn5L7yH/85Zey4i86ZBQCsDAwWgsdClCu0lUoPPP5EqhopkKpRUXYjhw0fN3KUE6mBC58QUFaZJ+iJhg19/04RRZT93VF9ZNGi4+2d2NRIHhxcLk0ZM+J9f/mXo0YM92cI1SBRCNCJKprv/PAnv7z/fttQ7xAZFI3dvHPXinVPnT1unCh7LC/1baWhb3b4FLAWcJ8pCAKqOm6uK7zhVa96dOmyNGVLxFwzp6lpz4X2PaK+gDOtFyyswcvzS9Zc7NPdxCg62tX1zR/9aHhTAypXBIFUEAS2bttx32MPbT90wBbr0tR5IwNgqcvFc84+O0JMASATeFJRY2xbV++TS1ckaEjYKJBKUuqdN3/Oq265pd5EUd/nxzXSfwdmzPj+D3/UumWbiXKIJAC9afrookWvv/nmvK8TgwhpCJsR6Ctuvvknv7t314FDUa6QKKtH58eFH9/9261btr/uFS+7dP78sWPGUGx6uks7du9+dOGT3/npzw4eO5Yr1CepIFpRVq/fIhlzsG8vQmsCGSkhGE8S7KPeXbP01cMflERYArDA109kQLiqQwl9lN2034ciggElUSVCiKMvf+Ob3//pjx2w17/yR4OarEeMyCETBIuYdnW+/pV3vP31rxf2qnJqCER0wbx5M8+atmrTFlNsKAuKYr7QsG7rjrf97d+/7XWvv/aqSydOGJ8zxofIJOVNu3f/53e/d/eDD0WFOhFVZVLSUu9ZUyZPGDuWXWLInIo6HYbhaHD77pdw9NvSmLXmxZg9LceeXLyUohwCgmhkqVQqXX7e7DfedJM5wX5LASKA3u7O+x55MBVHAgioxnaVy48tXnb7tdfkPLAj+2DUWvGi4P8RSAlVRrYX+QFDoI6vuXjBjVde+bMHHorqG5wwkTGIXDmT+n2xF3B5+ELNsPziFq02FT0V3tv2WdrXcvTTX/2qUUavnxy8hQkFy0nZRpEtFFi8Fi7myfR0dMw7d9blF16QCntmTDgNVRHN6vVPbd6+HY0xqlaRRPK56NIF8+vIltPEywOiAQSjAIzBEMyxKyKNHzlixYZNVtUxAxkw0fKVa57eum3BrLNTV7YIXh7EO/e6xM06Y+pbXvvaj37+nyIPSmYRAQWycWH5hs1rNn12/LgxI0YOpyjq6ek+fOjokZZjEuVMsVhOOSJT5jRkCChG1RfMihlbFQe0Z0PH2NdzIUwLesdZrO2qV6DaQWRCssoCqgrKoDCAFdtPBU4VUQSUYPOe3Ru3p2D9dqdMQTZUjr4i929LoNJ+/LabbzRIqaqpeCqzGz9i+OvveMVTH/uEMrMaVSwLR/nCtiNHPvLFu771k+9NnTh5ePMQS5Q4PnLs2Lbd+3btOwCFHCMiiDVolCOA666+akh9XZr0Ep0sWGklw0IgJCUEJQGVoHkdjBlNX8UXn7oKS2TjtRs2bN+7J5fPOSUCYOfyUXzxvAsj1bScBJMPMlBjaO80dWRnT582eeyojQcORlGBU4e5yEb5RUtW7N1/4KzJE0ppGlmrylCRR+pzOGHNfCCYIflKwJCKumIufuNrX7tw+arW7lJkYxYnnpgfaFuZSlglw37RSPVZ/oQ2Zw3kBJGCw2Sozq3HvYsAB+FjNaAQFQuoIMoeu2DQkHP1An/2qteMHTkqTZJcZCu0ej9te3zZ0sPHjkVNQ5z2WlSXJiObGi6aM9cgxGSNgDGqJCgASAaDg7GCDikWZkybhg89IiJAyM5FcX7/0ZZFq1ZdcM5MBiFA47HuooTEyi5JX3/HK1avWfeL3/42N2RISdRl5B2qKybqth49svnwwaBYaaJcfYMKpKIRYdrba+JYyDtBqaGsF6V9ROSrRU1wug63DwD70JIqnhRZoDNBGgBBvZ+esviexwkGaYhVSx0AVS/V7GFUYqOY8nlBFC+gqhooiqqgGPgkCCgQqzNEo0eMRoAMJCkAYkidpLffdOOjjz5298NP5OqavIppiqrWKphNBw5s2rmbnQNDioAUkc3HdQ0OBEhFJE+2t63zuisuveW660g08oZi/aQaTgAB9JNUBPIdz8ptVR0ILAtO0CWQhxcubO/uKTQ0S8qImCTpuJEjL7zwQo9tACQig8Fsy8M/IGISdmOHD7vkwgue/vFP1MZgCRCifGHvwUOLV6ycPnkiIErwzYZM7T3TRPWmUgIgUJV8hmxyhCCsaZpeOG/OdVdf892f/MzWeRgQcOBrgor0Ncl54fbeX6BNd0EEIAICRQFgZaIMk2sMiFFHqsYxpWwd55hjx1HKmAqmTlMWAEKkPBno7Uk72//67W972Q03JokjYzy8ymgKnCqZI11djy9f7jAIc7K1aVo6Z9rUs8+anjo2ImTEm415baowRQTxAm+XX3zRyKFDnbB6zXJjE6AHFy5q6e0lG/n+pah6LjAgAqfNsf3037//xiuv7G1rIwATGT/xZhFAQzZvozoT1dlcgzF57/sUqUipe/a5Z48YNsSJIBkEC8Gn2CqAADISqEEVL89UzixJGcSRkhCBFUQGMCLeFDW0MDLmo6Kwt7FGAzZyBoy1hkhAEgBGUPJyoJo1yD1VAMqqkZKlSI1VUiUBREFi9uNaUe+DyyIOmFEZRZRFWVQAUtE4zo0cMcLbE9agIQlEmwv1H/3why+ed15PxzEwibViQA0SkgXMU6EpP2Rkrn5ooX5olKsjk3MMImgAjXJXe8uZUyd+5L1/M3bIEOccKg6cpvZRm5FM3ErQCIpQAghiDBoEKgdPGQIhxAoWTsNcguzhluPLVq5milIvDSNiysm8WbMmjRsrzhEiUeBaej9UA0SKBowAFvKFl151dWOxCKBgDQM5hS5OH1q2tCVJnecqe3wnkfdETUElTC0IyfjvlXoKvTBSEDoyUYRo8ta+7pUvHzOiWSTByCCFVxo1Bqx4ADay547pCzVmvYDJz6G/gQhgEWLEAlKebIRojKIRsopW0QIZQRIk9rJ0OcI8KaYl7epMjrdOHN78off+9bvf/tZiFMWWDJnMpFMcOySzZevW7du21eVyljmnlEfKgV6x4OKmQhEVDBFWu5iVXI8QkYhSx3PnzJk5Y7oRV4hsjGRF6+J46+bNmzdtIo93rXQ2EW0U5XMxMI8ZPuyuT37y1S97mU0S7u7KG7KE1nh9hIAtMoSRwRwRupJ0dtx85ZUf/bv3NdcVrHCMSBq88GrIzqRQtbMm0JzBGFykLlKJRXOAMVZUXGrEY7Jcg5147RlDEIHmDeWNiYlM9WMqsqJVKWH2OAzAPFKeMAaxqB5spQbQoCEwBsmgB3uRIUNgDUWEFiEyFBHFNhra3OxUgSqisgRABo2mbuq4cXd98pN33nKLSUpc6sobzRsgYSIES0KoBAJqIuNNPCJl19lJvaVrLl7w5U9/8pyzziqXEzQnqwY1+BEGiACqWIWYICbNEeSJYkLj80lPYqoOGUBByyJszPotG7fv2RkXIkbBCKOcyeXokksX1McRqFhjqIKBy/B+Ya6HJMyzpk8/e8pkw2l9ZGOFSCQfRatWrty+Y7ufFWbgXxFQB4CIOYI6wiJKwWDeUOTzW+YqNM5L/CBx2c075+xbr7uWXBIDWIWIwKrECDljMbNUPAX4yosl4cCkPCwdDSbQSTnt7ERAFAQRRKmgFDPd22zLEiq7yNjh9XXjx0y+dP5Fd7zsltlnnV3u6SZxSCEC+i1ORAj00EMPHzt02NY3sKi1yEkysr7uygULyJ+goqHxmtnyVQkRkApzcyF/8dzzHn3skVgaIUkETC6OD+3d/ehDD1183iwDVb2hYFOGFNuoXCqPbm760ic/cfG8C77zox8+vXNHb7msSGQjrw7shC1CmqYMMHJI4yvuuP2973onM+fSEnS2Czvt6YQ0qQAWM1svqNR8xKzdPdjTZaOUhRRQSokkaYBaqVYlqDBAkIgMKmhS0q52ryrsQKWnG53zRgthZljLVfRVITvoLalTsgScKAIqCXpFVyVFQcVafKVoJdNARC6Vm8aOrSsWRYUw0yL2z1eEVLicnj158lc//YnLfnn+9375iy3btnWVyg4IyBAhkQFUYfa1EjltLBamnnnGrTfc8IY7Xzm8eYgkJePFuQBOKqji9bwQAMCl0tOlSQJoFBQ11bwNAzbCiqZ+AG95NLPjhx98qKv1WL6xyfPzEpeOaR4yZ+ZZ/ausrOvv1yKL+CgzcfSoS+fMWbNqjbJAKkg2B7B329bFTzxx4YwZaYVBqIqKBkDKJe3qBGZwoJGVrg4tlwwogxBhVrt6PRmNQGKM3vTqOx984P49h4+afD5NywgENkq7uzQtV+byIYN+QWr44QsTcBEscERFGIxZ9fTTq55+2uYLpCiqxu8dCFN6DZSdoG3iQIr5/KQJEyaMGzuyeSiBujQ1wYgKwbN4EEVFRR3gwiXLdu8/gDZiFUMEwkPr66++8oq6fA6ZTVidiN5mJttHqgLKrKBot+3dt2TVqlBZoQEFKfdOmzzxsgvnGSRF418bZAhBAZBTl6qAMZG1+1tbH168eMmyZdt27Tp8tKWrs0tE6uoKDfUNY0eOnDv73GuuuOK8mWdbcUkpeWzJkkMtraZQTEu9M6dOXjBvLikQGDWovkZV8QZeB462PL5occIpknFKCGAcnz9n9qwzp4hLyUQgvkVDmf8CsuNUZPHKldv27DG5HAEgIpdL8849d9ZZZxEo1aidBMsLZVHZf7T18cVLyjVzROzTiO/vVCSZHE7IN5w2NzRcddkl9fkYVchYH7NQFUTS1JG1LF5r1uxra1+1ds3yFas379hxuKWlvbPNqTjl2EaNDQ2jhw6beca0eefNvmjOvLHDhjrnPMEaEAxZQ1XI0kAog/+nSEqGNu/cs3jVGiGrAAYAQUj5yksunThmjLjUO2IoEoBHmKtj7U2TRUuXHjzWgsYIoIoIu9HDhl928YK6XGw95i1YEGmGavdKZQ6RRAGJtuzetXzVGjEoigaJVNKkPH3q1AvmzUNEYiYCNCZJXGTs09s2r1y3DqNYGdQgl5KZZ0y56PzZqApgK3rQGBgikgIwwMKly/YePEhRLMIIgGTKpfJZUydefuGFBhkFAI0qEL0YsJ5VwApoRAEkIfVzdntqCVqlFcwu9UrbWtFEhkqLxAAAqxhjg9pnTV85YBIhTNIUkKrE/IqKd4pgWEHRUKaSWSMzAurKiAhk/UFXi672dGhCZE7RGoM2BTje2XW05WhPd7eoFuvq6ot1I4YNLUQRAIg4FEYFG+UUwAsPGwBxiSHyOE9fH6KwJ/wJGpvhdvxswYRgmYgqVMKoz7O80Y+IiJC1UHXFCd6iws4QVeRmAMBlGu2gomiRkKHK0aTnkFaLqjCAIlklTyAXUEbxYofoVcOsNf55lVSPHT/e2dGhqimoNaapobGhsaFobOT7OGmKwZ86iDZasidZb6qiAAgiwmhig8TZd6koMWKmL4gmGGmjAHoEDijFZuCbO2ZENYiqmbF1FgtC69ArwovHH6Kp3uMKORycqIJYv3bAk57UGxd6q1rJJoXKCagqWCIiQg1S9B5HiKwKtj96MQVQZaNokT0XMYCBXgxYzy5gVQ/k0MTELNOpnfL0/+UMqEJYPUs1Y7QTCHjznGzo7w85DCObDM6XURShZv5cMYLPjHPFrwNW7wSu2fL2CCwNJBU01eaAr4D8m6InUoiqqFjxZ5o/EiksMFVWVTFgAawiKDiVwJgFMOiBAYJAgsiggGi8lgMQAIkIiFM/pwukHCFEIG8lOwBQpeqPYk9hpiobEQmRsrZuSA2CQoC3y85KUZVqVwz7NLb7Pl7fjqHQGAvDfgRkUAX1zejwjqg1+UgI9hoMOggD/DVkSMriQJWQ0MfXoDQPFReTk646yUQQRQEEjLctJWRVATQe7BSSQz9pA8p6PlneDQwKgpol1ERIfeN3HyMMBU1VDKDnFoh3SApsKkUAReNH5MEzRTljIKCqVypBQVIN1EzPSQwPXStyHV6aX0WV2VOakISqHHoir01DFYmKF6QSKeoL2N6nZvwsmmmwk/fuOwHwuLJ2+8tyVP1RvMAWZalQZWdxzZGW9R+9enLNLkWsooRFHGbllABRH1Ecf2MznnHfqKpVVyipwpwUOZgu+drOE/8Q0TckIMjahbhdi8IRRKpgCdHvmWC14rWlIPQjsndHDEYsAwNW6FNVJBcg8+qsqhdUkEpYPSC05jFBptKJJ4QLVEwAPfI921IhRUDJxB08xCl7rSh6rgFmfQCttMs1g3pq8AkLd6kiqX8yKMNASE31eAJRQAFQQDvYkgutIvYLRQHCJE+qjm/97wX1ex8H6h1Bapwmsm9Y+f3qAq6ozFa/V0VSg9A/kAytFQDAWcDyyiKQeZ1li9K3TWvX1gt3FPeCDlhVgI9AzThMT1pwVE7jkHtoH1R3xX9kAJpXa0NSJVvA6mcFc7+aGyY1e4FqKkJ/GWZgwhj6XzUARaqBmyn23+WooqqExvsyEQRIUF8MkPgNWpEeAWDV2uG91rIvNNsDQdF4EPSRb4T5fjwOFFepDVjYLz0J/6/PRU6YMmsfey1FRcUqfpv8Xqw0fZXDRWXS6RjicgXVWjV7xYqnKXo/ZaxUX6cSsGprMU8MrNnVZtBv5FvUggSV8y/MEKFGvkJPMprnYHpYQzPH2mumvo+878oVrTmctXKROgi6N/tGffr+tV/EwAv+x77Ao1XNza36V52aagDoQMO1Gk4G9j/zK3lzRbGuIhSVHbyekQ0GQhJHmWQ71FybnEjLFmo01rKzH7MoidrnW9dqHGPFLkh8Med9UbMdXrVc7v9pFUoJZdEEK/ZNWiOUX8lktXrfKOMQYiWW9yvrwnyxX8TLYPiqMNiWqSIy+2AuIdCGsl2eUamh4tCBWjmKQsgzmLEgocYhMIDosYqhr9UYfJYLD7OZWX/fq771bXVNVLsP1SMC4Zl8PIxin9+oleIC6RtFKw86K5Op9v2xn7BVrQx4liNXA59Av0S5VoTuBer09YLWdK/Wc9mD9CeXGSylqnlVVdlOVbGSyWs/NxStGKlWYHK1GylIBvaR5dJaCkq2lEPvKytzqLYXBn2kcvpt2pq0Q71wsPbLfNFDmhFQwWBFWFVrl/Ngx+IA+gySb42Y/kptg2fYGkKwnjD4qi+iUZVqfKj6uOc9U7cIaijQIdGkgdlBbfaqigimTwGLNSgT8fusRhDHB/lK+qLPkERkjclMoiE7YzxRaMBt9evHq0uGb+QrKkSo/OszYpq0z0OoRO3s5lPFofake6RibK8nOyf6CGBh1kckHJAhvGChWC/0khAHz530JAGr9qVh+FUztK4Z1g4SRLS2lVMpfLBytmv1OO9DAsb+naD+D1yp73mlWpUI1gwSNchV1VTFUJNfVOQntZJNDJaZVjsygz1lP2U/WaIxqGLUgOL6BJ3HU12Bg0TNCsBu4Dtj7a3pw0eC2pyw5klgn4QDB0uRqgW7DtjoOujZWROwao6lmrP1pIFDT3IvBt5/7H+UDtY2GewWDmgl4snq39PD+/kFHbBOcYZ4Kp3Uvl2kZywmB9+oeMo1LKj2bzngCXs6p2AULoPmTf2K3ME3Q1+9ygFfH5/Fje4fsE72uuczY9ITbbA+fSgdrFGD/xvvfEovOdnTf5a/DM/+qk646qo4lkG6vQin/c/pGbCezxd+Hu+M//9clQ5AiT3HyH6CJOu5fqNnMXd7Ls8Xn+G76ABtKHxu7/yMAeL3rbbS7/2fVbjXwSrMGtJVFbwC+n8hYll48efEC2AQ4/dT/pFK03/wV576kfwczS6f81F0Chum6pSlv4ewhc/lFafonPjMt33gN8JTvtunfB/05Bfx3FJUHKg6838iSJ3+AesEJWGfOusEsNKTF18I2q/O6lvZ4alssww8gyfNR55FDVE1csdnE600qPmepKgxJ9h4esKeV7YzB7ujz7MSPIVkcPDGWt9A8L9Qug1av5/kq+mzDVvVZpoOCDhV4B4+q0Zg7bpFE2BYkp0umOn+/D6f0Ysl4QmSl4CyzgDPGaJIoapoPrAhFVrWgwGLqu/sGKuidaioFN43ABP7RJG+3AURCdAGDGSSLAbW9k9rOi+EKhIEJNH0kQDtM+XEMIoEBK+S+wxw7cwAKgNzcvaJNEDzN2A+PTZawpsHICZksgUVzrAHfFbH99XIFUSgqxg0fP67oiZ0am2rL2CrtILMDNIOp/CJ6t22M1v3MDTMxDsk7HdP5PLvHZxhaZAoJhoogcE3SZFqQCoD07QaYlaGhwosAQxNc0UkDXNPr9amgAFJdsIpoWrffmi/oXYFTBOA9yrixQIQX6Dkm/+DGRZWNlsFSYDBAIFqigOscarCmsd2suopW6wYpAK0+qq+Y+1Bj3IvSulJEMBVf6iq8UOmjQrKqIoAIjqQjVu74j0PvMIHA1WD5hmyCAyOQgoaiVqs3CjVPsh7lYCiBvZSY1nUDBckVSg5AGSOapkHntbYp2amx7+PrpYqIiGLeGacB3tjoFNX4PUSMAYn3tj+CyGgBJxR5SzRTHbC3x/v9eA9Gk3AIw34alpBySqIiBoPsA9Q08qtwEHPIUBRJTLC7HnhmVkBiWbaG5ixpJ9xvgHh1iNB9aCpweJXQr0wI6KIENFg2LoXA9bvNc8CBUJmdqhIBsibeAv2G10LkM+HcfBMW7OfsPxFFcSjkLySqWcJI/WpRk4Q+YBV1NuHe/h2ZfCeQVND9GRBrMDBB9BY+ogHiCgSEQMDgEFkEfIkur5lSIWgq4igIqII4FAryQgiIEttouppOqpSK4ZcCZd+H4uKKjCIigQip7ePxYAU8z7tKGrJPLfO8YlLLZ9Weig/MDsALxoImfcqGAUTdHIkA4UNdhopCHgLLG+vIRT8Z/oIznjxBFEGREKrCkio6qmBJ0yBs7upjEBkvJWcwuBmYsFdE1QkJOIO1bulorKoEog1xrMFn5kpIwEuqESOJVPODxGYK/lpUDTxwpiUIchOv9rwtAxYQWmN0LEooSHjtWyFAID6+fmqAVZgx5YGF8yoLYKcgIpSZI1BAIizFeYSUWaw/mNx0H68iIqqiawBYICob48kABMwQ1hGRgFc0FrQftvbH4OOnc9fTGQRAMECgLCAgBrAAUDYSnrFzAhgraUByaDW3IEK48OpiHOE5JeD1rSrWIRF0RKRob4DhL6tMRICxw5Fjdd0ff6bATM1T4HEJYhorLVkau+qE5e6VCx5ncWBn1mVx/Be0kSKhORPH3HsELyUf/AyExUyJqLI59PMqo4Dh7ovl7uSoTh2xlqLBAAOArW4Ai7oN6HzpHEFNTaqtBF9+u+l05xwqZSmTiJjjD8AzAlbWqrqSdEpq6KQNTZ7IlTTlM2el3rRG3x+M5kXA9azPnV9B4sFGHT/wYPHu3p8KuOfb23A8nrVdfniuDEjDVaFn/q1ab1MVsqsNgaCvYcO79i16+DhQ0m5NGRI8+RJk6dMmNBYLCTlkiXKTFJr0Z2+CMPOUunA/n29SZJ5mGil++4qTlkey8quqaFh3KhRIGA8qFSry8vvHiQS1a6enn0tLSJBa3ncqFFDGxpC17YPEN+/Xsl7XHd2Hjx6JGVxqsYYUuWAuqTMxEsRkUDFpcOaGkePHOkNZmq7ICLMLAq4Z//B9p4eMhTE2H3jENFLNBjy9jA4YfSYYpwLXZLng8NSrWUWpaJKEUbmSFvb9h07Dhw82N1TyudzE8aPO3PS5NFDm1VSdqm1UV9iwiC5iAM4cOjQsbZ2S1jMxRNHjbLW+poTABhECQ+1Hjva2iqIBmnKmHHFyKoq2UHmE4AozKy6a8+e9t4SItbn8xPHjM5HsZ4AE+I7DC3H2w8cPQrGGGOUBQiJUJiJaNjQoY31DcU4EmYR9syJrCqtMrlr6gcQADDY1tW57+AhsJYyHnrlUA26ZuIMwbQJk/JRVDmnXywJ/xARi/x+Fc7Z6Ae/+PW//M936xobwREosRHKAL6kYI3hzo7L5p//pc9+JjYiymqAwJCabOTEqkggzjHYeF9Lyze//4MHnnjk0JEjnZ29gBhFcUN9w9lTJ7/+zjtuvPZaYDFOCFUNBsNKBVBkZozs3iMtf/n+D+1pacFcDKAgKSgwGEFg0JiVEMWQNVQ+3nHzVVf808c/GhOiettqqHSXRBwiiqra6LcLn/yHz99lbISiqUs++nd//8bbbuS0jIiiYDTKhO+DkIEKGILtu3b9zT9+9EBbh9qcESaXgDElBGCKAY06NeTIEGmp9fifvvzln/zgB7mcICqajFOmqkTgUoP0tW988wf3PRg3NjCnBhQpcmgQVBFEOAJFl4wbOuQ/vvClGZMminMIoXmMzylaCQsZUnaAmjJQLt51pOX7P/vVQ489uvfQ/q6O7jIrFnL1uWjq8JEvu+4lb7jjjtHDhyacxpR1c/pNNkH9IzBI//6d7/zPPb+1SAvOnv7NL94VW6PCSt4Fydlc8af33v/5f/23XDHfVKz/zy/+0wXTp6dJ6tUkfX0YGqgoIGQUEjCf+7ev//axJ9HqvGlnfOtLX8o3x6JqvaO17yVi8AYCcTbK/+aBB//xq1/FxkYSjVgMRYrAyCg8dMiQ6VPOvHz+/NteevXo5iHO9QoIOSSMvPWpAUEFJVMdm0mat/kVq9f+1Yc/6vJ5AbFEVr3zkaeJG0IFVxrb3PQfX/zSrEmT2TmqtAFfDFi//5iVnfEAPUlyuLU1J6glSXp7wdZYGChYY1xH68QpE9iAQzVaFZupenQrOCcQRRt27Hj/Zz7/6NLFGKFLUmOiXJzr6u7u6Ok9fOjgilWrD7YcfctrXhOxIkqm0lLVOTcA6mTP7n17WlogH4MIKke5PEY5hwqo1JMoO4dso9gda2s92qIqCGSwL+VMgTAUmInIouUrdh08lK+vB+FSUlq6Zs2rb7ouJlJ1iKY/iTiTF3Cp271r98GODoiLwCmK2EIhjWIQjJkhLTthQYAYoeXY4ZajFr3bti8ZNXPlU2MNALZ2dBw8ejRKHadlShN2qmAgIvBDSFRIylwqlZxTJPYMbXyOICDfZBYVVUnSlPL1jy9f/pmv/svilWsAicWpAlrrupLuXjp27NiqjRseW7Hq0//wkRkTxmvZYWROYHvqxcnoWGf7kZZjYG1LR4cCGWMqQjUWyQB0J8mBlpaosT5JnZMa0eSBo+pQhWpbV/eh48chwpbODgmafIEUNpjPPHQl5YPHj5OAJCmUejIbakXC3YePrNyw5VcP3v/j3/zqr976lqsvvgiTpAARoAOyil7PjSoIBvLq8ADl1B1qPe7q6kVFSj3AAhpU/gNfMO3VpJQwCwAjEAGehiit0zNgIWKGTUJDGOcJTLGQnzJ1ko3AoVfkRVQlRdfTPXPaGSYcixRE6RBq6MooaLpK5a/85zceXrxoyJBmcKVLLrnkwgvmF+PC9h2773/woeMdHYnKP331q2dOnnzLpZdy2Xlj74zKFybfxVw0d+b08e1j1BoQQYuHj7cfaetCFAI+84xJ9flcCs4YIx09M86YHAGaGkHUUGdkcy9jowOHD69Zvz5n4/pikSJKjrnlK1ceOtY6edRwda6GcxdgD37uAAj1dXUXnDu7patTbAycWqR9LccOdfcKUcHaMyZNyOWiFDWylLS3T50wgVn7mgCHpg0SOgWwFuOYoqihGE0bNSpGy6ISLMHUAEqSjhk2rC7OgwJU8kV67ueRiIgo5YpL165774f+3/YDBwrFOlKZfdbsc86aVl9Xt//gkXUbt+7adzBqqLv38cX4+S9+/VMfH1MsQo0Ecu20DlC9NaQxMcaxtdbYqEJ6DBglVAQwxlKUs1GOrMmUXTKgwyDDagAEshZtbCI0cawnUGYI0xYyABARRcZaiuLYnj3jrPqhDVpOI8BjHe279h843tUL+cLCtU9t+vsPffb/feSOG16a9pZtFKkqKPe/rRnTH62lOBdRFBkdN3Z0Uy5HoTL0JksInI5saq6PYlQ1XufLwIsZ1h+uk+WLd2/L5BRHjhjypc98bOq4sexcZckiADjORVE9GYJ+OuPqJ40iGsV27dNPPbh4cUPjkFJXzxtvv/WTH/77xlyBARjgnssWfOCTnzza1X68s+Pue359/cWXkHckFa2iGQlZeMKYEV/78j+JgAKyuLhY+Mo3v/OFr3/L1OWLBj/2/vcumDOnlJYJkUQLUUwqSJG3f8+cOsMu85PtdRs27NyzW1FmnD19+Mhhv7zntzsPH163cdPUUZe7EJ8o2MhW5G0Q2PGZk6d8/ctfTkUQ0aiQoU9/9d++9qOfmny+LrZf/Pg/zJg6tZymiIiieRs7xwhCmWxeBfkkKsH0iQyXe8+YPO0bX/rC8EJRmDGzafWqLpZMY7HOpakh1Cr39lmf4AF+AIomOtLe9Zmv/suOAweLxXoj8qG/fs+rb3/Z0PoigqrTHXsPfvpL/3b3Q48MGz7y4ccW/ure+9756juYnaW+oLa+bU1QUBb2LrZBm8f3JElRJAjVAzBzJl4zaFusf1aswuJHuiAwOLNBg3Q2OFI1lArXReZ9f/UXV8+/0PX2RsZ0dnVv3bPnmz/40b0PP1ZfP6Srq/MT//TFqZMmXDRjhktS8qrWg98xEERBYHGk7m//8p03XnJJmiREqsqCRhUtaAw0pFhUx8ZQRUrpxYD1e/9hCDpHYemYCNQapdGNDWMbG1mlUp1rSN4Fgqu713rKWpjeZAUJEbbv2nWsqwtyxcbGpptuvLEY53p6evxI6paXXPXAow/8zy9+FhuzaeOG421to4YMYWHKFIN82g2sEdkRzUMy0IszZAu5PBApGFBpLNaNamhIoY6APN5AOIQoDP9TI+QH4ACWLF/R0d1Dqgtmnzdmwrhf3fPbzq6uhYuW3Xrl5SxqEIGyFjWQhzkCKJHJoyk0NYVQqI7I5vI5p+KH2UMam0Y1NjoV9QbBfnKU6SMEEEGIw0G0xRPULJnh9Q1j6hscO7QUQGoQ0G/CrEE2Tw0iPffdoKqA1vzmgQcfW7oiamjs7e56/7ve8fY3vI5E1IloSuJmTBn7kfe9a8O2Lau3bdFy6be/+e3rb72poZBjEUM1+IYatK7XYPT4KM0seStYcI92E1QmddhHfaMGc1tbgYewJSpqFAiFvIY3ONVB1UayPoRhgZgMCdYZM9Raly8gQMPQ3LiRI+aec84n7vryt3/401x93Y79+771ve/N/dgnYgVC5D5lXBYYMaiDCIuxaFlH1jeMqa9nUSQRYACrQASg4HxMZgrtyhczrD9EPegx3BUAu4qSYyOALCIszpEx4H1wQQI4J8AExWJU5T9o0IsEgCRJEZHRpI7L3T0RUhlT4yXgk9I73vCGSy+5GICGxvk8kTjGINpdvSSwQAoqAiqoIqIUGRUnHi4NmRUgMxCjP2/JqJ/M+eFnEFECBgSEY52da57aCBRFgOeeMW3S9DNGNg5pa+1aunrNgSPHxg5rYnVGg7kMVnSjDHtRVBUxACwOQASNAKoBh5ASOGFVRU6RLCgYv1u9I3GFr4Pg5ccCo0OURdg5YRHHKoLA6udr5OGO6gXWUb2nzHMrCDWoJhts6+y9+zf3pQjs0lnTz/yTO18VCSiLMb6jT6Wke/yEkX//129/bOlyIZw4rDkt90AhV/UMxwr4Xg2iIjJU2cGZCJAGNdfMij7YZSNWICAK/XtRQV9bvVojYmgtYVUdNIN8ZkrFFUunoDKISKQMYC37I0fAIItwr6uL7N//1bvXbd746OqVUWPdQ08uWrvh6UvOPTf1bj1AWkFnoSgIkI9cahBI2YBoWlYRSRJjiFAVsmQRMxa9nj6CMv9XSkLU2oilPsslIgJDhKQIBrz3rRVxoAwglNlDhO5LcHIXABjW3Jw3NlHt6en55v9876wzJp8xZWIeCJ2kpfKsCZPPO3NG4u9XkiowUVWor7bUzNZ8MBMDBAEJRVIQaadKF7hWsrMqSepRY3G09qmntu7cJYgTx445Z9oZY8eNP2vKlKWta7fv2rV+09YJVy5Ik7JBRIqgD1ieAKtpGoEJmMQgNc2AJrhrYlXyQGvUfPthuzLtYbBEURSTNRgZYDCGCDzkNNObBxVOMUjIP/d6Q1WtiXfu3bl+82abyyVJ6fL5F40e0gQujYhEVBQU1SC6pPemqy+/9brrxGcRaZkEguT/CTakZl7v1ciiFSrD4CxqPAWV29p7VhXhxqqw3sB3EJBgqYrIKoooBi1iWu4Z2lh/0/UvWbRhtSlER1pbV65Zd8nscxG04phTe2mYqcoaQgZWEDQGicgSGQuoXvMRAQyjioCh4GD9IqzhD5RjhWVgIJv+kNWyuEM93bnOLk5SzzwI5iYq9fl8MRdZFM3QiMGoE8iP5Fj0/PNmT58wfsWmbfXNDQ+tWv7qd73rJZddcuXFl14w69wJI0YY0O6eHjSWEWJjfLpBZBQr0KpwSFf13VHC4aziuWNZRPDQU6zZPn0CBQt7jN+ylWta2ztS1VkzZ0ydML6Qy125YMGS1avbe3sfWbTo6svnE6Kq58chhWGjJ/5IJXOsiP4ZVmAgMSjesgy9DWOIlf3lvSGDB1DVEwFtt+NDnV295TTYFngrF1AUrsvl63OxUSBQen7tEc/Z3bxj+9HOLqgvxuIumje3zhInqfdXJMop2Ag0jhB8jaMoIhWvNfRNxpMuoJoz5hSC0al8H80kBAeLYmH+W8Oh9441lXPOj4oI1RJGqvNmzmqub2xJ0tTp9l27BYCVIxP18yHQzA/K8yGtiUWkw/H+nt5ST09sIgBhj0BkrotzDfkcCROCQe9u/2KG9XtNrDwnw1PXfG9UFVQxwoPtre/68EdyhUhFQ49LwQBJuec9f/62V9x4fTkt56xPiwTVhCSEQFXScnn88BHvf9c73/ePn9jTejTfVL+j5eiWH/74e3ffO2n8hAVz515/xaWXXzS/EEWSlgEJTFB3z4aNmbI2VKTJqbLjjXqfL6l6UflptD/4MnedmvRCgWx7T8+KVWtY0ZrogvPn1hfyyHL5xRd//Yc/OHas8/GVyw4fPz6mqb5qoFO1hkD1fjlVKTck8PkmEiCC8YB3BAKqETzXinZ7tp0CtTdUvpTPbd9/4M/+6j05ICArgECooBFCqavzppde/Xd/8e6cGAOqos+HV+uf7L7DRxIUC9xYLEwYN9aXzSlBV0/vtl27ktRZxYhIQRyCIsRkzpg4salQqK13qkJimt2SyoPLaCuIfbwsq+GlVvvw1AqoDJvXDzGA3jmtYrPhl4hUi0sgNKSoqgSKJlKFkSPGjGgedXTPfrJxV09P6jjLifpET0QK/rkK7AQjw5T72Be/MqS+gcWPsFnRREhpd/u1V13+wb/6q0iVAE81Cr8YsJ53egUVPVwBYO8OjNqdlp/avEWIM+4qgaBFcj1d+4+2+P3pYXz9BddRIgOOk5tf8pKhDY1f/uY3nli7prWnHOeL3QJrd+1es3Xrz+6559qLF7znHW+de9Z0cQ4JpS86x/Pua3N1rRGo8ebAWWJYgTYq9WkHV+d8xtCePfs2b92uis2NTfPOnS3sMHVTxoyZNHZ8a/vmbXt2bdiybeLFF7HrJSRQHbCbQpODs16foAoCoigyezlvEvFyBVXCYx/GjVbA0kH4XnrTdO3GDZAwgAGyAAIqNjKu7fjZ06aoaGgZEj3nDolXbncArZ3tYFBRY2PyxgCAYwbI7T64728+/KE9B1tsXGBQBwwEknRPGz36W1/8SvPkKY4d9SGl9L0pKBkZHSuCKwD9oemkz6hfOOAPGfG9f8484J0wS/KzkhQUwaj/TBEEQY3ri1G+KAzCUk4SNISQjXlqK8LM8AKVEAwTgcUtu3dD6gAMkO/RUY5Mue3YjMmTIjJWfCZ4+kk1nH4ByzfcVQhAFVMEYxGB2THmMZo0pslEwL7QUyEAg+hKpWH1RQOgiKJigICosq5UnCFkQYMkzl150QXnnXfOI4uX/u7Rx1atW7997/42V7J1hS5xP7n33nVbNn71Hz9+1YXnp2k5JsoAllShxWCopdi7R/hWkgZzy9B1QwqmmBDo/SFx9OalpEqQWrQLly4/3NalYOfMOnfOzFmxMWDsmJH5yZMnrt60oatHnli24pqL5/siEoE0GM9XbFogw0NmIyRVVDAKJNmwoGaQlxWT6Ku8QNb05RkGdR1ViQgnjR9nBRWMkG87i0VIhjaOGTHcIERkEJSeO6/WwzAYCQwaVRBWQhPUIkykgAlzy/GO/ceOQhQBGoosxHkplYb1dikwQJY1Kni9AwxZp6qKgiFQIFEVVIOgjA4AjRpVECANJmOKILYq3alKWrV6zKKQ134gkMxFlqQyikQ/ofXXYhVYQA0QZq4Avscp6BwGUAL5gOcZ5YCOnaRpDJSZXSM4FCtgFQEpTARQVRnRVMw6SEF4wsgRRSIFFARCBNY8UbmxbtywYSoc4hydltp+p2MPK5yLHuFrFcDGoDBm+LDPf/jvJ4wexiwmO3RQgZnHjBwpzADCPvOp8cAMtU9QT6FSqRQbc/PVV1131VUH9x98esPG+xY+8buFTxxpb2scPmLjzp2f+8pXzvrSl0Y0N6qqqcUOnvSCTyD+1+cMrtKNUY/3dj+2dGnZMdmorr7+4RVLTMpGUOKozGUBMCZa+OSSA6+9c/yIIcACFW07pJOokQz0wMFnOh2yURcCopbdGVMnffH/fXh4Lg8KrmKmraAiTU2NESILIwIKPPeZuXftBsjbCFkIMGFXds73lQGgIVecNXVaY3095iIAbG3rPNTZk0aFnKkzgXJOg95ibxzmIwwZgxBqYw1TOgJ1HjSjhlzg+OAJm+5YEWbDfh13HWBdUY10FUyrh+aGZAcIUDLzUxCNLXUea+vt7IoMJSUu1BUwSH75XxtYcACgAApwkiP4u7e99ep580rlpIYCqaAypL4ROcgZ+VT4xYD1B5kQggL4zjGQQASGFIqRnXXm1GmjRg6sBESFmYPdnY9YilU7GUFjDCAxoKFIQUulUkQ4bdzoM8ePueW6lzy6YuUHP/P59Tt2FpuGLVu/4fElS197603lcq8x3q281laqpqmr1WGRPoNoO6LPYFQZgEy8Y/+up7btlNjkC/EDCx+578l7RZDYIDLljC3kXQJPb922afPWKSMvTaREhqoDygHjrdppn9Sq4T1T6Z3ZmvoIgijamMude+a0UcXiwNeKQOJHhJnW0nNCjXptFDAI40YMzykqYntP9+Fjx3w+LJxMHDP2nz/3OQZxmoK1//KNb/3r/3xfbaxomPVEb1s1oMmEqjxoDUW8szygn6cGSQ1rImXxrUpURaBBjX0qE9ZqwELfA+DKR/sRsU+gBIVCIgagSFkbXkGFBECtny8D7Nm7+2h7i4sJSzp+zBgEEFQirDWH9WZrqAwQ+aYugZKTsyZOPGfaGf0KbVBgVlAlAlXwqlin3eY//a4Yq81tAx6syIyoqsxpyiIll5TZpeJScU44cSkLEwGpRmhM1T7cd2URkUqlpLWzu6Wz63B3d1eSKgAaKLme7nJXqdx99QXnv/Mtb44AU8YeJ1t27hEvQ4Sq/b1btMYtgmqDxjNMPREUBJEBBMGu3LBp95FjlM+naXdPV1upp1Tq6e1Jyr2lpKut0/WWcvlCe7m0cPkKzoT0AuZeddDRlg46tNdTNxAiRVRSJUhcmor2pi4Rl4pLmR2LY1Fhi2jQQzjouWJ8sIJumzpxYlO+SAJJ4lauX1dS8Mo1eUtjhzWPHdY8bvjwoUOaesq9jE4MOQWwdNLmWDABBGMYsMRScsDO638KigNRBiilCRgDAhFaGzDGgyor90GyPOOd9I32SkUI6n0Bq9IYgOpAy8zllFOA5U+ta+3tZKMN9cWZ0880NeiyAUauUj34EBmllJZFpDctlTlN2bGKc5w659v+IlJzPLyYYf2BpoUZkIbIkTInikJB8pE9LMjru1FFG5lQQEyG5fZjIkEkMr0sn7jrrs27dveKu/HKK//mbW9TV0JEY4kFSszTpkxuqqs/3Jsqmt7U+XNYvGRDlmJlkpdQ47Rc23bnk3wfAVBl73Lay+7xpSvKrDHz5OHDZ581HYSFyLESECKsffrpA10ljaKl69cfae8c3lCnwjhw7pMBJ9AnVlhd06eCKcrMFzOtUkRmUVEERXUWRWvUsWqEWcGDLfoNN069R+l1YxV04rjx40aO7Dh0ILLRwwuffPsb/mRcQ52yQxARVZEUtbNU3r5zD1LESgC2v0ts36ghKhahPp8HdqZY19rVdfh41/D6kaiJCBMgI3ZzuufQASBQ0sb6hrpCHaiwOlBbdeStnpy1LQHtFxj7dd3JG/NmXtuYpeH+h0QISRVL5TQuFLfuPfC7Bx7NUT7tTmbOPPu8s2em7BD9tJH6NBukIvlv/IzFkiqwHwYbQARlSZGsHySQ15QEJaIXBfz+cDUhV1QxCdGgIWBQJkLEPMXhoaIvx0BAHTOiEIgBE2gYCgpAaBJlW5ffe+TgQ4sWYr7QfrzzlTe/fNq4EeVSNxhQ0Vxkjh3v6O4tG4ojE40ZMczHp35CaDVG6rVVoIAwKNd4jCuqoBrFqjC9ACCSuDLZ+MDh1nXrN8UWtdz7qltf/4F3vg2SRMikCKASk/3MV//189/+Tq6+cf22Has3bbzpovmJSzPxwoqUeyXmeGFRMFnLzmYqfixsqJKd9UlyNJM4VyRWFWESBiKjkCMTmah/xScgAI5T8CrKqs9tCOUV+5AgcemEcaMuu/iCp37442Jz49oNG3/4s5+/981vSkWsE0BQNPnIrly8fMPGbTbXIKmQcKAKZDbrtXgRHz0JYPK48UgYx/ZgS8vGXdtmTh7jygaEWTXOFXbu3r1m1dpCnGfHY8eNHdo8RADUGEWgfmkNIqgapcQnOKgh1wnpE1U9mT1oFwwooLCX50AVICAkIovoNXNNhGTrokNtXZ/90j9v23mg2FDf2dV55623TBg1ksuJF5Xsq3zqQbo2XJMgsTEiOcohksWIkPyYx3cDwLO3hAkHybBOi/h1ugJHCQLbSxSUU2MiATl4/Fh9Ia/MFWlyBVARArSWhjQUiVACZqoqqimieRtddeWVDy1akmsYsnPfwY98/vP/+IG/nThmVA4AAXYfPvrdH/6wKy3bHA1varjg3HMloNjxGQsbBCCDSNi3dOz/WlVBZVRAtEtXr9m7b18hsrGBS+fOLZARAohMjCqsBWsvv2j+f/7wJ90sR9uPL16+8iUXno8ZEtIDzyuIrOx7+qwvdGZVQnpa43MMg87dncdPV63bIeX0aHs7lxIHICi+H0/+RjuOoqihoYik9HwQiZ55pQqor77j5b9+8IFjvd2FQvzVr3+9YPG1r7ijub4eAXqTdMWqtV/6l691dvdivkCIJqJ+rgr92DR+iHr+nPOG1zckAL2u/L2f/3TmWWdOGTG8aGPHuvPo0X/+xjc3bttWaGjoau+88oJ5w+rrElc21piB5bMEswlRVQWj6CdvEA4rrBVTV+nj2UEiFtR7GrWXelt7envLPbGNu0qlVevXf/N7P35i6Yp8U0NHW/vVl1182w3XCbM1hBT4ndUqH32nXf2TtUqCiEitXV2HW1tLaWqtgSr8S1U1tlF9oWBQDVEUBErhNEq1Tl9N98w6B9QA5NC0HG1999+8Px9HqY8OgYCvVpxV+diHPnj9FZezK3lUXjb9QUUxgAnzTS+9/u5771u4ZFXDsKF3P/bIuu2bL7rw/GGNDd0dHavXPrV51+58Ie5qa73ltj85/9xZ4hJjnrFF5T9CDYhBqU76B1sc5DN7xURh2dp1vVw2qnNmnDVz2lRIHSAgCAVgRnLOjLOmThy/essOMmbRihUd3a9vri96hd8B5u7ZwB0AFIxCRIYqaoHPsEwRgUkEgMiQoObqi5v373/1O95pBQRRTYC5k4IF5N7uP33Na/7izW9Vdiqiz1EyPAweicC5dM7Z0//8T1778S99OWpo6lH91Jf/9b6Hnpg0ZbyNcwePtixftep4a1tDfTMWikfaWhnEgZwMLkHGSTpv1sw/ue3Wr37rv+qGDHn8icVv2v0Xs8+e0dTQ2N3VtX7Txg07d9Q1Nna2HJt/1ow7b7xR1EFW4Gr/uY8XvJIwtcZwhHmMLvevz/t0tIhIFcjY1OAnv/LVr9bXkaghPNbRvu/IkY7O3rhYbG09evH5cz/xkb8f3dwkpVIURaJV89iAIA0oLAQAIkBUsTYF+shdd302F6simmwkrmqI0u7ON77mte94058hs3nOimUvBqzn0HbHCgyZHSflJC30puX2jh4Jzlm+jy0IaiVpNNRY30CA7A+6KoQq5F/keOKI4Z/80Ic++qnPPr5ipcTRtj17N23bYvycnsgARUny6ltueNef/WlsQJyqh8tXiYC1bYyaIbdLOSljYiQ4vmQrvf8uRVFUa/cfObJo2VIn5aS3Z/75544ePowdUxQBESp7Id1Rw5ovnX/BijVPxQ35p9avW//0+qsXXOq4ZAz26aNrUP0SD6USp2niSr0KMWog/+KJi24EsEC+ohSXalIuJ0lZeGPbXkkZEIGMd+ogEKOQ9nTYujoilFSB8Dk0sDLtKt8BFEJRx298zWtaO7q/9cOftPWUObKPLl/lli0VAbWAIGObmv7mXX/+q3vvP7h9i4wZWmkC1Pr3ZH8GBGTRyJi/fMubjxw88sv771Mbbdi9a/W2LQoIhHlEFOg52jLnzOmf+vAHz5gwPuVeIjQVPQSsgD2wapGn4FwqSQJC7NLB+oOoviLDoD3jUpcmqRXuLCfrN23i1BMyBcggkQGoN+Y1r77z3W/9s6kTx0OaxNaCMFCQiYQal0bvqOFXmiuXUmOYaNeBwygsSkExXgBUSEV6e/L19TlrxTlkhppE+HThFZ6Omu5Ze1uVARoK+THDRxQbGpUF0QohKgoYHxQMKpR7J48eMWrkSFXBTCmp0l9ABBQpWpsmbu7ZM7541+d+9ItfPvLEk/v37HPlOhEnOZOvK5wxcdKtL73+zltvbi4WmFNDAGhrEQ06YIrvCXH1xeL4UaOokC+gei1thYGhAhHQiaCNd+za1dneMXbk8AjSyxfMjwwlosYXM4EACNbA1Rdfcu+9D0pEaWfb5s2br1lwKWTs6v5jPlQQAZWGuuLY4cOjfKE5FxmDDKJ9LCkGLQyRVVW1ub5+9LBhhSHNzM4qWLAMlV6ZQxBgyeHYs6acEUATlgYJy8+mj4WABg2RDKkrfuA9fzn7vLnf/dFPNm7d3NnbIy4fkc03FKZNHfe2V77y5muv27x6zfYRw0Y0NZFW/dxOkGeRiBs7fNgXP/Gxi+Zf8L1f/mLX4YO95UhUMYqK1oweOuyy+Qve+ppXnzt1Uloqm4g8O0AHFvGZ75uIDG1sGDd8OBoc3tgIKjy4tkz1L/KxHTdyODUNUZdE2hBzQQkdpnX1dWNHjp55xhnXXXH5ZXPn5CNySYlM5Nn6IaBUERRenEOEWZWKhiYNH+7yOQE00IiIgobRwwzZIBjRHOjZ06ZbAGcIzGmJdD/9jFT9uIcQVSFVPdhyrLOnGwGNL3YQPdUTK5gYx7HBEc3NhVxkERGt1iBnMndJVVDHkkaESMePt+3du7+t7XiSlPOF4rBRIyaMG1dfKIJLrHowN8IANHfQGgk0tUBKPtre3trZqYix8Khhw+qLdR6t1xcCoyyOGRj1eE93S1s7kEaGRg8dkTPWKEThs7yQOAhrZ7nc0nY8SZlUm+sLw4c2e+ug2kIvE7QRBWSVo+3tbV3dSAZVRw0bWrDGGrImOlGmA5lrTsruaHt7V7kMZLTKBAn2h8ElQdWgjBg6rBDnCIHIPGdQoh+SEKCKKCgzs0IUx629PXv37d+5c2c5SYvFurFjxkyaOL6hrigpH2s93tHTnY9zo4YNq48tntDJVUVFRJ1zaK0xdv+Rlu27dh473lpOysVi3dBhQ8eNGTt2xEhkQebIEFJ4UlX/hxqbJQRgkbLwodaWcsKIYMmMGjq0kMt7dYwqkQDRr1sRQcSjx9uOd3UqERESgAULAKlzuThuaGqsKxZyAGmSEKExWIHuY2YjW8s7ZRXHzrHr7i0da+tAY8kYzRhgmrlIoTcEEh49YkR9oWhgECfgFwPW7ylghUEYiwiAEtm+zaRgqFWDGBAAZUfBoYtqmWMYHHYDoyvRVEStjSK0mr0JAzgBl6bWgEGiIB4DffekqicLVwKWqhNWMl4vMAJ1aYpI1piB/SMnTkQFAK0xGZaQmVGEEIOLGRgAFBCvk0fG+q8pwqoa/K/67dJg6EqeyayAxpvHJAkBGGPNIGYwNdZYIszMIiaXtwNA/QPjgRPxAAsies6gxEp7CBVEVYRV2QmDsbGNMXu4CpCqsHMAaKIoFEgsFuGkdqqsAuJvmYIxFNk+RQaDlpMyAhqDBgjRZDgErQ1Y4rEIiKLCqmgIAAlQVITZeMvJqmZbZZmJ1+BBJTKkg0GqWKXMjhAjIiJUFQLqv9ZqA5b3cRVBYyyZ2sxu4PszKDNT8AI4LU0oTsOApVoxcBcA9naUAaoQ4pnvV/i/IY9+8UJUA0gWYSX5haSefQXOK3FmrdZM/y9TssraTgQDasBsJBc8UH2SAKioYVqT7aV+O4pVMkVLdZ70V2m0+VKQqCKYJaKa9fC8n3p2VJ+wMQQI7FXSKeSdftZ9cp/kiluf7w0xMtRgJrOvWhEfCBqJfhs8HxS11gREj7kCRFaVbPxmMtsrbwmqUIG4kDHmGdpkNTDQVBmqpxcaIC+2gIgqSplHfGXJ1WZYgj4NDJ4TokJEkgnYQl8/70o3TVUFAkgvs/yoYGGCbypmjowUAj+eLLh7iRovq62ips/Ip0KF9J9AQP7Y7peMv9h0/32G2L7LgIhsjcJKBczgta6CtzFW1X+1MqI/0ZAK0RIIAGXjtGDxELrsVSfhAaYEVPvXGhoxPiUgFFA8YV8zExtGBIw8AxYxwyj0GSxiZidM2eJWOaH6VHWnKSBmtUIfvNjgF1Sxv0NELyKAAJ5agNqnmR1ayuG2e4zD/842CIocgVnoSZKKkElehctQQqi2y07hk7OnCYgYgfHD5nDYESqCiqIf3FAfa9v+aLWq5IP/g1GAGgsM7WcoXVVDgwofWxDJT1SrFV/mxhiEvEXhxHkQZsg1j7YNLPHwXKRyR7xkZTbQRK/p/KLz8/8PtaFU+SPeArTCOQ1CtzViBBmdDHDgZKTyTxWHIbPKuvYh84JMmxSr6xVPPu3CykzQ5319/r7fOVnj9JUdsZoZd1W0SatbxQB6qZwKTmLQKU+Ibao+4RGoSoyCyDOv2OpswseOPny8mssJKhSVzs7z3AkVKrdW4Uy+JaSVR5BllKr9xihZwjToNQTZhkzMTEkRUBwbIt+M8xoMgdipg6fDIbnLAnV4rAreQIhqJx59X5Lp2WScLgg6p/7clQB6B5NZyas+o8YNhHklhFSvxuvA510m+xUINBCsMT17sen+h2/A13ZrQo6Ekn212my8Usic/Dn1odSo4ikkev0LmUo91c99/hSLoFMc/5/qO58oSooCntJrYUBdU51tnjTo/O8/bHzed+MEF9mXOHmCt6p5SINci2gtHaf/QKbmnWvTrtp/l8pZW6v5c6pbIBzfVKVhZ1VgrZ8dwmmpKfN/JmCdcMpU+70qvgCntAj6kYexNhyiwqnvjX4r9dQ3Ep54X51iMPo9nAfVyzjF5fL72xaqnBVVCKd8rypd59qI0C8bel7XnAWsvuCvZ3GW6HO6h7V6i5CBaQCCQjeKCckf4mkeqU7/kvAED6/2yeCzXYcn1IFROMXYNAgv7wSonBOlKqd+gPyBk3r9/+eB9guX3oHG38BnHasJTnardcATQsTBs+BKBar9CFdYyV7hD4jGrAFoUTZopUoD4ETp3os9rD/sah6EdVy7mc2AXzuFc6vfoacnpP8Pkpn2reu0UmM+W0dwrTSxq02twX5Lsm6deR4RITTUNXNPG3g3TjVGqv7vRlMdrCJEQETKqq/ByoOTf64OeO8T//6gJ1DVNGJALMwMAv+ggT1LrPpdyuC52/+BHItO9y8w6Jod7HvVKkEO/v9lz1YH+eXnLp+Z2ayq9vuogTsJQ2s+k/auiBuf9JUDytjBotKJi+fwAZmBi+pJM6rntRv7OALWdF+eKYnTgYt2oBuZPnNgBtXMI1L7NUAH0TXTSutf+94WrXp5ab/vFpYKnlTR/STLpPa/WrnSwRZqnx0gp3IX/2/8nMYZVv/i6wTRpUZrRbNmQ9b+UMnYZ33eS7SiDyNeCASCzQkhqMnkjrSPjBto8PWqYFMFq7mSnwBwJsVFHiWhKqRISqqAJJpJumWSbAZUJbPo7JcS1KSBkn0O1mQiteJ9qFgxiPby8ajo5XlBUUnVqCogqxcO9vcgQNCeoW2TgTnET9hAUdWgcYreE6jyRDSoO3hTQEZFVGQEgSDF4lBBNVLNrHLJS4FW0PVhZyoxqteKMIroXcU0QOdcqIWCJS0qadUdMMMMUMUvWaDiBwFUCTieZSyoCIJAIN6rFhSlP6RFA34h4P6D44/WKOv72aP/8gPVjSGLh6IBokFVlE6oKqmS1QXoVg2qK0MnPIsByGk6H/w/0sN6NncfB0kRNCxVDyVwASsTfONJsYJHUAVBMZUGPAAjUdgMMqCVUJMAYgB4VmAXCCDAGubbJN52SVGQwpBbA8a1YngKJ0UPhjgYZPP6dFmysXcIbViTR2VOORgMkjPUk6qeYkaJ/RAFUC3VvDGg+PTND9O9yA5W4BEqmoUjzYQIVKtJc0UCECvln1b+lTJfP9ufSO6DkCdeYpCwqKoJapDfqSJFBEUVTeV+aBBrAUEAlbA2EANR0YcuVOQauwsRVcok9cOVZnLLIcxQDSCmNif0l6hA/lDzSl6iKEGOptZhUfsh7k5TLNWLTfdn2xnRYBXn2X9a1YEUREDvN+IB81SVvUIw6Cp5mqqiMARIngejm0obI2wNwsy31RskMwoDCKAhL/2iQgiIJKGBhFgL6NSKhq4Ezx0MwalmPq1+t0PAh2ZaV9XrrFyPBix1BvhGEASUkHsEEaqQYAicVO/LXyRB1eBPjNbkdqAoLuwwypyP1VAms0EVDIpmmU7FfUjJZ5qQAZdqkzSPkCINUE+vlN6nXPL0lwqSXyqJD1ZuHwJ6S0hfIGLmTl8L1ENVq4E6ISgCGHkgqVRUrmq7SL6wVkTrIb0+w1PKZMhYgIJDdshwPThZK1EUq3iJ4AhXUQaicKMgPCLVP8ZQ9UcasCoZgYTSQ1g9VBC9zBpmnoYef86+dhNBBFIRAEEiRQRF8YHGr0CPdM7OTFVBFQZVMCAEAIYQBEBE0AWSGle2B4MDRSMGRDzfUVRFxSiGfKJiXAVaCWsaYhBk+vKIAU+pVYP5bEbJICwBGo4A1uOf1YtsoQgAApk+edkzFhpa20YJOCLMPk+AUBEJfXmFCOITSRVkqCDZvRFMUL4QBadSAcz7mkdByTNZ/BPKHhdR7dQvQ32LKIDPVUHFaCAbBDkdURaEzP4rk99S9qAE4FDcAYAAqfGUJCEB9JxM4xt+SKQqKBkBJtNo9f8hNAqI6g2XVX2mJwoomEVDb+yVXToDgAoJCgRPODUqnsTDaFCpyoEOiFBEpBcD1h9FtFJV9QEhsAeNT6oUhDKuKZDvcwgrszCoWCJiVTKAJOCZsSigTKiohEiZK6+qsKojcioAECMSiIQazzAZVqsECETgF6hYFXZ+0yMa8la+rKJKpAhOFbysLVLm4+X5jyziUBHIGkJAEbWV9gn54bb6Vp0oeYczRQB2qOyFABAIkAStt35CCGazp3Ir/S1SZFURQGZVRLCGCCI1qdPUpUQQGTKgiIyAzIaF1PrOFyNwoBeLqqL48Ma+ixQCQWZJDSwigNYYAU1VjarVTPEaQQFFBYQVUAwBoYqqODJEiKzqRBCQyQohiUTKXmElCzMGMAJQ8Yh6VQKUlFGZjBqDCKiiAiiETEqMEQsBiFFBEBXnFw+Sb+cZBWJUEueJhoaCHbgGaxzyTTJSFP/sUYF8aLJegBs1VebUoZIlsgYJ+mq6vxiw/s//hCJBgciwiBPuSdLEiajvr6oRACJGb0Sg+TjKRWBASVQl6krLHUk3UYSqBkFBUgQBjASaCnHBWlb1gpM9pXJHUiKAIbm8zUWgIEiqWhZp6+l07Jrq8oXIkKD6gGawlEh3b1lRwCAisCqiyceFxlxEQmmaeENzBJFQ05ECJqLdvT3oHJKpLxbAGKuB86EV4QiAcpp2lcssQESNxTpQJRQVBoRS4jp7ExNRY7Euqjbq9YRmYAGeiFjRqkebgpg4YoQjx44db2211gxrHjG0qQEV2DlDvt5UBXaoXb2lJE1tZJuKRVJWVCAjgp09vSWXNuTy9ZEN4dqrMKiSoCiWCQ93HhfRXJRrLBYwU74DVAWXjTa0o7cncRxbM7RQRFBgQUJA7Cml7eVOjGxTvmiJANiztp1IR0+vc+JNdhHQKRRzubp8LgbLiSPvJ69a4vKxcilFbSzWDTUWnEexkiCqtce7ejgp56Ncsa6oiCKMioLUxWmpuwSIhXyuEMcESBpmBaExBZIKdPT2pqIEWqAIQUsqJp9rzOcNgLAm6iJQS8EqWvH5jK9fDFinyQ9BUGTzndeE5R8//ZmVq9fl8nWpqsY5awyDuLScM9TTcfyll1/+kfe+14AyoI3tr3/7u3/5zneKhYa0p4e4rMDOGgEqoPnsBz5w0dy5KScAJo7sg4uXfPbf/tla85kPfnDBrHPLaQKgkY227dv7gU995siRo+/7i3fc/tJrlZ1TBcXIRgtXL/unL/+zgoqkwE5U1NgRI0adMWH8DVdfdfGFFzKzodAgIcTUuSjOPbBo4Zf+9d9QwIl7+xvf+KqbbnYpV4QpFEBETWQ3btv4ic/d1ZU459yfv+lNd9x8XeKYQCLKP/LEw5/50lfOOnv65/7ho3VNjcIMwacLT9Js16AVASKagjoy9z362K/vv3fT1k37d+9RiidOPmP22TPuuPnmS8+f69iFt7SmrbP7Hz7z+TXr1r7s1pv/7h3vUMeCgkhK+M9f+/o9Dz34l295y5vueIWkDlEVGBANGgamXPTre3/79f/+DhlrEf723X959UULEufiCr0bAUyknH7rv797929/d/55sz/94Q/aXIygwhJFuV8+/vBX/vPrw0cO//xH/3HamLGpMKpGJtp5+MCHPvOpg0ePkTHl3q7ImlSwvqlp0rgJF889//brr2/KxeicIVN26ee+8sUlT62bPnnqp9/7/skjRzpgx87Y/MNPPvmlr3ypgPi+d//1xZddoo5BgAGcpX/91rcfevQRBrn2qiv/9l1/4YStt+pABBVWscYeb+v4u49/auehg5aM9pQsQRmh0NQ0ZdSoi+ecd9vNNzbU17EqSa1j94sZ1v/1ilBFqyMt31lQLZdKZOOyyM4DR1rb24YMbZw0coQkzEnKpRQYBMnLhhxubVm2akWhaeiMMePzBpw4FmYga+PK0M1/xLHjHYtWrbGx6ejpzcbfSkjd5WTVpk379+w5cLTFAiaiYBSRCOBoZ/vja1YX4nj65InNdUVEaCuVHlm06N7u3l//7oEvf+7T115ykUsSm5ndC2JZ5Lf3PfzI4iUjR4w8cvTw0OahL73m2sYooiDy5dvDSIDdSbps7brOVMqlcm/pa+fNPnv6+HGcuhjoyPG2ZStWlhCdZAYwp3g3ERGUWW0c3f/kond/8ENHWw5fOPfc17/2NS3HO+9/7PGlK1csW7Hy37/4hTlnTmVNUQWJGOHprdtWLl0y89yZBkAkBe8WbfHpnTvWrFy577bbCDF4sXnHUxVB6CmXf3XffU8sX9k8bNjxw4emTpp82fyLIJhoYbV0RLNj775ly1dEcZSkDvM5Ffbjt/1Hjy1Zvmr8pPGl3pLPbwwSIpXLyaqNm3bs2jNl8pQpY0dKUjJR9PSWrQ8/sfhnv/j18WOt73nbm4ETZjekrv788+b+989/vm7tU+eeMf0D73ynK6dC0NbV/bXv/vcjC5943ctvnz17diocq4IAxXbPkUM/uvvXu/ftU5RjrcdeeettZ06YCMJBcCKbQCqY9Zu3P7V1y4QpE6ePHo3OoTFbd+xY+Piin//yVzv37v7g+97nJyM20zCCP76++x9bwEJACvbCAKAuZ+kj739/KUlNFHeUe9/3sU8/8Lv7rrjgqrs++g+xshXNWRNZI6qMAAB5G5lcfnhz88c+8qF5M2a4tOwQBTFSHNlQ73/LF0zGRoViHUWGTJT1lBAAgExcKMRNjWCIwfvBokgKYKLYFBrzRRt/5P3vu+L8812SlAkfWrT4E3d9edueXT+9554r5l9gg14IioAx0YHWYyvXrB0+cvQNN9543wP3r920acfuXXOmn+XSxBoTFJYwyFXZYrE5V18oFjbt2nXP7x742z9/W+ocAGhkqbExXyxq1RoZcCDxuxZ+pMBejsWJUSo5/sVvfnfgWOuCCxd89VMfO2fqGQrym4cf/usPfGTVqlW/uPue2X/7HmY1AtZgpJQvFKixPs7n/ZSTiBRRVHOFPDU12nxePN7AQ0sUQDWy0Y7t21atXz9+8tQFFy2455e/WL123e79+6eMGydOrEHNsFCiauOCaWzK19WLH72KoLEKQDYyDfW5Qr1RMoAgqCCAikD1jUPQHHjVy1/xt297c9LTDcZu3rvvHz/3T0uXr/zV7353+603jRvZjGVnSsmrbrj5scWLf/iru396z6/vuOWWyWPHRYYefvD+hUuXTzjzzLe++S1DmxraSz1ARhQJYdW6tXv2H5w1e87Q5saFjz68fPXqmRMni3IGJ8n05lWL9XVEcMN1V3/yPX+DvT0J0d6WY5/8wlceeOD+3zz4yBtf/4YJY0dzmhoi/GNNsf4oG3gZTIEQrTHNDfVjRwwf2dw0eviwiFS4XE8wvrlp3PCho4cPaWosogU0EMCcrOAAknRIsTBqSNPopiHjm4dMaGoe29gUG1Jh9MbzAKzsUUjMKiLAwCxOxLFjduySMK8XoQxuwcosLk1KEWFTPl9P2JzL3frS62adM1OVj7YeK6UpkQmgMJGIcN36pzbt2D563Njb77hj2Kjhew8dXLZiBYF32QkWUxW/4XKaFhvqr7zmJSaX++mv73lqxzayUTaTFxYeSKYbDBQe/uCF9YAVFUvl5OCBQ6A0bvzESZMml5KeUm/HZRee/953veMv3v6WGTOm9TqHYAwgiRoBYRWBxFtGA7KIS1NQVWFJnahUumci6nvVhLjuqad379s7cdKkW26+ccTQodt37V779MYo87wOGC5QREhVmJ1zTkVc6hTUudSJpJwyQilNyRgMgDgF9FKLqsoGtSmfH5ovNkX5BefMuu7aawWgraOzva3NUASGALAxn3v9q18zYsTwjTu3//R3v1VDLcfbf/Szn3e0t990w43z584tp2nOGkBEiyy6YuWq7vbj8+bOvfCC+d3dPQuXL+txTlhUxK8qp6qITKLgRNMIpSmfa4xtk8ULz5h67TVXYZzrSvhYa1sUVBf/ePvuf1zfXAEEQRGBCIEMRURgQEUSlATYKRKAdUDiHDtOBREiBCUD1o/HiUCBgHJxzgLEkbXGRtZEEao6FjEQBoxinAqTUF2xnogon4vyBUsU5fPWoLo0hjDhUkHCCACMEioB2VxctIYKdfX5XL6rp6ens1M5aWiqK+RyKhoE2IAYYPG6NZ1dbedOmXLR2WedfcZkl/QsXr2qOymRQRYHqoTAIABgABGxt6f9pZdfdO6sM9dsWP+T395XqggWGG+djIkXPxSQIBytUiWJ+AY+qzKiEgKBoAFFKeTiUc3DYrTLV6z6zg9/fLy71+bqGxoa/vxNf/rp//eRO264wSpaJUULiGLUmRSA4jhXMCbOFeO4zuTrYiKIYhBjwXjXUzUWyAozgpRZlqxY63rSC84885rZs2bPOON4d++TK9amqv50UEBgtQHOIECAJirkClGcs7m6OF+MiXJ1BRC0NnJea5TUkAFQIlRWADVRFAFExUJczBFA67HjKUtTY3FE05BI0ZrY5COX6uVz5778+uscw/fu/vWWI0fuf3LJY08umTH9rLe88tV5MogKRAJgjTl4+MjS1WuxGF183sypY0diLlrx1Ibdhw9TbFgSPxtFtB67BmrAUR5zOQBbKOaLjQjQ0d6RpIxkGuuLBhjRadV/Sf/YApb9Y0utaBCaNHrN9ACHRhUPaCJyQFWYYsiHQMH0Cn3jhz++f+QwEVYkdW7ssObbb7ttSEMDMqv6UKRoiS1968fff2zcmBK7SMSS3XustbtUJoq44g5IKAwAECGpQgpm/fYddXW5lNPesrv7wYeWrloxcszYW6673hIIMyGioLX2wPH25WvXRmDnTp8xiuiq8xf85lf3rl29bs++/edOmZxqGcloBcCNKoicJuNHjXz5zTctX7rs1/fee+eN1887Yxp6rwpxWYMvK2ARamCzfbVPAxIMmcipRNa8/NYbH1742IF9uz79hS/89sH75s+ee+Hc8y6cM2dIXT1zGhkCQEFQNKqKDqnQsGHzjo9/7T80TVSBrBHWrdv3UK6OORPY8/rSiKK69/DR9Rs25wv1c6fPGFffeNmFF9376OKlq1bta2mZPHyoOKYME06KmAKY/OHjHXf9+9einFERVDVxvHzjFrK2ImOYoXO9jQYCRfsOH35800YulQDNivVP/fw3vyHkqy67bOzIEcAuM6TgiOzrbn/lAw8v3Lp1x3/98CfbN23v6u545a1/fu6Z01wpMRGKB4Ma2rhtx6Zt2yeOGnvOlKmOZezw0Tu27Vq5as2scTelAmCBkFTFgKLHtEbxwZaWhRufci5lMBs3bfrBT36AwNdcdcX4saOcK1HV6kj/+IaEf6RId9+g8USLauDyfi1VYlz4JQ/GDDpDJEgm7kzdf373fyApgQpYC509M2eefe311w9tHAJSIdCToAWy3/7u96DUA7EFZmCGuJAfMZpsLIACwKhI4o9MUgClVOkjn/m80TJYZaYUaNTQ5g++569uu+ZaLpetUQYFBqJow9Zta5/eMHrUmAvmziXE+XPmTp4wZd/B/ctWrzl36hkARhBq/es8ZhSde/l1N/z4pz9fvXbdz37+03l/9wEP4UJSRDUAEtgtmfhAVWQaaxy00IAy+nQTE+deevXln/n4h//jO9/ZsHXHQ08sevixhSOHNF8894J3/NmfXnbJ+SopBMXpyKAhpigurt+4ZfGD9wEh+LGXQG7EaJMreB62KIOisACLjXOrn96weeu2yZMnXzBnDgIsuODCoUOaN+/csXzduonXvAS8bxkEopRVIhPtO3DoU1/4CkCauYmoaWyKGxodc7UVlw1DxWkubvjZL+75/g9/aCMCNI7BRrl3vOPP3/X2t0NAy6sCgMU0dXPOmfWK227+8je++b0f/bi3o/vCeXNeddutlkMotArKChaWrVrd1nr8mosumj5pajnlc6adfd9jjz2xZPmdN1wfGY+Z82xDRRVWMfXFu+9/6J577xZChxE4Fxn50ze87gPv+5s4MsCpMZb6qubCaU4PfDFgnVq2FcZnftF6rGQo+jDLLAwCZe4WgeSCIuDyOXP97beNax7m2AEZYJk4Ymghn9eKNDMACVkxIHjDbbdPGDm0l51RjaPoSGfPA48v6eju9dh4BWEQQYzAu10CIU2eOrUxT07TI4eOHevscil3tLahY0OI4CGo5AwsXbu2peX49Ve/ZMTE8fs6OocMHzFz9uxNO3Y+sHDRnbfcWiAUEUs2I5sge6xnkk4bOvQVN9749Ianf3bPr197x502nwPAVLzGbojWGW2t2rTysPTMlkLRa7x7Ug9Iudz7ihtvvHTBgiXLVz2xdPmy5ct27d573+ML1z711Gc/+f9e9tKXqJQqOstkyZV7p0896/Lbb2Rh9iQm1idWr928cZt3M/N4dhRiMU5x0apVrZ0dl11zZWFI04GOjqFjxp599tlPLFq8cPHS2666ukDGc60UAUkRWbk8YviYV95yo8lbAEVRa+yG7dsWrlxFUJ/ZWGScLAQwxA5GjRk9fGi9QNrV3Xtw70En2trS2lsuYaHgzy9GRMJY1Yn+yavvvP/xxzZu3xUhvOnVrzprwnjXU4oiAwDEgGhaO3qWrP7/2jvTILuO6o6fc7rvfe/N/mYfyUKWJdvYxsibbDYLYyM7BdhgAwkOmwEHAiFOkYKwhFRSKbJQQML+gc2kSAULDK4CB7BJmVIcZFmbtUtj7WPtM5pFs713b/c5+dD3vnkjybYwLuSyzu+TSjUjvdvv3v/tPt3n/1+Pkb3y6qsn0ooTuOLaJb9evWb1pi37jxy98Ly+1PtYaj1YAiLgoKO347yuBc7zeMUdO3okrYyPjY2NjU/MKZbpHC63n6OChTPNpzOuQQiEkJ2wzn4oJGhlNgu1FQp4wyLVFoJPfuAD117y0hQka8SHVFi8eEBELwAQCRjnDclH73rv66+4rBLiXgBW7xl4fPWGMR+OfeYFbMgiMojEiPzNRz/yuuuump4eHx0+8b0fLv/+/T/55re/fe3iy197zVWcOoPGGxqrJCvXrTPF0s5D+//qHz6LlTSOSnuPHI1aWlZv2LRn3/4rLlzk2NXSXjHzl6MIEUXetGzZzx7+1drVj//0wf+++MqrIC6CMZIndRACCYZA0DwEJksMq2lWFvCR9fRQZEsJSE9b+x03L7v1ptcPHD3yowd/8Z0fLD8yeOy7//nDG65/ZblgwCdgBECYnJ8aW/LyS//ts3/rgQHIASDA+z75qf4nNmXxRhRSPEgsHh0ZXbVunWks9u/qv+czn0qTKbTx0MhIHEVr1jxx7Njgwr7uxKVEIU9IxLCkU/N62j/36Y83N5SCKhUAv/zjn6xYuYqM9T5YcMy40ZIxzlXe9Ec3f+yDd1Umxtn7//nNii9881vL71v+svnzPv2hD7LLUpQQxCKlFbdoztwlV169YcuO+RcvevUrrrMCqcnOV3iA2NqN2zds27Or0N7ywEO/+t9VjyLR4Filody26+BT67duuWjeXJZUZGbCREB+urJs6fV//7GPTk9OJV5+u+qxL339qw/89IH5vXO+8PGPicuiMWYmutr8/KIvY8207mdtrIwsIUgrn1LU7uMZn4PQvYoAxExpitOJpB7TaYoNgKA4xAhD6JwBAkjJe0gNE7gURGyaAjBGBWRHKIQg4AnACiJTaGVjQiZGqXY2FOc0NyUxXNTdh+965y8fffTIoUOrN2987TVXh2ZiIdyyZ9f2nXtKJjp08MCePU+SY8NG4kLc3HZ08PiGLVuvuvhC9ixgsk2lEGHFYMkC4gXz5t3xxls3bNzys0ceva21Jy40MWNutiPCzjOJDcdUhZ1DY4LjCmTuOZwnFDkBGBmb7N874MSfP/e87rYWw/787o6PvPdd+w8f+8Hy5UdHxkaGJzrndLnQNIciyIAOxBsRTKtIkRFIrEGfAPJMBrw4Foois3Pvvr379pYK0Z49u3b1bwsn1ONic7FU2Ld/YMuOHQv6uoUdkMk6ldEAiPgkTpOSi5i8pM7GDcQ+tCyFDNGslyq7bAeu0lC0vU2NHBfjyMx7xzseXvF/A4cPbunvn0xdI5kQpkUgAGyNEEDBGvBpY3NTa1sLIqDNq5IASLDqiSeOjgxDQ/zExg0ELMIxlqi1PJ1UHlm58s03LyugqTkXMQKgA06aC3Zuc0ul1BgZc8Httz/62OM7dx/evPnJkYmpzqbYeSECD0zA5tn6PVWwXnw1rTznJbyrQvt+vvlCWAsWQBAkAGQTUQEBxYiJjFAc9pksWM72qcULEIA36CJhcik5QRTyJGIQiYTRefQhqFUEUTB8DQzIIoYwNFxbYe8rza0NpcaGxLnBsTEPYIDYiS3a9Zs2HDlyeG53z19++AMdXe3GswE7MjX1te98b+vWJx9bs/Htb3yDNczZATIQZvSMcTaJJObblt2y/IGfb9rxJDz0kI0jdt5lBREBLx5w76GD4yfG+jo6+zo6sGYSkRWzUACZHYEXMnsPHfrzv/7E4NDgZz7x8Xve86fV6TGpps2NrX293d55QMsACJbQgoAXADBAEaEhRDRWAAnIIFohYKodwSUk9iAAv33ssZHRE5dccslH7n5vc0PJO2fi6MCx49+69z/27nvqkVWrblz6SitsxACHhRsBGkZLSNZYLywh2NF7A2xymwSpWTxkZjCMkhgRgCR1SLbY3N4mINOVJE0SLJZkxoMGkLMSJwAYyUsMiISGBdDgWDVZs3FDdWLy5tcuvev2t3lXIUKLhXvv/8lDv/nNug0bDg4eW9jdAywsaBAJyZJBltw4wvnUA5mm5hYQrFaqSbUqjQWp7RYEoTvHNvrPecGqma4LiIhBwGCBJJnZDCEBkOQ+mRZMkmJqSwOj4x1HB6eTipAhhMgnbcViudxhjPHCHsCLABmx5EkYwKGYzBsv7ErmASeCQIQ+1PQFASxRCA52SEgEBsiQsSaOolA7N0QTSXXtunXTE2NX3Xjj+9/+xw2YhyEDbFy/vn9z/9qNW/YcPHjZwpeId5w9jBADGsjSOyVNF/b1/Mkdb932xS/s2rfbV5OiibIkMg8gwoTfuPfeH//ovn//3D/fedtt3qeUDVVWo5PQii3sRLr7+nrm9uwY2Pfd+5bPOa/vplddWyiWHl275lcP/9ISz+kud5TL4hmEGNADsEfk0HeTaQYS5MYpZPJljwBYa0ZOjD+2ek2SJK+65ur33XpruGs9wDjAqrXrdu8/sHrjpqHR0XnlVuckIgvMngHJGrIeETCY4xEAGCQSEfGhLz3rMAYhAIuZ+VR2zgmRERJ2SBDMfzxk8X+hSoAmEz0EMJS/BoTCqS4ku+fgU5t3bG1oKL3lpmV33nRDMG+MACZOnFi1ctXAgYFN27Ze3NObsidEAPQhI8MQIzIikEMxaAySIDFhvjavWQNqDeucmlfBTLUqvK0ERdg7SVJxHjPXyXxViOLZR2C8S1j4+NTUJz/3Tw2GBISNMYh+fOwv3v2uD939Z67qQAQtmBSw4ihi68QAIERZcZUBqw6nK5ImEnYJgSHImfeYJOzJOXYATjDGOJII0tRPTiVjE2EVY2J79KmDG9avixCvvXJxJDw9XYmNceKiQsPSV1x7//0P7nhyx8q1ay9bON97JjIAAN5xUpGYEpcyABFg6t98y00P/OLn6zZuNiiQVDLTLQGiaBp4z+FDU96XuzoFwHtGFKSsaI5oiAWAREiYe8rlez509+59u7fu2HrPZ/5u0aJFhbiwe8/Opw7snz+n98N33dlaKvg0AUQfHFfZSbXCSZUAHITzp+LBOJ+Iq+aWr8AiEcL2Hf3btm4uRGbJyy9H5rQy6U3M4hsLxVctvuLBBx/u375j88ZNC258XVVSYC8imKaSJK4yzcIOIEUB7yMD4L1PU++cQPZSybL6mLmaSsWzEw4LTgQCQOekmlYmJz17z4IENg929OIBLLOTNOVqOuMtyMBerIHHH1914MDAS+bNv/qlF3vmtFr16NgWl1z+srnd7dv39q9YseLN19/ALAZBmNm7xCXiEudSARAhREOAwIkk00l1QnyKIPn7E/LcWhWsc0q26rKrEKC9paXc09Pe2lKzHa6z1xYRKDXGfb2ttlTylalJAUZgImKASqWxXM7mCAwGoCWKXtJWRkMNaADAhtqTQFFwTkuL6epuKRYcsEMhEAEfgW2w0ZyOLsIoAnbOkSHx3BKXLr1g4dhTh23ihDmc59y6ZbNUK4sve+mSa64AQmsNIVgyDOnLL7308ksu2rZrV3//9umkWsDg4gWlKO7t7LClgsmMP0W8u6C7651ve8vhgf3WYGdbM7L34EEYDI2cGN83MHD++QsWXXihB6BwHjLYBITnSTyjQbQRsfd+2fVLv/b5z3//v+5bv2nbhi07GLi9tfFNN99y953vuOHVrxCpkDVVFmQQ5zubGru7OzuamgiE2CMhe4ck7W1NHZ3lUqFQs3AVgZ27d8WWrrvy8qsufxkBRNYyETIbca9ZvPiKhYuOHTm0c9t2v/Q1IOiAgbncUOzt7uguN1vJHf28WAtNUWFuV2dfZ3tEhgEIUUA8e0vU29Ex3NHVWmygbMks1sDiBYtWdvU2oKlMT7eUGoC95Hng4WxXa1NzT0dXZ2ML1YXCI1I1Tfu3b28plZZed91F55/vBSJj0CAwz5/b95pXLjl+4ti+3bsHBwd7+np9mpBgRDi33H64rdxSLIKA4YiEjKUF8/p65nYVLCTJtEirCGfTUSSQc27P8MWXS/i7CVZYETKLCHvhA8PHx6cm2xob+9q74lD1gFr5lz3AyMT4yIkJIDJEJlgABx86lq7W1sZSKURGC8iJyYmhkWFh6e3ubmlsRABmYZFKmhwbGvIu7WgvNzc1IQIQibCwjE9OHx8dE5Gu9ramUskgIqJjGRwenZycam4odXW2I4KwDA0fn5iaigqFcrmtGMUWkIhYOPFOBI4cPz5dSYqFuKezvRTF4RomKpUjQ4NO/JyevqZCAR2DSAo4kVSGho8DSIFMZ2dHKYrYcVQorli//o73vPutt9769X/5V5N6IiAUIWKA8MewY8EiYWqaeDbWTlaSg4ePHB0ccgQ9nZ3zevvaSsUkqUREZEgAnJNqmg4ND1crlbaW5u6OTkJmEcfCiMdHRkbHxjvb29vLreFovjAPHR8ZOTEWFwvdHV0RkTGAFDxWIEnc4cHhNEmaGoud7W0igkRp6oZHR6erlWKh0NvZba0BhODRNzI5OTgyHEdxb1dXKYoFOHQ5JWk6NDo6naStzc3tra2WABkEafTE+LGR4TiOerq7i9ZQbiiNAolnBzI4MjwxMdnU0NDdXi5EEQJ68c6zAz42NDhVrba1tna2tRsAFPGc+dgeGx0eGx0rFgp93T2FOA4mP4nnweGRyUqlubmhq7VsBAhJUI6OjoyOnyhEcU9HZ9FGRHlR/4yCgVWwXqTLQxFhETaUnbUUJpHg3xkOTHoRL0iENi8fUK3+klW1BUCYxRiSmZA6kJOyoPNOMAYBluACmG1UIxpAAHDAGExNAX1m/hZmCRx8+4wxBCgAzjsAIKRg+ZzFHhgbjlNxqI9kvpfhPD8IMLBQPm9EQ5TnBXt2zOxF0MZf/OpX/vFLX/rGV778/tvfmlSqNjKGgBEFyAQb33AGQgRQmL0Asxc01pA1kBWnPAv41IbGvcy+0wlAbOIwIJ6ZUACRWQTAGovZL3LWti0Szky5MKnJl/G1w3GEhPnFsvdh+88YWxsxQCAgyexLs201z0y56Vdweg4H5cNlmFAu8kJhbxTAs6fM8jpsSwizCEroSYTgJJvX+Lww5NfiQZiZco9BFhYRMib7oiUklYSECwwGZwIM4sELEDALoLHGCoAXpjzbGWcyLVWwztndQhGX74WF0gbW5Sxk1pecFeMzv78sMQWEmTA8O1klFgU4vFGJCLE+yN57ziUCKFSBMXcM8QwSnhMS5kwU2IfTmmSo3pQ9d17PznPWMlSyNznWfaDQhp1ZyGd2SrUKugCLCAFQrbmb+dePPDJw+PAbbrllQU+vpI4sEWUODgZMyJTIxg1EwgE0RGHwLMIAhgDBhIMizIYMIgpL8Gtnzm3psyHO42bDXkewwyeUIARSCy7O+5zzMykAwN4BACAZY/IryvyQsRaQkz/cnI8MzA5VDa8rYQj7HNknC3+ZhUxn75KZl1z+iRkAWAwRZvkW2cgEx2REyrRqpulAQu96+PYpM1sEFvbgQYQwO8uOwb9QKPRmI2LNpwHPvTPuKlizCDdQuL9DO0pdhlIe6MBcS5cGYAHKWzswi2nJndWkzq6zLj0csxCFbG5Te44wnxyBiBcRSzY00FG2YvV5yyOGxtdQJ4aah3tdCrHkJ0SDAzTl2SoM+QMYZox54kK+PeezDTNBBnAscRwxgPcenDNhBmJNKCtRdpSpTvXEZwcdalEZOBOmBoAGMg+vrDJVu/9mshYkj+wRkpnjkbWHM+hduLbZB/DD+VZEQi+Ms93tTopulrqo+poW1f4hznPAcGYzJmi9IJLFkwSO6yoGQJz1o+YpRllXZvB9tTArv7720IkIUZgNB+kPYV8W6z5ztpcZRNCzMeZcfk5VsKD+7gluaiBSHzKO+XFKYKl109UCreqSD/Gk2xHypIXslV2bB+VZy+H5QAbIkxJqjzEgemHKdRNm555jmCxkt/vsbzT/dPXxeCd5W+FMNGh+bDr4lUMIEkJGScWjgEEylK03wwkxFAnpZ6FrKVdyH/rDOayxQo/TzOxUcpu6mUHPh6OmLPUDcPLJE2YmIs6nnPUyVFuLIUL9om/W+6buG8nSRmCmkTtTKZ71gspeH1JLpUA6JfA9F+aQXyESgiJYsO5iZhIj5WmrqHn4WK5aVJtDhY+RTZMxFMAQVbCUk8Xr9K/oZx6r+skYvrCu6NS7fNa1ZGUR4bzKVq+PtX1UB0CQHTTC2mwUZonz09UHTxXWuinEH3zERE4XNn/6wTkp8B1/l1/5vb8jfppUYBUsZfZtd9o740xGCp/r/3tW7sV8jTarLDKzVj1p1Vz7mzOonpwkiPiC+X6f82c5W2+ic7NW9XRYHYKnmyqd5r45g5vmOd/Wpz5LZzj5OO2PPbPyPvO/A7Nlq/7lNpPO/MxTlLqRwFNWUmf38XvO4/y008izcTeqYCkzi6NT7+C8G/dZloSzy0LPx9NVVyR+1p95fp8lPOVhzrzwQ83lVB/E0wzks6+4Xygz6zMY57OlWfJ8TOFfNBAoZ7xOPCvwMy5FQ//r8/VafubfenG/6fl36c7TMspZm1FoDeuFLpdnsCTUNcMfYJwVnWEpZ7o0+31+QHlexllRwVIURVHBUhRFBUtRFEUFaxH/lQAAAQtJREFUS1EURQVLURQVLEVRFBUsRVEUFSxFUVSwFEVRVLAURVFUsBRFUcFSFEVRwVIURVHBUhRFBUtRFEUFS1EUFSxFURQVLEVRFBUsRVFUsBRFUVSwFEVRVLAURVHBUhRFUcFSFEVRwVIURQVLURRFBUtRFEUFS1EUFSxFURQVLEVRFBUsRVFUsBRFUVSwFEVRVLAURVHBUhRFUcFSFEVRwVIURQVLURRFBUtRFEUFS1EUFSxFURQVLEVRFBUsRVFUsBRFUVSwFEVRwVIURVHBUhRFUcFSFEUFS1EURQVLURRFBUtRFBUsRVEUFSxFURQVLEVRVLAURVFUsBRFUVSwFEVRwVIURTn7/D/sobuUxIih+wAAAABJRU5ErkJggg==";
let _storyLogoPromise = null;
function loadStoryLogo() {
  if (!_storyLogoPromise) {
    _storyLogoPromise = new Promise((resolve) => {
      const img = new Image();
      img.crossOrigin = "anonymous";
      img.onload = () => resolve(img);
      img.onerror = () => {
        // fallback به لوگوی قدیمی داخل کد
        const fallback = new Image();
        fallback.onload = () => resolve(fallback);
        fallback.onerror = () => resolve(null);
        fallback.src = STORY_LOGO_DATA_URI;
      };
      img.src = "assets/logo.png?v=2";
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
    const isSale = p.deal_type === "فروش";

    // پس‌زمینه
    const bg = ctx.createLinearGradient(0, 0, 0, H);
    bg.addColorStop(0, "#F7F1E6");
    bg.addColorStop(0.55, "#F3EBDC");
    bg.addColorStop(1, "#EDE3D0");
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W, H);

    ctx.fillStyle = T.brass;
    ctx.fillRect(0, 0, W, 12);

    ctx.fillStyle = T.ink;
    setFont(ctx, 800, 48);
    rtlText(ctx, "گروه مشاورین املاک اطلس", cx, 100);

    ctx.fillStyle = T.brass;
    setFont(ctx, 600, 26);
    rtlText(ctx, "خادم‌آباد  ·  باغستان  ·  شهریار", cx, 148);

    drawOrnamentDivider(ctx, cx, 188, 200);

    const cardX = 72;
    const cardW = W - cardX * 2;
    const padX = cardX + 52;
    const contentW = cardW - 104;
    const cardRight = cardX + cardW - 52;
    const cardY = 220;

    const extras = buildExtras(p);
    const specs = [];
    if (p.area_m2) specs.push(`${p.area_m2} متر`);
    if (p.rooms) specs.push(`${p.rooms} خواب`);
    const addr = truncateAddress(p.address) || "خادم‌آباد";
    const dealLabel = p.deal_type || "آگهی";
    const priceText = isSale
      ? `${p.price_total || "توافقی"}`
      : `رهن ${p.rahn || "-"}  |  اجاره ${p.ejare || "-"}`;

    // محاسبه ارتفاع واقعی کارت از روی همان فواصل رسم
    let y = cardY + 48;
    y += 52; // deal row
    y += 36;
    y += 56; // title
    y += 28; // divider
    if (specs.length) y += 84 + 28;
    y += 52; // address
    if (extras.length) y += 48 + 32;
    else y += 8;
    y += 140 + 36; // price
    y += 48; // phone label
    y += 48; // phone number
    if (p.agent_name) y += 40;
    y += 44; // bottom padding inside card
    const cardH = y - cardY;

    const footH = 248;
    const footY = cardY + cardH + 24;

    // کارت
    ctx.save();
    ctx.shadowColor = "rgba(32,28,21,0.14)";
    ctx.shadowBlur = 36;
    ctx.shadowOffsetY = 14;
    ctx.fillStyle = "#FFFCFA";
    rr(ctx, cardX, cardY, cardW, cardH, 32);
    ctx.fill();
    ctx.restore();
    ctx.strokeStyle = "rgba(180,137,79,0.45)";
    ctx.lineWidth = 2;
    rr(ctx, cardX, cardY, cardW, cardH, 32);
    ctx.stroke();

    // محتوا
    y = cardY + 48;

    setFont(ctx, 700, 28);
    const dealW = Math.max(150, ctx.measureText(dealLabel).width + 48);
    const dealH = 52;
    ctx.fillStyle = isSale ? T.sale : T.rent;
    rr(ctx, padX, y, dealW, dealH, 14);
    ctx.fill();
    ctx.fillStyle = "#fff";
    rtlText(ctx, dealLabel, padX + dealW / 2, y + dealH / 2 + 10);

    setFont(ctx, 700, 30);
    ctx.fillStyle = T.ink;
    rtlText(ctx, `کد ${p.code || "-"}`, cardRight, y + dealH / 2 + 10, { align: "right" });

    y += dealH + 36;

    ctx.fillStyle = T.ink;
    setFont(ctx, 800, 56);
    rtlText(ctx, p.property_type || "ملک", cx, y + 18);
    y += 56;

    ctx.strokeStyle = "rgba(32,28,21,0.12)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(padX, y);
    ctx.lineTo(cardRight, y);
    ctx.stroke();
    y += 28;

    if (specs.length) {
      const boxH = 84;
      ctx.fillStyle = "#F7F1E6";
      rr(ctx, padX, y, contentW, boxH, 16);
      ctx.fill();
      ctx.fillStyle = T.ink;
      setFont(ctx, 700, 36);
      rtlText(ctx, specs.join("   ·   "), cx, y + boxH / 2 + 12);
      y += boxH + 28;
    }

    ctx.fillStyle = T.ink;
    setFont(ctx, 600, 32);
    rtlText(ctx, `📍  ${addr}`, cx, y + 8);
    y += 52;

    if (extras.length) {
      setFont(ctx, 600, 28);
      const gap = 14;
      const widths = extras.map((e) => ctx.measureText(e).width + 36);
      const totalW = widths.reduce((a, b) => a + b, 0) + gap * (extras.length - 1);
      let x = cx + totalW / 2;
      const chipH = 48;
      extras.forEach((label, i) => {
        const w = widths[i];
        x -= w;
        ctx.fillStyle = "#F3EBDC";
        rr(ctx, x, y, w, chipH, 24);
        ctx.fill();
        ctx.fillStyle = T.ink;
        rtlText(ctx, label, x + w / 2, y + chipH / 2 + 10);
        x -= gap;
      });
      y += chipH + 32;
    } else {
      y += 8;
    }

    const priceH = 140;
    const priceGrad = ctx.createLinearGradient(padX, y, padX + contentW, y);
    priceGrad.addColorStop(0, "#E8D5A8");
    priceGrad.addColorStop(1, "#F5E8C8");
    ctx.fillStyle = priceGrad;
    rr(ctx, padX, y, contentW, priceH, 20);
    ctx.fill();
    ctx.strokeStyle = T.brass;
    ctx.lineWidth = 1.5;
    rr(ctx, padX, y, contentW, priceH, 20);
    ctx.stroke();

    ctx.fillStyle = T.brassDark || "#8A6A3A";
    setFont(ctx, 600, 24);
    rtlText(ctx, isSale ? "قیمت فروش" : "شرایط رهن و اجاره", cx, y + 42);

    ctx.fillStyle = T.ink;
    setFont(ctx, 800, isSale ? 44 : 32);
    rtlText(ctx, priceText, cx, y + 100);
    y += priceH + 36;

    ctx.fillStyle = T.ink;
    setFont(ctx, 700, 30);
    rtlText(ctx, "📞  تماس با دفتر اطلس", cx, y);
    y += 48;

    ctx.fillStyle = T.sale || "#2F6B4F";
    setFont(ctx, 800, 40);
    ctx.direction = "ltr";
    ctx.textAlign = "center";
    ctx.fillText("0910 694 3220", cx, y);
    ctx.direction = "rtl";
    y += 48;

    if (p.agent_name) {
      ctx.fillStyle = "#6B6358";
      setFont(ctx, 600, 26);
      rtlText(ctx, `ثبت‌شده توسط: ${cleanAgentName(p.agent_name)}`, cx, y);
    }

    // فوتر
    ctx.fillStyle = T.ink;
    rr(ctx, cardX, footY, cardW, footH, 26);
    ctx.fill();

    let fy = footY + 38;
    ctx.fillStyle = T.brass;
    setFont(ctx, 700, 24);
    rtlText(ctx, "مشاهده جزئیات و آگهی‌های مشابه", cx, fy);

    fy += 34;
    ctx.fillStyle = "#F7F1E6";
    setFont(ctx, 600, 24);
    rtlText(ctx, "خادم‌آباد و باغستان", cx, fy);

    fy += 26;
    const btnW = 360;
    const btnH = 48;
    ctx.fillStyle = T.brass;
    rr(ctx, cx - btnW / 2, fy, btnW, btnH, 12);
    ctx.fill();
    ctx.fillStyle = T.ink;
    ctx.direction = "ltr";
    ctx.textAlign = "center";
    setFont(ctx, 800, 28);
    ctx.fillText("atlas-amlak.ir", cx, fy + btnH / 2 + 10);
    ctx.direction = "rtl";

    fy += btnH + 22;
    ctx.strokeStyle = "rgba(180,137,79,0.35)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(padX + 30, fy);
    ctx.lineTo(cardRight - 30, fy);
    ctx.stroke();

    fy += 26;
    ctx.fillStyle = "rgba(247,241,230,0.75)";
    setFont(ctx, 600, 20);
    rtlText(ctx, "تهیه شده توسط دفتر اطلس", cx, fy);

    if (logoImg) {
      const logoSize = 52;
      ctx.drawImage(logoImg, cx - logoSize / 2, footY + footH - logoSize - 16, logoSize, logoSize);
    }

    ctx.fillStyle = T.brass;
    ctx.fillRect(0, H - 12, W, 12);

    const dataUrl = canvas.toDataURL("image/jpeg", 0.95);
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


function showShareModal(p, shareBtn) {
  const oldModal = document.getElementById("shareModal");
  if (oldModal) oldModal.remove();

  const shareUrl = `${window.location.origin}${window.location.pathname}?code=${p.code}`;
  const extras = buildExtras(p);
  const priceText = p.deal_type === "فروش"
    ? `💰 قیمت: ${p.price_total || "توافقی"}`
    : `💰 رهن: ${p.rahn || "-"} | اجاره: ${p.ejare || "-"}`;

  const shareText =
`🏠 ${p.property_type || "ملک"} · کد ${p.code}

📍 ${p.address || "خادم‌آباد"}
📐 ${[p.area_m2 ? p.area_m2 + " متر" : "", p.rooms ? p.rooms + " خواب" : ""].filter(Boolean).join(" · ")}
${extras.length ? "✨ " + extras.join(" · ") + "\n" : ""}${priceText}

📞 تماس با دفتر اطلس: ۰۹۱۰۶۹۴۳۲۲۰

🔗 مشاهده آگهی:
${shareUrl}

🌐 atlas-amlak.ir
گروه مشاورین املاک اطلس — خادم‌آباد و باغستان`;

  const modalHtml = `
    <div id="shareModal" style="position:fixed;inset:0;z-index:9999;background:rgba(32,28,21,0.55);backdrop-filter:blur(5px);display:flex;align-items:center;justify-content:center;padding:16px;">
      <div style="background:#FFFCFA;border:1px solid #E8DFD0;border-radius:20px;width:100%;max-width:380px;padding:24px;text-align:center;box-shadow:0 16px 40px rgba(32,28,21,0.2);">
        <h3 style="margin:0 0 6px;color:#201C15;font-size:1.15rem;font-weight:800;">اشتراک‌گذاری آگهی</h3>
        <p style="margin:0 0 18px;color:#6B6358;font-size:0.85rem;">کد ${p.code || "—"} · ${p.property_type || "ملک"}</p>

        <div style="display:flex;flex-direction:column;gap:10px;">
          <button id="modalNativeShareBtn" type="button" style="background:#201C15;color:#FFFCFA;border:none;padding:13px;border-radius:12px;font-weight:700;font-size:0.92rem;cursor:pointer;">
            📤 اشتراک از طریق برنامه‌ها
          </button>
          <button id="modalStoryBtn" type="button" style="background:#B4894F;color:#201C15;border:none;padding:13px;border-radius:12px;font-weight:700;font-size:0.92rem;cursor:pointer;">
            🖼️ دانلود کارت تصویری
          </button>
          <button id="modalTextBtn" type="button" style="background:#FFFCFA;color:#201C15;border:1px solid #D4C4A8;padding:13px;border-radius:12px;font-weight:700;font-size:0.92rem;cursor:pointer;">
            📋 کپی متن آگهی
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

  // اشتراک بومی (واتساپ، تلگرام، ...)
  document.getElementById("modalNativeShareBtn").addEventListener("click", async () => {
    if (navigator.share) {
      try {
        await navigator.share({
          title: `${p.property_type || "ملک"} · کد ${p.code} | اطلس املاک`,
          text: shareText,
          url: shareUrl
        });
        showCopySuccess(shareBtn, "✅ اشتراک‌گذاری شد");
        closeModal();
      } catch (err) {
        if (err && err.name !== "AbortError") {
          forceCopyText(shareText);
          showCopySuccess(shareBtn, "📋 متن کپی شد");
          closeModal();
        }
      }
    } else {
      forceCopyText(shareText);
      showCopySuccess(shareBtn, "📋 متن کپی شد (اشتراک مستقیم پشتیبانی نمی‌شود)");
      closeModal();
    }
  });

  document.getElementById("modalStoryBtn").addEventListener("click", async () => {
    const btn = document.getElementById("modalStoryBtn");
    const original = btn.innerHTML;
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
      agent_name: (document.getElementById("submitAgentName")?.value.trim()
                    || document.getElementById("submitName")?.value.trim()
                    || ""),
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

      if (!res.ok) {
        let errMsg = "خطا در ارسال";
        try {
          const errJson = await res.json();
          if (errJson.detail) errMsg = typeof errJson.detail === "string" ? errJson.detail : errMsg;
        } catch (_) {}
        throw new Error(errMsg);
      }

      statusEl.textContent = "✅ فایل با موفقیت ارسال شد. به زودی با شما تماس می‌گیریم.";
      statusEl.classList.add("success");
      submitForm.reset();
      if (agentNameGroup) agentNameGroup.style.display = "none";
      if (typeof updatePriceFields === "function") updatePriceFields();
    } catch (err) {
      statusEl.textContent = "❌ " + (err.message || "مشکلی پیش آمد. لطفاً دوباره تلاش کنید.");
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
        let errMsg = "خطا در ارسال";
        try {
          const errJson = await res.json();
          if (errJson.detail) errMsg = typeof errJson.detail === "string" ? errJson.detail : errMsg;
        } catch (_) {}
        throw new Error(errMsg);
      }

      if (statusEl) {
        statusEl.textContent = "✅ پیام شما ثبت شد. به زودی تماس می‌گیریم.";
        statusEl.classList.add("success");
      }
      leadForm.reset();
    } catch (err) {
      if (statusEl) {
        statusEl.textContent = "❌ " + (err.message || "مشکلی پیش آمد. لطفاً دوباره تلاش کنید.");
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

// --------------------------------------------------------------------- //
// ۱۱. دکمه‌های دسترسی سریع (فروش / رهن)
// --------------------------------------------------------------------- //
const quickSale = document.getElementById("quickSale");
const quickRent = document.getElementById("quickRent");

function filterByDealType(dealType) {
  const dealTypeEl = document.getElementById("dealType");
  if (dealTypeEl) dealTypeEl.value = dealType;
  if (typeof applyFilters === "function") {
    applyFilters();
  }
  const listings = document.getElementById("listings");
  if (listings) listings.scrollIntoView({ behavior: "smooth" });
}

if (quickSale) {
  quickSale.addEventListener("click", (e) => {
    e.preventDefault();
    filterByDealType("فروش");
  });
}
if (quickRent) {
  quickRent.addEventListener("click", (e) => {
    e.preventDefault();
    filterByDealType("رهن و اجاره");
  });
}
