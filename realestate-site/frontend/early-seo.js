/* early-seo.js — به‌محض لود دادهٔ اسنپ‌شات، title/meta مخصوص ?code= را تنظیم می‌کند
   مستقل از script.js؛ ظاهر و منطق کارت/اشتراک را تغییر نمی‌دهد. */
(function () {
  try {
    var params = new URLSearchParams(window.location.search);
    var code = params.get("code");
    if (!code) return;

    var list = window.__PRELOADED_PROPERTIES__;
    if (!list || !list.length) return;

    var p = null;
    for (var i = 0; i < list.length; i++) {
      if (String(list[i].code) === String(code)) {
        p = list[i];
        break;
      }
    }
    if (!p) return;

    function cleanPrice(t) {
      if (!t) return "";
      return String(t).replace(/(\d+)\.(\d+)/g, function (m, a, b) {
        var trimmed = b.replace(/0+$/, "");
        return trimmed ? a + "." + trimmed : a;
      });
    }

    var type = (p.property_type || "ملک").trim();
    var label = p.deal_type === "فروش" ? type + " فروشی" : "رهن و اجاره " + type;
    var addr = (p.address || "").trim();
    if (addr.length > 50) addr = addr.slice(0, 50) + "…";

    var specs = [];
    if (p.area_m2) specs.push(p.area_m2 + " متر");
    if (p.rooms) specs.push(p.rooms + " خواب");
    if (p.floor) specs.push("طبقه " + p.floor);

    var price = "";
    if (p.deal_type === "فروش") {
      price = cleanPrice(p.price_total) || "توافقی";
    } else {
      var bits = [];
      if (p.rahn && p.rahn !== "-") bits.push("رهن " + cleanPrice(p.rahn));
      if (p.ejare && p.ejare !== "-") bits.push("اجاره " + cleanPrice(p.ejare));
      price = bits.length ? bits.join(" | ") : "توافقی";
    }

    var title = label + " کد " + code + " | اطلس املاک";
    var parts = [label + " کد " + code];
    if (addr) parts.push(addr);
    if (specs.length) parts.push(specs.join(" · "));
    if (price) parts.push(price);
    parts.push("مشاهده جزئیات و تماس با دفتر اطلس املاک خادم‌آباد و باغستان.");
    var desc = parts.join(" — ");

    var pageUrl =
      window.location.origin +
      window.location.pathname +
      "?code=" +
      encodeURIComponent(code);

    var ogImage = p.image || "https://atlas-amlak.ir/assets/logo.png";
    if (ogImage && !/^https?:\/\//i.test(ogImage)) {
      try {
        ogImage = new URL(ogImage, window.location.origin + window.location.pathname).href;
      } catch (e) {
        ogImage = "https://atlas-amlak.ir/assets/logo.png";
      }
    }

    document.title = title;

    function setMeta(attr, key, val) {
      if (!val) return;
      var el = document.querySelector("meta[" + attr + '="' + key + '"]');
      if (!el) {
        el = document.createElement("meta");
        el.setAttribute(attr, key);
        document.head.appendChild(el);
      }
      el.setAttribute("content", val);
    }

    var descEl = document.querySelector('meta[name="description"]');
    if (descEl) descEl.setAttribute("content", desc);

    setMeta("property", "og:title", title);
    setMeta("property", "og:description", desc);
    setMeta("property", "og:url", pageUrl);
    setMeta("property", "og:image", ogImage);
    setMeta("name", "twitter:title", title);
    setMeta("name", "twitter:description", desc);
    setMeta("name", "twitter:image", ogImage);

    var canonical = document.querySelector('link[rel="canonical"]');
    if (!canonical) {
      canonical = document.createElement("link");
      canonical.rel = "canonical";
      document.head.appendChild(canonical);
    }
    canonical.href = pageUrl;
  } catch (err) {
    // عمداً ساکت: اگر خطا باشد سایت عادی کار می‌کند
  }
})();
