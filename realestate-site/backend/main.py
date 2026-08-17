"""
Atlas Amlak — Website API
==========================
این بک‌اند به دو منبع داده وصل است:

1) گوگل‌شیت املاک (همون شیتی که ربات تلگرام "اطلس" هم ازش می‌خونه) — فقط خواندن.
   هیچ تغییری روی کد یا رفتار ربات ایجاد نمی‌کند.
2) دیتابیس Postgres (Supabase) — برای ذخیره‌ی درخواست‌های تماس (لید).
3) Google Apps Script Web App — برای ثبت فایل‌های «در انتظار تایید» از فرم سایت
   (مستقیم می‌ره توی تب انتظار تایید شیت، همون جایی که ربات هم استفاده می‌کنه).

متغیرهای محیطی لازم:
- SPREADSHEET_ID   -> همون مقداری که در Environment سرویس ربات روی Render ست شده
- DATABASE_URL     -> آدرس Postgres (Supabase)
- API_KEY          -> رمز دلخواه برای مشاهده‌ی لیدها
- APPS_SCRIPT_URL  -> لینک Web App اسکریپت (اختیاری، مقدار پیش‌فرض داره)
"""

import csv
import os
import time
import uuid
import json
from datetime import datetime
from io import StringIO
from typing import Optional, List

import httpx
from fastapi import FastAPI, HTTPException, Header
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from sqlalchemy import create_engine, Column, Integer, String, Text, DateTime
from sqlalchemy.orm import declarative_base, sessionmaker

# --------------------------------------------------------------------------- #
# پیکربندی
# --------------------------------------------------------------------------- #

SPREADSHEET_ID = os.getenv("SPREADSHEET_ID", "")
API_KEY = os.getenv("API_KEY", "change-me")

# محدودیت نرخ: هر شماره هر چند ثانیه یک‌بار
RATE_LIMIT_SECONDS = int(os.getenv("RATE_LIMIT_SECONDS", "600"))  # پیش‌فرض ۱۰ دقیقه
_rate_limit_store: dict[str, float] = {}  # phone -> last submit timestamp


def _normalize_phone(phone: str) -> str:
    """یکسان‌سازی شماره برای محدودیت نرخ."""
    digits = "".join(c for c in (phone or "") if c.isdigit())
    if digits.startswith("98") and len(digits) >= 12:
        digits = "0" + digits[2:]
    return digits


def check_rate_limit(phone: str) -> None:
    """اگر شماره اخیراً ارسال کرده باشد، خطای ۴۲۹ می‌دهد."""
    key = _normalize_phone(phone)
    if not key:
        return
    now = time.time()
    last = _rate_limit_store.get(key)
    if last is not None and (now - last) < RATE_LIMIT_SECONDS:
        remain = int(RATE_LIMIT_SECONDS - (now - last))
        minutes = max(1, remain // 60)
        raise HTTPException(
            status_code=429,
            detail=f"از این شماره اخیراً درخواست ثبت شده. لطفاً حدود {minutes} دقیقه دیگر دوباره تلاش کنید."
        )
    _rate_limit_store[key] = now
    # پاکسازی کلیدهای قدیمی (جلوگیری از رشد بی‌نهایت حافظه)
    if len(_rate_limit_store) > 2000:
        cutoff = now - RATE_LIMIT_SECONDS
        _rate_limit_store.clear()  # ساده‌ترین روش روی پلن رایگان
        _rate_limit_store[key] = now

# لینک Web App گوگل‌اسکریپت (همون که ربات هم ازش استفاده می‌کنه)
APPS_SCRIPT_URL = os.getenv(
    "APPS_SCRIPT_URL",
    "https://script.google.com/macros/s/AKfycbxLJvAiBpq43s0fL37h2w5ReenrJlj6rxXmpCiXG61A2mfKOA0Yyef3e8t0JPh8V-b_3Q/exec"
)

# همون GID هایی که توی کد ربات هم استفاده شده (تب‌های گوگل‌شیت)
SHEET_GIDS = {
    "فروش": "883906283",
    "رهن و اجاره": "388590955",
}

CACHE_TTL_SECONDS = 120

DATABASE_URL = os.getenv("DATABASE_URL", "sqlite:///./local.db")
if DATABASE_URL.startswith("postgres://"):
    DATABASE_URL = DATABASE_URL.replace("postgres://", "postgresql://", 1)
# Supabase معمولاً به SSL نیاز دارد
if "supabase" in DATABASE_URL and "sslmode" not in DATABASE_URL:
    DATABASE_URL += ("&" if "?" in DATABASE_URL else "?") + "sslmode=require"
connect_args = {"check_same_thread": False} if DATABASE_URL.startswith("sqlite") else {}
engine = create_engine(DATABASE_URL, connect_args=connect_args)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()


# --------------------------------------------------------------------------- #
# مدل دیتابیس — فقط برای لیدهای سایت
# --------------------------------------------------------------------------- #

class Lead(Base):
    __tablename__ = "leads"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, nullable=False)
    phone = Column(String, nullable=False)
    message = Column(Text, default="")
    source = Column(String, default="website")
    created_at = Column(DateTime, default=datetime.utcnow)


