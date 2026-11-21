// Tam · LINE commands for the work order demo.
"use strict";

(() => {
  const bangkokDay = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Bangkok", year: "numeric", month: "2-digit", day: "2-digit"
  });
  const bangkokTime = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Bangkok", hour: "2-digit", minute: "2-digit"
  });
  const states = {
    awaiting_approval: { label: "รอหัวหน้าอนุมัติ", advice: "หัวหน้าโครงการควรตรวจใบงานก่อนดำเนินการต่อ" },
    approved: { label: "อนุมัติแล้ว", advice: "ตรวจผลอนุมัติก่อนส่งต่องาน" },
    rejected: { label: "ไม่อนุมัติ", advice: "ทบทวนรายละเอียดกับหัวหน้าโครงการก่อนเสนอใหม่" }
  };
  const sampleBrief = "เปรียบเทียบ Aqua และ Glycerin จาก V1 เป็น V2-A";
  const day = at => bangkokDay.format(new Date(at));

  function makeOrder(alias, id, at, brief = sampleBrief) {
    return { alias, id, project_id: 2, request: { brief }, state: "awaiting_approval",
      events: [{ at, message: "ส่งใบงานให้หัวหน้าอนุมัติ" }] };
  }

  function makeDemoOrders(at) {
    const pending = makeOrder("WO-001", exampleId, at);
    const now = Date.parse(at);
    const submittedAt = new Date(now - 26 * 60 * 60 * 1000).toISOString();
    const reviewedAt = new Date(now - 25 * 60 * 60 * 1000).toISOString();
    const approved = makeOrder("WO-002", "b45d4819-b81a-4552-95e7-b4fd018e41bb", submittedAt,
      "ตรวจฝาปิดและฉลากของตัวอย่าง B");
    approved.state = "approved";
    approved.events.push({ at: reviewedAt, message: "อนุมัติผลตรวจฝาปิดและฉลาก" });
    const rejected = makeOrder("WO-003", "1747c741-19a0-4ccd-a960-c617f1ed4b33", submittedAt,
      "ทบทวนรายงานความคงตัวของตัวอย่าง C");
    rejected.state = "rejected";
    rejected.events.push({ at: reviewedAt, message: "ส่งกลับให้ระบุเวลาที่บันทึกผลในรายงาน" });
    return [pending, approved, rejected];
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
      "รออนุมัติ — ดูใบงานที่ต้องตรวจ",
      "ประวัติ " + defaultAlias + " — ดูเหตุการณ์ของใบงาน",
      "สรุปวันนี้ — ดูความเคลื่อนไหววันนี้",
    ].join("\n");
    if (command === "สรุปวันนี้") return dailyReply(orders, now);
    if (command === "รออนุมัติ") {
      const pending = orders.filter(order => order.state === "awaiting_approval");
      if (!pending.length) return "ตอนนี้ไม่มีใบงานรออนุมัติ";
      return [
        "รออนุมัติ " + pending.length + " รายการ",
        ...pending.map(order => order.alias + " · " + order.request.brief),
      ].join("\n");
    }
    if (command === "ดูเคส") {
      if (!orders.length) return "ตอนนี้ยังไม่มีเคส";
      return [
        "เคสทั้งหมด " + orders.length + " รายการ",
        ...orders.map(o => o.alias + " · " + states[o.state].label + " · " + o.request.brief),
        "เปิดรายละเอียด เช่น ดูเคส " + orders[0].alias,
      ].join("\n");
    }
    const match = /^(ดูเคส|ประวัติ)\s+(.+)$/u.exec(command);
    if (!match) return "พิมพ์ คำสั่ง เพื่อดูเมนู";
    const query = match[2];
    const key = query.toLowerCase();
    const order = orders.find(o => o.id.toLowerCase() === key || o.alias.toLowerCase() === key);
    if (!order) return "ไม่พบเคส " + query.slice(0, 180) + " ในข้อมูลสาธิต";
    if (match[1] === "ดูเคส") return caseReply(order);
    return [
      "ประวัติ " + order.alias + " (เวลาไทย)",
      ...order.events.map(event =>
        day(event.at) + " " + bangkokTime.format(new Date(event.at)) + " · " + event.message),
    ].join("\n");
  }

  const exampleId = "3c50b68c-785c-49ee-9600-a43fb924cc7c";
  const reports = { exampleId, makeOrder, makeDemoOrders, caseReply, report, states };
  if (typeof module === "object" && module.exports) module.exports = reports;
  else globalThis.RalphLabReports = reports;
})();
