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

        # فقط ردیف‌های فعال
        active = [
            row for row in rows
            if (row.get("وضعیت") or "فعال").strip() not in ("لغو شده", "حذف شده", "غیرفعال")
        ]
        return active
    except Exception as e:
        print(f"خطا در خواندن تب {deal_type}: {e}")
        return []


def row_to_property(row: dict, deal_type: str) -> dict:
    result = {
        "code": row.get("کد", ""),
        "deal_type": deal_type,
        "property_type": row.get("نوع ملک", ""),
        "address": row.get("آدرس", ""),
        "area_m2": row.get("متراژ", ""),
        "rooms": row.get("خواب", ""),
        "parking": (row.get("پارکینگ") or "").strip() == "دارد",
        "elevator": (row.get("آسانسور") or "").strip() == "دارد",
        "storage": (row.get("انباری") or "").strip() == "دارد",
        "agent_name": (row.get("مشاور") or "").strip(),
        "agent_phone": (row.get("شماره مشاور") or "").strip(),
    }
    if deal_type == "فروش":
        result["price_total"] = row.get("قیمت کل", "") or "توافقی"
    else:
        result["rahn"] = row.get("رهن", "") or "-"
        result["ejare"] = row.get("کرایه", "") or "-"
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
