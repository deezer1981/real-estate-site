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

# GID تب «محله‌گردی» — کارت‌های معرفی مکان‌های محلی (کافه، مغازه، ...)
# ستون‌ها: کد | عنوان | دسته | آدرس | متن | عکس | تاریخ ثبت | وضعیت | لینک | تلفن
LOCAL_SHEET_GID = os.getenv("LOCAL_SHEET_GID", "1952981132")

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


def _norm_header(h: str) -> str:
    """یکدست‌سازی عنوان ستون شیت (فاصله، BOM، ی/ک عربی)."""
    if h is None:
        return ""
    s = str(h).replace("\ufeff", "").strip()
    s = s.replace("ي", "ی").replace("ك", "ک")
    s = re.sub(r"\s+", " ", s)
    return s


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
        # نرمال‌سازی نام ستون‌ها تا «توضیحات » یا ی عربی باعث از دست رفتن نشود
        fieldnames = [_norm_header(h) for h in (reader.fieldnames or [])]
        rows = []
        for raw in reader:
            if not any((v or "").strip() for v in raw.values()):
                continue
            row = {_norm_header(k): (v or "").strip() if isinstance(v, str) else v
                   for k, v in raw.items()}
            rows.append(row)
        if fieldnames:
            print(f"  ستون‌های تب gid={gid}: {', '.join(fieldnames)}")
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


def fetch_local_guide() -> list[dict]:
    """خواندن تب محله‌گردی و برگرداندن ردیف‌های فعال."""
    if not SPREADSHEET_ID or not LOCAL_SHEET_GID:
        return []
    rows = fetch_csv_by_gid(LOCAL_SHEET_GID)
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


def _normalize_local_image(raw: str) -> str:
    """مسیر عکس محله‌گردی: لینک کامل یا مسیر نسبی داخل assets.
    اگر خالی باشد از پیش‌فرض مخصوص محله‌گردی استفاده می‌شود (نه generic ملکی).
    """
    s = (raw or "").strip()
    if not s:
        return "assets/defaults/local-guide.svg"
    if s.startswith("http://") or s.startswith("https://") or s.startswith("assets/"):
        return s
    # فقط نام فایل → داخل assets
    return f"assets/{s.lstrip('/')}"


def row_to_local(row: dict) -> dict:
    """تبدیل ردیف تب محله‌گردی به دیکشنری سازگار با اسنپ‌شات."""
    code = (row.get("کد") or "").strip()
    title = (row.get("عنوان") or "").strip()
    category = (row.get("دسته") or "").strip()
    address = (row.get("آدرس") or "").strip()
    text = (row.get("متن") or "").strip()
    image = _normalize_local_image(row.get("عکس") or "")
    registered = (row.get("تاریخ ثبت") or "").strip()
    link = (row.get("لینک") or "").strip()
    phone = (row.get("تلفن") or "").strip()

    result = {
        "code": code,
        "deal_type": "محله‌گردی",
        "is_local": True,
        "title": title,
        "property_type": category or "محله‌گردی",  # برای فیلتر/جستجو
        "category": category,
        "address": short_address(address) if address else address,
        "description": text,
        "image": image,
        "registered_at": registered,
    }
    if link:
        result["link"] = link
    if phone:
        # تلفن کسب‌وکار محلی عمومی است (برخلاف شماره مالک آگهی)
        result["phone"] = phone
    return result


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
    "وضعیت", "عکس", "مدارک", "توضیحات", "توضیح", "شرح", "توضیحات فایل",
    "پین",
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


def _parse_pin_order(raw: str) -> int | None:
    """مقدار ستون «پین» را به عدد اولویت تبدیل می‌کند.
    خالی / بی‌معنی → None (پین نشده)
    عدد فارسی یا انگلیسی → همان عدد (عدد کوچکتر = اولویت بالاتر)
    «بله» / «آره» / «yes» / «true» → 1
    """
    s = (raw or "").strip()
    if not s:
        return None
    # ارقام فارسی → انگلیسی
    fa = "۰۱۲۳۴۵۶۷۸۹"
    en = "0123456789"
    trans = str.maketrans(fa, en)
    s_norm = s.translate(trans).strip().lower()
    # بله / آره / yes / true
    if s_norm in ("بله", "آره", "yes", "true", "1", "✓", "✔"):
        return 1
    # فقط عدد
    digits = "".join(c for c in s_norm if c.isdigit())
    if digits:
        try:
            n = int(digits)
            return n if n > 0 else 1
        except ValueError:
            return None
    return None


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

    # --- پین: عدد اولویت از ستون «پین» (خالی = بدون پین) ---
    pin_order = _parse_pin_order(_safe_get(row, "پین") or row.get("پین") or "")
    if pin_order is not None:
        result["pinned"] = True
        result["pin_order"] = pin_order

    # چند نام رایج برای ستون توضیحات در شیت
    notes = (
        _safe_get(row, "توضیحات")
        or _safe_get(row, "توضیح")
        or _safe_get(row, "شرح")
        or _safe_get(row, "توضیحات فایل")
        or (row.get("توضیحات") or row.get("توضیح") or row.get("شرح") or "")
    )
    if isinstance(notes, str):
        notes = notes.strip()
    if notes:
        result["description"] = notes

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


