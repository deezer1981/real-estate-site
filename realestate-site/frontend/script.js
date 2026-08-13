// script.js — منطق مخصوص صفحه‌ی اصلی (کاروسل، فیلتر، لیست آگهی‌ها، فرم تماس)

// ۱. متغیر پایه API (اگر در common.js تعریف نشده باشد، از لینک مستقیم استفاده می‌کند)
const BASE_API = typeof API_BASE_URL !== "undefined" ? API_BASE_URL : "https://api.atlas-amlak.ir";

// --------------------------------------------------------------------- //
// خلاصه و خلاصه‌سازی هوشمند آدرس
// --------------------------------------------------------------------- //
function truncateAddress(address) {
  if (!address) return "";
  const text = address.trim();
  const match = text.match(/^(.*?لاله\s*[\u06F0-\u06F90-9]+\s*(اصلی|غربی|شرقی)?)/);
  if (match && match[1]) {
    return match[1].trim();
  }
  return text.length > 40 ? text.slice(0, 40).trim() + "…" : text;
}

// --------------------------------------------------------------------- //
// فیلتر کشویی موبایل (Bottom Sheet)
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

if (searchBar) {
  searchBar.addEventListener("click", (e) => e.stopPropagation());
  searchBar.addEventListener("touchstart", (e) => e.stopPropagation());
}

// --------------------------------------------------------------------- //
// وضعیت آگهی‌ها و رندر
// --------------------------------------------------------------------- //
const grid = document.getElementById("propertyGrid");
const resultCount = document.getElementById("resultCount");
const loadMoreBtn = document.getElementById("loadMoreBtn");
let allProperties = [];
let currentFiltered = [];

const PAGE_SIZE = 6;
let visibleCount = PAGE_SIZE;

function buildExtras(p) {
  const extras = [];
  if (p.parking) extras.push("🅿️ پارکینگ");
  if (p.elevator) extras.push("🛗 آسانسور");
  if (p.storage) extras.push("📦 انباری");
  return extras;
}

function shareText(p) {
  const priceInfo =
    p.deal_type === "فروش"
      ? `💰 قیمت: ${p.price_total || "توافقی"}`
      : `💰 رهن: ${p.rahn || "-"} | اجاره: ${p.ejare || "-"}`;
  const url = `${location.origin}${location.pathname}?code=${encodeURIComponent(p.code || "")}`;
  const extras = buildExtras(p);
  const metaLine = [
    p.area_m2 ? `${p.area_m2} متر` : "",
    p.rooms ? `${p.rooms} خواب` : "",
  ].filter(Boolean).join(" · ");

  const lines = [
    `${p.property_type || "ملک"} · کد ${p.code || "-"}`,
    `📍 ${truncateAddress(p.address)}`,
  ];
  if (metaLine) lines.push(`📐 ${metaLine}`);
  if (extras.length) lines.push(extras.join(" "));
  lines.push(priceInfo);
  if (p.agent_name && p.agent_phone) {
    lines.push(`👤 ${p.agent_name} · 📞 ${p.agent_phone}`);
  } else if (p.agent_name) {
    lines.push(`👤 مشاور: ${p.agent_name}`);
  } else if (p.agent_phone) {
    lines.push(`📞 ${p.agent_phone}`);
  }
  lines.push("🌐 atlas-amlak.ir");
  lines.push(url);

  return { url, text: lines.join("\n") };
}

async function copyToClipboard(text) {
  if (navigator.clipboard && navigator.clipboard.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch (err) {}
  }
  try {
    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.style.position = "fixed";
    textarea.style.opacity = "0";
    document.body.appendChild(textarea);
    textarea.focus();
    textarea.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(textarea);
    return ok;
  } catch (err2) {
    return false;
  }
}

async function handleShareTextClick(code, btnEl) {
  const p = allProperties.find((item) => String(item.code) === String(code));
  if (!p) return;
  const { url, text } = shareText(p);

  if (navigator.share) {
    try {
      await navigator.share({
        title: `${p.property_type || "ملک"} · کد ${p.code || "-"}`,
        text: text,
        url: url,
      });
      return;
    } catch (err) {
      if (err.name === "AbortError") return;
    }
  }

  const copied = await copyToClipboard(text);
  if (btnEl) {
    const original = btnEl.textContent;
    btnEl.textContent = copied ? "✅ کپی شد" : "⚠️ کپی نشد";
    btnEl.disabled = true;
    setTimeout(() => {
      btnEl.textContent = original;
      btnEl.disabled = false;
    }, 1800);
  }
  if (!copied) {
    prompt("این متن را کپی کنید:", text);
  }
}

