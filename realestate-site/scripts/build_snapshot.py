"""
build_snapshot.py
==================
این اسکریپت هر بار که اجرا میشه:
1. از API بک‌اند (همون آدرسی که سایت برای گرفتن آگهی‌ها استفاده می‌کنه) آخرین
   لیست آگهی‌ها رو می‌گیره.
2. کارت‌های HTML آگهی‌ها رو می‌سازه (دقیقاً همون طراحی که توی script.js هست).
3. این HTML رو بین دو کامنت مخصوص توی index.html جایگزین می‌کنه.
4. کل لیست آگهی‌ها رو هم به‌صورت JSON توی یه تگ <script> مخفی می‌ذاره تا
   script.js بتونه همون لحظه‌ی اول (قبل از تموم‌شدن fetch زنده) نشونش بده.

⚠️ این آدرس رو با آدرس واقعی بک‌اندت (Render یا زیردامنه‌ی api.) جایگزین کن:
"""

import json
import re
from pathlib import Path

import requests

# ---------------------------------------------------------------------
# تنظیمات
# ---------------------------------------------------------------------
API_URL = "https://real-estate-site-svyr.onrender.com/api/properties"  # <-- این رو با آدرس واقعی خودت عوض کن
INDEX_PATH = Path(__file__).parent.parent / "frontend" / "index.html"
SNAPSHOT_COUNT = 6  # چند تا کارت واقعی توی HTML اولیه رندر بشه (بقیه از طریق JS/جستجو در دسترسن)

START_MARK = "<!-- SNAPSHOT_START -->"
END_MARK = "<!-- SNAPSHOT_END -->"
DATA_START_MARK = "<!-- SNAPSHOT_DATA_START -->"
DATA_END_MARK = "<!-- SNAPSHOT_DATA_END -->"


def truncate_address(address: str) -> str:
    if not address:
        return ""
    text = address.strip()
    match = re.match(r"^(.*?لاله\s*[۰-۹0-9]+\s*(اصلی|غربی|شرقی)?)", text)
    if match and match.group(1):
        return match.group(1).strip()
    return text[:40].strip() + "…" if len(text) > 40 else text


def property_card_html(p: dict) -> str:
    deal_type = p.get("deal_type", "")
    if deal_type == "فروش":
        price_line = f'<p class="card-price">💰 {p.get("price_total") or "توافقی"}</p>'
        tag_class = "sale"
    else:
        price_line = (
            f'<p class="card-price">💰 رهن: {p.get("rahn") or "-"} | '
            f'اجاره: {p.get("ejare") or "-"}</p>'
        )
        tag_class = "rent"

    extras = []
    if p.get("parking"):
        extras.append("🅿️ پارکینگ")
    if p.get("elevator"):
        extras.append("🛗 آسانسور")
    extras_line = f'<p class="card-meta">{" | ".join(extras)}</p>' if extras else ""

    address = truncate_address(p.get("address", ""))
    area = p.get("area_m2")
    rooms = p.get("rooms")
    meta2 = " ".join(
        filter(None, [f"{area} متر" if area else "", f"· {rooms} خواب" if rooms else ""])
    )

    return f"""
    <article class="card">
      <div class="card-body">
        <span class="deal-tag {tag_class}">{deal_type}</span>
        <h3>{p.get("property_type") or "ملک"} · کد {p.get("code") or "-"}</h3>
        <p class="card-meta">📍 {address or "-"}</p>
        <p class="card-meta">{meta2}</p>
        {extras_line}
        {price_line}
      </div>
    </article>
    """.strip()


def main():
    try:
        response = requests.get(API_URL, timeout=20)
        response.raise_for_status()
        properties = response.json()
    except Exception as e:
        print(f"⚠️ خطا در گرفتن آگهی‌ها: {e} — از snapshot موجود صرف‌نظر شد.")
        return

    properties = list(reversed(properties))  # جدیدترین‌ها اول

    html_content = INDEX_PATH.read_text(encoding="utf-8")

    # ۱) جایگزینی کارت‌های HTML (برای ربات‌های گوگل / بارگذاری اول)
    cards_html = "\n".join(property_card_html(p) for p in properties[:SNAPSHOT_COUNT])
    if not cards_html:
        cards_html = '<p class="loading">فعلاً آگهی‌ای ثبت نشده.</p>'

    pattern = re.compile(
        re.escape(START_MARK) + r".*?" + re.escape(END_MARK), re.DOTALL
    )
    replacement = f"{START_MARK}\n{cards_html}\n{END_MARK}"
    html_content, count1 = pattern.subn(replacement, html_content)

    # ۲) جایگزینی دیتای کامل JSON (برای اینکه script.js فوراً همه‌چیز رو داشته باشه)
    data_json = json.dumps(properties, ensure_ascii=False)
    data_pattern = re.compile(
        re.escape(DATA_START_MARK) + r".*?" + re.escape(DATA_END_MARK), re.DOTALL
    )
    data_replacement = (
        f'{DATA_START_MARK}\n'
        f'<script id="snapshotData" type="application/json">{data_json}</script>\n'
        f'{DATA_END_MARK}'
    )
    html_content, count2 = data_pattern.subn(data_replacement, html_content)

    if count1 == 0 or count2 == 0:
        print("⚠️ مارکرهای SNAPSHOT توی index.html پیدا نشدن — چیزی تغییر نکرد.")
        return

    INDEX_PATH.write_text(html_content, encoding="utf-8")
    print(f"✅ Snapshot با {len(properties)} آگهی (نمایش {min(len(properties), SNAPSHOT_COUNT)} تا) به‌روزرسانی شد.")


if __name__ == "__main__":
    main()
