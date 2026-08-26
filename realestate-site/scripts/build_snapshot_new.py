#!/usr/bin/env python3
"""
build_snapshot.py — دریافت مستقیم داده‌ها از گوگل‌شیت و تزریق به index.html و bagh-villa.html
Spreadsheet ID از GitHub Secret خوانده می‌شود تا در ریپوی عمومی دیده نشود.
"""

import csv
import io
import json
import os
import re
import requests
from pathlib import Path
from html import escape

# ==================== تنظیمات ====================
SPREADSHEET_ID = os.getenv("SPREADSHEET_ID", "")

SHEET_GIDS = {
    "فروش": "883906283",
    "رهن و اجاره": "388590955",
}

# GID تب «دکمه‌ها» (متن دکمه‌های میان‌بر بالای صفحه اصلی) — اختیاری.
MENU_SHEET_GID = os.getenv("MENU_SHEET_GID", "")

# GID تب «صفحه باغ و ویلا» — اختیاری.
# ساختار تب: دو ستون  کلید | مقدار
# کلیدهای پشتیبانی‌شده:
#   title, subtitle, caption, intro, para1, para2, list_title,
#   list1, list2, list3, list4, list5,
#   image1, image1_caption, image2, image2_caption, image3, image3_caption, image4, image4_caption,
#   hero_image
BAGH_SHEET_GID = os.getenv("BAGH_SHEET_GID", "")

INACTIVE_STATUSES = {
    "لغو شده",
    "حذف شده",
    "غیرفعال",
    "غیر فعال",
    "غیرفعال شده",
}

# ---------------------------------------------------------------
# عکس‌های پیش‌فرض وقتی ستون «عکس» در شیت خالی باشد.
# این فایل‌ها باید از قبل داخل ریپو، در مسیر زیر آپلود شوند:
#   frontend/assets/defaults/<نام فایل>
# مسیرها نسبی هستند (نه raw.githubusercontent.com) تا از همان CDN
# سایت (GitHub Pages) سرو شوند و سرعت بارگذاری بالاتر بماند.
#
# ساختار:
#   - کلید ساده (رشته)  → فقط بر اساس نوع ملک (معمولاً فقط فروشی)
#   - کلید دوتایی (tuple) → (نوع ملک, نوع معامله) برای تفکیک فروش / رهن و اجاره
#
# اولویت جستجو:
#   ۱) (نوع ملک, نوع معامله)
#   ۲) فقط نوع ملک
#   ۳) _default
# ---------------------------------------------------------------
DEFAULT_IMAGES = {
    # ----- آپارتمان (فروش + رهن) -----
    ("آپارتمان", "فروش"): "assets/defaults/apartment-sale.svg",
    ("آپارتمان", "رهن و اجاره"): "assets/defaults/apartment-rent.svg",
    "آپارتمان": "assets/defaults/apartment-sale.svg",  # fallback

    # ----- تجاری / مغازه / اداری (فروش + رهن) -----
    ("تجاری", "فروش"): "assets/defaults/commercial-sale.svg",
    ("تجاری", "رهن و اجاره"): "assets/defaults/commercial-rent.svg",
    "تجاری": "assets/defaults/commercial-sale.svg",

    ("مغازه", "فروش"): "assets/defaults/shop-sale.svg",
    ("مغازه", "رهن و اجاره"): "assets/defaults/shop-rent.svg",
    "مغازه": "assets/defaults/shop-sale.svg",

    ("اداری", "فروش"): "assets/defaults/office-sale.svg",
    ("اداری", "رهن و اجاره"): "assets/defaults/office-rent.svg",
    "اداری": "assets/defaults/office-sale.svg",

    # ----- ویلا / ویلایی / خانه ویلایی (فروش + رهن) -----
    ("ویلا", "فروش"): "assets/defaults/villa-sale.svg",
    ("ویلا", "رهن و اجاره"): "assets/defaults/villa-rent.svg",
    "ویلا": "assets/defaults/villa-sale.svg",

    ("ویلایی", "فروش"): "assets/defaults/villa-sale.svg",
    ("ویلایی", "رهن و اجاره"): "assets/defaults/villa-rent.svg",
    "ویلایی": "assets/defaults/villa-sale.svg",

    ("خانه ویلایی", "فروش"): "assets/defaults/villa-sale.svg",
    ("خانه ویلایی", "رهن و اجاره"): "assets/defaults/villa-rent.svg",
    "خانه ویلایی": "assets/defaults/villa-sale.svg",

    # ----- فقط فروش (بدون رهن و اجاره) -----
    "باغ ویلا": "assets/defaults/bagh-villa.svg",
    "باغ": "assets/defaults/bagh.svg",
    "باغچه": "assets/defaults/baghcheh.svg",
    "زمین": "assets/defaults/land.svg",
    "کلنگی": "assets/defaults/kolangi.svg",

    # اگر نوع ملک در بالا نبود یا خالی بود:
    "_default": "assets/defaults/generic.svg",
}