// --------------------------------------------------------------------- //
// ساخت تصویر کارت آگهی با Canvas (استوری)
// --------------------------------------------------------------------- //
function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function hexToRgba(hex, alpha) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

function wrapCanvasText(ctx, text, maxWidth) {
  const words = text.split(" ");
  const lines = [];
  let current = "";
  words.forEach((word) => {
    const test = current ? current + " " + word : word;
    if (ctx.measureText(test).width > maxWidth && current) {
      lines.push(current);
      current = word;
    } else {
      current = test;
    }
  });
  if (current) lines.push(current);
  return lines;
}

async function ensureFontLoaded() {
  try {
    await document.fonts.load('600 34px Vazirmatn');
    await document.fonts.load('700 46px Vazirmatn');
    await document.fonts.load('800 52px Vazirmatn');
    await document.fonts.ready;
  } catch (err) {}
}

async function generatePropertyImageBlob(p) {
  await ensureFontLoaded();

  const W = 1080, H = 1920;
  const INK = "#14213D", BRASS = "#B8894F", PAPER = "#F5F1EA", SAGE = "#4A6B5F", TEXT = "#2B2B2B";

  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d");
  ctx.direction = "rtl";

  ctx.fillStyle = PAPER;
  ctx.fillRect(0, 0, W, H);

  const headerH = 230;
  ctx.fillStyle = INK;
  ctx.fillRect(0, 0, W, headerH);
  ctx.textAlign = "center";
  ctx.fillStyle = "#ffffff";
  ctx.font = "700 46px Vazirmatn, sans-serif";
  ctx.fillText("گروه مشاورین املاک اطلس", W / 2, 115);
  ctx.fillStyle = BRASS;
  ctx.font = "600 30px Vazirmatn, sans-serif";
  ctx.fillText("شهریار، باغستان، خادم‌آباد", W / 2, 168);

  const footerH = 220;
  const cardX = 60, cardY = headerH + 60;
  const cardW = W - 120, cardH = H - headerH - 60 - footerH - 40;
  ctx.fillStyle = "#ffffff";
  roundRect(ctx, cardX, cardY, cardW, cardH, 28);
  ctx.fill();

  const padX = cardX + cardW - 60;
  const contentW = cardW - 120;
  let cy = cardY + 100;

  ctx.textAlign = "right";

  const dealText = p.deal_type || "";
  ctx.font = "700 32px Vazirmatn, sans-serif";
  const tagW = ctx.measureText(dealText).width + 60;
  const tagColor = p.deal_type === "فروش" ? SAGE : BRASS;
  ctx.fillStyle = hexToRgba(tagColor, 0.15);
  roundRect(ctx, padX - tagW, cy - 46, tagW, 62, 31);
  ctx.fill();
  ctx.fillStyle = tagColor;
  ctx.fillText(dealText, padX - 30, cy - 4);
  cy += 95;

  ctx.fillStyle = INK;
  ctx.font = "800 52px Vazirmatn, sans-serif";
  ctx.fillText(`${p.property_type || "ملک"} · کد ${p.code || "-"}`, padX, cy);
  cy += 78;

  ctx.fillStyle = TEXT;
  ctx.font = "500 38px Vazirmatn, sans-serif";
  wrapCanvasText(ctx, `📍 ${truncateAddress(p.address)}`, contentW).forEach((line) => {
    ctx.fillText(line, padX, cy);
    cy += 52;
  });
  cy += 12;

  const metaParts = [];
  if (p.area_m2) metaParts.push(`${p.area_m2} متر`);
  if (p.rooms) metaParts.push(`${p.rooms} خواب`);
  if (metaParts.length) {
    ctx.font = "500 36px Vazirmatn, sans-serif";
    ctx.fillText(`📐 ${metaParts.join(" · ")}`, padX, cy);
    cy += 58;
  }

  const extras = buildExtras(p);
  if (extras.length) {
    ctx.font = "500 34px Vazirmatn, sans-serif";
    ctx.fillText(extras.join("    "), padX, cy);
    cy += 58;
  }

  cy += 20;
  ctx.strokeStyle = "#E4DFD3";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(padX, cy);
  ctx.lineTo(padX - contentW, cy);
  ctx.stroke();
  cy += 70;

  const priceInfo =
    p.deal_type === "فروش"
      ? `${p.price_total || "توافقی"}`
      : `رهن: ${p.rahn || "-"}  |  اجاره: ${p.ejare || "-"}`;
  ctx.fillStyle = INK;
  ctx.font = "800 50px Vazirmatn, sans-serif";
  wrapCanvasText(ctx, `💰 ${priceInfo}`, contentW).forEach((line) => {
    ctx.fillText(line, padX, cy);
    cy += 62;
  });

  if (p.agent_name || p.agent_phone) {
    cy += 20;
    ctx.font = "600 34px Vazirmatn, sans-serif";
    ctx.fillStyle = SAGE;
    let agentText;
    if (p.agent_name && p.agent_phone) agentText = `👤 ${p.agent_name} · 📞 ${p.agent_phone}`;
    else if (p.agent_name) agentText = `👤 مشاور: ${p.agent_name}`;
    else agentText = `📞 ${p.agent_phone}`;
    ctx.fillText(agentText, padX, cy);
  }

  ctx.fillStyle = BRASS;
  ctx.fillRect(0, H - footerH, W, footerH);
  ctx.textAlign = "center";
  ctx.fillStyle = INK;
  ctx.font = "700 40px Vazirmatn, sans-serif";
  ctx.fillText("🌐 atlas-amlak.ir", W / 2, H - footerH + 90);
  ctx.font = "500 30px Vazirmatn, sans-serif";
  ctx.fillText("برای مشاهده آگهی‌های بیشتر", W / 2, H - footerH + 140);

  return new Promise((resolve) => {
    canvas.toBlob((blob) => resolve(blob), "image/png", 0.95);
  });
}