Base.metadata.create_all(bind=engine)


class LeadIn(BaseModel):
    name: str
    phone: str
    message: str = ""
    source: str = "website"


class LeadOut(LeadIn):
    id: int
    created_at: datetime

    class Config:
        from_attributes = True


class PendingPropertyIn(BaseModel):
    deal_type: str
    property_type: str
    address: str
    area_m2: str = ""
    rooms: str = ""
    price_info: str
    parking: bool = False
    elevator: bool = False
    storage: bool = False
    description: str = ""
    submitter_name: str
    submitter_phone: str
    is_agent: bool = False
    agent_name: str = ""
    source: str = "website"


# --------------------------------------------------------------------------- #
# خواندن آگهی‌ها از گوگل‌شیت (همون روش ربات) + کش ساده
# --------------------------------------------------------------------------- #

_sheet_cache: dict[str, tuple[float, list[dict]]] = {}


async def fetch_sheet_records(deal_type: str) -> list[dict]:
    now = time.time()
    cached = _sheet_cache.get(deal_type)
    if cached and (now - cached[0] < CACHE_TTL_SECONDS):
        return cached[1]

    if not SPREADSHEET_ID:
        return []

    gid = SHEET_GIDS.get(deal_type)
    if not gid:
        return []

    url = f"https://docs.google.com/spreadsheets/d/{SPREADSHEET_ID}/gviz/tq?tqx=out:csv&gid={gid}"

    try:
        async with httpx.AsyncClient(timeout=10, follow_redirects=True) as client:
            response = await client.get(url)
        if response.status_code != 200:
            return cached[1] if cached else []

        f = StringIO(response.text)
        reader = csv.DictReader(f)
        rows = [row for row in reader if any((v or "").strip() for v in row.values())]
        active_rows = [
            row for row in rows
            if (row.get("وضعیت") or "فعال").strip() not in ("لغو شده", "حذف شده", "غیرفعال")
        ]
        _sheet_cache[deal_type] = (now, active_rows)
        return active_rows
    except Exception:
        return cached[1] if cached else []


def row_to_property(row: dict, deal_type: str) -> dict:
    """یک ردیف خام گوگل‌شیت را به فرمت ساده‌ای برای نمایش در سایت تبدیل می‌کند."""
    import re
    raw_addr = (row.get("آدرس") or "").strip()
    m = re.search(r"^(.*?لاله\s*[\d۰-۹]+\s*(?:اصلی|غربی|شرقی)?)", raw_addr)
    short_addr = m.group(1).strip() if m else (raw_addr[:40] + "…" if len(raw_addr) > 40 else raw_addr)

    result = {
        "code": row.get("کد", ""),
        "deal_type": deal_type,
        "property_type": row.get("نوع ملک", ""),
        "address": short_addr,
        "area_m2": row.get("متراژ", ""),
        "rooms": row.get("خواب", ""),
        "floor": (row.get("طبقه") or "").strip(),
        "parking": (row.get("پارکینگ") or "").strip() == "دارد",
        "elevator": (row.get("آسانسور") or "").strip() == "دارد",
        "storage": (row.get("انباری") or "").strip() == "دارد",
        "agent_name": (row.get("مشاور") or "").strip(),
        # اطلاعات شخصی (شماره / مالک / مشتری) عمداً حذف شده
    }
    if deal_type == "فروش":
        result["price_total"] = row.get("قیمت کل", "") or "توافقی"
    else:
        result["rahn"] = row.get("رهن", "") or "-"
        result["ejare"] = row.get("کرایه", "") or "-"
    return result