def get_default_image(property_type: str, deal_type: str = "") -> str:
    """عکس پیش‌فرض بر اساس نوع ملک + نوع معامله.
    اول جفت (نوع ملک، معامله) را چک می‌کند، بعد فقط نوع ملک، در نهایت _default.
    """
    pt = (property_type or "").strip()
    dt = (deal_type or "").strip()

    if pt and dt:
        key = (pt, dt)
        if key in DEFAULT_IMAGES:
            return DEFAULT_IMAGES[key]

    if pt and pt in DEFAULT_IMAGES:
        return DEFAULT_IMAGES[pt]

    return DEFAULT_IMAGES.get("_default", "")


# ================================================


def fetch_csv_by_gid(gid: str) -> list[dict]:
    """خواندن یک تب گوگل‌شیت به‌صورت CSV و برگرداندن لیست دیکشنری."""
    if not SPREADSHEET_ID or not gid:
        return []
    url = f"https://docs.google.com/spreadsheets/d/{SPREADSHEET_ID}/gviz/tq?tqx=out:csv&gid={gid}"
    try:
        resp = requests.get(url, timeout=20)
        resp.raise_for_status()
        f = io.StringIO(resp.text)
        reader = csv.DictReader(f)
        rows = [row for row in reader if any((v or "").strip() for v in row.values())]
        return rows
    except Exception as e:
        print(f"خطا در خواندن تب (gid={gid}): {e}")
        return []


def fetch_menu_items() -> dict:
    """تب اختیاری «دکمه‌ها»: کلید | متن | آیکون | عکس -> {key: {text, icon, image}}."""
    if not SPREADSHEET_ID or not MENU_SHEET_GID:
        return {}
    rows = fetch_csv_by_gid(MENU_SHEET_GID)
    items = {}
    for row in rows:
        key = (row.get("کلید") or "").strip()
        if not key:
            continue
        entry = {}
        text = (row.get("متن") or "").strip()
        icon = (row.get("آیکون") or "").strip()
        image = (row.get("عکس") or "").strip()
        if text:
            entry["text"] = text
        if image:
            entry["image"] = image
        elif icon:
            entry["icon"] = icon
        if entry:
            items[key] = entry
    return items


def fetch_bagh_content() -> dict:
    """
    تب «صفحه باغ و ویلا» با ساختار کلید | مقدار.
    برمی‌گرداند دیکشنری {key: value}.
    اگر تب نبود یا خالی بود، دیکشنری خالی → متن پیش‌فرض HTML حفظ می‌شود.
    """
    if not SPREADSHEET_ID or not BAGH_SHEET_GID:
        return {}
    rows = fetch_csv_by_gid(BAGH_SHEET_GID)
    content = {}
    for row in rows:
        # پشتیبانی از نام ستون فارسی یا انگلیسی
        key = (row.get("کلید") or row.get("key") or "").strip().lower()
        value = (row.get("مقدار") or row.get("value") or "").strip()
        if key and value:
            content[key] = value
    return content


