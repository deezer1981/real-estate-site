#!/usr/bin/env python3
"""
build_snapshot.py — دریافت مستقیم داده‌ها از گوگل‌شیت و تزریق به index.html
Spreadsheet ID از GitHub Secret خوانده می‌شود تا در ریپوی عمومی دیده نشود.
"""

import csv
import io
import json
import os
import requests
from pathlib import Path

# ==================== تنظیمات ====================
# این مقدار از Secret خوانده می‌شود (دیگر داخل کد نیست)
SPREADSHEET_ID = os.getenv("SPREADSHEET_ID", "")

SHEET_GIDS = {
    "فروش": "883906283",
    "رهن و اجاره": "388590955",
}

# وضعیت‌هایی که نباید روی سایت بیایند
INACTIVE_STATUSES = {
    "لغو شده",
    "حذف شده",
    "غیرفعال",
    "غیر فعال",
    "غیرفعال شده",
}
# ================================================


def find_index_html() -> Path:
    cwd = Path.cwd()
    for path in cwd.rglob("index.html"):
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

    url = f"https://docs.google.com/spreadsheets/d/{SPREADSHEET_ID}/gviz/tq?tqx=out:csv&gid={gid}"
    try:
        resp = requests.get(url, timeout=20)
        resp.raise_for_status()
        f = io.StringIO(resp.text)
        reader = csv.DictReader(f)
        rows = [row for row in reader if any((v or "").strip() for v in row.values())]

        # فقط ردیف‌های فعال + دارای کد
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
    except Exception as e:
        print(f"خطا در خواندن تب {deal_type}: {e}")
        return []


def short_address(raw: str) -> str:
    """فقط تا «لاله X» (و جهت اصلی/غربی/شرقی) نگه می‌دارد؛ جزئیات دقیق‌تر حذف می‌شود."""
    import re
    text = (raw or "").strip()
    if not text:
        return ""
    # مثال: بلوار رسول اکرم لاله ۱۱ شرقی پلاک ۱۲ → بلوار رسول اکرم لاله ۱۱ شرقی
    m = re.search(
        r"^(.*?لاله\s*[\d۰-۹]+\s*(?:اصلی|غربی|شرقی)?)",
        text,
    )
    if m:
        return m.group(1).strip()
    # اگر الگوی لاله نبود، حداکثر ۴۰ کاراکتر
    return (text[:40].strip() + "…") if len(text) > 40 else text


# --------------------------------------------------------------------------- #
# حریم خصوصی: فقط این ستون‌ها از شیت مجازند وارد سایت شوند.
# هر ستون دیگری (مالک، شماره مالک، مشتری، تلفن مشاور، ...) نادیده گرفته می‌شود.
# --------------------------------------------------------------------------- #
ALLOWED_SHEET_COLUMNS = {
    "کد",
    "نوع ملک",
    "آدرس",
    "متراژ",
    "خواب",
    "طبقه",
    "پارکینگ",
    "آسانسور",
    "انباری",
    "مشاور",          # فقط نام مشاور دفتر — نه شماره
    "تاریخ ثبت فایل",
    "قیمت کل",
    "قیمت متری",
    "رهن",
    "کرایه",
    "وضعیت",          # فقط برای فیلتر فعال/غیرفعال
}

# کلیدهایی که حتی اگر تصادفاً در خروجی بیایند باید حذف شوند
BLOCKED_OUTPUT_KEYS = {
    "owner", "owner_name", "owner_phone", "مالک", "نام مالک", "شماره مالک",
    "customer", "مشتری", "نام مشتری", "شماره مشتری",
    "phone", "mobile", "tel", "شماره", "تلفن", "موبایل",
    "agent_phone", "شماره مشاور", "تلفن مشاور",
    "national_id", "کد ملی", "کدملی",
}


def _safe_get(row: dict, col: str) -> str:
    """فقط از ستون‌های مجاز مقدار می‌خواند."""
    if col not in ALLOWED_SHEET_COLUMNS:
        return ""
    return (row.get(col) or "").strip()


def _strip_phone_like(text: str) -> str:
    """اگر داخل متن چیزی شبیه شماره تلفن باشد حذفش می‌کند."""
    import re
    if not text:
        return ""
    # حذف دنباله‌های ۸+ رقمی (فارسی و لاتین)
    cleaned = re.sub(r"[\d۰-۹]{8,}", "", text)
    return cleaned.strip(" -–|/\\")


def row_to_property(row: dict, deal_type: str) -> dict:
    """
    تبدیل ردیف شیت به آبجکت عمومی سایت.
    فقط whitelist ستون‌ها خوانده می‌شود؛ اطلاعات شخصی هرگز وارد خروجی نمی‌شود.
    """
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
    if deal_type == "فروش":
        result["price_total"] = _safe_get(row, "قیمت کل") or "توافقی"
        result["price_per_m2"] = _safe_get(row, "قیمت متری")
    else:
        result["rahn"] = _safe_get(row, "رهن")
        result["ejare"] = _safe_get(row, "کرایه")

    # لایه دفاعی نهایی: حذف هر کلید مسدود
    for bad in list(result.keys()):
        if bad in BLOCKED_OUTPUT_KEYS or any(b in bad for b in ("phone", "مالک", "مشتری", "شماره")):
            del result[bad]

    return result


def update_snapshot():
    print("در حال دریافت داده‌ها از گوگل‌شیت...")

    if not SPREADSHEET_ID:
        print("Error: متغیر محیطی SPREADSHEET_ID خالی است")
        exit(1)

    all_props = []
    for deal_type in SHEET_GIDS:
        rows = fetch_sheet(deal_type)
        all_props.extend(row_to_property(r, deal_type) for r in rows)

    # جدیدترین‌ها اول (بر اساس کد آگهی، بزرگ‌تر = جدیدتر)
    def sort_key(item):
        code = str(item.get("code") or "0")
        digits = "".join(c for c in code if c.isdigit())
        return int(digits) if digits else 0

    all_props.sort(key=sort_key, reverse=True)
    print(f"تعداد فایل‌های فعال: {len(all_props)}")

    index_path = find_index_html()
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

    before = content.split(start_marker)[0]
    after = content.split(end_marker)[1]

    new_content = (
        f"{before}{start_marker}\n"
        f"<script>window.__PRELOADED_PROPERTIES__ = {properties_json};</script>\n"
        f"{end_marker}{after}"
    )

    with open(index_path, "w", encoding="utf-8") as f:
        f.write(new_content)

    print("✅ اسنپ‌شات با موفقیت به‌روز شد")


if __name__ == "__main__":
    update_snapshot()
