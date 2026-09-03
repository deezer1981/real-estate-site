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
# ستون‌ها: کد | عنوان | دسته | آدرس | متن | عکس | تاریخ ثبت | وضعیت | لینک | تلفن | ساعت | اسلاگ
LOCAL_SHEET_GID = os.getenv("LOCAL_SHEET_GID") or "1952981132"

# GID تب «نظرات» مشتریان
REVIEWS_SHEET_GID = os.getenv("REVIEWS_SHEET_GID") or "443074725"

# صفحات متنی (کلید | مقدار)
ABOUT_SHEET_GID = os.getenv("ABOUT_SHEET_GID") or "1046935789"
BAGHESTAN_TEXT_SHEET_GID = os.getenv("BAGHESTAN_TEXT_SHEET_GID") or "559435682"
INVESTMENT_SHEET_GID = os.getenv("INVESTMENT_SHEET_GID") or "554697258"

# GID تب «دکمه‌ها» (متن دکمه‌های میان‌بر بالای صفحه اصلی) — اختیاری.
MENU_SHEET_GID = os.getenv("MENU_SHEET_GID") or ""

# GID تب «صفحه باغ و ویلا» — اختیاری.
# ساختار تب: دو ستون  کلید | مقدار
# کلیدهای پشتیبانی‌شده:
#   title, subtitle, caption, intro, para1, para2, list_title,
#   list1, list2, list3, list4, list5,
#   image1, image1_caption, image2, image2_caption, image3, image3_caption, image4, image4_caption,
#   hero_image
BAGH_SHEET_GID = os.getenv("BAGH_SHEET_GID") or "1304456576"

DELETE_STATUSES = {
    "حذف شده",
    "حذف",
}

# وضعیت‌هایی که هنوز روی سایت در لیست فعال دیده می‌شوند
PUBLIC_ACTIVE_STATUSES = {
    "فعال",
    "در بازدید",
}

ARCHIVE_STATUS_MAP = {
    "فروخته شد": "فروخته شد",
    "فروخته شده": "فروخته شد",
    "فروخته": "فروخته شد",
    "فروخته/اجاره رفت": "فروخته شد",  # مقدار قدیمی ترکیبی
    "واگذار شده": "فروخته شد",
    "واگذار شد": "فروخته شد",
    "رهن داده شد": "رهن داده شد",
    "رهن داده شده": "رهن داده شد",
    "اجاره داده شده": "رهن داده شد",
    "رهن‌داده‌شده": "رهن داده شد",
    "منقضی شده": "منقضی شده",
    "منقضی": "منقضی شده",
    "منصرف شده": "منصرف شده",
    "منصرف": "منصرف شده",
    "کنسل شده": "منصرف شده",
    "لغو شده": "منصرف شده",
    "غیرفعال": "غیرفعال",
    "غیر فعال": "غیرفعال",
    "غیرفعال شده": "غیرفعال",
    "توقف موقت": "توقف موقت",
    "قولنامه": "قولنامه",
}

INACTIVE_STATUSES = DELETE_STATUSES | set(ARCHIVE_STATUS_MAP.keys())


def normalize_listing_status(raw: str) -> tuple:
    """برمی‌گرداند (برچسب_نمایش, is_active).

    is_active=True → در لیست صفحه اصلی / جستجو نشان داده می‌شود.
    is_active=False → از لیست اصلی خارج است، ولی صفحهٔ اختصاصی آگهی
    (agahi/...) برای جلوگیری از ۴۰۴ گوگل باقی می‌ماند.
    """
    s = (raw or "").strip().replace("ي", "ی").replace("ك", "ک")
    if not s or s in PUBLIC_ACTIVE_STATUSES:
        # «در بازدید» مثل فعال روی سایت می‌ماند
        return (s or "فعال"), True
    if s in DELETE_STATUSES:
        return "حذف شده", False
    if s in ARCHIVE_STATUS_MAP:
        return ARCHIVE_STATUS_MAP[s], False
    # هر وضعیت ناشناختهٔ دیگر → آرشیو (صفحه می‌ماند، لیست اصلی نه)
    return s, False

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
    """همهٔ ردیف‌های دارای کد را برمی‌گرداند (حتی منقضی / واگذار / حذف‌شده).

    سیاست سایت: هیچ صفحهٔ agahi/... به‌خاطر عوض شدن وضعیت پاک نمی‌شود
    تا لینک ایندکس‌شده در گوگل ۴۰۴ نگیرد. فقط از لیست صفحهٔ اصلی
    (is_active=False) کنار گذاشته می‌شوند.
    """
    if not SPREADSHEET_ID:
        print("Error: SPREADSHEET_ID تنظیم نشده است")
        return []
    gid = SHEET_GIDS.get(deal_type)
    if not gid:
        return []
    rows = fetch_csv_by_gid(gid)
    out = []
    for row in rows:
        status_raw = (row.get("وضعیت") or "فعال").strip()
        label, is_active = normalize_listing_status(status_raw)
        code = (row.get("کد") or "").strip()
        if not code:
            continue
        row = dict(row)
        row["وضعیت"] = label
        row["_is_active"] = is_active
        out.append(row)
    return out


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


