# RalphLAB

พื้นที่พัฒนาของทีม RalphLAB เริ่มจากไฟล์ทั้งหมดของ [RalphGuard / jay-frontend ที่ commit 9218cb59](https://github.com/lurk-z/ralphguard/commit/9218cb59ed015be95587e055521bdad04d0e1714) ประวัติของ repo นี้เริ่มที่ snapshot ดังกล่าว ตามด้วยการตั้งค่าสำหรับทีมและการพัก QSAR

## เริ่มพัฒนา

### เดโมเคสอินซูลินบนสาขา GOD

ทีมวิจัยใช้โต๊ะ 3D เทียบผิวสัมผัสระหว่างโมเลกุลของอินซูลินสองชนิด แล้วอ่านผลที่วัดในคนจากใบงานเดียวกัน เมื่อรันระบบแล้ว เปิด [ห้องแล็บในเครื่อง](http://localhost:3000/lab-room?table=protein) เลือก **เปรียบเทียบอินซูลินปกติกับ lispro** แล้วกด **เริ่มวิเคราะห์หลักฐาน** ดูการส่งงานสี่บทบาท จากนั้นเปิดใบงานเพื่อทบทวนแหล่งอ้างอิงและลงเหตุผลอนุมัติ

โค้ดตั้งต้นมาจาก RalphGuard ตามลิงก์ด้านบน และเทมเพลต UI มาจาก [RalphLab-components ของทีม](https://github.com/ThanakhonOonklan/RalphLAB/tree/ac502d7c1a9a42c0926091e48b3443b02652c26a/RalphLab-components) ส่วนที่สร้างเพิ่มสำหรับเคสนี้ในงานวันที่ 21 พฤศจิกายน 2026 คือการเทียบพิกัดและจุดสัมผัสบนโต๊ะ กราฟผลการศึกษาในคน และประวัติการส่งหลักฐานให้ผู้ทบทวน ทีมใช้ Codex พัฒนา API และฉาก ทดสอบพิกัดเทียบกับต้นฉบับ และทดสอบเส้นทางรับโจทย์จนถึงรายงาน

ใช้โครงสร้างและผลทดลองที่ตีพิมพ์แล้วเป็นข้อมูลต้นทาง [อินซูลินปกติ 1TRZ](https://www.rcsb.org/structure/1TRZ) · [lispro 1LPH](https://www.rcsb.org/structure/1LPH) · [การศึกษาในคนของ Howey และคณะ](https://pubmed.ncbi.nlm.nih.gov/8314011/)

### ตั้งค่าในเครื่อง

ใช้ Git, Node.js 20 ขึ้นไป และ Docker Compose v2 ตัวอย่างด้านล่างใช้ PowerShell

```powershell
git clone https://github.com/lurk-z/RalphLAB.git
cd RalphLAB
Copy-Item .env.example .env
```

เปิด `.env` ที่รากโปรเจกต์ แล้วตั้ง `AUTH_SECRET` และ `NEXTAUTH_SECRET` เป็นค่าสุ่มยาว **ค่าเดียวกัน** สำหรับลงนามเซสชันทั้งสองโหมด

- `LOGIN_ENABLED=false` เปิด Studio และ Lab ทันที โปรเจกต์ผู้เยี่ยมชมผูกกับคุกกี้ของเบราว์เซอร์นั้น
- `LOGIN_ENABLED=true` เป็นค่าเริ่มต้น เข้าสู่ระบบด้วย Google แล้วสร้างหรือเลือกโปรเจกต์เพื่อเข้าห้องแล็ป ตั้ง `GOOGLE_CLIENT_ID` และ `GOOGLE_CLIENT_SECRET` ตาม [คู่มือตั้งค่าสำหรับแอปและ Cloud](docs/GOOGLE_LOGIN_SETUP.md)

หลังเปลี่ยนโหมด ให้เริ่ม Next.js ใหม่และรัน `docker compose up -d backend` หากใช้ production ให้ตั้ง `LOGIN_ENABLED` ให้ตรงกันทั้ง frontend และ backend แล้ว build frontend ใหม่ ระบบที่ไม่ได้กำหนดค่านี้จะใช้โหมดล็อกอิน

แชต AI ใน Lab และผู้ช่วยใช้ `GROQ_API_KEY` กับ `GROQ_MODEL` เป็นหลัก ตั้ง `OPENAI_API_KEY` เพื่อให้ระบบใช้ `OPENAI_MODEL` อัตโนมัติเมื่อ Groq ใช้งานไม่ได้หรือยังไม่ได้ตั้งค่า ค่าโมเดลเริ่มต้นของ OpenAI คือ `gpt-5.4-mini` เก็บคีย์ไว้ที่ `.env` รากโปรเจกต์หรือใน environment ของ backend แล้วรัน `docker compose up -d backend` เพื่อโหลดค่าใหม่

```powershell
# Next.js อ่านค่าจาก frontend/.env.local ซึ่ง Git ไม่ติดตาม
Get-Content .env | Select-String '^(NEXT_PUBLIC_API_URL|NEXTAUTH_URL|NEXTAUTH_SECRET|GOOGLE_CLIENT_ID|GOOGLE_CLIENT_SECRET)=' | ForEach-Object { $_.Line } | Set-Content -Encoding ascii frontend/.env.local
docker compose up --build -d
cd frontend
npm ci
npm run dev
```

เปิดเว็บที่ `http://localhost:3000` และ API ที่ `http://localhost:8000/docs` สำหรับงานหน้า landing page สามารถเริ่มจาก `cd frontend`, `npm ci` และ `npm run dev` ได้ทันที ส่วนการบันทึกโปรเจกต์ใน Studio ใช้ backend

## การทำงานร่วมกัน

### ใบงานของ Agent

เปิด `/lab-room/orders` หรือกด **ใบงาน Agent** ในห้องแล็บ เลือกโครงการ กด **สร้างใบงาน** แล้วนำสูตรจาก Studio มาเทียบสองรุ่น หรือกด **ใช้ตัวอย่าง Aqua และ Glycerin** เพื่อทดลอง บันทึกสัดส่วนเป็นเปอร์เซ็นต์โดยน้ำหนักให้รวม 100 ในแต่ละรุ่น

หัวหน้าแล็บตรวจคำขอด้วย Pydantic นักวิจัยค้นทะเบียนสารและหลักฐานที่ตรวจทานแล้ว พร้อมเก็บหมายเลขระเบียนและแหล่งอ้างอิง นักพัฒนาสูตรเปรียบเทียบสัดส่วนด้วย Decimal และระบุสารที่ล็อก นักวิเคราะห์ใช้ RDKit ตรวจการอ่านโครงสร้าง ผู้ประเมินส่งรุ่นที่ผ่านการตรวจเอกสารให้เจ้าของโครงการอนุมัติ ทั้งห้าบทบาทบันทึกการส่งงานใน PostgreSQL เจ้าของเลือกส่งหลักฐานของบทบาทที่ต้องการให้ Groq ช่วยสรุปได้จากหน้าใบงาน

เมื่อหลักฐานขาดหรือขัดแย้ง ใบงานจะพักไว้ เจ้าของตรวจใหม่ได้หลังปรับปรุงทะเบียน หรือปฏิเสธพร้อมเหตุผล การอนุมัติครอบคลุมเฉพาะสำเนาสูตรรุ่นที่แสดงในใบงาน ส่วนการประเมิน QSAR ยังคงขึ้นกับการตั้งค่าของระบบ โครงการที่แชร์สิทธิ์อ่านให้สมาชิกด้วยอีเมล Google จะแสดงในรายการใบงานของสมาชิกหลังล็อกอิน สมาชิกอ่านได้เฉพาะใบงานของโครงการนั้น

**ทดสอบในเครื่องโดยยังไม่มี OAuth** เพิ่ม `LAB_LOCAL_WORK_ORDERS=1` ใน `frontend/.env.local` เว้น `GOOGLE_CLIENT_ID` ว่าง และตั้ง `NEXTAUTH_URL=http://localhost:3000` ใช้ `npm run dev` และเลือก **เริ่มเซสชันทดสอบ** ระบบสร้างเจ้าของโครงการสำหรับเซสชันนั้น การออกจากระบบแล้วเริ่มเซสชันใหม่จะได้เจ้าของคนใหม่ การใช้งานร่วมกันระยะยาวให้เข้าสู่ระบบด้วย Google

- **main** เป็นฐานรวมงาน เปิด pull request เข้าสาขานี้และดูผล CI ก่อนรวมงาน
- **GOD** เป็นสาขาของหัวหน้าทีม รับผิดชอบงานส่วนที่ 1 ได้แก่ ระบบ Agent กฎส่งใบงานระหว่างบทบาท จุดรออนุมัติ และการเชื่อม QSAR ในภายหลัง ใช้ `git switch GOD` หลัง clone
- สมาชิกที่มีสิทธิ์เขียนสร้างสาขาจาก main ด้วย `git switch -c feature/<ชื่องาน> origin/main` แล้ว `git push -u origin HEAD` สมาชิกทั่วไปให้ **Fork** ก่อน แล้ว clone จาก fork ของตัวเอง สร้างและ push สาขาไปที่ fork จากนั้นเปิด pull request ไปยัง `lurk-z/RalphLAB:main`

## สถานะ QSAR

ค่าเริ่มต้นคือ `ASSESSMENT_EXECUTION_MODE=disabled` ในโหมดนี้ Compose เริ่มเฉพาะ PostgreSQL และ API หน้า Studio และ Node Graph อ่านสถานะจาก `GET /api/assessments/availability` ปุ่มประเมินแสดงว่าปิดอยู่ การส่งงานใหม่เข้า API ได้ HTTP 503 ก่อนสร้าง job ลงฐานข้อมูลหรือเข้าคิว ทีมยังแก้สูตรและเปิดผลเก่าที่มีสิทธิ์อ่านได้

เมื่อต้องการทดสอบ QSAR ในเครื่อง ให้เปลี่ยนค่าใน `.env` เป็น `ASSESSMENT_EXECUTION_MODE=queue` แล้วใช้ `docker compose --profile qsar up --build -d` และรีเฟรช Studio เมื่อทดสอบเสร็จใช้ `docker compose --profile qsar stop worker redis` ตั้งค่ากลับเป็น `disabled` แล้ว `docker compose up -d` เพื่ออัปเดต backend

ตรวจบริการเริ่มต้นด้วย `docker compose config --services` และตรวจ TypeScript ใน `frontend` ด้วย `npm run type-check` โครงสร้างเดิมและรายละเอียดโมเดลอยู่ใน [คู่มือ RalphGuard](docs/RALPHGUARD-README.md)
