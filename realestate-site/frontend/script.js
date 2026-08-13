// script.js — منطق مخصوص صفحه‌ی اصلی (کاروسل، فیلتر، لیست آگهی‌ها، فرم
// تماس). منوی همبرگری و لینک‌های تماس توی common.js هست که قبل از این
// فایل لود میشه.

// --------------------------------------------------------------------- //
// Smart address truncation for property cards
//    Keeps everything up to "لاله X [اصلی/غربی/شرقی]" and drops the rest
//    of the sub-address (کوچه/پلاک/طبقه/زنگ ...) to keep cards clean.
// --------------------------------------------------------------------- //
function truncateAddress(address) {
  if (!address) return "";
  const text = address.trim();
  const match = text.match(/^(.*?لاله\s*[\u06F0-\u06F90-9]+\s*(اصلی|غربی|شرقی)?)/);
  if (match && match[1]) {
    return match[1].trim();
  }
  // Fallback: no "لاله" pattern found — cap at a reasonable length
  return text.length > 40 ? text.slice(0, 40).trim() + "…" : text;
}

// --------------------------------------------------------------------- //
// 3) Mobile bottom-sheet filter
// --------------------------------------------------------------------- //
const searchBar = document.getElementById("searchBar");
const filterFab = document.getElementById("filterFab");
const filterBackdrop = document.getElementById("filterBackdrop");
const sheetClose = document.getElementById("sheetClose");

function openSheet() {
  searchBar.classList.add("open");
  filterBackdrop.classList.add("open");
}
function closeSheet() {
  searchBar.classList.remove("open");
  filterBackdrop.classList.remove("open");
}
filterFab.addEventListener("click", openSheet);
filterBackdrop.addEventListener("click", closeSheet);
sheetClose.addEventListener("click", closeSheet);

// Defensive: prevent any tap/click inside the sheet itself from ever
// bubbling out to the backdrop's close handler (this is what caused
// "touching an input inside the sheet closes it").
searchBar.addEventListener("click", (e) => e.stopPropagation());
searchBar.addEventListener("touchstart", (e) => e.stopPropagation());

// --------------------------------------------------------------------- //
// Property listing state + rendering
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
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch (err) {
    // Fallback برای مرورگرهایی که Clipboard API رو محدود کردن
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
}

function isMobileLike() {
  return (
    window.matchMedia("(max-width: 720px)").matches ||
    /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent)
  );
}