def find_frontend_file(filename: str) -> Path | None:
    cwd = Path.cwd()
    for path in cwd.rglob(filename):
        if ".git" not in path.parts and "node_modules" not in path.parts:
            return path
    return None


def fetch_sheet(deal_type: str) -> list[dict]:
    if not SPREADSHEET_ID:
        print("Error: SPREADSHEET_ID تنظیم نشده است")
        return []
    gid = SHEET_GIDS.get(deal_type)
    if not gid:
        return []
    rows = fetch_csv_by_gid(gid)
    active = []
    for row in rows:
        status = (row.get("وضعیت") or "فعال").strip()
        if status in INACTIVE_STATUSES:
            continue
        code = (row.get("کد") or "").strip()
        if not code:
            continue
        active.append(row)
    return active


def short_address(raw: str) -> str:
    """آدرس را کوتاه و یکدست می‌کند: باغستان - خادم‌آباد - ... تا لاله X"""
    text = (raw or "").strip()
    if not text:
        return ""
    # یکدست‌سازی فاصله و خط تیره
    text = re.sub(r"\s*-\s*", " - ", text)
    text = re.sub(r"\s+", " ", text).strip()
    # تا لاله + جهت
    m = re.search(
        r"^(.*?لاله\s*[\d۰-۹]+\s*(?:اصلی|غربی|شرقی)?)",
        text,
    )
    if m:
        text = m.group(1).strip()
    elif len(text) > 55:
        text = text[:55].strip() + "…"
    # پیشوند یکسان باغستان - خادم‌آباد
    low = text.replace("ي", "ی").replace("ك", "ک")
    has_bagh = "باغستان" in low
    has_khad = "خادم" in low  # خادم‌آباد / خادم آباد
    if has_bagh and has_khad:
        # مرتب کردن ترتیب: اول باغستان بعد خادم‌آباد
        rest = low
        rest = re.sub(r"^باغستان\s*-\s*", "", rest)
        rest = re.sub(r"^خادم[\u200c\s]*آباد\s*-\s*", "", rest)
        # اگر rest با خادم شروع شده بود دوباره پاک
        rest = re.sub(r"^خادم[\u200c\s]*آباد\s*-\s*", "", rest)
        rest = rest.strip(" -")
        text = f"باغستان - خادم‌آباد - {rest}" if rest else "باغستان - خادم‌آباد"
    elif has_bagh and not has_khad:
        rest = re.sub(r"^باغستان\s*-\s*", "", low).strip(" -")
        text = f"باغستان - خادم‌آباد - {rest}" if rest else "باغستان - خادم‌آباد"
    elif has_khad and not has_bagh:
        rest = re.sub(r"^خادم[\u200c\s]*آباد\s*-\s*", "", low).strip(" -")
        text = f"باغستان - خادم‌آباد - {rest}" if rest else "باغستان - خادم‌آباد"
    # اگر هیچ‌کدام نبود همان متن کوتاه‌شده
    return text


ALLOWED_SHEET_COLUMNS = {
    "کد", "نوع ملک", "آدرس", "متراژ", "خواب", "طبقه",
    "پارکینگ", "آسانسور", "انباری", "مشاور",
    "تاریخ ثبت فایل", "قیمت کل", "قیمت متری", "رهن", "کرایه",
    "وضعیت", "عکس", "مدارک",
}

BLOCKED_OUTPUT_KEYS = {
    "owner", "owner_name", "owner_phone", "مالک", "نام مالک", "شماره مالک",
    "customer", "مشتری", "نام مشتری", "شماره مشتری",
    "phone", "mobile", "tel", "شماره", "تلفن", "موبایل",
    "agent_phone", "شماره مشاور", "تلفن مشاور",
    "national_id", "کد ملی", "کدملی",
}


def _safe_get(row: dict, col: str) -> str:
    if col not in ALLOWED_SHEET_COLUMNS:
        return ""
    return (row.get(col) or "").strip()