def _slugify_local(raw: str, fallback: str = "") -> str:
    """اسلاگ انگلیسی/لاتین برای URL محله‌گردی. فقط a-z 0-9 و خط تیره."""
    s = (raw or "").strip().lower()
    s = s.replace(" ", "-").replace("_", "-")
    s = re.sub(r"[^a-z0-9\-]", "", s)
    s = re.sub(r"-+", "-", s).strip("-")
    if s:
        return s
    fb = re.sub(r"[^\w\-]", "", (fallback or "").strip())
    return fb or "local"


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
    hours = (row.get("ساعت") or row.get("ساعات") or row.get("ساعت کاری") or "").strip()
    # اسلاگ دستی از شیت؛ اگر خالی → از کد
    slug_raw = (row.get("اسلاگ") or row.get("slug") or "").strip()
    slug = _slugify_local(slug_raw, fallback=code)

    result = {
        "code": code,
        "slug": slug,
        "deal_type": "محله‌گردی",
        "is_local": True,
        "title": title,
        "property_type": category or "محله‌گردی",
        "category": category,
        "address": short_address(address) if address else address,
        "description": text,
        "image": image,
        "registered_at": registered,
    }
    if hours:
        result["hours"] = hours
    if link:
        result["link"] = link
    if phone:
        result["phone"] = phone
    return result



def fetch_reviews() -> list[dict]:
    """خواندن تب نظرات و برگرداندن ردیف‌های فعال."""
    if not SPREADSHEET_ID or not REVIEWS_SHEET_GID:
        return []
    rows = fetch_csv_by_gid(REVIEWS_SHEET_GID)
    active = []
    for row in rows:
        status = (row.get("وضعیت") or "فعال").strip()
        if status in INACTIVE_STATUSES:
            continue
        text = (row.get("نظر") or row.get("متن") or "").strip()
        if not text:
            continue
        name = (row.get("نام") or row.get("نام مشتری") or "مشتری").strip()
        deal = (row.get("نوع معامله") or row.get("نوع") or "").strip()
        year = (row.get("سال") or row.get("تاریخ") or "").strip()
        active.append({
            "name": name,
            "text": text,
            "deal": deal,
            "year": year,
        })
    return active


def update_reviews_page(reviews: list[dict]) -> bool:
    """تزریق نظرات از شیت به reviews.html"""
    path = find_frontend_file("reviews.html")
    if not path:
        print("⚠️  reviews.html پیدا نشد")
        return False

    with open(path, "r", encoding="utf-8") as f:
        html = f.read()

    start = "<!-- SNAPSHOT_REVIEWS_START -->"
    end = "<!-- SNAPSHOT_REVIEWS_END -->"
    if start not in html or end not in html:
        print("⚠️  مارکرهای SNAPSHOT_REVIEWS در reviews.html پیدا نشد")
        return False

    if not reviews:
        cards = (
            '      <article class="review-card">\n'
            '        <p class="review-text">«هنوز نظری ثبت نشده است.»</p>\n'
            '        <p class="review-meta"><strong>—</strong></p>\n'
            '      </article>'
        )
    else:
        parts = []
        for r in reviews:
            name = escape(r.get("name") or "مشتری")
            text = escape(r.get("text") or "")
            if not (text.startswith("«") or text.startswith('"') or text.startswith("'")):
                text = f"«{text}»"
            deal = escape(r.get("deal") or "")
            year = escape(r.get("year") or "")
            meta_bits = [f"<strong>{name}</strong>"]
            if deal:
                meta_bits.append(deal)
            if year:
                meta_bits.append(year)
            meta = " · ".join(meta_bits)
            parts.append(
                f'      <article class="review-card">\n'
                f'        <p class="review-text">{text}</p>\n'
                f'        <p class="review-meta">{meta}</p>\n'
                f'      </article>'
            )
        cards = "\n\n".join(parts)

    block = (
        f"{start}\n"
        f'    <div class="reviews-list">\n\n'
        f"{cards}\n\n"
        f"    </div>\n"
        f"    {end}"
    )

    before = html.split(start)[0]
    after = html.split(end)[1]
    new_html = before + block + after

    with open(path, "w", encoding="utf-8") as f:
        f.write(new_html)
    print(f"✅ reviews.html: {len(reviews)} نظر تزریق شد")
    return True




def fetch_kv_sheet(gid: str) -> dict:
    """خواندن تب کلید|مقدار و برگرداندن dict."""
    if not SPREADSHEET_ID or not gid:
        return {}
    rows = fetch_csv_by_gid(gid)
    content = {}
    for row in rows:
        key = (row.get("کلید") or row.get("key") or "").strip().lower()
        value = (row.get("مقدار") or row.get("value") or "").strip()
        if key and value:
            content[key] = value
    return content



def _normalize_asset_path(raw: str) -> str:
    """مسیر عکس: لینک کامل یا assets/... — نام فایل تنها → assets/"""
    s = (raw or "").strip()
    if not s:
        return ""
    if s.startswith(("http://", "https://", "assets/", "/")):
        return s
    return f"assets/{s.lstrip('/')}"


def _apply_page_titles(html: str, content: dict) -> str:
    """عنوان / زیرعنوان / کپشن / عکس هیرو از شیت."""
    title = (content.get("title") or "").strip()
    subtitle = (content.get("subtitle") or "").strip()
    caption = (content.get("caption") or "").strip()
    hero = _normalize_asset_path(content.get("hero_image") or content.get("hero") or "")

    if title:
        html = re.sub(
            r'(<h1 id="page-title">)(.*?)(</h1>)',
            rf'\1{escape(title)}\3',
            html, count=1, flags=re.DOTALL,
        )
    if subtitle:
        html = re.sub(
            r'(<p class="page-eyebrow" id="page-subtitle">)(.*?)(</p>)',
            rf'\1{escape(subtitle)}\3',
            html, count=1, flags=re.DOTALL,
        )
    if caption:
        html = re.sub(
            r'(<p class="carousel-caption active" id="page-caption">)(.*?)(</p>)',
            rf'\1{escape(caption)}\3',
            html, count=1, flags=re.DOTALL,
        )
    if hero:
        html = re.sub(
            r'(<div class="carousel-slide active"[^>]*>\s*<img src=")([^"]*)(")',
            rf'\1{escape(hero, quote=True)}\3',
            html, count=1, flags=re.DOTALL,
        )
        html = re.sub(
            r'(<img src=")([^"]*)(" alt="[^"]*" fetchpriority="high")',
            rf'\1{escape(hero, quote=True)}\3',
            html, count=1,
        )
    return html


