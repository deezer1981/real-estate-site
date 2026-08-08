document.getElementById("year").textContent = new Date().getFullYear();

const botUrl = `https://t.me/${TELEGRAM_BOT_USERNAME}`;
document.getElementById("botLinkNav").href = botUrl;
document.getElementById("botLinkBig").href = botUrl;

const whatsappUrl = `https://wa.me/${WHATSAPP_NUMBER}`;
document.getElementById("whatsappLinkNav").href = whatsappUrl;
document.getElementById("whatsappLinkBig").href = whatsappUrl;

const rubikaUrl = `https://rubika.ir/${RUBIKA_USERNAME}`;
document.getElementById("rubikaLinkNav").href = rubikaUrl;
document.getElementById("rubikaLinkBig").href = rubikaUrl;

document.getElementById("tabTelegram").href = botUrl;

const grid = document.getElementById("propertyGrid");
const resultCount = document.getElementById("resultCount");
const loadMoreBtn = document.getElementById("loadMoreBtn");
let allProperties = [];
let currentFiltered = [];

const PAGE_SIZE = 6;
let visibleCount = PAGE_SIZE;

function propertyCard(p) {
  const priceLine =
    p.deal_type === "فروش"
      ? `<p class="card-price">💰 ${p.price_total || "توافقی"}</p>`
      : `<p class="card-price">💰 رهن: ${p.rahn || "-"} | اجاره: ${p.ejare || "-"}</p>`;

  const extras = [];
  if (p.parking) extras.push("🅿️ پارکینگ");
  if (p.elevator) extras.push("🛗 آسانسور");

  return `
    <article class="card">
      <div class="card-body">
        <span class="deal-tag ${p.deal_type === "فروش" ? "sale" : "rent"}">${p.deal_type}</span>
        <h3>${p.property_type || "ملک"} · کد ${p.code || "-"}</h3>
        <p class="card-meta">📍 ${p.address || "-"}</p>
        <p class="card-meta">${p.area_m2 ? p.area_m2 + " متر" : ""} ${p.rooms ? "· " + p.rooms + " خواب" : ""}</p>
        ${extras.length ? `<p class="card-meta">${extras.join(" | ")}</p>` : ""}
        ${priceLine}
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

loadMoreBtn.addEventListener("click", () => {
  visibleCount += PAGE_SIZE;
  renderProperties();
});

async function loadProperties() {
  grid.innerHTML = `<p class="loading">در حال بارگذاری آگهی‌ها...</p>`;
  try {
    const res = await fetch(`${API_BASE_URL}/api/properties`);
    if (!res.ok) throw new Error("request failed");
    allProperties = await res.json();
    applyFilters();
  } catch (err) {
    grid.innerHTML = `<p class="loading">اتصال به سرور برقرار نشد. لطفاً چند لحظه صبر کنید و صفحه را رفرش کنید (سرور رایگان گاهی چند ثانیه طول می‌کشد بیدار شود).</p>`;
  }
}

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

document.getElementById("searchBtn").addEventListener("click", applyFilters);

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

// Lead form
document.getElementById("leadForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const statusEl = document.getElementById("formStatus");
  statusEl.textContent = "در حال ارسال...";

  const payload = {
    name: document.getElementById("leadName").value.trim(),
    phone: document.getElementById("leadPhone").value.trim(),
    message: document.getElementById("leadMessage").value.trim(),
    source: "website",
  };

  try {
    const res = await fetch(`${API_BASE_URL}/api/leads`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!res.ok) throw new Error("failed");
    statusEl.textContent = "درخواست شما ثبت شد. به‌زودی تماس می‌گیریم.";
    e.target.reset();
  } catch (err) {
    statusEl.textContent = "ارسال با خطا مواجه شد. لطفاً دوباره تلاش کنید.";
  }
});

loadProperties();