def _strip_phone_like(text: str) -> str:
    if not text:
        return ""
    cleaned = re.sub(r"[\d۰-۹]{8,}", "", text)
    return cleaned.strip(" -–|/\\")


def row_to_property(row: dict, deal_type: str) -> dict:
    agent = _strip_phone_like(_safe_get(row, "مشاور"))
    result = {
        "code": _safe_get(row, "کد"),
        "deal_type": deal_type,
        "property_type": _safe_get(row, "نوع ملک"),
        "address": short_address(_safe_get(row, "آدرس")),
        "area_m2": _safe_get(row, "متراژ"),
        "rooms": _safe_get(row, "خواب"),
        "floor": _safe_get(row, "طبقه"),
        "parking": _safe_get(row, "پارکینگ") == "دارد",
        "elevator": _safe_get(row, "آسانسور") == "دارد",
        "storage": _safe_get(row, "انباری") == "دارد",
        "agent_name": agent,
        "registered_at": _safe_get(row, "تاریخ ثبت فایل"),
    }
    docs = _safe_get(row, "مدارک")
    if docs:
        result["documents"] = docs

    # --- عکس: از شیت بخوان، اگر خالی بود عکس پیش‌فرض بر اساس نوع ملک + معامله بگذار ---
    image_url = _safe_get(row, "عکس")
    is_default_image = False
    if not image_url:
        image_url = get_default_image(result["property_type"], deal_type)
        is_default_image = True
    if image_url:
        result["image"] = image_url
        if is_default_image:
            result["image_is_default"] = True

    if deal_type == "فروش":
        result["price_total"] = _safe_get(row, "قیمت کل") or "توافقی"
        result["price_per_m2"] = _safe_get(row, "قیمت متری")
    else:
        result["rahn"] = _safe_get(row, "رهن")
        result["ejare"] = _safe_get(row, "کرایه")

    for bad in list(result.keys()):
        if bad in BLOCKED_OUTPUT_KEYS or any(b in bad for b in ("phone", "مالک", "مشتری", "شماره")):
            del result[bad]
    return result