def _build_simple_content_block(content: dict, max_paras: int = 8, with_list: bool = True) -> str:
    """پاراگراف + لیست + گالری + CTA — یکدست برای همه صفحات متنی."""
    parts = []
    content = dict(content)
    if content.get("intro") and not content.get("para1"):
        content["para1"] = content["intro"]

    for i in range(1, max_paras + 1):
        val = (content.get(f"para{i}") or "").strip()
        if val:
            parts.append(f'    <p id="page-para{i}">{escape(val)}</p>')

    list_title = (content.get("list_title") or "").strip()
    list_items = []
    for i in range(1, 9):
        v = (content.get(f"list{i}") or "").strip()
        if v:
            list_items.append(f"      <li>{escape(v)}</li>")
    if list_items:
        if list_title:
            parts.append(f'    <h2 id="page-list-title">{escape(list_title)}</h2>')
        parts.append('    <ul class="page-list" id="page-list">')
        parts.extend(list_items)
        parts.append('    </ul>')

    gallery_parts = []
    for i in range(1, 5):
        img = _normalize_asset_path(content.get(f"image{i}") or "")
        cap = (content.get(f"image{i}_caption") or content.get(f"image{i}_cap") or "").strip()
        if img:
            safe_url = escape(img, quote=True)
            safe_cap = escape(cap) if cap else f"عکس {i}"
            gallery_parts.append(
                f'      <figure>\n'
                f'        <img src="{safe_url}" alt="{safe_cap}" loading="lazy" width="400" height="220">\n'
                f'        <figcaption>{safe_cap}</figcaption>\n'
                f'      </figure>'
            )
    if gallery_parts:
        parts.append('    <div class="page-gallery" id="page-gallery">')
        parts.extend(gallery_parts)
        parts.append('    </div>')

    cta = (content.get("cta_text") or content.get("cta") or "").strip()
    if cta:
        parts.append(f'    <p id="page-cta-text" class="page-cta-lead">{escape(cta)}</p>')

    return "\n".join(parts) if parts else ""


def update_kv_page(
    filename: str,
    content: dict,
    marker_start: str,
    marker_end: str,
    *,
    max_paras: int = 8,
    with_list: bool = True,
) -> bool:
    """تزریق محتوای کلید|مقدار به یک صفحه HTML."""
    path = find_frontend_file(filename)
    if not path:
        print(f"⚠️  {filename} پیدا نشد")
        return False
    if not content:
        print(f"  {filename}: شیت خالی — متن فعلی حفظ شد")
        return False

    with open(path, "r", encoding="utf-8") as f:
        html = f.read()

    if marker_start not in html or marker_end not in html:
        print(f"⚠️  مارکرهای {marker_start} در {filename} پیدا نشد")
        return False

    html = _apply_page_titles(html, content)
    inner = _build_simple_content_block(content, max_paras=max_paras, with_list=with_list)
    if not inner:
        print(f"  {filename}: هیچ پاراگرافی در شیت نبود")
        return False

    block = (
        f"{marker_start}\n"
        f'    <div id="sheet-content">\n'
        f"{inner}\n"
        f"    </div>\n"
        f"    {marker_end}"
    )
    before = html.split(marker_start)[0]
    after = html.split(marker_end)[1]
    new_html = before + block + after

    with open(path, "w", encoding="utf-8") as f:
        f.write(new_html)
    print(f"✅ {filename}: {len(content)} کلید از شیت تزریق شد")
    return True