def update_baghestan_local(local_props: list[dict]) -> bool:
    """تزریق کارت‌های محله‌گردی + JSON-LD به baghestan.html برای سئو و نمایش."""
    path = find_frontend_file("baghestan.html")
    if not path:
        print("⚠️  baghestan.html پیدا نشد")
        return False

    with open(path, "r", encoding="utf-8") as f:
        html = f.read()

    data_start = "<!-- SNAPSHOT_LOCAL_DATA_START -->"
    data_end = "<!-- SNAPSHOT_LOCAL_DATA_END -->"
    if data_start not in html or data_end not in html:
        print("⚠️  مارکرهای SNAPSHOT_LOCAL_DATA در baghestan.html پیدا نشد")
        return False

    local_json = json.dumps(local_props, ensure_ascii=False)
    before = html.split(data_start)[0]
    after = html.split(data_end)[1]
    html = (
        f"{before}{data_start}\n"
        f"<script>window.__PRELOADED_LOCAL__ = {local_json};</script>\n"
        f"{data_end}{after}"
    )

    ld_start = "<!-- SNAPSHOT_LOCAL_JSONLD_START -->"
    ld_end = "<!-- SNAPSHOT_LOCAL_JSONLD_END -->"
    if ld_start in html and ld_end in html:
        elements = []
        for i, p in enumerate(local_props[:20], start=1):
            name = (p.get("title") or p.get("category") or "مکان محلی").strip()
            item = {
                "@type": "ListItem",
                "position": i,
                "item": {
                    "@type": "Place",
                    "name": name,
                },
            }
            if p.get("address"):
                item["item"]["address"] = str(p.get("address")).strip()
            if p.get("image") and not str(p.get("image")).endswith(".svg"):
                img = str(p.get("image")).strip()
                if img.startswith("http"):
                    item["item"]["image"] = img
                else:
                    item["item"]["image"] = f"https://atlas-amlak.ir/{img.lstrip('/')}"
            if p.get("phone"):
                item["item"]["telephone"] = str(p.get("phone")).strip()
            if p.get("link"):
                item["item"]["url"] = str(p.get("link")).strip()
            elements.append(item)
        item_list = {
            "@context": "https://schema.org",
            "@type": "ItemList",
            "name": "محله‌گردی باغستان و خادم‌آباد",
            "description": "مکان‌های محلی پیشنهادی در باغستان و خادم‌آباد",
            "numberOfItems": len(elements),
            "itemListElement": elements,
        }
        ld_json = json.dumps(item_list, ensure_ascii=False)
        b = html.split(ld_start)[0]
        a = html.split(ld_end)[1]
        html = (
            f"{b}{ld_start}\n"
            f'<script type="application/ld+json" id="local-guide-jsonld">{ld_json}</script>\n'
            f"{ld_end}{a}"
        )

    with open(path, "w", encoding="utf-8") as f:
        f.write(html)
    print(f"✅ baghestan.html: {len(local_props)} کارت محله‌گردی تزریق شد")
    return True


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


def _to_persian_digits(s: str) -> str:
    en = "0123456789"
    fa = "۰۱۲۳۴۵۶۷۸۹"
    return "".join(fa[en.index(c)] if c in en else c for c in str(s))


def update_index_shell_counts(content: str, all_props: list) -> str:
    """شات اول HTML را با آمار واقعی هم‌خوان می‌کند (بدون تزریق کارت‌های سنگین)."""
    listing = [p for p in all_props if not p.get("is_local")]
    local_n = sum(1 for p in all_props if p.get("is_local"))
    total = len(listing)
    sale = sum(1 for p in listing if p.get("deal_type") == "فروش")
    rent = sum(1 for p in listing if p.get("deal_type") == "رهن و اجاره")
    grid_total = len(all_props)
    page = min(6, grid_total)

    stats = (
        f"🏠 {_to_persian_digits(total)} فایل فعال — "
        f"{_to_persian_digits(sale)} فروشی، {_to_persian_digits(rent)} رهن و اجاره"
    )
    if local_n:
        stats += f" · {_to_persian_digits(local_n)} محله‌گردی"
    count = f"{_to_persian_digits(page)} از {_to_persian_digits(grid_total)} آگهی"

    content = re.sub(
        r'(<span id="statsText">)(.*?)(</span>)',
        lambda m: m.group(1) + stats + m.group(3),
        content,
        count=1,
        flags=re.S,
    )
    content = re.sub(
        r'(<span class="section-note" id="resultCount">)(.*?)(</span>)',
        lambda m: m.group(1) + count + m.group(3),
        content,
        count=1,
        flags=re.S,
    )

    start_c = "<!-- SNAPSHOT_START -->"
    end_c = "<!-- SNAPSHOT_END -->"
    if start_c in content and end_c in content:
        before = content.split(start_c)[0]
        after = content.split(end_c)[1]
        content = (
            before
            + start_c
            + "\n      <!-- گرید با JS از __PRELOADED_PROPERTIES__ پر می‌شود -->\n      "
            + end_c
            + after
        )
    return content


