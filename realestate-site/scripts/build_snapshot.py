#!/usr/bin/env python3
"""
build_snapshot.py — اسکریپت دریافت داده‌های املاک از API و تزریق آن به فایل index.html
"""

import os
import requests
from pathlib import Path

# آدرس API بک‌اند شما
API_URL = os.getenv("PROPERTIES_API_URL", "https://api.atlas-amlak.ir/api/properties")

# یافتن مسیر دقیق پوشه اسکریپت و فایل index.html هم‌سطح با پوشه scripts
SCRIPT_DIR = Path(__file__).resolve().parent
INDEX_HTML = SCRIPT_DIR.parent / "index.html"

def update_snapshot():
    try:
        print(f"Fetching properties from: {API_URL}")
        response = requests.get(API_URL, timeout=15)
        response.raise_for_status()
        properties_json = response.text.strip()

        if not INDEX_HTML.exists():
            print(f"Error: Could not find index.html at {INDEX_HTML}")
            exit(1)

        print(f"Found index.html at: {INDEX_HTML}")

        with open(INDEX_HTML, "r", encoding="utf-8") as f:
            content = f.read()

        start_marker = "<!-- SNAPSHOT_DATA_START -->"
        end_marker = "<!-- SNAPSHOT_DATA_END -->"

        if start_marker in content and end_marker in content:
            before = content.split(start_marker)[0]
            after = content.split(end_marker)[1]
            
            new_content = f"{before}{start_marker}\n<script>window.__PRELOADED_PROPERTIES__ = {properties_json};</script>\n{end_marker}{after}"

            with open(INDEX_HTML, "w", encoding="utf-8") as f:
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
