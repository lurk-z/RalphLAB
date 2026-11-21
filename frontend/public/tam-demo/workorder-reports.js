// Tam · LINE commands for the work order demo.
"use strict";

(() => {
  const bangkokDay = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Bangkok", year: "numeric", month: "2-digit", day: "2-digit"
  });
  const states = {
    awaiting_approval: { label: "รอหัวหน้าอนุมัติ", advice: "หัวหน้าโครงการควรตรวจใบงานก่อนดำเนินการต่อ" },
    approved: { label: "อนุมัติแล้ว", advice: "ตรวจผลอนุมัติก่อนส่งต่องาน" },
    rejected: { label: "ไม่อนุมัติ", advice: "ทบทวนรายละเอียดกับหัวหน้าโครงการก่อนเสนอใหม่" }
  };
  const sampleBrief = "เปรียบเทียบ Aqua และ Glycerin จาก V1 เป็น V2-A";
  const day = at => bangkokDay.format(new Date(at));

  function makeOrder(alias, id, at) {
    return { alias, id, project_id: 2, request: { brief: sampleBrief }, state: "awaiting_approval",
      events: [{ at, message: "ส่งใบงานให้หัวหน้าอนุมัติ" }] };
  }

  function caseReply(order) {
    const last = order.events[order.events.length - 1];
    return [order.alias + " · " + states[order.state].label, order.request.brief,
      "ล่าสุด: " + last.message, "คำแนะนำ: " + states[order.state].advice].join("\n");
  }

  function dailyReply(orders, now) {
    const today = day(now);
    const active = orders.filter(o => o.events.some(e => day(e.at) === today));
    const pending = active.filter(o => o.state === "awaiting_approval").map(o => o.alias);
    return ["สรุปวันนี้ " + today + " (เวลาไทย)", "ใบงานที่มีความเคลื่อนไหว " + active.length + " รายการ",
      ...active.map(o => o.alias + " · " + states[o.state].label),
      ...(pending.length ? ["ควรติดตาม: " + pending.join(", ") + " รอหัวหน้าอนุมัติ"] : [])].join("\n");
  }

  function report(input, orders, defaultAlias, now = new Date()) {
    const command = input.trim();
    if (command === "คำสั่ง") return [
      "คำสั่งที่ใช้ได้",
      "ดูเคส — ดูรายการเคสและสถานะ",
      "ดูเคส " + defaultAlias + " — ค้นหาด้วยรหัส",
      "สรุปวันนี้ — ดูความเคลื่อนไหววันนี้",
    ].join("\n");
    if (command === "สรุปวันนี้") return dailyReply(orders, now);
    if (command === "ดูเคส") {
      if (!orders.length) return "ตอนนี้ยังไม่มีเคส";
      return [
        "เคสทั้งหมด " + orders.length + " รายการ",
        ...orders.map(o => o.alias + " · " + states[o.state].label + " · " + o.request.brief),
        "เปิดรายละเอียด เช่น ดูเคส " + orders[0].alias,
      ].join("\n");
    }
    const match = /^ดูเคส\s+(.+)$/u.exec(command);
    if (!match) return "พิมพ์ คำสั่ง เพื่อดูเมนู";
    const query = match[1];
    const key = query.toLowerCase();
    const order = orders.find(o => o.id.toLowerCase() === key || o.alias.toLowerCase() === key);
    return order ? caseReply(order) : "ไม่พบเคส " + query.slice(0, 180) + " ในข้อมูลสาธิต";
  }

  const exampleId = "3c50b68c-785c-49ee-9600-a43fb924cc7c";
  const reports = { exampleId, makeOrder, caseReply, report, states };
  if (typeof module === "object" && module.exports) module.exports = reports;
  else globalThis.RalphLabReports = reports;
})();