def update_snapshot():
    print("در حال دریافت داده‌ها از گوگل‌شیت...")

    if not SPREADSHEET_ID:
        print("Error: متغیر محیطی SPREADSHEET_ID خالی است")
        exit(1)

    all_props = []
    for deal_type in SHEET_GIDS:
        rows = fetch_sheet(deal_type)
        all_props.extend(row_to_property(r, deal_type) for r in rows)

    # کارت‌های محله‌گردی — با آگهی‌ها قاطی می‌شوند (بر اساس تاریخ ثبت)
    local_rows = fetch_local_guide()
    local_props = [row_to_local(r) for r in local_rows]
    all_props.extend(local_props)
    print(f"تعداد کارت محله‌گردی: {len(local_props)}")

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
        # پین‌شده‌ها اول (عدد کوچکتر = اولویت بالاتر)، بعد تاریخ جدیدتر، بعد کد
        code = str(item.get("code") or "0")
        digits = "".join(c for c in code if c.isdigit())
        code_n = int(digits) if digits else 0
        pinned = 1 if item.get("pinned") else 0
        # pin_order کوچک‌تر باید بالاتر باشد → با منفی برمی‌گردانیم تا reverse=True درست کار کند
        pin_ord = item.get("pin_order") or 9999
        return (pinned, -pin_ord, _parse_reg(item.get("registered_at")), code_n)

    all_props.sort(key=sort_key, reverse=True)
    n_listing = sum(1 for p in all_props if not p.get("is_local"))
    print(f"تعداد فایل‌های فعال (آگهی): {n_listing}")
    print(f"مجموع کارت‌ها (آگهی + محله‌گردی): {len(all_props)}")

    n_pinned = sum(1 for p in all_props if p.get("pinned"))
    n_default_images = sum(1 for p in all_props if p.get("image_is_default"))
    n_with_desc = sum(1 for p in all_props if p.get("description"))
    print(f"تعداد فایل‌های پین‌شده: {n_pinned}")
    print(f"تعداد فایل‌هایی که عکس پیش‌فرض گرفتند: {n_default_images}")
    print(f"  تعداد آگهی با توضیحات: {n_with_desc}")

    menu_items = fetch_menu_items()
    print(f"تعداد دکمه‌های سفارشی‌شده: {len(menu_items)}")

    # --- صفحه باغ و ویلا ---
    bagh_content = fetch_bagh_content()
    if bagh_content:
        print(f"محتوای صفحه باغ: {len(bagh_content)} کلید")
        update_bagh_page(bagh_content)
    else:
        print("تب صفحه باغ خالی یا تنظیم‌نشده — متن پیش‌فرض حفظ شد")

    # --- صفحه معرفی باغستان + محله‌گردی ---
    update_baghestan_local(local_props)

    # --- index.html ---
    index_path = find_frontend_file("index.html")
    if not index_path:
        print("Error: index.html پیدا نشد")
        exit(1)

    print(f"یافت شد: {index_path}")

    with open(index_path, "r", encoding="utf-8") as f:
        content = f.read()

    content = update_index_shell_counts(content, all_props)
    print(f"  شات اول HTML: آمار برای {len(all_props)} آگهی به‌روز شد")

    start_marker = "<!-- SNAPSHOT_DATA_START -->"
    end_marker = "<!-- SNAPSHOT_DATA_END -->"

    if start_marker not in content or end_marker not in content:
        print("Error: مارکرهای SNAPSHOT_DATA پیدا نشد")
        exit(1)

    properties_json = json.dumps(all_props, ensure_ascii=False)
    menu_items_json = json.dumps(menu_items, ensure_ascii=False)

    before = content.split(start_marker)[0]
    after = content.split(end_marker)[1]

    # ItemList سبک برای سئو (حداکثر ۱۲ آگهی اول — فقط آگهی‌های ملکی، نه محله‌گردی)
    item_list_elements = []
    listing_for_seo = [p for p in all_props if not p.get("is_local")][:12]
    for i, p in enumerate(listing_for_seo, start=1):
        code = str(p.get("code") or "").strip()
        if not code:
            continue
        item_list_elements.append({
            "@type": "ListItem",
            "position": i,
            "url": f"https://atlas-amlak.ir/agahi/{code}.html",
            "name": _build_seo_title(p),
        })
    item_list_ld = {
        "@context": "https://schema.org",
        "@type": "ItemList",
        "name": "آگهی‌های فعال اطلس املاک",
        "itemListOrder": "https://schema.org/ItemListOrderAscending",
        "numberOfItems": len(item_list_elements),
        "itemListElement": item_list_elements,
    }
    item_list_json = json.dumps(item_list_ld, ensure_ascii=False)

    new_content = (
        f"{before}{start_marker}\n"
        f"<script>window.__PRELOADED_PROPERTIES__ = {properties_json};</script>\n"
        f"<script>window.__MENU_ITEMS__ = {menu_items_json};</script>\n"
        f'<script type="application/ld+json" id="listings-itemlist-jsonld">{item_list_json}</script>\n'
        f"{end_marker}{after}"
    )

    with open(index_path, "w", encoding="utf-8") as f:
        f.write(new_content)

    print("✅ اسنپ‌شات با موفقیت به‌روز شد")

    # صفحات سبک هر آگهی (سئو + پیش‌نمایش لینک) — فقط آگهی‌های ملکی
    frontend_dir = index_path.parent
    listing_only = [p for p in all_props if not p.get("is_local")]
    n_pages = write_listing_pages(frontend_dir, listing_only)
    print(f"✅ صفحات آگهی: {n_pages} فایل در agahi/")
    write_sitemap(frontend_dir, listing_only)
    print("✅ sitemap.xml به‌روز شد")