async function handleShareImageClick(code, btnEl) {
  const p = allProperties.find((item) => String(item.code) === String(code));
  if (!p) return;

  const original = btnEl ? btnEl.textContent : "";
  if (btnEl) {
    btnEl.textContent = "⏳ در حال ساخت تصویر...";
    btnEl.disabled = true;
  }

  try {
    const blob = await generatePropertyImageBlob(p);
    const fileName = `atlas-amlak-${p.code || "ملک"}.png`;
    const file = new File([blob], fileName, { type: "image/png" });

    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      await navigator.share({
        files: [file],
        text: `${p.property_type || "ملک"} · کد ${p.code || "-"} — atlas-amlak.ir`,
      });
    } else {
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = fileName;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 4000);
    }
  } catch (err) {
    alert("ساخت تصویر با خطا مواجه شد. لطفاً دوباره تلاش کنید.");
  } finally {
    if (btnEl) {
      btnEl.textContent = original;
      btnEl.disabled = false;
    }
  }
}

// --------------------------------------------------------------------- //
// منوی انتخاب «کپی متن» یا «اشتراک تصویر»
// --------------------------------------------------------------------- //
function closeShareMenu() {
  document.querySelectorAll(".share-menu").forEach((m) => m.remove());
}

function openShareMenu(anchorBtn, code) {
  closeShareMenu();
  const menu = document.createElement("div");
  menu.className = "share-menu";
  menu.style.position = "absolute";
  menu.style.zIndex = "9999";
  menu.innerHTML = `
    <button type="button" data-action="text">📋 کپی متن آگهی</button>
    <button type="button" data-action="image">🖼 اشتراک تصویر (استوری)</button>
  `;
  document.body.appendChild(menu);

  const rect = anchorBtn.getBoundingClientRect();
  const menuWidth = 220;
  let left = rect.right - menuWidth;
  if (left < 8) left = 8;
  if (left + menuWidth > window.innerWidth - 8) left = window.innerWidth - menuWidth - 8;
  
  menu.style.top = `${rect.bottom + window.scrollY + 6}px`;
  menu.style.left = `${left}px`;

  menu.addEventListener("click", (e) => {
    e.stopPropagation();
    const action = e.target.closest("button")?.dataset.action;
    if (!action) return;
    closeShareMenu();
    if (action === "text") handleShareTextClick(code, anchorBtn);
    if (action === "image") handleShareImageClick(code, anchorBtn);
  });

  setTimeout(() => {
    window.addEventListener("click", function outsideCloser(e) {
      if (!menu.contains(e.target)) {
        closeShareMenu();
        window.removeEventListener("click", outsideCloser);
      }
    });
  }, 50);
}