def build_bagh_html_block(content: dict) -> str:
    """
    ساخت بلوک HTML صفحه باغ از دیکشنری محتوا.
    اگر کلیدی نبود، از متن پیش‌فرض استفاده می‌شود.
    """
    defaults = {
        "intro": (
            "منطقه باغستان و خادم‌آباد به‌خاطر فضای باز، درختان قدیمی و دسترسی مناسب به تهران، "
            "یکی از بهترین گزینه‌ها برای کسانی است که به‌دنبال باغ، باغچه یا باغ‌ویلا هستند. "
            "چه برای سکونت دائمی، چه برای استراحت آخر هفته و چه برای سرمایه‌گذاری، "
            "این محدوده ترکیبی متنوع از املاک سبز را در خود جای داده است."
        ),
        "para1": (
            "در این منطقه می‌توانید باغ‌های چند هزار متری با سند رسمی، باغچه‌های کوچکتر مناسب "
            "استفاده شخصی، و باغ‌ویلاهای ساخته‌شده یا نیمه‌کاره پیدا کنید. بسیاری از این املاک "
            "در محدوده‌های لاله‌های بالاتر قرار دارند و هنوز فضای آرام و کم‌تراکم خود را حفظ کرده‌اند."
        ),
        "para2": (
            "قیمت و شرایط این نوع املاک به متراژ، نوع سند، دسترسی به آب و برق، و موقعیت دقیق "
            "(نزدیکی به جاده اصلی یا عمق باغستان) بستگی دارد. تیم ما با شناخت کامل از محدوده‌ها "
            "می‌تواند بر اساس بودجه و هدف شما، بهترین گزینه‌های موجود را معرفی کند."
        ),
        "list_title": "چه گزینه‌هایی معمولاً پیدا می‌شود؟",
        "list1": "باغ و باغ‌ویلا با متراژهای مختلف (از حدود ۵۰۰ متر تا چند هزار متر)",
        "list2": "باغچه مناسب استفاده شخصی یا کاشت درخت",
        "list3": "زمین‌های بایر با قابلیت تبدیل به باغ یا باغ‌ویلا",
        "list4": "ویلاهای آماده سکونت در محیط سبز",
    }

    def get(key: str) -> str:
        return content.get(key) or defaults.get(key, "")

    intro = escape(get("intro"))
    para1 = escape(get("para1"))
    para2 = escape(get("para2"))
    list_title = escape(get("list_title"))

    # لیست آیتم‌ها
    list_items = []
    for i in range(1, 8):
        val = content.get(f"list{i}") or defaults.get(f"list{i}")
        if val:
            list_items.append(f"      <li>{escape(val)}</li>")
    list_html = "\n".join(list_items) if list_items else "      <li>—</li>"

    # گالری عکس
    gallery_parts = []
    placeholders = ["🌳", "🏡", "🌿", "🪴"]
    has_any_image = False
    for i in range(1, 5):
        img_url = (content.get(f"image{i}") or "").strip()
        caption = (content.get(f"image{i}_caption") or "").strip()
        if img_url:
            has_any_image = True
            safe_url = escape(img_url, quote=True)
            safe_cap = escape(caption) if caption else f"عکس {i}"
            gallery_parts.append(
                f'      <figure>\n'
                f'        <img src="{safe_url}" alt="{safe_cap}" loading="lazy" width="400" height="200">\n'
                f'        <figcaption>{safe_cap}</figcaption>\n'
                f'      </figure>'
            )
        else:
            # فقط اگر هیچ عکسی نبود، placeholder نشون بده
            pass

    if not has_any_image:
        for i, icon in enumerate(placeholders[:3], 1):
            gallery_parts.append(
                f'      <figure>\n'
                f'        <div class="gallery-placeholder">{icon}</div>\n'
                f'        <figcaption>عکس {i} (به‌زودی)</figcaption>\n'
                f'      </figure>'
            )

    gallery_html = "\n".join(gallery_parts)

    html = f"""    <p id="page-intro">
      {intro}
    </p>

    <p id="page-para1">
      {para1}
    </p>

    <h2 id="page-list-title">{list_title}</h2>
    <ul class="page-list" id="page-list">
{list_html}
    </ul>

    <p id="page-para2">
      {para2}
    </p>

    <div class="page-gallery" id="page-gallery">
{gallery_html}
    </div>
"""
    return html


def update_bagh_page(content: dict) -> bool:
    """به‌روزرسانی bagh-villa.html با محتوای شیت. True اگر موفق."""
    path = find_frontend_file("bagh-villa.html")
    if not path:
        print("⚠️  bagh-villa.html پیدا نشد — رد شد")
        return False

    with open(path, "r", encoding="utf-8") as f:
        html = f.read()

    start = "<!-- SNAPSHOT_BAGH_START -->"
    end = "<!-- SNAPSHOT_BAGH_END -->"
    if start not in html or end not in html:
        print("⚠️  مارکرهای SNAPSHOT_BAGH در bagh-villa.html پیدا نشد")
        return False

    # عنوان و زیرعنوان صفحه (خارج از بلوک اصلی)
    title = content.get("title", "").strip()
    subtitle = content.get("subtitle", "").strip()
    caption = content.get("caption", "").strip()
    hero = content.get("hero_image", "").strip()

    if title:
        html = re.sub(
            r'(<h1 id="page-title">)(.*?)(</h1>)',
            rf'\1{escape(title)}\3',
            html,
            count=1,
        )
    if subtitle:
        html = re.sub(
            r'(<p class="page-eyebrow" id="page-subtitle">)(.*?)(</p>)',
            rf'\1{escape(subtitle)}\3',
            html,
            count=1,
        )
    if caption:
        html = re.sub(
            r'(<p class="carousel-caption active" id="page-caption">)(.*?)(</p>)',
            rf'\1{escape(caption)}\3',
            html,
            count=1,
        )
    if hero:
        html = re.sub(
            r'(<img src=")([^"]*)(" alt="[^"]*" fetchpriority="high"[^>]*id="hero-image")',
            rf'\1{escape(hero, quote=True)}\3',
            html,
            count=1,
        )

    block = build_bagh_html_block(content)
    before = html.split(start)[0]
    after = html.split(end)[1]
    new_html = f"{before}{start}\n{block}    {end}{after}"

    with open(path, "w", encoding="utf-8") as f:
        f.write(new_html)

    print(f"✅ bagh-villa.html به‌روز شد ({len(content)} کلید از شیت)")
    return True