def _clean_price_text(text: str) -> str:
    if not text:
        return ""
    def repl(m):
        a, b = m.group(1), m.group(2)
        trimmed = b.rstrip("0")
        return f"{a}.{trimmed}" if trimmed else a
    return re.sub(r"(\d+)\.(\d+)", repl, str(text))


def _format_sale_total(text: str) -> str:
    """مثل formatSaleTotal در script.js — اگر عدد >= 100 و واحد میلیارد باشد ÷1000."""
    if not text:
        return ""
    s = _clean_price_text(text).strip()
    if not s or s == "-" or "توافقی" in s:
        return s or "توافقی"
    m = re.match(r"^([\d,]+(?:\.\d+)?)\s*(.*)$", s)
    if not m:
        return s
    try:
        num = float(m.group(1).replace(",", ""))
    except ValueError:
        return s
    unit = (m.group(2) or "").strip()
    if "میلیارد" in unit and num >= 100:
        num = num / 1000.0
        unit = "میلیارد"
    if not unit:
        unit = "میلیارد"
    num_str = f"{num:.3f}".rstrip("0").rstrip(".")
    return f"{num_str} {unit}".strip()


def _format_price_per_m2(text: str) -> str:
    if not text:
        return ""
    s = _clean_price_text(text).strip()
    if not s or s == "-":
        return ""
    if not re.search(r"میلیون|میلیارد|هزار|تومان|ریال", s):
        n = re.sub(r"[^\d.]", "", s)
        if n:
            return f"{n} میلیون"
    return s


def _listing_label(p: dict) -> str:
    t = (p.get("property_type") or "ملک").strip()
    if p.get("deal_type") == "فروش":
        return f"{t} فروشی"
    return f"رهن و اجاره {t}"


def _listing_price_line(p: dict) -> str:
    if p.get("deal_type") == "فروش":
        return _format_sale_total(p.get("price_total") or "") or "توافقی"
    bits = []
    if p.get("rahn") and p.get("rahn") != "-":
        bits.append(f"رهن {_clean_price_text(p.get('rahn'))}")
    if p.get("ejare") and p.get("ejare") != "-":
        bits.append(f"اجاره {_clean_price_text(p.get('ejare'))}")
    return " | ".join(bits) if bits else "توافقی"


def _abs_image_url(image: str) -> str:
    if not image:
        return "https://atlas-amlak.ir/assets/office.jpg"
    if re.match(r"^https?:\/\/", image, re.I):
        return image
    return "https://atlas-amlak.ir/" + image.lstrip("/")


def _og_image_url(p: dict) -> str:
    """واتساپ SVG را نشان نمی‌دهد — برای پیش‌نمایش فقط JPG/PNG."""
    raw = (p.get("image") or "").strip()
    if (not raw) or p.get("image_is_default") or raw.lower().endswith(".svg"):
        return "https://atlas-amlak.ir/assets/office.jpg"
    return _abs_image_url(raw)



def _parse_rooms_num(p: dict) -> int | None:
    raw = str(p.get("rooms") or "").strip()
    if not raw:
        return None
    fa = "۰۱۲۳۴۵۶۷۸۹"
    en = "0123456789"
    raw = raw.translate(str.maketrans(fa, en))
    digits = re.sub(r"[^\d]", "", raw)
    if not digits:
        return None
    try:
        n = int(digits)
        return n if n > 0 else None
    except ValueError:
        return None


def _parse_area_num(p: dict) -> float | None:
    raw = str(p.get("area_m2") or "").strip()
    if not raw:
        return None
    fa = "۰۱۲۳۴۵۶۷۸۹"
    en = "0123456789"
    raw = raw.translate(str.maketrans(fa, en))
    m = re.search(r"[\d.]+", raw.replace(",", ""))
    if not m:
        return None
    try:
        n = float(m.group(0))
        return n if n > 0 else None
    except ValueError:
        return None


def _schema_property_type(p: dict) -> str:
    """نوع schema.org مناسب برای ملک (Apartment / House / Land و ...)."""
    t = (p.get("property_type") or "").strip()
    mapping = {
        "آپارتمان": "Apartment",
        "ویلا": "House",
        "ویلایی": "House",
        "خانه ویلایی": "House",
        "باغ ویلا": "House",
        "باغ": "House",
        "باغچه": "House",
        "زمین": "LandForm",
        "کلنگی": "House",
        "تجاری": "Store",
        "مغازه": "Store",
        "اداری": "OfficeBuilding",
    }
    return mapping.get(t, "Residence")


