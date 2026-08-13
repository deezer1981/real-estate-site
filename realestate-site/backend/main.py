"""
Atlas Amlak — Website API
==========================
این بک‌اند به دو منبع داده وصل است:

1) گوگل‌شیت املاک (همون شیتی که ربات تلگرام "اطلس" هم ازش می‌خونه) — فقط خواندن.
   هیچ تغییری روی کد یا رفتار ربات ایجاد نمی‌کند.
2) دیتابیس Postgres (Supabase) — برای ذخیره‌ی درخواست‌های تماس (لید) و فایل‌های در انتظار تایید از سایت.

متغیرهای محیطی لازم:
- SPREADSHEET_ID   -> همون مقداری که در Environment سرویس ربات روی Render ست شده
- DATABASE_URL     -> آدرس Postgres (Supabase)
- API_KEY          -> رمز دلخواه برای مشاهده‌ی لیدها و فایل‌های pending
"""

import csv
import os
import time
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
# مدل دیتابیس — لیدها + فایل‌های در انتظار تایید
# --------------------------------------------------------------------------- #

class Lead(Base):
    __tablename__ = "leads"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, nullable=False)
    phone = Column(String, nullable=False)
    message = Column(Text, default="")
    property_code = Column(String, nullable=True)  # کد آگهی مرتبط
    source = Column(String, default="website")
    created_at = Column(DateTime, default=datetime.utcnow)


class PendingProperty(Base):
    __tablename__ = "pending_properties"

    id = Column(Integer, primary_key=True, index=True)
    deal_type = Column(String, nullable=False)
    property_type = Column(String, nullable=False)
    address = Column(String, nullable=False)
    area_m2 = Column(String, default="")
    rooms = Column(String, default="")
    price_info = Column(String, nullable=False)
    parking = Column(Integer, default=0)  # 0 یا 1
    elevator = Column(Integer, default=0)
    storage = Column(Integer, default=0)
    description = Column(Text, default="")
    submitter_name = Column(String, nullable=False)
    submitter_phone = Column(String, nullable=False)
    is_agent = Column(Integer, default=0)
    agent_name = Column(String, default="")
    source = Column(String, default="website")
    status = Column(String, default="pending")  # pending / approved / rejected
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


# اضافه کردن متد HEAD برای پاسخگویی به UptimeRobot در صفحه اصلی
@app.api_route("/", methods=["GET", "HEAD"])
def root():
    return {"status": "ok", "service": "atlas-amlak-website-api"}


# اضافه کردن متد HEAD برای لیست آگهی‌ها
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
def create_pending_property(item: PendingPropertyIn):
    db = SessionLocal()
    obj = PendingProperty(
        deal_type=item.deal_type,
        property_type=item.property_type,
        address=item.address,
        area_m2=item.area_m2,
        rooms=item.rooms,
        price_info=item.price_info,
        parking=1 if item.parking else 0,
        elevator=1 if item.elevator else 0,
        storage=1 if item.storage else 0,
        description=item.description,
        submitter_name=item.submitter_name,
        submitter_phone=item.submitter_phone,
        is_agent=1 if item.is_agent else 0,
        agent_name=item.agent_name,
        source=item.source,
        status="pending"
    )
    db.add(obj)
    db.commit()
    db.refresh(obj)
    db.close()
    return {"ok": True, "id": obj.id, "message": "فایل با موفقیت ثبت شد و در انتظار بررسی است"}


@app.get("/api/pending-properties")
def list_pending_properties(x_api_key: Optional[str] = Header(None)):
    if x_api_key != API_KEY:
        raise HTTPException(status_code=401, detail="Invalid API key")
    db = SessionLocal()
    result = db.query(PendingProperty).filter(PendingProperty.status == "pending").order_by(PendingProperty.created_at.desc()).all()
    db.close()
    # تبدیل به دیکشنری ساده برای خروجی
    return [
        {
            "id": r.id,
            "deal_type": r.deal_type,
            "property_type": r.property_type,
            "address": r.address,
            "area_m2": r.area_m2,
            "rooms": r.rooms,
            "price_info": r.price_info,
            "parking": bool(r.parking),
            "elevator": bool(r.elevator),
            "storage": bool(r.storage),
            "description": r.description,
            "submitter_name": r.submitter_name,
            "submitter_phone": r.submitter_phone,
            "is_agent": bool(r.is_agent),
            "agent_name": r.agent_name,
            "source": r.source,
            "status": r.status,
            "created_at": r.created_at.isoformat() if r.created_at else None,
        }
        for r in result
    ]
