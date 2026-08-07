import os
from datetime import datetime
from typing import Optional, List

from fastapi import FastAPI, HTTPException, Header
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from sqlalchemy import create_engine, Column, Integer, String, Float, DateTime, Text
from sqlalchemy.orm import declarative_base, sessionmaker

# ---------------------------------------------------------------------------
# Database setup
# ---------------------------------------------------------------------------
# DATABASE_URL comes from an environment variable (set on Render / locally in .env)
# Example (Supabase/Postgres): postgresql://user:pass@host:5432/dbname
# For local testing without a real DB, it falls back to a SQLite file.
DATABASE_URL = os.getenv("DATABASE_URL", "sqlite:///./local.db")

# Render/Supabase sometimes give "postgres://" — SQLAlchemy needs "postgresql://"
if DATABASE_URL.startswith("postgres://"):
    DATABASE_URL = DATABASE_URL.replace("postgres://", "postgresql://", 1)

connect_args = {"check_same_thread": False} if DATABASE_URL.startswith("sqlite") else {}
engine = create_engine(DATABASE_URL, connect_args=connect_args)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()

# A simple shared secret so only your bot / admin panel can create or delete data.
# Set this in your environment too (Render dashboard + wherever your bot runs).
API_KEY = os.getenv("API_KEY", "change-me")


# ---------------------------------------------------------------------------
# Models (tables)
# ---------------------------------------------------------------------------
class Property(Base):
    __tablename__ = "properties"

    id = Column(Integer, primary_key=True, index=True)
    title = Column(String, nullable=False)
    description = Column(Text, default="")
    price = Column(Float, default=0)
    area_m2 = Column(Float, default=0)
    rooms = Column(Integer, default=0)
    city = Column(String, default="")
    district = Column(String, default="")
    deal_type = Column(String, default="sale")  # sale | rent
    image_url = Column(String, default="")
    created_at = Column(DateTime, default=datetime.utcnow)


class Lead(Base):
    __tablename__ = "leads"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, nullable=False)
    phone = Column(String, nullable=False)
    message = Column(Text, default="")
    property_id = Column(Integer, nullable=True)
    source = Column(String, default="website")  # website | bot
    created_at = Column(DateTime, default=datetime.utcnow)


Base.metadata.create_all(bind=engine)


# ---------------------------------------------------------------------------
# Pydantic schemas (what the API accepts / returns)
# ---------------------------------------------------------------------------
class PropertyIn(BaseModel):
    title: str
    description: str = ""
    price: float = 0
    area_m2: float = 0
    rooms: int = 0
    city: str = ""
    district: str = ""
    deal_type: str = "sale"
    image_url: str = ""


class PropertyOut(PropertyIn):
    id: int
    created_at: datetime

    class Config:
        from_attributes = True


class LeadIn(BaseModel):
    name: str
    phone: str
    message: str = ""
    property_id: Optional[int] = None
    source: str = "website"


class LeadOut(LeadIn):
    id: int
    created_at: datetime

    class Config:
        from_attributes = True


# ---------------------------------------------------------------------------
# App
# ---------------------------------------------------------------------------
app = FastAPI(title="Real Estate API")

# Allow your website (any origin, for simplicity) to call this API.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def check_key(x_api_key: Optional[str]):
    if x_api_key != API_KEY:
        raise HTTPException(status_code=401, detail="Invalid API key")


@app.get("/")
def root():
    return {"status": "ok", "service": "real-estate-api"}


@app.get("/api/properties", response_model=List[PropertyOut])
def list_properties(city: Optional[str] = None, deal_type: Optional[str] = None):
    db = SessionLocal()
    q = db.query(Property)
    if city:
        q = q.filter(Property.city == city)
    if deal_type:
        q = q.filter(Property.deal_type == deal_type)
    result = q.order_by(Property.created_at.desc()).all()
    db.close()
    return result


@app.post("/api/properties", response_model=PropertyOut)
def create_property(item: PropertyIn, x_api_key: Optional[str] = Header(None)):
    check_key(x_api_key)
    db = SessionLocal()
    obj = Property(**item.dict())
    db.add(obj)
    db.commit()
    db.refresh(obj)
    db.close()
    return obj


@app.delete("/api/properties/{property_id}")
def delete_property(property_id: int, x_api_key: Optional[str] = Header(None)):
    check_key(x_api_key)
    db = SessionLocal()
    obj = db.query(Property).filter(Property.id == property_id).first()
    if not obj:
        db.close()
        raise HTTPException(status_code=404, detail="Not found")
    db.delete(obj)
    db.commit()
    db.close()
    return {"status": "deleted"}


@app.post("/api/leads", response_model=LeadOut)
def create_lead(item: LeadIn):
    # No API key needed here — anyone on the website should be able to send a lead.
    db = SessionLocal()
    obj = Lead(**item.dict())
    db.add(obj)
    db.commit()
    db.refresh(obj)
    db.close()
    return obj


@app.get("/api/leads", response_model=List[LeadOut])
def list_leads(x_api_key: Optional[str] = Header(None)):
    # Protected — only you (or your bot) should see the leads.
    check_key(x_api_key)
    db = SessionLocal()
    result = db.query(Lead).order_by(Lead.created_at.desc()).all()
    db.close()
    return result
