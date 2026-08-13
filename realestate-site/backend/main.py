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
    property_code = Column(String, nullable=True)
    source = Column(String, default="website")
    created_at = Column(DateTime, default=datetime.utcnow)


Base.metadata.create_all(bind=engine)


class LeadIn(BaseModel):
    name: str
    phone: str
    message: str = ""
    property_code: Optional[str] = None
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
def create_lead(item: LeadIn):
    db = SessionLocal()
    obj = Lead(**item.dict())
    db.add(obj)
    db.commit()
    db.refresh(obj)
    db.close()
    return obj


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
    # ساخت شناسه یکتا
    pending_id = f"web-{int(time.time())}-{uuid.uuid4().hex[:6]}"

    # ساخت آبجکت فیلدها برای ذخیره در ستون «فیلدها» (JSON)
    fields = {
        "address": item.address,
        "area_m2": item.area_m2,
        "rooms": item.rooms,
        "price_info": item.price_info,
        "parking": item.parking,
        "elevator": item.elevator,
        "storage": item.storage,
        "description": item.description,
        "submitter_phone": item.submitter_phone,
        "source": item.source or "website",
    }
    fields_json = json.dumps(fields, ensure_ascii=False)

    # تاریخ ساده
    now_str = datetime.now().strftime("%Y-%m-%d %H:%M")

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
        "advisor_phone": item.submitter_phone if item.is_agent else "",
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
