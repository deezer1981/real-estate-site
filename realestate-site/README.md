# سایت املاک + اتصال به ربات تلگرام — راهنمای گام‌به‌گام

این پروژه سه بخش داره:
- `backend/` → یک API با پایتون (FastAPI) که آگهی‌ها و درخواست‌های تماس (لید) رو مدیریت می‌کنه
- `frontend/` → خود سایت (HTML/CSS/JS ساده، بدون نیاز به نصب چیزی)
- دیتابیس مشترک که هم سایت هم ربات تلگرامت می‌تونن باهاش کار کنن

مراحل رو دقیقاً به همین ترتیب انجام بده.

---

## مرحله ۱ — ساخت ریپو در گیت‌هاب

1. برو به github.com و اگه اکانت نداری بساز.
2. روی دکمه سبز **New repository** بزن.
3. یک اسم بده (مثلاً `real-estate-site`)، Public بزار، Create repository رو بزن.
4. روی سیستم خودت (یا از همین گفتگو با کمک من) این پوشه رو داخل ریپو push کن:

```bash
cd realestate-site
git init
git add .
git commit -m "Initial commit"
git branch -M main
git remote add origin https://github.com/USERNAME/real-estate-site.git
git push -u origin main
```

⚠️ فایل `.env` رو هیچوقت push نکن (رمزها توشه). فقط `.env.example` باید توی گیت‌هاب باشه.

---

## مرحله ۲ — ساخت دیتابیس رایگان (Supabase)

1. برو به **supabase.com** و با گیت‌هاب ثبت‌نام کن (نیاز به کارت بانکی نداره).
2. **New Project** بزن، یک اسم و رمز عبور دیتابیس انتخاب کن (رمز رو یادداشت کن).
3. بعد از ساخته شدن پروژه، برو به بخش **Project Settings → Database**.
4. مقدار **Connection string** رو با فرمت `URI` کپی کن. یک چیزی شبیه این می‌بینی:
   ```
   postgresql://postgres:[YOUR-PASSWORD]@db.xxxxxx.supabase.co:5432/postgres
   ```
5. جای `[YOUR-PASSWORD]` رمزی که ساختی رو بزار. این می‌شه `DATABASE_URL` تو.

---

## مرحله ۳ — بالا آوردن بک‌اند روی Render

1. برو به **render.com** و با گیت‌هاب ثبت‌نام کن.
2. **New → Web Service** بزن.
3. ریپوی `real-estate-site` رو انتخاب کن.
4. تنظیمات:
   - **Root Directory:** `backend`
   - **Build Command:** `pip install -r requirements.txt`
   - **Start Command:** `uvicorn main:app --host 0.0.0.0 --port $PORT`
   - **Instance Type:** Free
5. برو به بخش **Environment** و این دو متغیر رو اضافه کن:
   - `DATABASE_URL` = همون آدرسی که از Supabase گرفتی
   - `API_KEY` = یک رمز دلخواه طولانی (این برای محافظت از بخش مدیریت آگهی‌هاست)
6. **Create Web Service** بزن و صبر کن دیپلوی تموم بشه.
7. یک آدرس شبیه این بهت میده: `https://real-estate-site.onrender.com` — اینو یادداشت کن.

نکته: پلن رایگان Render بعد از چند دقیقه بی‌کاری «می‌خوابه» و اولین درخواست بعدش چند ثانیه طول می‌کشه تا بیدار بشه. عادیه.

---

## مرحله ۴ — تنظیم و انتشار فرانت‌اند (خود سایت)

1. فایل `frontend/config.js` رو باز کن و این دو خط رو ویرایش کن:
   ```js
   const API_BASE_URL = "https://real-estate-site.onrender.com"; // آدرس مرحله قبل
   const TELEGRAM_BOT_USERNAME = "your_bot_username"; // یوزرنیم ربات بدون @
   ```
2. تغییرات رو کامیت و push کن.
3. برای انتشار سایت، ساده‌ترین راه **GitHub Pages** هست:
   - برو به ریپو → **Settings → Pages**
   - زیر Source، برنچ `main` و پوشه `/frontend` رو انتخاب کن (یا اگه نبود، محتوای `frontend` رو به یک برنچ/پوشه `docs` منتقل کن)
   - Save بزن، بعد چند دقیقه آدرس سایتت آماده‌ست (چیزی شبیه `https://username.github.io/real-estate-site/`)

---

## مرحله ۵ — وصل کردن ربات تلگرام به همون دیتابیس

ربات پایتونی‌ات (python-telegram-bot) باید به همون `DATABASE_URL` وصل بشه تا آگهی‌ها و لیدها مشترک باشن. کافیه از همون کتابخونه SQLAlchemy توی کد ربات استفاده کنی:

```python
import os
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

DATABASE_URL = os.getenv("DATABASE_URL")  # همون مقدار Supabase
engine = create_engine(DATABASE_URL)
SessionLocal = sessionmaker(bind=engine)

# مثال: خوندن لیست آگهی‌ها داخل ربات
from main import Property  # اگه فایل مدل‌ها رو مشترک کنی

def get_properties():
    db = SessionLocal()
    items = db.query(Property).all()
    db.close()
    return items
```

ساده‌ترین کار اینه که فایل `backend/main.py` رو کنار کد ربات هم بزاری (یا مدل‌های `Property`/`Lead` رو توی یک فایل مشترک `models.py` بزاری) تا هر دو از یک تعریف جدول استفاده کنن.

جایی که ربات هاست شده (Render) هم باید همین `DATABASE_URL` رو به عنوان Environment Variable داشته باشه.

---

## مرحله ۶ — تست نهایی

1. سایتت رو باز کن، چک کن آگهی‌ها لود می‌شن (اگه هنوز آگهی ثبت نکردی، خالی نشون میده — طبیعیه).
2. یک آگهی تستی از طریق API اضافه کن (با ابزاری مثل Postman یا curl):
   ```bash
   curl -X POST https://real-estate-site.onrender.com/api/properties \
     -H "Content-Type: application/json" \
     -H "x-api-key: همون-API_KEY-ت" \
     -d '{"title":"آپارتمان ۸۰ متری","price":3500000000,"city":"تهران","district":"سعادت‌آباد","rooms":2,"area_m2":80,"deal_type":"sale"}'
   ```
3. رفرش کن، باید آگهی رو ببینی.
4. دکمه «شروع چت با ربات» رو بزن و مطمئن شو مستقیم به ربات تلگرامت میره.
5. فرم تماس رو پر کن و بفرست، بعد با `x-api-key` بررسی کن که توی `/api/leads` ثبت شده.

---

هر جا هر مرحله گیر کردی (پیغام خطا گرفتی، چیزی درست کار نکرد)، عین همون پیغام یا اسکرین‌شات رو برام بفرست تا دقیق راهنماییت کنم.