async function handleShareTextClick(code, btnEl) {
  const p = allProperties.find((item) => String(item.code) === String(code));
  if (!p) return;
  const { text } = shareText(p);

  if (isMobileLike() && navigator.share) {
    try {
      await navigator.share({ text });
      return;
    } catch (err) {
      return; // کاربر منوی اشتراک‌گذاری رو بست
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
    prompt("این متن رو کپی کن:", text);
  }
}

// --------------------------------------------------------------------- //
// ساخت تصویر کارت آگهی (سایز استوری واتساپ، ۱۰۸۰×۱۹۲۰) با Canvas —
// دقیقاً با همون رنگ‌ها و استایل کارت‌های سایت
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
  } catch (err) {
    // اگه فونت لود نشد، همچنان با فونت پیش‌فرض مرورگر رسم می‌کنیم
  }
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

  // پس‌زمینه
  ctx.fillStyle = PAPER;
  ctx.fillRect(0, 0, W, H);

  // هدر سرمه‌ای بالا
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

  // کارت سفید وسط
  const footerH = 220;
  const cardX = 60, cardY = headerH + 60;
  const cardW = W - 120, cardH = H - headerH - 60 - footerH - 40;
  ctx.fillStyle = "#ffffff";
  roundRect(ctx, cardX, cardY, cardW, cardH, 28);
  ctx.fill();

  const padX = cardX + cardW - 60; // لبه‌ی راست محتوا (RTL)
  const contentW = cardW - 120;
  let cy = cardY + 100;

  ctx.textAlign = "right";

  // برچسب نوع معامله
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

  // عنوان
  ctx.fillStyle = INK;
  ctx.font = "800 52px Vazirmatn, sans-serif";
  ctx.fillText(`${p.property_type || "ملک"} · کد ${p.code || "-"}`, padX, cy);
  cy += 78;

  // آدرس
  ctx.fillStyle = TEXT;
  ctx.font = "500 38px Vazirmatn, sans-serif";
  wrapCanvasText(ctx, `📍 ${truncateAddress(p.address)}`, contentW).forEach((line) => {
    ctx.fillText(line, padX, cy);
    cy += 52;
  });
  cy += 12;

  // متراژ و خواب
  const metaParts = [];
  if (p.area_m2) metaParts.push(`${p.area_m2} متر`);
  if (p.rooms) metaParts.push(`${p.rooms} خواب`);
  if (metaParts.length) {
    ctx.font = "500 36px Vazirmatn, sans-serif";
    ctx.fillText(`📐 ${metaParts.join(" · ")}`, padX, cy);
    cy += 58;
  }

  // امکانات
  const extras = buildExtras(p);
  if (extras.length) {
    ctx.font = "500 34px Vazirmatn, sans-serif";
    ctx.fillText(extras.join("   "), padX, cy);
    cy += 58;
  }

  // خط جداکننده
  cy += 20;
  ctx.strokeStyle = "#E4DFD3";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(padX, cy);
  ctx.lineTo(padX - contentW, cy);
  ctx.stroke();
  cy += 70;

  // قیمت
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

  // مشاور
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

  // فوتر برنزی
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

    if (isMobileLike() && navigator.canShare && navigator.canShare({ files: [file] })) {
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
// منوی کوچیک انتخاب «کپی متن» یا «اشتراک تصویر»، کنار دکمه‌ی اشتراک هر کارت
// --------------------------------------------------------------------- //
function closeShareMenu() {
  document.querySelectorAll(".share-menu").forEach((m) => m.remove());
}

function openShareMenu(anchorBtn, code) {
  closeShareMenu();
  const menu = document.createElement("div");
  menu.className = "share-menu";
  menu.innerHTML = `
    <button type="button" data-action="text">📋 کپی متن آگهی</button>
    <button type="button" data-action="image">🖼 اشتراک تصویر (استوری)</button>
  `;
  document.body.appendChild(menu);

  const rect = anchorBtn.getBoundingClientRect();
  const menuWidth = 240;
  let left = rect.right - menuWidth;
  if (left < 8) left = 8;
  if (left + menuWidth > window.innerWidth - 8) left = window.innerWidth - menuWidth - 8;
  menu.style.top = `${rect.bottom + window.scrollY + 6}px`;
  menu.style.left = `${left}px`;

  menu.addEventListener("click", (e) => {
    const action = e.target.closest("button")?.dataset.action;
    if (!action) return;
    closeShareMenu();
    if (action === "text") handleShareTextClick(code, anchorBtn);
    if (action === "image") handleShareImageClick(code, anchorBtn);
  });

  setTimeout(() => {
    document.addEventListener(
      "click",
      function outsideCloser(e) {
        if (!menu.contains(e.target)) closeShareMenu();
      },
      { once: true }
    );
  }, 0);
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
          <span class="deal-tag ${p.deal_type === "فروش" ? "sale" : "rent"}">${p.deal_type}</span>
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
  if (!currentFiltered.length) {
    grid.innerHTML = `<p class="loading">فایلی با این مشخصات پیدا نشد.</p>`;
    resultCount.textContent = "";
    loadMoreBtn.hidden = true;
    return;
  }
  const shown = currentFiltered.slice(0, visibleCount);
  grid.innerHTML = shown.map(propertyCard).join("");
  resultCount.textContent = `${shown.length} از ${currentFiltered.length} آگهی`;
  loadMoreBtn.hidden = visibleCount >= currentFiltered.length;
}

// اشتراک‌گذاری هر کارت (delegation، چون کارت‌ها مرتب دوباره ساخته میشن)
grid.addEventListener("click", (e) => {
  const btn = e.target.closest(".share-btn");
  if (btn) openShareMenu(btn, btn.dataset.code);
});

// اگه لینک با ?code=XXX باز شده باشه، فقط همون آگهی رو نشون بده و اسکرول کن
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
  document.getElementById("listings").scrollIntoView({ behavior: "smooth" });
}

