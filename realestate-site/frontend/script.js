document.getElementById("year").textContent = new Date().getFullYear();

const botUrl = `https://t.me/${TELEGRAM_BOT_USERNAME}`;
document.getElementById("botLinkNav").href = botUrl;
document.getElementById("botLinkBig").href = botUrl;

const grid = document.getElementById("propertyGrid");
const resultCount = document.getElementById("resultCount");

function formatPrice(num) {
  if (!num) return "توافقی";
  return new Intl.NumberFormat("fa-IR").format(num) + " تومان";
}

function propertyCard(p) {
  const img = p.image_url
    ? `<img src="${p.image_url}" alt="${p.title}">`
    : `<div class="no-image">بدون تصویر</div>`;

  return `
    <article class="card">
      <div class="card-image">${img}</div>
      <div class="card-body">
        <span class="deal-tag ${p.deal_type}">${p.deal_type === "rent" ? "رهن و اجاره" : "خرید"}</span>
        <h3>${p.title}</h3>
        <p class="card-meta">${p.city || ""} ${p.district ? "· " + p.district : ""}</p>
        <p class="card-meta">${p.area_m2 ? p.area_m2 + " متر" : ""} ${p.rooms ? "· " + p.rooms + " خواب" : ""}</p>
        <p class="card-price">${formatPrice(p.price)}</p>
      </div>
    </article>
  `;
}

async function loadProperties(city = "", dealType = "") {
  grid.innerHTML = `<p class="loading">در حال بارگذاری آگهی‌ها...</p>`;
  try {
    const params = new URLSearchParams();
    if (city) params.set("city", city);
    if (dealType) params.set("deal_type", dealType);

    const res = await fetch(`${API_BASE_URL}/api/properties?${params.toString()}`);
    if (!res.ok) throw new Error("request failed");
    const data = await res.json();

    if (!data.length) {
      grid.innerHTML = `<p class="loading">فعلاً آگهی‌ای ثبت نشده. به‌زودی اضافه می‌شود.</p>`;
      resultCount.textContent = "";
      return;
    }

    grid.innerHTML = data.map(propertyCard).join("");
    resultCount.textContent = `${data.length} آگهی`;
  } catch (err) {
    grid.innerHTML = `<p class="loading">اتصال به سرور برقرار نشد. لطفاً بعداً دوباره تلاش کنید.</p>`;
  }
}

document.getElementById("searchBtn").addEventListener("click", () => {
  const city = document.getElementById("citySearch").value.trim();
  const dealType = document.getElementById("dealType").value;
  loadProperties(city, dealType);
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
