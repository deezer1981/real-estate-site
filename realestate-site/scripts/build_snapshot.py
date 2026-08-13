#!/usr/bin/env python3
"""
build_snapshot.py — اسکریپت دریافت داده‌های املاک از API و تزریق آن به فایل index.html
"""

import os
import requests
from pathlib import Path

# آدرس API بک‌اند
API_URL = os.getenv("PROPERTIES_API_URL", "https://api.atlas-amlak.ir/api/properties")

def find_index_html() -> Path:
    """جستجوی جامع برای یافتن فایل index.html در تمام پوشه‌های ریپوزیتوری"""
    cwd = Path.cwd()
    
    # 1. جستجوی مستقیم در تمام زیرپوشه‌ها
    for path in cwd.rglob("index.html"):
        # ندیده گرفتن فایل‌های داخل node_modules یا .git اگر وجود داشته باشند
        if ".git" not in path.parts and "node_modules" not in path.parts:
            return path

    # 2. بررسی مسیرهای احتمالی بر اساس پوشه اسکریپت
    script_dir = Path(__file__).resolve().parent
    candidate_paths = [
        script_dir.parent / "index.html",
        script_dir.parent.parent / "index.html",
    ]
    for path in candidate_paths:
        if path.exists():
            return path
            
    return None

def update_snapshot():
    try:
        print(f"Fetching properties from: {API_URL}")
        response = requests.get(API_URL, timeout=15)
        response.raise_for_status()
        properties_json = response.text.strip()

        index_html_path = find_index_html()

        if not index_html_path:
            print(f"Error: Could not find index.html anywhere under {Path.cwd()}")
            print("Listing all directory contents for debugging:")
            for p in Path.cwd().rglob("*"):
                if ".git" not in p.parts:
                    print(f" - {p}")
            exit(1)

        print(f"Found index.html at: {index_html_path}")

        with open(index_html_path, "r", encoding="utf-8") as f:
            content = f.read()

        start_marker = "<!-- SNAPSHOT_DATA_START -->"
        end_marker = "<!-- SNAPSHOT_DATA_END -->"

        if start_marker in content and end_marker in content:
            before = content.split(start_marker)[0]
            after = content.split(end_marker)[1]
            
            new_content = f"{before}{start_marker}\n<script>window.__PRELOADED_PROPERTIES__ = {properties_json};</script>\n{end_marker}{after}"

            with open(index_html_path, "w", encoding="utf-8") as f:
                f.write(new_content)
            print("Snapshot updated successfully!")
        else:
            print("Error: Markers (SNAPSHOT_DATA_START / SNAPSHOT_DATA_END) not found in index.html")
            exit(1)

    except Exception as e:
        print(f"Error executing snapshot update: {e}")
        exit(1)

if __name__ == "__main__":
    update_snapshot()