document.getElementById("clearDeepLinkBtn").addEventListener("click", () => {
  history.replaceState(null, "", location.pathname);
  document.getElementById("clearDeepLinkBtn").hidden = true;
  applyFilters();
});

loadMoreBtn.addEventListener("click", () => {
  visibleCount += PAGE_SIZE;
  renderProperties();
});

// اگه build_snapshot.py قبلاً دیتای آگهی‌ها رو توی صفحه جاسازی کرده باشه،
// همون‌ها رو فوراً (بدون صبر برای fetch) نشون می‌دیم؛ بعدش هنوز هم زنده
// از سرور آخرین نسخه رو می‌گیریم و جایگزین می‌کنیم.
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
  } catch (err) {
    // نادیده گرفتن خطای پارس، می‌ریم سراغ fetch زنده
  }
  return false;
}

async function loadProperties() {
  const hadSnapshot = loadSnapshotData();
  if (!hadSnapshot) {
    grid.innerHTML = `<p class="loading">در حال بارگذاری آگهی‌ها...</p>`;
  } else {
    applyDeepLinkIfPresent();
  }
  try {
    const res = await fetch(`${API_BASE_URL}/api/properties`);
    if (!res.ok) throw new Error("request failed");
    allProperties = (await res.json()).reverse(); // جدیدترین‌ها اول
    updateStatsRibbon();
    applyFilters();
    applyDeepLinkIfPresent();
  } catch (err) {
    if (!hadSnapshot) {
      grid.innerHTML = `<p class="loading">اتصال به سرور برقرار نشد. لطفاً چند لحظه صبر کنید و صفحه را رفرش کنید (سرور رایگان گاهی چند ثانیه طول می‌کشد بیدار شود).</p>`;
    }
    // اگه snapshot داشتیم، همون همچنان نمایش داده‌شده می‌مونه؛ کاربر بی‌نصیب نمی‌مونه.
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

// اسلایدر تصاویر بالای صفحه
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

// جستجو: همیشه روی کل داده‌ی گوگل‌شیت اجرا می‌شود، نه فقط آگهی‌های نمایش‌داده‌شده
function applyFilters() {
  const keyword = document.getElementById("citySearch").value.trim();
  const dealType = document.getElementById("dealType").value;

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

document.getElementById("searchBtn").addEventListener("click", () => {
  applyFilters();
  closeSheet();
  document.getElementById("listings").scrollIntoView({ behavior: "smooth" });
});

document.getElementById("quickSale").addEventListener("click", (e) => {
  e.preventDefault();
  document.getElementById("dealType").value = "فروش";
  applyFilters();
  document.getElementById("listings").scrollIntoView({ behavior: "smooth" });
});
document.getElementById("quickRent").addEventListener("click", (e) => {
  e.preventDefault();
  document.getElementById("dealType").value = "رهن و اجاره";
  applyFilters();
  document.getElementById("listings").scrollIntoView({ behavior: "smooth" });
});

// --------------------------------------------------------------------- //
// 4) Lead form -> save to backend AND open a pre-filled WhatsApp chat
// --------------------------------------------------------------------- //
document.getElementById("leadForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const statusEl = document.getElementById("formStatus");
  const name = document.getElementById("leadName").value.trim();
  const phone = document.getElementById("leadPhone").value.trim();
  const message = document.getElementById("leadMessage").value.trim();

  statusEl.textContent = "در حال ارسال...";

  const payload = { name, phone, message, source: "website" };

  try {
    await fetch(`${API_BASE_URL}/api/leads`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
  } catch (err) {
    // حتی اگر ذخیره در سرور ناموفق بود، همچنان کاربر را به واتساپ می‌فرستیم
  }

  const waText = encodeURIComponent(
    `سلام، من ${name} هستم.\nشماره تماس: ${phone}\n${message ? "پیام: " + message : ""}`
  );
  window.open(`${whatsappUrl}?text=${waText}`, "_blank");

  statusEl.textContent = "درخواست شما ثبت شد و چت واتساپ باز شد.";
  e.target.reset();
});

loadProperties();
