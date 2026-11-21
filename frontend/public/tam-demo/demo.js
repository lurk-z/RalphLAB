// Tam · Messaging demo.
"use strict";

(() => {
  const storageKey = "ralphlab.tam.messaging.v1";
  const { exampleId, makeOrder, caseReply, report, states } = globalThis.RalphLabReports;
  const byId = id => document.getElementById(id);
  const timestamp = () => new Date().toISOString();
  const message = (text, mine = false) => ({ text, mine });

  function approvalNotice(order) {
    return [order.alias + " · รอหัวหน้าอนุมัติ", order.request.brief, "หัวหน้าโครงการตรวจใบงานได้ที่โต๊ะหัวหน้าโครงการ"].join("\n");
  }

  function newDemo() {
    const order = makeOrder("WO-001", exampleId, timestamp());
    return { orders: [order], selected: order.id, unread: 1,
      line: [message("พิมพ์ คำสั่ง เพื่อดูเมนู")],
      telegram: [message(approvalNotice(order))] };
  }

  function load() {
    try {
      const saved = JSON.parse(localStorage.getItem(storageKey));
      if (saved && Array.isArray(saved.orders) && saved.orders.some(o => o.id === saved.selected) &&
          saved.orders.every(o => Object.hasOwn(states, o.state) && o.request?.brief && o.events?.length) &&
          Array.isArray(saved.line) && Array.isArray(saved.telegram)) return saved;
    } catch { /* Storage can be disabled in private windows. */ }
    return newDemo();
  }

  let data = load();
  let channel = "line";

  function save() {
    try { localStorage.setItem(storageKey, JSON.stringify(data)); }
    catch { byId("storage-note").hidden = false; }
  }

  function selected() { return data.orders.find(o => o.id === data.selected); }

  function sendLine(input) {
    const command = input.trim();
    if (!command) return;
    const reply = report(command, data.orders, selected().alias);
    data.line.push(message(command, true), message(reply));
    save();
    renderFeed();
  }

  function create() {
    const alias = "WO-" + String(data.orders.length + 1).padStart(3, "0");
    const order = makeOrder(alias, crypto.randomUUID(), timestamp());
    data.orders.push(order);
    data.selected = order.id;
    data.telegram.push(message(approvalNotice(order)));
    if (channel !== "telegram") data.unread++;
    data.line.push(message(order.alias + " · รับใบงานแล้ว รอหัวหน้าอนุมัติ"));
    save();
    render();
  }

  function decide(nextState) {
    const order = selected();
    if (order.state !== "awaiting_approval") return;
    order.state = nextState;
    const result = "หัวหน้าโครงการ" + (nextState === "approved" ? "อนุมัติใบงาน" : "ปฏิเสธใบงาน");
    order.events.push({ at: timestamp(), message: result });
    data.line.push(message(caseReply(order)));
    save();
    render();
  }

  function element(tag, value, className) {
    const el = document.createElement(tag);
    el.textContent = value;
    if (className) el.className = className;
    return el;
  }

  function renderFeed() {
    const feed = byId("feed");
    const rows = data[channel].map(item => {
      const card = element("div", "", "message" + (item.mine ? " mine" : ""));
      card.append(element("small", item.mine ? "Tam" : "RalphLAB"), element("p", item.text));
      return card;
    });
    feed.replaceChildren(...rows);
    feed.scrollTop = feed.scrollHeight;
    byId("line").setAttribute("aria-pressed", String(channel === "line"));
    byId("telegram").setAttribute("aria-pressed", String(channel === "telegram"));
    byId("line-controls").hidden = channel !== "line";
    byId("telegram-note").hidden = channel !== "telegram";
    byId("unread").textContent = data.unread ? "(" + data.unread + ")" : "";
  }

  function render() {
    const order = selected();
    const picker = byId("order");
    picker.replaceChildren(...data.orders.slice().reverse().map(o => new Option(o.alias + " · " + states[o.state].label, o.id)));
    picker.value = order.id;
    const detail = byId("detail");
    detail.replaceChildren(element("h3", order.request.brief), element("p", states[order.state].label, "state " + order.state),
      element("p", "โครงการ " + order.project_id + " · UUID " + order.id, "ref"),
      element("p", "คำแนะนำตามสถานะ: " + states[order.state].advice, "advice"));
    if (order.state === "awaiting_approval") {
      const actions = element("div", "", "actions");
      for (const [key, label] of [["approved", "อนุมัติ"], ["rejected", "ปฏิเสธ"]]) {
        const button = element("button", label);
        button.type = "button";
        button.addEventListener("click", () => decide(key));
        actions.append(button);
      }
      detail.append(actions);
    }
    renderFeed();
  }

  byId("create").addEventListener("click", create);
  byId("order").addEventListener("change", e => { data.selected = e.target.value; save(); render(); });
  for (const name of ["line", "telegram"]) {
    byId(name).addEventListener("click", () => {
      channel = name;
      if (channel === "telegram") data.unread = 0;
      save();
      renderFeed();
    });
  }
  byId("today").addEventListener("click", () => sendLine("สรุปวันนี้"));
  byId("lookup").addEventListener("click", () => sendLine("ดูเคส " + selected().alias));
  byId("compose").addEventListener("submit", e => {
    e.preventDefault();
    sendLine(byId("command").value);
    byId("command").value = "";
  });
  byId("reset").addEventListener("click", () => {
    if (!window.confirm("ล้างใบงานและข้อความสาธิต แล้วเริ่มใหม่หรือไม่?")) return;
    data = newDemo(); channel = "line"; save(); render();
  });
  save();
  render();
})();
