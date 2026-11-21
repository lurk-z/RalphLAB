# Tam · ทดสอบ RalphLAB จากแชต LINE บนมือถือ

บอตจะตอบด้วยใบงานตัวอย่าง `WO-001` ที่สร้างตอนเปิดเซิร์ฟเวอร์ ใช้คำสั่ง `สรุปวันนี้` หรือ `ดูเคส WO-001` ได้จากแอป LINE ข้อมูลใบงานที่แก้ในเดโม HTML เก็บแยกในเบราว์เซอร์

1. เปิด LINE Developers Console เลือก provider และ Messaging API channel ของบัญชีทดสอบ ใน **Basic settings → Channel secret** ใช้ค่าใหม่หากค่าเดิมถูกเปิดเผย ใน **Messaging API → Channel access token** กด **Issue** เพื่อรับ token เก็บทั้งสองค่าไว้ใช้บนเครื่องที่รันบอต
2. ดาวน์โหลด [ZIP ของสาขา Tam](https://github.com/lurk-z/RalphLAB/archive/refs/heads/feature/tam-line-telegram-demo.zip) แล้วแตกไฟล์ทั้งโฟลเดอร์ หรือใช้ checkout ของสาขานี้ บน Windows ที่มี Node.js 20 ขึ้นไป เปิด `integrations\line-demo\start.cmd` แล้วกรอกสองค่าในหน้าต่างที่เปิดขึ้น โปรแกรมซ่อนค่าที่พิมพ์และใช้เฉพาะระหว่างที่เซิร์ฟเวอร์ทำงาน เปิดหน้าต่างนี้ค้างไว้
3. เปิด PowerShell อีกหน้าต่างหนึ่ง หากยังไม่มี cloudflared ให้ติดตั้งด้วย `winget install --id Cloudflare.cloudflared --exact` แล้วเปิด PowerShell ใหม่ รัน `cloudflared tunnel --url http://127.0.0.1:8787` และเปิดหน้าต่างนี้ค้างไว้
4. คัดลอก URL ที่ลงท้ายด้วย `.trycloudflare.com` จากหน้าต่างที่สอง เติม `/line/webhook` แล้ววางใน **Messaging API → Webhook URL** กด **Verify** ให้ขึ้น **Success** แล้วเปิด **Use webhook** เมื่อเปิด tunnel ใหม่ให้ใช้ URL ใหม่
5. สแกน QR code ในแท็บ Messaging API เพื่อเพิ่ม OA เป็นเพื่อน ส่ง `ดูเคส WO-001` ใน LINE ควรได้รับคำตอบที่ขึ้นต้นด้วย **RalphLAB · ข้อมูลสาธิต** และมีสถานะ **รอหัวหน้าอนุมัติ**

ทดสอบ webhook ในเครื่องโดยใช้ token จำลองได้ด้วย `node --test integrations/line-demo/server.test.mjs` จากโฟลเดอร์หลักของ repo

[คู่มือ LINE](https://developers.line.biz/en/docs/messaging-api/building-bot/) · [คู่มือ Quick Tunnels](https://developers.cloudflare.com/tunnel/get-started/quick-tunnels/)