def update_snapshot():
    print("در حال دریافت داده‌ها از گوگل‌شیت...")

    if not SPREADSHEET_ID:
        print("Error: متغیر محیطی SPREADSHEET_ID خالی است")
        exit(1)

    all_props = []
    for deal_type in SHEET_GIDS:
        rows = fetch_sheet(deal_type)
        all_props.extend(row_to_property(r, deal_type) for r in rows)

    def _parse_reg(s):
        m = re.match(
            r"^(\d{4})/(\d{1,2})/(\d{1,2})(?:\s+(\d{1,2}):(\d{1,2}))?",
            str(s or "").strip(),
        )
        if not m:
            return 0
        y, mo, d = int(m.group(1)), int(m.group(2)), int(m.group(3))
        hh, mm = int(m.group(4) or 0), int(m.group(5) or 0)
        return y * 10**10 + mo * 10**8 + d * 10**6 + hh * 10**4 + mm * 100

    def sort_key(item):
        code = str(item.get("code") or "0")
        digits = "".join(c for c in code if c.isdigit())
        code_n = int(digits) if digits else 0
        return (_parse_reg(item.get("registered_at")), code_n)

    all_props.sort(key=sort_key, reverse=True)
    print(f"تعداد فایل‌های فعال: {len(all_props)}")

    n_default_images = sum(1 for p in all_props if p.get("image_is_default"))
    print(f"تعداد فایل‌هایی که عکس پیش‌فرض گرفتند: {n_default_images}")

    menu_items = fetch_menu_items()
    print(f"تعداد دکمه‌های سفارشی‌شده: {len(menu_items)}")

    # --- صفحه باغ و ویلا ---
    bagh_content = fetch_bagh_content()
    if bagh_content:
        print(f"محتوای صفحه باغ: {len(bagh_content)} کلید")
        update_bagh_page(bagh_content)
    else:
        print("تب صفحه باغ خالی یا تنظیم‌نشده — متن پیش‌فرض حفظ شد")

    # --- index.html ---
    index_path = find_frontend_file("index.html")
    if not index_path:
        print("Error: index.html پیدا نشد")
        exit(1)

    print(f"یافت شد: {index_path}")

    with open(index_path, "r", encoding="utf-8") as f:
        content = f.read()

    start_marker = "<!-- SNAPSHOT_DATA_START -->"
    end_marker = "<!-- SNAPSHOT_DATA_END -->"

    if start_marker not in content or end_marker not in content:
        print("Error: مارکرهای SNAPSHOT_DATA پیدا نشد")
        exit(1)

    properties_json = json.dumps(all_props, ensure_ascii=False)
    menu_items_json = json.dumps(menu_items, ensure_ascii=False)

    before = content.split(start_marker)[0]
    after = content.split(end_marker)[1]

    new_content = (
        f"{before}{start_marker}\n"
        f"<script>window.__PRELOADED_PROPERTIES__ = {properties_json};</script>\n"
        f"<script>window.__MENU_ITEMS__ = {menu_items_json};</script>\n"
        f"{end_marker}{after}"
    )

    with open(index_path, "w", encoding="utf-8") as f:
        f.write(new_content)

    print("✅ اسنپ‌شات با موفقیت به‌روز شد")


if __name__ == "__main__":
    update_snapshot()
