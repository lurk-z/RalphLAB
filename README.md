# RalphLAB

พื้นที่พัฒนาของทีม RalphLAB เริ่มจากไฟล์ทั้งหมดของ [RalphGuard / jay-frontend ที่ commit 9218cb59](https://github.com/lurk-z/ralphguard/commit/9218cb59ed015be95587e055521bdad04d0e1714) ประวัติของ repo นี้เริ่มที่ snapshot ดังกล่าว ตามด้วยการตั้งค่าสำหรับทีมและการพัก QSAR

## เริ่มพัฒนา

ใช้ Git, Node.js 20 ขึ้นไป และ Docker Compose v2 ตัวอย่างด้านล่างใช้ PowerShell

```powershell
git clone https://github.com/lurk-z/RalphLAB.git
cd RalphLAB
Copy-Item .env.example .env
```

เปิด `.env` แล้วตั้ง `AUTH_SECRET` และ `NEXTAUTH_SECRET` เป็นค่าสุ่มยาว **ค่าเดียวกัน** สำหรับเครื่องของคุณ หากต้องการเปิดให้ล็อกอินด้วย Google ให้ตั้ง `GOOGLE_CLIENT_ID` และ `GOOGLE_CLIENT_SECRET` ของ OAuth client ที่อนุญาต callback `http://localhost:3000/api/auth/callback/google` ตั้ง `GROQ_API_KEY` หากต้องการใช้ผู้ช่วยแชต

```powershell
# Next.js อ่านค่าจาก frontend/.env.local ซึ่ง Git ไม่ติดตาม
Get-Content .env | Select-String '^(NEXT_PUBLIC_API_URL|NEXTAUTH_URL|NEXTAUTH_SECRET|GOOGLE_CLIENT_ID|GOOGLE_CLIENT_SECRET)=' | ForEach-Object { $_.Line } | Set-Content -Encoding ascii frontend/.env.local
docker compose up --build -d
cd frontend
npm ci
npm run dev
```

เปิดเว็บที่ `http://localhost:3000` และ API ที่ `http://localhost:8000/docs` สำหรับงานหน้า landing page สามารถเริ่มจาก `cd frontend`, `npm ci` และ `npm run dev` ได้ทันที ส่วน Studio ใช้ backend และเปิดได้โดยไม่ต้องล็อกอิน โปรเจกต์ของผู้เยี่ยมชมผูกกับคุกกี้ในเบราว์เซอร์เดิม

## การทำงานร่วมกัน

- **main** เป็นฐานรวมงาน เปิด pull request เข้าสาขานี้และดูผล CI ก่อนรวมงาน
- **GOD** เป็นสาขาของหัวหน้าทีม รับผิดชอบงานส่วนที่ 1 ได้แก่ ระบบ Agent กฎส่งใบงานระหว่างบทบาท จุดรออนุมัติ และการเชื่อม QSAR ในภายหลัง ใช้ `git switch GOD` หลัง clone
- สมาชิกที่มีสิทธิ์เขียนสร้างสาขาจาก main ด้วย `git switch -c feature/<ชื่องาน> origin/main` แล้ว `git push -u origin HEAD` สมาชิกทั่วไปให้ **Fork** ก่อน แล้ว clone จาก fork ของตัวเอง สร้างและ push สาขาไปที่ fork จากนั้นเปิด pull request ไปยัง `lurk-z/RalphLAB:main`

## สถานะ QSAR

ค่าเริ่มต้นคือ `ASSESSMENT_EXECUTION_MODE=disabled` ในโหมดนี้ Compose เริ่มเฉพาะ PostgreSQL และ API หน้า Studio และ Node Graph อ่านสถานะจาก `GET /api/assessments/availability` ปุ่มประเมินแสดงว่าปิดอยู่ การส่งงานใหม่เข้า API ได้ HTTP 503 ก่อนสร้าง job ลงฐานข้อมูลหรือเข้าคิว ทีมยังแก้สูตรและเปิดผลเก่าที่มีสิทธิ์อ่านได้

เมื่อต้องการทดสอบ QSAR ในเครื่อง ให้เปลี่ยนค่าใน `.env` เป็น `ASSESSMENT_EXECUTION_MODE=queue` แล้วใช้ `docker compose --profile qsar up --build -d` และรีเฟรช Studio เมื่อทดสอบเสร็จใช้ `docker compose --profile qsar stop worker redis` ตั้งค่ากลับเป็น `disabled` แล้ว `docker compose up -d` เพื่ออัปเดต backend

ตรวจบริการเริ่มต้นด้วย `docker compose config --services` และตรวจ TypeScript ใน `frontend` ด้วย `npm run type-check` โครงสร้างเดิมและรายละเอียดโมเดลอยู่ใน [คู่มือ RalphGuard](docs/RALPHGUARD-README.md)
