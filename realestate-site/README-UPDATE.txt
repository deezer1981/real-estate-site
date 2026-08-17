به‌روزرسانی کامل — اطلس املاک (استاتیک روی GitHub Pages)
=====================================================

کپی کنید:
  frontend/*       →  realestate-site/frontend/
  backend/main.py  →  realestate-site/backend/main.py  (اختیاری؛ اگر دیگر از Render استفاده نمی‌کنید لازم نیست)

تغییرات:
1) قطع کامل Render/API
   - دیگر fetch به api.atlas-amlak.ir زده نمی‌شود
   - آگهی‌ها فقط از snapshot داخل index.html (__PRELOADED_PROPERTIES__)
   - به‌روزرسانی آگهی‌ها همان GitHub Action ساعتی (update-snapshot.yml)

2) دیزاین
   - فقط بله + واتساپ + تماس (بدون روبیکا/تلگرام)
   - فوتر کامل‌تر
   - تب پایین: جستجو به‌جای خانه
   - متن کارت خواناتر + لوگو با کنتراست بهتر
   - اسکلتون/empty state

3) سرعت
   - فونت سبک‌تر
   - lazy برای عکس صفحات داخلی
   - بدون درخواست API روی هر بازدید

بعد از کپی: commit + push تا GitHub Pages آپدیت شود.
سرویس Render را می‌توانید از داشبورد خاموش/حذف کنید.