function propertyCard(p) {
  const priceLine =
    p.deal_type === "فروش"
      ? `<p class="card-price">💰 ${p.price_total || "توافقی"}</p>`
      : `<p class="card-price">💰 رهن: ${p.rahn || "-"} | اجاره: ${p.ejare || "-"}</p>`;

  const extras = buildExtras(p);
  const shortAddress = truncateAddress(p.address);
  const cardId = `card-${p.code || Math.random().toString(36).slice(2)}`;

  const agentLine = p.agent_name
    ? `<p class="card-agent">👤 ثبت‌شده توسط: <strong>${p.agent_name}</strong></p>`
    : "";
  const agentCallBtn = p.agent_phone
    ? `<a class="agent-call-btn" href="tel:${p.agent_phone}">📞 تماس با ${p.agent_name || "مشاور"}</a>`
    : "";

  return `
    <article class="card" id="${cardId}" data-code="${p.code || ""}">
      <div class="card-body">
        <div class="card-top-row">
          <span class="deal-tag ${p.deal_type === "فروش" ? "sale" : "rent"}">${p.deal_type || "آگهی"}</span>
          <button class="share-btn" data-code="${p.code || ""}" aria-label="اشتراک‌گذاری آگهی" type="button">🔗 اشتراک</button>
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
  `;
}

function renderProperties() {
  if (!grid) return;
  if (!currentFiltered.length) {
    grid.innerHTML = `<p class="loading">فایلی با این مشخصات پیدا نشد.</p>`;
    if (resultCount) resultCount.textContent = "";
    if (loadMoreBtn) loadMoreBtn.hidden = true;
    return;
  }
  const shown = currentFiltered.slice(0, visibleCount);
  grid.innerHTML = shown.map(propertyCard).join("");
  if (resultCount) resultCount.textContent = `${shown.length} از ${currentFiltered.length} آگهی`;
  if (loadMoreBtn) loadMoreBtn.hidden = visibleCount >= currentFiltered.length;
}

if (grid) {
  grid.addEventListener("click", (e) => {
    const btn = e.target.closest(".share-btn");
    if (btn) {
      e.stopPropagation();
      openShareMenu(btn, btn.dataset.code);
    }
  });
}

function applyDeepLinkIfPresent() {
  const params = new URLSearchParams(location.search);
  const code = params.get("code");
  const clearBtn = document.getElementById("clearDeepLinkBtn");
  if (!code) return;
  const match = allProperties.find((p) => String(p.code) === String(code));
  if (!match) return;
  currentFiltered = [match];
  visibleCount = PAGE_SIZE;
  renderProperties();
  if (clearBtn) clearBtn.hidden = false;
  const listingsEl = document.getElementById("listings");
  if (listingsEl) listingsEl.scrollIntoView({ behavior: "smooth" });
}

const clearDeepLinkBtn = document.getElementById("clearDeepLinkBtn");
if (clearDeepLinkBtn) {
  clearDeepLinkBtn.addEventListener("click", () => {
    history.replaceState(null, "", location.pathname);
    clearDeepLinkBtn.hidden = true;
    applyFilters();
  });
}

if (loadMoreBtn) {
  loadMoreBtn.addEventListener("click", () => {
    visibleCount += PAGE_SIZE;
    renderProperties();
  });
}

function loadSnapshotData() {
  const el = document.getElementById("snapshotData");
  if (!el) return false;
  try {
    const data = JSON.parse(el.textContent);
    if (Array.isArray(data) && data.length) {
      allProperties = data;
      updateStatsRibbon();
      applyFilters();
      return true;
    }
  } catch (err) {}
  return false;
}