# --------------------------------------------------------------------------- #
# اپ FastAPI
# --------------------------------------------------------------------------- #

app = FastAPI(title="Atlas Amlak Website API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.api_route("/", methods=["GET", "HEAD"])
def root():
    return {"status": "ok", "service": "atlas-amlak-website-api"}


@app.api_route("/api/properties", methods=["GET", "HEAD"])
async def list_properties(deal_type: Optional[str] = None):
    deal_types = [deal_type] if deal_type in SHEET_GIDS else list(SHEET_GIDS.keys())
    result: list[dict] = []
    for dt in deal_types:
        rows = await fetch_sheet_records(dt)
        result.extend(row_to_property(r, dt) for r in rows)
    return result


@app.post("/api/leads", response_model=LeadOut)
async def create_lead(item: LeadIn):
    check_rate_limit(item.phone)
    db = SessionLocal()
    try:
        data = item.model_dump() if hasattr(item, "model_dump") else item.dict()
        obj = Lead(**data)
        db.add(obj)
        db.commit()
        db.refresh(obj)

        return obj
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=f"خطا در ذخیره لید: {str(e)}")
    finally:
        db.close()


@app.get("/api/leads", response_model=List[LeadOut])
def list_leads(x_api_key: Optional[str] = Header(None)):
    if x_api_key != API_KEY:
        raise HTTPException(status_code=401, detail="Invalid API key")
    db = SessionLocal()
    result = db.query(Lead).order_by(Lead.created_at.desc()).all()
    db.close()
    return result


@app.post("/api/pending-properties")
async def create_pending_property(item: PendingPropertyIn):
    """
    فایل ثبت‌شده از فرم سایت را مستقیم به تب «در انتظار تایید»
    گوگل‌شیت می‌فرستد (از طریق Apps Script Web App).
    """
    check_rate_limit(item.submitter_phone)
    # ساخت شناسه یکتا
    pending_id = f"web-{int(time.time())}-{uuid.uuid4().hex[:6]}"

    # امکانات به صورت متن فارسی
    extras = []
    if item.parking:
        extras.append("پارکینگ")
    if item.elevator:
        extras.append("آسانسور")
    if item.storage:
        extras.append("انباری")
    extras_text = "، ".join(extras) if extras else "ندارد"

    # متن خوانا برای ستون «فیلدها» (نه JSON) تا در شیت قاطی و چندستونه نشود
    fields_json = (
        f"آدرس: {item.address}\n"
        f"متراژ: {item.area_m2 or '-'}\n"
        f"خواب: {item.rooms or '-'}\n"
        f"قیمت: {item.price_info}\n"
        f"امکانات: {extras_text}\n"
        f"توضیحات: {item.description or '-'}\n"
        f"شماره تماس: {item.submitter_phone}\n"
        f"منبع: سایت"
    )

    # تاریخ (فرمت ساده؛ ربات می‌تونه شمسی‌ش کنه)
    now_str = datetime.now().strftime("%Y/%m/%d %H:%M")

    payload = {
        "action": "save_pending",
        "pending_id": pending_id,
        "deal_type": item.deal_type,
        "property_type": item.property_type,
        "fields_json": fields_json,
        "owner_chat_id": "",
        "owner_username": "",
        "owner_full_name": item.submitter_name,
        "advisor_name": item.agent_name if item.is_agent else "",
        "advisor_phone": item.submitter_phone if item.is_agent else item.submitter_phone,
        "date": now_str,
    }

    try:
        async with httpx.AsyncClient(timeout=20, follow_redirects=True) as client:
            resp = await client.post(APPS_SCRIPT_URL, json=payload)

        if resp.status_code >= 400:
            raise HTTPException(
                status_code=502,
                detail=f"Apps Script error: {resp.status_code} - {resp.text[:200]}"
            )

        try:
            result = resp.json()
        except Exception:
            result = {"status": "ok", "raw": resp.text[:200]}

        if isinstance(result, dict) and result.get("status") == "error":
            raise HTTPException(status_code=502, detail=result.get("message", "Apps Script returned error"))

        return {
            "ok": True,
            "pending_id": pending_id,
            "message": "فایل با موفقیت در تب «در انتظار تایید» ثبت شد"
        }

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"خطا در ارتباط با گوگل‌شیت: {str(e)}")