def _parse_price_numeric(p: dict) -> float | None:
    """استخراج قیمت عددی به ریال برای فیلد price در Offer (تا حد امکان)."""
    if p.get("deal_type") != "فروش":
        return None
    raw = _format_sale_total(p.get("price_total") or "")
    if not raw or "توافقی" in raw:
        return None
    fa = "۰۱۲۳۴۵۶۷۸۹"
    en = "0123456789"
    s = raw.translate(str.maketrans(fa, en))
    m = re.search(r"([\d.]+)", s.replace(",", ""))
    if not m:
        return None
    try:
        num = float(m.group(1))
    except ValueError:
        return None
    if "میلیارد" in s:
        return int(num * 1_000_000_000)
    if "میلیون" in s:
        return int(num * 1_000_000)
    return None


def _build_seo_title(p: dict) -> str:
    """عنوان سئو محلی و جذاب برای صفحه آگهی و اسکیما."""
    label = _listing_label(p)
    code = str(p.get("code") or "").strip()
    area_n = _parse_area_num(p)
    rooms_n = _parse_rooms_num(p)
    parts = [label]
    if area_n:
        if area_n >= 100:
            parts.append(f"{int(area_n) if area_n == int(area_n) else area_n} متری")
        else:
            parts.append(f"{int(area_n) if area_n == int(area_n) else area_n} متر")
    if rooms_n:
        parts.append(f"{rooms_n} خواب")
    parts.append("در خادم‌آباد باغستان")
    title = " ".join(parts) + f" | کد {code}"
    # حداکثر حدود ۷۰ کاراکتر برای عنوان نتایج گوگل
    if len(title) > 72:
        title = f"{label} در خادم‌آباد باغستان | کد {code}"
    return title


def _build_listing_jsonld(p: dict) -> dict:
    """اسکیمای غنی RealEstateListing + about + Offer عددی + BreadcrumbList."""
    code = str(p.get("code") or "").strip()
    label = _listing_label(p)
    page_url = f"https://atlas-amlak.ir/agahi/{code}.html"
    addr = (p.get("address") or "").strip()
    seo_title = _build_seo_title(p)
    price_line = _listing_price_line(p)
    area_n = _parse_area_num(p)
    rooms_n = _parse_rooms_num(p)

    # توضیح غنی‌تر برای اسکیما و متا
    desc_parts = [seo_title]
    if addr:
        desc_parts.append(addr)
    if price_line:
        desc_parts.append(f"قیمت: {price_line}")
    note = (p.get("description") or "").strip()
    if note:
        # فقط اول جمله توضیح را بگیر تا خیلی طولانی نشود
        short_note = re.split(r"[\n|]", note)[0].strip()
        if short_note and len(short_note) > 15:
            desc_parts.append(short_note[:120])
    description = " — ".join(desc_parts)

    listing = {
        "@type": "RealEstateListing",
        "@id": f"{page_url}#listing",
        "name": seo_title,
        "description": description,
        "url": page_url,
        "image": _og_image_url(p),
        "address": {
            "@type": "PostalAddress",
            "streetAddress": addr or "خادم‌آباد",
            "addressLocality": "خادم‌آباد",
            "addressRegion": "تهران",
            "addressCountry": "IR",
        },
        "seller": {
            "@type": "RealEstateAgent",
            "name": "گروه مشاورین املاک اطلس",
            "url": "https://atlas-amlak.ir/",
            "telephone": "+989106943220",
        },
    }

    if p.get("registered_at"):
        listing["datePosted"] = str(p.get("registered_at")).strip()

    # about: نوع ملک مشخص (Apartment / House / Land و ...)
    about_type = _schema_property_type(p)
    about = {
        "@type": about_type,
        "name": f"{label} کد {code}",
        "address": {
            "@type": "PostalAddress",
            "streetAddress": addr or "خادم‌آباد",
            "addressLocality": "خادم‌آباد",
            "addressRegion": "تهران",
            "addressCountry": "IR",
        },
    }
    if area_n is not None:
        about["floorSize"] = {
            "@type": "QuantitativeValue",
            "value": area_n,
            "unitCode": "MTK",
        }
        listing["floorSize"] = about["floorSize"]
    if rooms_n is not None:
        about["numberOfRooms"] = rooms_n
        about["numberOfBedrooms"] = rooms_n
        listing["numberOfRooms"] = rooms_n
    listing["about"] = about

    extras = []
    if p.get("parking"):
        extras.append({"@type": "PropertyValue", "name": "پارکینگ", "value": "دارد"})
    if p.get("elevator"):
        extras.append({"@type": "PropertyValue", "name": "آسانسور", "value": "دارد"})
    if p.get("storage"):
        extras.append({"@type": "PropertyValue", "name": "انباری", "value": "دارد"})
    if p.get("floor"):
        extras.append({"@type": "PropertyValue", "name": "طبقه", "value": str(p.get("floor")).strip()})
    if p.get("property_type"):
        extras.append({"@type": "PropertyValue", "name": "نوع ملک", "value": str(p.get("property_type")).strip()})
    if p.get("deal_type"):
        extras.append({"@type": "PropertyValue", "name": "نوع معامله", "value": str(p.get("deal_type")).strip()})
    if extras:
        listing["additionalProperty"] = extras

    # Offer با قیمت عددی (مهم برای Rich Results)
    if price_line:
        offer = {
            "@type": "Offer",
            "priceCurrency": "IRR",
            "description": price_line,
            "availability": "https://schema.org/InStock",
            "url": page_url,
        }
        numeric_price = _parse_price_numeric(p)
        if numeric_price is not None and numeric_price > 0:
            offer["price"] = numeric_price
        listing["offers"] = offer

    breadcrumb = {
        "@type": "BreadcrumbList",
        "itemListElement": [
            {
                "@type": "ListItem",
                "position": 1,
                "name": "صفحه اصلی",
                "item": "https://atlas-amlak.ir/",
            },
            {
                "@type": "ListItem",
                "position": 2,
                "name": seo_title,
                "item": page_url,
            },
        ],
    }

    return {
        "@context": "https://schema.org",
        "@graph": [listing, breadcrumb],
    }