async function loadProperties() {
  const hadSnapshot = loadSnapshotData();
  if (!hadSnapshot && grid) {
    grid.innerHTML = `<p class="loading">در حال بارگذاری آگهی‌ها...</p>`;
  } else {
    applyDeepLinkIfPresent();
  }

  try {
    const res = await fetch(`${BASE_API}/api/properties`);
    if (!res.ok) throw new Error("request failed");
    const data = await res.json();
    allProperties = Array.isArray(data) ? data.reverse() : [];
    updateStatsRibbon();
    applyFilters();
    applyDeepLinkIfPresent();
  } catch (err) {
    console.error("Fetch error:", err);
    if (!hadSnapshot && grid) {
      grid.innerHTML = `<p class="loading">اتصال به سرور برقرار نشد. لطفاً چند لحظه صبر کنید و صفحه را رفرش کنید.</p>`;
    }
  }
}

function updateStatsRibbon() {
  const saleCount = allProperties.filter((p) => p.deal_type === "فروش").length;
  const rentCount = allProperties.filter((p) => p.deal_type === "رهن و اجاره").length;
  const el = document.getElementById("statsText");
  if (el) {
    el.textContent = `🏠 ${allProperties.length} فایل فعال — ${saleCount} فروشی، ${rentCount} رهن و اجاره`;
  }
}

function initCarousel() {
  const slides = document.querySelectorAll(".carousel-slide");
  const dots = document.querySelectorAll(".dot");
  if (slides.length <= 1) return;

  let current = 0;
  function goTo(index) {
    slides[current].classList.remove("active");
    dots[current].classList.remove("active");
    current = index;
    slides[current].classList.add("active");
    dots[current].classList.add("active");
  }
  dots.forEach((dot, i) => dot.addEventListener("click", () => goTo(i)));
  setInterval(() => goTo((current + 1) % slides.length), 4500);
}
initCarousel();

function applyFilters() {
  const citySearchEl = document.getElementById("citySearch");
  const dealTypeEl = document.getElementById("dealType");
  const keyword = citySearchEl ? citySearchEl.value.trim() : "";
  const dealType = dealTypeEl ? dealTypeEl.value : "";

  let filtered = allProperties;
  if (dealType) {
    filtered = filtered.filter((p) => p.deal_type === dealType);
  }
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
    const listingsEl = document.getElementById("listings");
    if (listingsEl) listingsEl.scrollIntoView({ behavior: "smooth" });
  });
}

const quickSale = document.getElementById("quickSale");
if (quickSale) {
  quickSale.addEventListener("click", (e) => {
    e.preventDefault();
    const dt = document.getElementById("dealType");
    if (dt) dt.value = "فروش";
    applyFilters();
    const listingsEl = document.getElementById("listings");
    if (listingsEl) listingsEl.scrollIntoView({ behavior: "smooth" });
  });
}

const quickRent = document.getElementById("quickRent");
if (quickRent) {
  quickRent.addEventListener("click", (e) => {
    e.preventDefault();
    const dt = document.getElementById("dealType");
    if (dt) dt.value = "رهن و اجاره";
    applyFilters();
    const listingsEl = document.getElementById("listings");
    if (listingsEl) listingsEl.scrollIntoView({ behavior: "smooth" });
  });
}

const leadForm = document.getElementById("leadForm");
if (leadForm) {
  leadForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const statusEl = document.getElementById("formStatus");
    const name = document.getElementById("leadName").value.trim();
    const phone = document.getElementById("leadPhone").value.trim();
    const message = document.getElementById("leadMessage").value.trim();

    if (statusEl) statusEl.textContent = "در حال ارسال...";

    const payload = { name, phone, message, source: "website" };

    try {
      await fetch(`${BASE_API}/api/leads`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
    } catch (err) {}

    const waText = encodeURIComponent(
      `سلام، من ${name} هستم.\nشماره تماس: ${phone}\n${message ? "پیام: " + message : ""}`
    );
    const waUrl = typeof whatsappUrl !== "undefined" ? whatsappUrl : "https://wa.me/";
    window.open(`${waUrl}?text=${waText}`, "_blank");

    if (statusEl) statusEl.textContent = "درخواست شما ثبت شد و چت واتساپ باز شد.";
    e.target.reset();
  });
}

loadProperties();