def short_address(raw: str) -> str:
    """آدرس را کوتاه و یکدست می‌کند: باغستان - خادم‌آباد - ... تا لاله X"""
    text = (raw or "").strip()
    if not text:
        return ""
    # یکدست‌سازی فاصله و خط تیره
    text = re.sub(r"\s*-\s*", " - ", text)
    text = re.sub(r"\s+", " ", text).strip()
    # تا لاله + جهت (عدد یا حروف ترتیبی مثل دهم، یازدهم و ...)
    m = re.search(
        r"^(.*?لاله\s*(?:[\d۰-۹]+|اول|دوم|سوم|چهارم|پنجم|ششم|هفتم|هشتم|نهم|دهم|یازدهم|دوازدهم|سیزدهم|چهاردهم|پانزدهم|شانزدهم|هفدهم|هجدهم|نوزدهم|بیستم)\s*(?:اصلی|غربی|شرقی)?)",
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
    "کد", "اسلاگ", "slug", "نوع ملک", "آدرس", "متراژ", "خواب", "طبقه",
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


def _extract_presale_fields(row: dict, notes: str) -> tuple[dict, str]:
    """فیلدهای پیش‌فروش را از ستون یا توضیحات برمی‌دارد و از notes جدا می‌کند.

    برمی‌گرداند: (dict فیلدها, notes تمیز بدون خطوط پیش‌فروش)
    """
    out: dict = {}

    def _from_row(*names: str) -> str:
        for n in names:
            v = (_safe_get(row, n) or (row.get(n) or "")).strip()
            if v and v not in ("-", "ندارم", "ندارد"):
                return v
        return ""

    delivery = _from_row("زمان تحویل")
    payment = _from_row("نحوه پرداخت")
    stage = _from_row("مرحله ساخت")

    clean_lines = []
    for line in (notes or "").splitlines():
        s = line.strip()
        if not s:
            continue
        if s in ("[پیش‌فروش]", "پیش‌فروش") or s.startswith("[پیش‌فروش]"):
            continue
        m = re.match(r"^(زمان تحویل|نحوه پرداخت|مرحله ساخت)\s*[:：]\s*(.+)$", s)
        if m:
            label, val = m.group(1), m.group(2).strip()
            if label == "زمان تحویل" and not delivery:
                delivery = val
            elif label == "نحوه پرداخت" and not payment:
                payment = val
            elif label == "مرحله ساخت" and not stage:
                stage = val
            continue
        # همان‌ها ممکن است با | جدا شده باشند
        if "زمان تحویل" in s or "نحوه پرداخت" in s or "مرحله ساخت" in s:
            for part in re.split(r"\s*\|\s*", s):
                mm = re.match(r"^(زمان تحویل|نحوه پرداخت|مرحله ساخت)\s*[:：]\s*(.+)$", part.strip())
                if mm:
                    label, val = mm.group(1), mm.group(2).strip()
                    if label == "زمان تحویل" and not delivery:
                        delivery = val
                    elif label == "نحوه پرداخت" and not payment:
                        payment = val
                    elif label == "مرحله ساخت" and not stage:
                        stage = val
            continue
        clean_lines.append(s)

    if delivery:
        out["presale_delivery"] = delivery
    if payment:
        out["presale_payment"] = payment
    if stage:
        out["presale_stage"] = stage
    return out, "\n".join(clean_lines).strip()


def _row_is_presale(row: dict, deal_type: str, notes: str) -> bool:
    raw = (
        _safe_get(row, "نوع معامله")
        or _safe_get(row, "فروش")
        or (row.get("نوع معامله") or row.get("فروش") or "")
        or deal_type
        or ""
    )
    s = str(raw).strip().replace("ي", "ی").replace("‌", "").replace(" ", "")
    if s == "پیشفروش" or "پیشفروش" in s:
        return True
    n = (notes or "").strip()
    if n.startswith("[پیش‌فروش]") or n.startswith("[پیش فروش]"):
        return True
    if any((_safe_get(row, k) or "").strip() for k in ("زمان تحویل", "نحوه پرداخت", "مرحله ساخت")):
        return True
    return False


def row_to_property(row: dict, deal_type: str) -> dict:
    agent = _strip_phone_like(_safe_get(row, "مشاور"))
    slug_val = (_safe_get(row, "اسلاگ") or (row.get("slug") or "")).strip()
    status_label = (row.get("وضعیت") or "فعال").strip() or "فعال"
    is_active = row.get("_is_active")
    if is_active is None:
        status_label, is_active = normalize_listing_status(status_label)

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
    else:
        notes = ""

    is_presale = _row_is_presale(row, deal_type, notes)
    display_deal = "پیش‌فروش" if is_presale else deal_type
    presale_fields, clean_notes = _extract_presale_fields(row, notes)

    result = {
        "code": _safe_get(row, "کد"),
        "deal_type": display_deal,
        "status": status_label,
        "is_active": bool(is_active),
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
    if is_presale:
        result["is_presale"] = True
        result.update(presale_fields)

    if slug_val:
        result["slug"] = slug_val

    docs = _safe_get(row, "مدارک")
    if docs:
        result["documents"] = docs

    # --- پین: عدد اولویت از ستون «پین» (خالی = بدون پین) ---
    pin_order = _parse_pin_order(_safe_get(row, "پین") or row.get("پین") or "")
    if pin_order is not None:
        result["pinned"] = True
        result["pin_order"] = pin_order

    if clean_notes:
        result["description"] = clean_notes

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

    # پیش‌فروش مثل فروش قیمت دارد
    if deal_type == "فروش" or is_presale:
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
    # فقط فعال‌ها در آمار صفحه اصلی
    active = [p for p in all_props if p.get("is_active", True)]
    listing = [p for p in active if not p.get("is_local")]
    total = len(listing)
    grid_total = len(active)
    page = min(6, grid_total)

    stats = (
        f"🏠 {_to_persian_digits(total)} کارت فعال خرید | رهن و اجاره"
    )
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

    n_active = sum(1 for p in all_props if p.get("is_active", True))
    n_archive = len(all_props) - n_active
    print(f"تعداد آگهی ملکی: {len(all_props)} (فعال: {n_active} | آرشیو: {n_archive})")

    local_rows = fetch_local_guide()
    local_props = [row_to_local(r) for r in local_rows]
    for lp in local_props:
        lp.setdefault("status", "فعال")
        lp.setdefault("is_active", True)
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

    # --- نظرات مشتریان ---
    reviews = fetch_reviews()
    print(f"تعداد نظرات فعال: {len(reviews)}")
    update_reviews_page(reviews)

    # --- صفحات متنی از شیت (کلید | مقدار) ---
    about_c = fetch_kv_sheet(ABOUT_SHEET_GID)
    print(f"درباره: {len(about_c)} کلید")
    update_kv_page(
        "about.html", about_c,
        "<!-- SNAPSHOT_ABOUT_START -->", "<!-- SNAPSHOT_ABOUT_END -->",
        max_paras=8, with_list=True,
    )

    bagh_text_c = fetch_kv_sheet(BAGHESTAN_TEXT_SHEET_GID)
    print(f"معرفی باغستان: {len(bagh_text_c)} کلید")
    update_kv_page(
        "baghestan.html", bagh_text_c,
        "<!-- SNAPSHOT_BAGHESTAN_TEXT_START -->", "<!-- SNAPSHOT_BAGHESTAN_TEXT_END -->",
        max_paras=8, with_list=True,
    )

    inv_c = fetch_kv_sheet(INVESTMENT_SHEET_GID)
    print(f"سرمایه‌گذاری: {len(inv_c)} کلید")
    update_kv_page(
        "investment.html", inv_c,
        "<!-- SNAPSHOT_INVESTMENT_START -->", "<!-- SNAPSHOT_INVESTMENT_END -->",
        max_paras=5, with_list=True,
    )

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

    active_props = [p for p in all_props if p.get("is_active", True)]
    properties_json = json.dumps(active_props, ensure_ascii=False)
    menu_items_json = json.dumps(menu_items, ensure_ascii=False)

    before = content.split(start_marker)[0]
    after = content.split(end_marker)[1]

    # ItemList سبک برای سئو (حداکثر ۱۲ آگهی اول — فقط آگهی‌های ملکی، نه محله‌گردی)
    item_list_elements = []
    listing_for_seo = [p for p in all_props if not p.get("is_local") and p.get("is_active", True)][:12]
    for i, p in enumerate(listing_for_seo, start=1):
        code = str(p.get("code") or "").strip()
        if not code:
            continue
        item_list_elements.append({
            "@type": "ListItem",
            "position": i,
            "url": f"https://atlas-amlak.ir/agahi/{_listing_slug(p)}.html",
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
    # صفحات استاتیک محله‌گردی
    n_local = write_local_pages(frontend_dir, local_props)
    print(f"✅ صفحات محله‌گردی: {n_local} فایل در mahale/")
    write_sitemap(frontend_dir, listing_only, local_props)
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


def _is_presale_prop(p: dict) -> bool:
    if p.get("is_presale"):
        return True
    dt = str(p.get("deal_type") or "").strip().replace("ي", "ی")
    return dt in ("پیش‌فروش", "پیش فروش")


def _is_sale_like_prop(p: dict) -> bool:
    if _is_presale_prop(p):
        return True
    return str(p.get("deal_type") or "").strip() == "فروش"


def _listing_label(p: dict) -> str:
    t = (p.get("property_type") or "ملک").strip()
    if _is_presale_prop(p):
        return f"{t} پیش‌فروش"
    if _is_sale_like_prop(p):
        return f"{t} فروشی"
    return f"رهن و اجاره {t}"


def _listing_price_line(p: dict) -> str:
    if _is_sale_like_prop(p):
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
    slug = _listing_slug(p)
    page_url = f"https://atlas-amlak.ir/agahi/{slug}.html"
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
    slug = _listing_slug(p)
    page_url = f"https://atlas-amlak.ir/agahi/{slug}.html"
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
    status_label = (p.get("status") or "فعال").strip()
    is_active = p.get("is_active", True)
    if not is_active and status_label and status_label != "فعال":
        title = f"{status_label} | {title}"
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
    m2_html = f'<p class="card-meta card-price-m2">قیمت متری: {m2}</p>' if m2 and _is_sale_like_prop(p) else ""
    negotiate_html = (
        '<p class="card-meta card-negotiate">💬 قیمت اعلامی مالک است؛ جای مذاکره دارد</p>'
        if _is_sale_like_prop(p)
        else ""
    )
    agent_html = f'<p class="card-agent">👤 ثبت‌شده توسط: <strong>{agent}</strong></p>' if agent else ""
    date_html = f'<p class="card-date">📅 ثبت: {reg}</p>' if reg else ""
    notes_html = f'<p class="card-meta card-notes">📝 {desc_note}</p>' if desc_note else ""
    specs_html = f'<p class="card-meta">{escape(specs_txt)}</p>' if specs_txt else ""
    addr_html = f'<p class="card-meta card-address">📍 {addr}</p>' if addr else ""
    # بلوک جداگانه پیش‌فروش
    presale_rows = []
    if p.get("presale_delivery"):
        presale_rows.append(
            f'<p class="card-meta card-presale-item">📅 زمان تحویل: <strong>{escape(str(p["presale_delivery"]))}</strong></p>'
        )
    if p.get("presale_payment"):
        presale_rows.append(
            f'<p class="card-meta card-presale-item">💳 نحوه پرداخت: <strong>{escape(str(p["presale_payment"]))}</strong></p>'
        )
    if p.get("presale_stage"):
        presale_rows.append(
            f'<p class="card-meta card-presale-item">🏗 مرحله ساخت: <strong>{escape(str(p["presale_stage"]))}</strong></p>'
        )
    if _is_presale_prop(p) and presale_rows:
        presale_html = (
            '<div class="card-presale-box">'
            '<p class="card-presale-title">🏗 مشخصات پیش‌فروش</p>'
            + "".join(presale_rows)
            + "</div>"
        )
    elif _is_presale_prop(p):
        presale_html = '<p class="card-meta">🏗 پیش‌فروش</p>'
    else:
        presale_html = ""

    bale_msg = escape(
        f"سلام، در مورد آگهی کد {code} از سایت اطلس املاک پیام می‌دم."
    )

    # متغیرهای از پیش محاسبه‌شده (سازگار با Python 3.11 — بدون \ داخل f-string)
    _presale = _is_presale_prop(p)
    _sale_like = _is_sale_like_prop(p)
    card_cls = "card-presale" if _presale else ("card-sale" if _sale_like else "card-rent")
    deal_tag_cls = "presale" if _presale else ("sale" if _sale_like else "rent")
    deal_tag_label = "پیش‌فروش" if _presale else deal

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
  .status-tag {{
    display: inline-block; margin-right: 6px; padding: 5px 12px; border-radius: 999px;
    background: #8B2942; color: #fff; font-size: 0.78rem; font-weight: 800;
  }}
  .status-banner {{
    background: #F8E8EC; color: #5C1A2E; border: 1px solid #E5B8C4; border-radius: 12px;
    padding: 12px 14px; margin-bottom: 14px; font-size: 0.92rem; line-height: 1.7; font-weight: 600;
  }}
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
    <article class="card {card_cls}">
      <div class="card-image-wrap">
        <img class="card-image" src="{img_src}" alt="{label} کد {code}" width="400" height="280" loading="eager">
        <div class="card-image-overlay">
          <span class="deal-tag {deal_tag_cls}">{deal_tag_label}</span>
          {'' if is_active else f'<span class="status-tag">{escape(status_label)}</span>'}
        </div>
      </div>
      <div class="card-body">
        {'' if is_active else f'<div class="status-banner">این فایل <strong>{escape(status_label)}</strong> است و دیگر در لیست آگهی‌های فعال نمایش داده نمی‌شود.</div>'}
        <h1 class="card-title">{label} <span class="card-code">کد {code}</span></h1>
        {addr_html}
        {specs_html}
        {extras_html}
        {docs_html}
        <p class="card-price">💰 {price}</p>
        {m2_html}
        {negotiate_html}
        {presale_html}
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




def _build_local_seo_title(p: dict) -> str:
    """عنوان سئو برای صفحه محله‌گردی."""
    title = (p.get("title") or p.get("category") or "محله‌گردی").strip()
    code = str(p.get("code") or "").strip()
    cat = (p.get("category") or "").strip()
    parts = [title]
    if cat and cat not in title:
        parts.append(cat)
    parts.append("باغستان خادم‌آباد")
    out = " | ".join(parts)
    if code:
        out = f"{out} | کد {code}"
    if len(out) > 70:
        out = f"{title} | محله‌گردی باغستان خادم‌آباد"
    return out


def _build_local_jsonld(p: dict) -> dict:
    """اسکیمای LocalBusiness / Place برای کارت محله‌گردی."""
    code = str(p.get("code") or "").strip()
    name = (p.get("title") or p.get("category") or "مکان محلی").strip()
    slug = str(p.get("slug") or code).strip()
    page_url = f"https://atlas-amlak.ir/mahale/{slug}.html"
    addr = (p.get("address") or "").strip()
    desc = (p.get("description") or "").strip()
    if not desc:
        desc = f"{name} در {addr or 'باغستان خادم‌آباد'}"

    img = _og_image_url(p)
    business = {
        "@type": "LocalBusiness",
        "@id": f"{page_url}#place",
        "name": name,
        "description": desc[:300],
        "url": page_url,
        "image": img,
        "address": {
            "@type": "PostalAddress",
            "streetAddress": addr or "خادم‌آباد",
            "addressLocality": "خادم‌آباد",
            "addressRegion": "تهران",
            "addressCountry": "IR",
        },
        "areaServed": {
            "@type": "Place",
            "name": "باغستان خادم‌آباد",
        },
    }
    if p.get("phone"):
        business["telephone"] = str(p.get("phone")).strip()
    if p.get("hours"):
        business["openingHours"] = str(p.get("hours")).strip()
    if p.get("category"):
        business["additionalType"] = str(p.get("category")).strip()
    if p.get("link"):
        business["sameAs"] = [str(p.get("link")).strip()]

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
                "name": name,
                "item": page_url,
            },
        ],
    }
    return {"@context": "https://schema.org", "@graph": [business, breadcrumb]}


def render_local_html(p: dict) -> str:
    """صفحه HTML استاتیک سئو‌محور برای یک کارت محله‌گردی."""
    code = escape(str(p.get("code") or ""))
    title_raw = (p.get("title") or p.get("category") or "محله‌گردی").strip()
    title = escape(title_raw)
    category = escape((p.get("category") or "").strip())
    addr = escape((p.get("address") or "").strip())
    desc_note = escape((p.get("description") or "").strip())
    reg = escape(str(p.get("registered_at") or "").strip())
    hours = escape(str(p.get("hours") or "").strip())
    phone = escape(str(p.get("phone") or "").strip())
    link = (p.get("link") or "").strip()
    slug = str(p.get("slug") or code).strip()
    page_url = f"https://atlas-amlak.ir/mahale/{slug}.html"
    seo_title = _build_local_seo_title(p)
    img = _og_image_url(p)
    img_rel = escape((p.get("image") or "assets/defaults/local-guide.svg").lstrip("/"))
    if not re.match(r"^https?:\/\/", img_rel, re.I):
        img_src = escape("../" + img_rel)
    else:
        img_src = escape(img_rel)

    # meta description
    desc_parts = [title_raw]
    if addr:
        desc_parts.append(addr)
    if (p.get("description") or "").strip():
        short = re.split(r"[\n|]", str(p.get("description")).strip())[0].strip()[:140]
        if short:
            desc_parts.append(short)
    desc_raw = " — ".join(desc_parts)
    desc = (
        desc_raw.replace("&", "&amp;")
        .replace('"', "&quot;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
    )

    addr_html = f'<p class="card-meta card-address">📍 {addr}</p>' if addr else ""
    cat_html = f'<p class="card-meta">🏷️ {category}</p>' if category else ""
    notes_html = f'<p class="card-meta card-notes">📝 {desc_note}</p>' if desc_note else ""
    date_html = f'<p class="card-date">📅 ثبت: {reg}</p>' if reg else ""
    hours_html = f'<p class="card-meta card-hours">🕐 ساعت کاری: {hours}</p>' if hours else ""

    actions = []
    if phone:
        tel = re.sub(r"[^\d+۰-۹]", "", phone)
        actions.append(
            f'<a class="agent-msg-btn agent-btn-primary" href="tel:{escape(tel)}">📞 تماس</a>'
        )
    if link:
        low = link.lower()
        if "instagram" in low or link.startswith("@"):
            href = link if link.startswith("http") else f"https://www.instagram.com/{link.lstrip('@')}"
            actions.append(
                f'<a class="agent-call-btn agent-btn-secondary" href="{escape(href)}" target="_blank" rel="noopener">📸 اینستاگرام</a>'
            )
        elif "maps" in low or "goo.gl" in low or "neshan" in low or "map" in low:
            actions.append(
                f'<a class="agent-call-btn agent-btn-secondary" href="{escape(link)}" target="_blank" rel="noopener">🗺️ مسیریابی</a>'
            )
        else:
            actions.append(
                f'<a class="agent-call-btn agent-btn-secondary" href="{escape(link)}" target="_blank" rel="noopener">🔗 لینک</a>'
            )
    # همیشه دکمه تماس دفتر به عنوان پشتیبان
    if not phone:
        actions.insert(
            0,
            '<a class="agent-msg-btn agent-btn-primary" href="tel:09106943220">📞 تماس با دفتر</a>',
        )
    actions_html = f'<div class="card-actions">{"".join(actions)}</div>' if actions else ""

    return f"""<!DOCTYPE html>
<html lang="fa" dir="rtl">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>{escape(seo_title)}</title>
<meta name="description" content="{desc}">
<meta name="robots" content="index, follow">
<link rel="canonical" href="{page_url}">
<meta property="og:type" content="website">
<meta property="og:site_name" content="اطلس املاک">
<meta property="og:title" content="{escape(seo_title)}">
<meta property="og:description" content="{desc}">
<meta property="og:url" content="{page_url}">
<meta property="og:image" content="{escape(img)}">
<meta property="og:locale" content="fa_IR">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="{escape(seo_title)}">
<meta name="twitter:description" content="{desc}">
<meta name="twitter:image" content="{escape(img)}">
<link rel="icon" type="image/png" href="../assets/favicon-32.png">
<link rel="stylesheet" href="../style.css">
<style>
  body {{
    background: linear-gradient(180deg, #F7F3EA 0%, #EFE6D3 100%);
    margin: 0; padding-bottom: 28px;
  }}
  .agahi-page {{ max-width: 560px; margin: 0 auto; padding: 18px 14px 36px; }}
  .agahi-nav {{
    display: flex; align-items: center; justify-content: space-between;
    gap: 10px; margin-bottom: 16px;
  }}
  .agahi-back {{
    display: inline-flex; align-items: center; gap: 6px;
    padding: 9px 16px; background: #fff; border: 1px solid #E8DFD0;
    border-radius: 999px; color: #201C15; font-weight: 700; font-size: 0.86rem;
    text-decoration: none; box-shadow: 0 2px 8px rgba(32,28,21,0.05);
  }}
  .agahi-brand-chip {{
    font-size: 0.78rem; font-weight: 700; color: #B8894F;
    background: rgba(184,137,79,0.12); padding: 8px 13px; border-radius: 999px;
  }}
  .agahi-bottom-back {{ display: flex; justify-content: center; margin: 24px 0; }}
  .agahi-bottom-back a {{
    border: 1.5px solid #B8894F; color: #201C15; font-weight: 700;
    padding: 10px 22px; border-radius: 999px; text-decoration: none;
  }}
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
  }}
  .agahi-footer strong {{ color: #201C15; display: block; margin-bottom: 6px; font-size: 1.1rem; }}
  .agahi-footer .footer-tagline {{ margin: 0 0 14px; color: #6B6358; }}
  .agahi-footer .phone-row {{
    display: inline-flex; align-items: center; gap: 8px;
    background: rgba(74,107,95,0.10); padding: 8px 16px; border-radius: 999px; margin: 0 0 6px;
  }}
  .agahi-footer a {{ color: #201C15; font-weight: 700; text-decoration: none; }}
  .agahi-footer .phone {{ direction: ltr; unicode-bidi: embed; font-weight: 800; }}
  .agahi-footer .hours {{ margin: 0 0 16px; color: #8A8070; font-size: 0.82rem; }}
  .agahi-footer-links {{
    display: flex; flex-wrap: wrap; justify-content: center; gap: 8px;
    margin-top: 6px; padding-top: 16px; border-top: 1px dashed #E0D5C4;
  }}
  .agahi-footer-links a {{
    font-size: 0.84rem; color: #6B6358; font-weight: 600;
    padding: 6px 13px; border-radius: 999px; background: #fff; border: 1px solid #EDE4D3;
  }}
  .agahi-footer-site {{ margin: 16px 0 0; font-size: 0.84rem; }}
  .agahi-footer-site a {{ color: #B8894F; }}
</style>
<script type="application/ld+json">
{json.dumps(_build_local_jsonld(p), ensure_ascii=False)}
</script>
</head>
<body>
<main class="agahi-page">
  <div class="agahi-nav">
    <a class="agahi-back" href="../">← همه آگهی‌ها</a>
    <span class="agahi-brand-chip">محله‌گردی اطلس</span>
  </div>

  <div class="agahi-card-wrap">
    <article class="card card-sale">
      <div class="card-image-wrap">
        <img class="card-image" src="{img_src}" alt="{title}" width="400" height="280" loading="eager">
        <div class="card-image-overlay">
          <span class="deal-tag sale">محله‌گردی</span>
        </div>
      </div>
      <div class="card-body">
        <h1 class="card-title">{title} <span class="card-code">کد {code}</span></h1>
        {addr_html}
        {cat_html}
        {notes_html}
        {hours_html}
        {date_html}
        {actions_html}
      </div>
    </article>
  </div>

  <div class="agahi-bottom-back">
    <a href="../">← بازگشت به صفحه اصلی سایت</a>
  </div>

  <footer class="agahi-footer">
    <div class="agahi-footer-inner">
      <div class="agahi-footer-logo">🗺️</div>
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


def write_local_pages(frontend_dir: Path, props: list[dict]) -> int:
    """ساخت/به‌روزرسانی mahale/{slug}.html و حذف اسلاگ‌های غیرفعال."""
    mahale = frontend_dir / "mahale"
    mahale.mkdir(exist_ok=True)
    active = set()
    for p in props:
        slug = str(p.get("slug") or p.get("code") or "").strip()
        if not slug:
            continue
        safe = re.sub(r"[^\w\-]", "", slug)
        if not safe:
            continue
        active.add(safe)
        (mahale / f"{safe}.html").write_text(render_local_html(p), encoding="utf-8")
    for old in mahale.glob("*.html"):
        if old.stem not in active:
            old.unlink()
    return len(active)




# نگاشت نوع ملک → اسلاگ لاتین برای URL آگهی
_PROPERTY_TYPE_SLUGS = {
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
}


def _code_to_alpha(code: str) -> str:
    """تبدیل کد عددی به حروف لاتین (بدون رقم) برای URL زیبا و یکتا."""
    s = str(code or "").strip()
    digits = "".join(c for c in s if c.isdigit())
    letters = "".join(c for c in s.lower() if c.isalpha())
    if digits:
        n = int(digits)
        if n <= 0:
            body = "a"
        else:
            chars = []
            while n > 0:
                n, r = divmod(n, 26)
                chars.append(chr(ord("a") + r))
            body = "".join(reversed(chars))
    else:
        body = letters or "x"
    # اگر کد خودش حرف داشت، اضافه کن تا یکتا بماند
    if letters and digits:
        return f"{letters}{body}"
    return body or "x"


def _listing_slug(p: dict) -> str:
    """اسلاگ آگهی بدون رقم در URL.
    اولویت: ستون اسلاگ در شیت → نوع‌ملک + کدِ حروفی.
    مثال: aparteman-all  یا  villa-baghestan (دستی)
    """
    manual = str(p.get("slug") or "").strip().lower()
    if manual:
        s = manual.replace(" ", "-").replace("_", "-")
        s = re.sub(r"[^a-z\-]", "", s)  # حذف رقم و غیرلاتین
        s = re.sub(r"-+", "-", s).strip("-")
        if s:
            return s
    pt = (p.get("property_type") or "").strip()
    type_slug = _PROPERTY_TYPE_SLUGS.get(pt, "melk")
    alpha = _code_to_alpha(str(p.get("code") or ""))
    return f"{type_slug}-{alpha}"



def write_listing_pages(frontend_dir: Path, props: list[dict]) -> int:
    """ساخت agahi/{slug}.html + ریدایرکت از agahi/{code}.html برای سازگاری."""
    agahi = frontend_dir / "agahi"
    agahi.mkdir(exist_ok=True)
    active = set()
    for p in props:
        code = re.sub(r"[^\w\-]", "", str(p.get("code") or "").strip())
        if not code:
            continue
        slug = _listing_slug(p)
        safe_slug = re.sub(r"[^\w\-]", "", slug)
        if not safe_slug:
            safe_slug = code
        active.add(safe_slug)
        active.add(code)
        html = render_listing_html(p)
        (agahi / f"{safe_slug}.html").write_text(html, encoding="utf-8")
        # ریدایرکت سبک از کد قدیمی → اسلاگ جدید (اگر متفاوت باشد)
        if safe_slug != code:
            redirect_html = f"""<!DOCTYPE html>
<html lang="fa">
<head>
<meta charset="UTF-8">
<title>انتقال…</title>
<link rel="canonical" href="https://atlas-amlak.ir/agahi/{safe_slug}.html">
<meta http-equiv="refresh" content="0;url=/agahi/{safe_slug}.html">
<script>location.replace("/agahi/{safe_slug}.html");</script>
</head>
<body>
<p><a href="/agahi/{safe_slug}.html">مشاهده آگهی</a></p>
</body>
</html>
"""
            (agahi / f"{code}.html").write_text(redirect_html, encoding="utf-8")
    for old in agahi.glob("*.html"):
        if old.stem not in active:
            old.unlink()
    return len({re.sub(r"[^\w\-]", "", str(p.get("code") or "")) for p in props if p.get("code")})



def write_sitemap(frontend_dir: Path, props: list[dict], local_props: list[dict] | None = None) -> None:
    urls = [
        ("https://atlas-amlak.ir/", "hourly", "1.0"),
        ("https://atlas-amlak.ir/about.html", "monthly", "0.6"),
        ("https://atlas-amlak.ir/baghestan.html", "weekly", "0.8"),
        ("https://atlas-amlak.ir/bagh-villa.html", "weekly", "0.7"),
        ("https://atlas-amlak.ir/investment.html", "monthly", "0.5"),
        ("https://atlas-amlak.ir/reviews.html", "monthly", "0.5"),
    ]
    # آگهی‌های ملکی (آدرس زیبا بر اساس نوع + کد)
    for p in props:
        code = re.sub(r"[^\w\-]", "", str(p.get("code") or "").strip())
        if not code:
            continue
        slug = re.sub(r"[^\w\-]", "", _listing_slug(p))
        urls.append((f"https://atlas-amlak.ir/agahi/{slug or code}.html", "daily", "0.8"))
    # کارت‌های محله‌گردی
    for p in (local_props or []):
        slug = re.sub(r"[^\w\-]", "", str(p.get("slug") or p.get("code") or "").strip())
        if slug:
            urls.append((f"https://atlas-amlak.ir/mahale/{slug}.html", "weekly", "0.7"))
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