def render_listing_html(p: dict) -> str:
    """صفحه HTML سبک و ایستا برای یک آگهی — بدون JS سنگین."""
    code = escape(str(p.get("code") or ""))
    label = escape(_listing_label(p))
    addr = escape((p.get("address") or "").strip())
    area = escape(str(p.get("area_m2") or "").strip())
    rooms = escape(str(p.get("rooms") or "").strip())
    floor = escape(str(p.get("floor") or "").strip())
    price = escape(_listing_price_line(p))
    m2 = escape(_format_price_per_m2(p.get("price_per_m2") or ""))
    docs = escape(str(p.get("documents") or "").strip())
    desc_note = escape(str(p.get("description") or "").strip())
    agent = escape(str(p.get("agent_name") or "").strip())
    reg = escape(str(p.get("registered_at") or "").strip())
    deal = escape(str(p.get("deal_type") or ""))
    page_url = f"https://atlas-amlak.ir/agahi/{code}.html"
    img = _og_image_url(p)
    img_rel = escape((p.get("image") or "assets/defaults/generic.svg").lstrip("/"))
    # مسیر نسبی از پوشه agahi/ (نمایش داخل صفحه)
    if not re.match(r"^https?:\/\/", img_rel, re.I):
        img_src = escape("../" + img_rel)
    else:
        img_src = escape(img_rel)

    specs = []
    if area:
        specs.append(f"{area} متر")
    if rooms:
        specs.append(f"{rooms} خواب")
    if floor:
        specs.append(f"طبقه {floor}")
    specs_txt = " · ".join(specs)

    extras = []
    if p.get("parking"):
        extras.append("پارکینگ")
    if p.get("elevator"):
        extras.append("آسانسور")
    if p.get("storage"):
        extras.append("انباری")
    extras_txt = " | ".join(extras)

    # پیش‌نمایش لینک + عنوان سئو محلی
    price_plain = _listing_price_line(p)
    short_addr = (p.get("address") or "").strip()
    # کوتاه‌کردن آدرس برای پیش‌نمایش
    short_addr = re.sub(r"^باغستان\s*-\s*خادم[\u200c\s]*آباد\s*-\s*", "", short_addr)
    if len(short_addr) > 36:
        short_addr = short_addr[:36].rstrip() + "…"
    # عنوان سئو: شامل متراژ + خواب + خادم‌آباد باغستان (بهبود CTR محلی)
    title = _build_seo_title(p)
    # خطوط توضیح — اول قیمت و متراژ (مهم‌ترین)
    lines = []
    if price_plain:
        lines.append(f"قیمت: {price_plain}")
    if specs_txt:
        lines.append(specs_txt)
    if short_addr:
        lines.append(short_addr)
    lines.append("خادم‌آباد، باغستان، شهریار | مشاور املاک اطلس")
    desc_raw = "\n".join(lines)
    desc = (
        desc_raw.replace("&", "&amp;")
        .replace('"', "&quot;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
    )

    extras_html = f'<p class="card-meta card-extras">{escape(extras_txt)}</p>' if extras_txt else ""
    docs_html = f'<p class="card-meta card-docs">📄 مدارک: {docs}</p>' if docs else ""
    m2_html = f'<p class="card-meta card-price-m2">قیمت متری: {m2}</p>' if m2 and p.get("deal_type") == "فروش" else ""
    agent_html = f'<p class="card-agent">👤 ثبت‌شده توسط: <strong>{agent}</strong></p>' if agent else ""
    date_html = f'<p class="card-date">📅 ثبت: {reg}</p>' if reg else ""
    notes_html = f'<p class="card-meta card-notes">📝 {desc_note}</p>' if desc_note else ""
    specs_html = f'<p class="card-meta">{escape(specs_txt)}</p>' if specs_txt else ""
    addr_html = f'<p class="card-meta card-address">📍 {addr}</p>' if addr else ""

    bale_msg = escape(
        f"سلام، در مورد آگهی کد {code} از سایت اطلس املاک پیام می‌دم."
    )

    return f"""<!DOCTYPE html>
<html lang="fa" dir="rtl">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>{escape(title)}</title>
<meta name="description" content="{desc}">
<meta name="robots" content="index, follow">
<link rel="canonical" href="{page_url}">
<meta property="og:type" content="website">
<meta property="og:site_name" content="اطلس املاک">
<meta property="og:title" content="{escape(title)}">
<meta property="og:description" content="{desc}">
<meta property="og:url" content="{page_url}">
<meta property="og:image" content="{escape(img)}">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="675">
<meta property="og:locale" content="fa_IR">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="{escape(title)}">
<meta name="twitter:description" content="{desc}">
<meta name="twitter:image" content="{escape(img)}">
<link rel="icon" type="image/png" href="../assets/logo.png">
<link rel="stylesheet" href="../style.css">
<style>
  body {{
    background: linear-gradient(180deg, #F7F3EA 0%, #EFE6D3 100%);
    margin: 0; padding-bottom: 28px;
  }}
  .agahi-page {{ max-width: 560px; margin: 0 auto; padding: 18px 14px 36px; }}

  /* ناوبری بالای صفحه: دکمه بازگشت + برچسب برند */
  .agahi-nav {{
    display: flex; align-items: center; justify-content: space-between;
    gap: 10px; margin-bottom: 16px;
  }}
  .agahi-back {{
    display: inline-flex; align-items: center; gap: 6px;
    padding: 9px 16px; margin: 0;
    background: #fff; border: 1px solid #E8DFD0; border-radius: 999px;
    color: #201C15; font-weight: 700; font-size: 0.86rem; text-decoration: none;
    box-shadow: 0 2px 8px rgba(32,28,21,0.05);
    transition: background 0.15s ease, box-shadow 0.15s ease, transform 0.1s ease;
  }}
  .agahi-back:hover {{ background: #FBF6EC; box-shadow: 0 4px 14px rgba(32,28,21,0.09); }}
  .agahi-back:active {{ transform: scale(0.97); }}
  .agahi-back-icon {{ font-size: 0.78rem; }}
  .agahi-brand-chip {{
    display: inline-flex; align-items: center; gap: 6px;
    font-size: 0.78rem; font-weight: 700; color: #B8894F;
    background: rgba(184,137,79,0.12); padding: 8px 13px; border-radius: 999px;
    white-space: nowrap; flex-shrink: 0;
  }}

  .agahi-card-wrap {{ margin: 4px 0 22px; }}

  /* دکمه بازگشت پایین کارت */
  .agahi-bottom-back {{ display: flex; justify-content: center; margin: 0 0 24px; }}
  .agahi-bottom-back a {{
    display: inline-flex; align-items: center; gap: 6px;
    background: transparent; border: 1.5px solid #B8894F; color: #201C15;
    font-weight: 700; font-size: 0.86rem; padding: 10px 22px; border-radius: 999px;
    text-decoration: none; transition: background 0.15s ease, color 0.15s ease;
  }}
  .agahi-bottom-back a:hover {{ background: #B8894F; color: #fff; }}

  /* فوتر برند — نوار رنگی بالا + لوگوی دایره‌ای + لینک‌های پیلی */
  .agahi-footer {{
    margin-top: 0; padding: 0; text-align: center;
    background: linear-gradient(180deg, #FFFCFA 0%, #F3EDE3 100%);
    border: 1px solid #E0D5C4; border-radius: 20px;
    color: #57503F; font-size: 0.9rem; line-height: 1.75;
    box-shadow: 0 8px 26px rgba(32,28,21,0.08); overflow: hidden;
  }}
  .agahi-footer::before {{
    content: ""; display: block; height: 4px;
    background: linear-gradient(90deg, #B8894F 0%, #4A6B5F 100%);
  }}
  .agahi-footer-inner {{ padding: 24px 20px 22px; }}
  .agahi-footer-logo {{
    width: 50px; height: 50px; border-radius: 50%;
    background: #fff; border: 1px solid #E8DFD0;
    display: flex; align-items: center; justify-content: center;
    margin: 0 auto 12px; font-size: 1.4rem;
    box-shadow: 0 4px 12px rgba(32,28,21,0.06);
  }}
  .agahi-footer strong {{ color: #201C15; display: block; margin-bottom: 6px; font-size: 1.1rem; }}
  .agahi-footer .footer-tagline {{ margin: 0 0 14px; color: #6B6358; }}
  .agahi-footer .phone-row {{
    display: inline-flex; align-items: center; gap: 8px;
    background: rgba(74,107,95,0.10); padding: 8px 16px; border-radius: 999px; margin: 0 0 6px;
  }}
  .agahi-footer a {{ color: #201C15; font-weight: 700; text-decoration: none; }}
  .agahi-footer .phone {{ direction: ltr; unicode-bidi: embed; font-weight: 800; font-size: 1.03rem; }}
  .agahi-footer .hours {{ margin: 0 0 16px; color: #8A8070; font-size: 0.82rem; }}
  .agahi-footer-links {{
    display: flex; flex-wrap: wrap; justify-content: center; gap: 8px;
    margin-top: 6px; padding-top: 16px; border-top: 1px dashed #E0D5C4;
  }}
  .agahi-footer-links a {{
    font-size: 0.84rem; color: #6B6358; font-weight: 600;
    padding: 6px 13px; border-radius: 999px; background: #fff; border: 1px solid #EDE4D3;
    transition: background 0.15s ease, color 0.15s ease, border-color 0.15s ease;
  }}
  .agahi-footer-links a:hover {{ background: #FBF6EC; color: #B8894F; border-color: #D9CDB4; }}
  .agahi-footer-site {{ margin: 16px 0 0; font-size: 0.84rem; }}
  .agahi-footer-site a {{ color: #B8894F; }}

  /* دکمه‌های تماس/پیام داخل کارت کمی نرم‌تر روی این صفحه */
  .agahi-page .card-actions {{ gap: 10px; }}
  .agahi-page .agent-call-btn,
  .agahi-page .agent-msg-btn {{ box-shadow: 0 3px 10px rgba(20,33,61,0.10); }}
</style>
<script type="application/ld+json">
{json.dumps(_build_listing_jsonld(p), ensure_ascii=False)}
</script>
</head>
<body>
<main class="agahi-page">
  <div class="agahi-nav">
    <a class="agahi-back" href="../"><span class="agahi-back-icon">←</span> همه آگهی‌ها</a>
    <span class="agahi-brand-chip">🏠 اطلس املاک</span>
  </div>

  <div class="agahi-card-wrap">
    <article class="card {'card-sale' if p.get('deal_type') == 'فروش' else 'card-rent'}">
      <div class="card-image-wrap">
        <img class="card-image" src="{img_src}" alt="{label} کد {code}" width="400" height="280" loading="eager">
        <div class="card-image-overlay">
          <span class="deal-tag {'sale' if p.get('deal_type') == 'فروش' else 'rent'}">{deal}</span>
        </div>
      </div>
      <div class="card-body">
        <h1 class="card-title">{label} <span class="card-code">کد {code}</span></h1>
        {addr_html}
        {specs_html}
        {extras_html}
        {docs_html}
        <p class="card-price">💰 {price}</p>
        {m2_html}
        {agent_html}
        <div class="card-actions">
          <a class="agent-call-btn agent-btn-primary" href="tel:09106943220">📞 مشاوره / بازدید</a>
          <a class="agent-msg-btn agent-btn-secondary" href="https://ble.ir/Nobody_Mohsen?text={bale_msg}" target="_blank" rel="noopener">💬 پیام</a>
        </div>
        {date_html}
        {notes_html}
      </div>
    </article>
  </div>

  <div class="agahi-bottom-back">
    <a href="../"><span class="agahi-back-icon">←</span> بازگشت به صفحه اصلی سایت</a>
  </div>

  <footer class="agahi-footer">
    <div class="agahi-footer-inner">
      <div class="agahi-footer-logo">🏠</div>
      <strong>گروه مشاورین املاک اطلس</strong>
      <p class="footer-tagline">خرید، فروش، رهن و اجاره در خادم‌آباد، باغستان و شهریار</p>
      <div class="phone-row">📞 <a class="phone" href="tel:+989106943220" dir="ltr">0910 694 3220</a></div>
      <p class="hours">ساعات پاسخگویی: همه‌روزه ۱۰ صبح تا ۹ شب</p>
      <div class="agahi-footer-links">
        <a href="../">صفحه اصلی</a>
        <a href="../about.html">درباره دفتر</a>
        <a href="../baghestan.html">معرفی باغستان</a>
        <a href="../bagh-villa.html">باغ و ویلا</a>
      </div>
      <p class="agahi-footer-site"><a href="../">atlas-amlak.ir</a></p>
    </div>
  </footer>
</main>
</body>
</html>
"""



def write_listing_pages(frontend_dir: Path, props: list[dict]) -> int:
    """ساخت/به‌روزرسانی agahi/{code}.html و حذف کدهای غیرفعال."""
    agahi = frontend_dir / "agahi"
    agahi.mkdir(exist_ok=True)
    active_codes = set()
    for p in props:
        code = str(p.get("code") or "").strip()
        if not code:
            continue
        # فقط ارقام و حروف ساده در نام فایل
        safe = re.sub(r"[^\w\-]", "", code)
        if not safe:
            continue
        active_codes.add(safe)
        (agahi / f"{safe}.html").write_text(render_listing_html(p), encoding="utf-8")
    # پاک کردن صفحات قدیمی که دیگر در شیت نیستند
    for old in agahi.glob("*.html"):
        if old.stem not in active_codes:
            old.unlink()
    return len(active_codes)


def write_sitemap(frontend_dir: Path, props: list[dict]) -> None:
    urls = [
        ("https://atlas-amlak.ir/", "hourly", "1.0"),
        ("https://atlas-amlak.ir/about.html", "monthly", "0.6"),
        ("https://atlas-amlak.ir/baghestan.html", "weekly", "0.8"),
        ("https://atlas-amlak.ir/bagh-villa.html", "weekly", "0.7"),
        ("https://atlas-amlak.ir/investment.html", "monthly", "0.5"),
        ("https://atlas-amlak.ir/reviews.html", "monthly", "0.5"),
    ]
    for p in props:
        code = re.sub(r"[^\w\-]", "", str(p.get("code") or "").strip())
        if code:
            urls.append((f"https://atlas-amlak.ir/agahi/{code}.html", "daily", "0.8"))
    lines = [
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    ]
    for loc, freq, pri in urls:
        lines.append("  <url>")
        lines.append(f"    <loc>{loc}</loc>")
        lines.append(f"    <changefreq>{freq}</changefreq>")
        lines.append(f"    <priority>{pri}</priority>")
        lines.append("  </url>")
    lines.append("</urlset>")
    lines.append("")
    (frontend_dir / "sitemap.xml").write_text("\n".join(lines), encoding="utf-8")


if __name__ == "__main__":
    update_snapshot()
