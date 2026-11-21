const RESEARCH_ROLES = {
  director: {
    name: "หัวหน้าแล็บ",
    title: "US EPA · Quality Assurance Project Plans",
    url: "https://www.epa.gov/sites/default/files/documents/ufp_qapp_v1_0305.pdf",
    use: "ตรวจว่าแผนระบุคำถาม ตัวอย่าง และหลักฐานที่จะใช้ตัดสิน",
  },
  researcher: {
    name: "นักวิจัย",
    title: "NCATS · Assay Guidance Manual",
    url: "https://www.ncbi.nlm.nih.gov/books/NBK53196/",
    use: "พิจารณาชุดควบคุมและที่มาของผลก่อนเสนอคำอธิบาย",
  },
  formulator: {
    name: "นักพัฒนาสูตร",
    title: "ICH Q1A(R2) · Stability Testing",
    url: "https://www.fda.gov/regulatory-information/search-fda-guidance-documents/q1ar2-stability-testing-new-drug-substances-and-products",
    use: "ทบทวนช่วงเวลาและเงื่อนไขที่ใช้ติดตามความคงตัว",
  },
  analyst: {
    name: "นักวิเคราะห์",
    title: "ICH Q2(R2) · Validation of Analytical Procedures",
    url: "https://www.fda.gov/media/161201/download",
    use: "ตรวจความเที่ยงและความแปรปรวนของการวัดซ้ำ",
  },
  evaluator: {
    name: "ผู้ประเมิน",
    title: "US EPA · Data Assessment",
    url: "https://www.epa.gov/sites/default/files/documents/ufp_qapp_v1_0305.pdf",
    use: "ประเมินความครบถ้วนและข้อจำกัดก่อนตัดสินผล",
  },
};
const TOPICS = [
  [
    /สี|color|colour|l\*/i,
    "colorimetry measurement repeatability stability",
    "colorimetry",
    "ความต่างของค่าที่วัดอาจเกี่ยวกับสภาพการวัดสี",
    "เทียบข้อมูลการสอบเทียบและเงื่อนไขการวัดระหว่างรอบ",
  ],
  [
    /เครื่อง|calibrat|instrument/i,
    "instrument calibration measurement drift",
    "instrument calibration",
    "การเปลี่ยนค่าระหว่างรอบอาจเกี่ยวข้องกับความคลาดเคลื่อนของเครื่องมือ",
    "ตรวจบันทึกสอบเทียบและเวลาวัดของรอบที่พบปัญหา",
  ],
  [
    /ระคาย|irritation/i,
    "non animal skin irritation evidence assessment",
    "toxicology data",
    "ข้อมูลของตัวอย่างและกลุ่มเปรียบเทียบอาจมาจากคนละเงื่อนไข",
    "เทียบตัวชี้วัดและขอบเขตของวิธีประเมินในเอกสารต้นฉบับ",
  ],
  [
    /โปรตีน|อินซูลิน|protein|insulin|lispro/i,
    "protein structure comparison coordinate uncertainty",
    "protein structure visualization",
    "ความแตกต่างที่เห็นอาจขึ้นกับชุดพิกัดหรือความครบถ้วนของตำแหน่งที่เทียบ",
    "ตรวจรหัสโครงสร้างและตำแหน่งที่มีข้อมูลทั้งสองชุด",
  ],
  [
    /คงตัว|เสถียร|stability|สูตร/i,
    "formulation stability time series variability",
    "stability analysis",
    "การเปลี่ยนแปลงตามเวลาอาจต่างกันระหว่างชุดตัวอย่าง",
    "ทบทวนเวลาเก็บข้อมูลและเงื่อนไขของชุดเปรียบเทียบ",
  ],
];
const genericTopic = [
  null,
  "measurement uncertainty repeated measures",
  "measurement uncertainty",
  "ความแปรปรวนของการวัดอาจมีส่วนต่อความต่างที่เห็น",
  "ตรวจข้อมูลวัดซ้ำและความสอดคล้องของหน่วยกับเกณฑ์ที่กำหนด",
];
function researchTopic(gap, context) {
  return (
    TOPICS.find((t) => t[0].test(gap)) ||
    TOPICS.find((t) => t[0].test(context)) ||
    genericTopic
  );
}
async function sourceJSON(url) {
  const response = await fetch(url.toString(), {
    headers: {
      "User-Agent": "RalphLAB-Research/1.0",
      Accept: "application/json",
    },
    redirect: "manual",
    signal: AbortSignal.timeout(8500),
  });
  if (!response.ok) throw Error("HTTP " + response.status);
  return response.json();
}
async function paperMatches(query) {
  const url = new URL("https://api.crossref.org/works");
  url.search = new URLSearchParams({
    "query.bibliographic": query,
    filter: "type:journal-article",
    rows: "5",
    select: "DOI,title,issued,container-title",
  }).toString();
  const body = await sourceJSON(url);
  return body.message.items
    .filter((p) => /^10\.\d{4,9}\/\S+$/i.test(p.DOI) && p.title?.[0])
    .slice(0, 4)
    .map((p) => ({
      kind: "paper",
      id: "doi:" + p.DOI.toLowerCase(),
      title: p.title[0].replace(/<[^>]*>/g, "").slice(0, 350),
      url:
        "https://doi.org/" + p.DOI.split("/").map(encodeURIComponent).join("/"),
      detail: [
        p["container-title"]?.[0],
        p.issued?.["date-parts"]?.[0]?.[0],
        p.DOI,
      ]
        .filter(Boolean)
        .join(" · ")
        .slice(0, 320),
    }));
}
async function softwareMatches(query) {
  const url = new URL("https://api.github.com/search/repositories");
  url.search = new URLSearchParams({
    q: query + " archived:false fork:false",
    per_page: "15",
  }).toString();
  const body = await sourceJSON(url);
  const openLicense =
    /^(MIT|Apache-2\.0|BSD-[23]-Clause|ISC|MPL-2\.0|[AL]?GPL-[23]\.0(?:-only|-or-later)?|Unlicense|EPL-2\.0|AGPL-3\.0)$/;
  return body.items
    .filter(
      (r) =>
        openLicense.test(r.license?.spdx_id) &&
        /^[\w.-]+\/[\w.-]+$/.test(r.full_name),
    )
    .slice(0, 4)
    .map((r) => ({
      kind: "software",
      id: "github:" + r.full_name.toLowerCase(),
      title: r.full_name,
      url: "https://github.com/" + r.full_name,
      detail: [r.license.spdx_id, r.description]
        .filter(Boolean)
        .join(" · ")
        .slice(0, 320),
    }));
}
async function priorEvidence(db, user, scope, topic) {
  const rows = await db
    .prepare(
      "SELECT payload FROM research_runs WHERE owner=? AND scope=? ORDER BY created DESC",
    )
    .bind(user, scope)
    .all();
  const latest = new Map();
  for (const record of rows.results) {
    const run = JSON.parse(record.payload);
    if (run.status !== "done") continue;
    for (const source of run.sources) {
      const review = source.review;
      if (
        review &&
        (!latest.has(source.id) || latest.get(source.id).at < review.at)
      ) {
        latest.set(source.id, {
          ...review,
          title: source.title,
          url: source.url,
          topic: run.topic,
          ...(source.file && {
            file: source.file.href,
            locator: source.locator,
            excerpt: source.excerpt,
          }),
        });
      }
    }
  }
  return [...latest.values()]
    .filter((s) => s.decision === "use" && (!topic || s.topic === topic))
    .sort((a, b) => b.at - a.at)
    .slice(0, 8);
}
async function researchRun(db, user, scope, context, body, runId) {
  const role = body.role || "researcher";
  requireTimed(Object.hasOwn(RESEARCH_ROLES, role), "ไม่พบบทบาท");
  const gap = label(body.gap, 800),
    topic = researchTopic(gap, context);
  const query = body.keywords ? label(body.keywords, 110) : "";
  const request = {
    role,
    gap,
    paper: query || topic[1],
    software: query || topic[2],
  };
  const prior = await priorEvidence(db, user, scope, topic[1]);
  const plan = {
    ...request,
    id: runId,
    at: Date.now(),
    baseline: RESEARCH_ROLES[role],
    topic: topic[1],
    prior,
    hypothesis: topic[3],
    check: topic[4],
    status: "searching",
    sources: [],
    unavailable: [],
  };
  const insert = await db
    .prepare(
      "INSERT INTO research_runs(id,owner,scope,created,revision,payload) VALUES(?,?,?,?,0,?) ON CONFLICT(id) DO NOTHING",
    )
    .bind(runId, user, scope, plan.at, JSON.stringify(plan))
    .run();
  if (!insert.meta.changes) return;
  const results = await Promise.allSettled([
    paperMatches(request.paper),
    softwareMatches(request.software),
  ]);
  results.forEach((r, i) => {
    if (r.status === "fulfilled") plan.sources.push(...r.value);
    else {
      const provider = i ? "GitHub" : "Crossref";
      plan.unavailable.push(provider);
      console.warn(
        "Evidence lookup failed",
        provider,
        r.reason?.name,
        r.reason?.message?.split("?")[0]?.slice(0, 90),
      );
    }
  });
  plan.status = "done";
  await db
    .prepare(
      "UPDATE research_runs SET revision=1,payload=? WHERE id=? AND owner=? AND scope=? AND revision=0",
    )
    .bind(JSON.stringify(plan), runId, user, scope)
    .run();
}
async function researchAPI(request, env, url) {
  const user = identity(request)?.id;
  requireTimed(user, "กรุณาเข้าสู่ระบบ", 401);
  const db = env.DB.withSession ? env.DB.withSession("first-primary") : env.DB;
  const parts = url.pathname.split("/").filter(Boolean);
  const [, , type, key] = parts;
  requireTimed(
    (parts.length === 4 ||
      (parts[4] === "files" && [5, 7].includes(parts.length))) &&
      ["timed", "project"].includes(type),
    "ไม่พบคลังอ้างอิง",
    404,
  );
  let context = "";
  if (type === "timed") {
    const item = await db
      .prepare("SELECT payload FROM timed_studies WHERE id=? AND owner=?")
      .bind(uuid(key), user)
      .first();
    requireTimed(item, "ไม่พบใบงานนี้", 404);
    const row = JSON.parse(item.payload);
    context = [row.metric, row.goal, row.brief].join(" ");
  } else {
    requireTimed(/^[1-9]\d*$/.test(key), "ไม่พบโครงการ", 404);
    await projectFor(db, user, Number(key));
  }
  const scope = type + "/" + key;
  if (parts.length === 7)
    return downloadSource(request, env, db, user, scope, parts[5], parts[6]);
  const read = async () => {
    const rows = await db
      .prepare(
        "SELECT payload FROM research_runs WHERE owner=? AND scope=? ORDER BY created DESC",
      )
      .bind(user, scope)
      .all();
    return rows.results
      .map((r) => JSON.parse(r.payload))
      .filter((r) => r.status !== "uploading");
  };
  if (parts.length === 5) {
    await uploadSource(request, env, db, user, scope, context);
    return json({ roles: researchRolesWithReferences(), runs: await read() });
  }
  if (request.method === "GET")
    return json({ roles: researchRolesWithReferences(), runs: await read() });
  requireTimed(request.method === "POST", "ไม่รองรับวิธีนี้", 405);
  const b = await bodyOf(request, url);
  if (b.action === "search") {
    await researchRun(db, user, scope, context, b, uuid(b.id));
  } else {
    requireTimed(
      b.action === "review" && ["use", "dismiss"].includes(b.decision),
      "ไม่พบการตัดสินใจ",
    );
    const id = label(b.id, 120);
    const saved = await db
      .prepare(
        "SELECT revision,payload FROM research_runs WHERE id=? AND owner=? AND scope=?",
      )
      .bind(id, user, scope)
      .first();
    requireTimed(saved, "ไม่พบการค้นนี้", 404);
    const run = JSON.parse(saved.payload),
      source = run.sources.find((s) => s.id === b.source);
    requireTimed(run.status === "done", "แหล่งนี้ยังบันทึกไม่เสร็จ", 409);
    requireTimed(source, "ไม่พบแหล่งนี้ในผลค้น", 404);
    source.review = {
      decision: b.decision,
      note: label(b.note, 650),
      hypothesis: b.hypothesis ? label(b.hypothesis, 600) : "",
      at: Date.now(),
    };
    if (b.decision === "use" && !source.file) {
      source.file = await archiveCitation(env, user, scope, run, source);
    }
    const changed = await db
      .prepare(
        "UPDATE research_runs SET payload=?,revision=revision+1 WHERE id=? AND revision=?",
      )
      .bind(JSON.stringify(run), id, saved.revision)
      .run();
    requireTimed(
      changed.meta.changes === 1,
      "ข้อมูลเปลี่ยนแล้ว กรุณาตรวจอีกครั้ง",
      409,
    );
  }
  return json({ roles: researchRolesWithReferences(), runs: await read() });
}
function researchRolesWithReferences() {
  return Object.fromEntries(Object.entries(RESEARCH_ROLES).map(([key,role])=>[key,{...role,references:roleReferences(key)}]));
}
