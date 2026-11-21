const MAX_SOURCE_BYTES = 10 * 1024 * 1024;
const SOURCE_TYPES = {
  pdf: "application/pdf",
  txt: "text/plain",
  md: "text/markdown",
  csv: "text/csv",
  json: "application/json",
};
async function fileDigest(buffer) {
  const digest = await crypto.subtle.digest("SHA-256", buffer);
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}
function fileLink(scope, run, index) {
  return (
    "/api/research/" + scope + "/files/" + encodeURIComponent(run) + "/" + index
  );
}
async function privateObjectKey(user, scope, hash) {
  return (
    "sources/" + (await timedDigest(JSON.stringify([user, scope]))) + "/" + hash
  );
}
function storage(env) {
  requireTimed(env.BUCKET, "ยังเชื่อมพื้นที่เก็บไฟล์ไม่ได้", 503);
  return env.BUCKET;
}
function metadataFrom(request) {
  let meta;
  try {
    meta = JSON.parse(
      decodeURIComponent(request.headers.get("x-ralph-file") || ""),
    );
  } catch {}
  requireTimed(meta && typeof meta === "object", "ไม่พบรายละเอียดไฟล์");
  const name = label(meta.name, 180);
  requireTimed(
    !/[\\/\u0000-\u001f\u007f]/.test(name),
    "กรุณาใช้ชื่อไฟล์โดยไม่มีเส้นทาง",
  );
  const type = name.split(".").pop().toLowerCase();
  requireTimed(
    Object.hasOwn(SOURCE_TYPES, type),
    "รองรับ PDF, TXT, MD, CSV และ JSON",
    415,
  );
  requireTimed(Object.hasOwn(RESEARCH_ROLES, meta.role), "ไม่พบบทบาทนี้");
  let origin = "";
  if (meta.origin) {
    let url;
    try {
      url = new URL(label(meta.origin, 1000));
    } catch {}
    requireTimed(
      url?.protocol === "https:" && !url.username && !url.password,
      "ลิงก์ต้นทางต้องเป็น HTTPS",
    );
    origin = url.href;
  }
  return {
    name,
    type,
    role: meta.role,
    origin,
    note: label(meta.note, 650),
    locator: label(meta.locator, 180),
  };
}
async function readOriginal(request, type) {
  const length = Number(request.headers.get("content-length"));
  requireTimed(
    request.body && length <= MAX_SOURCE_BYTES,
    "ไฟล์ใหญ่เกิน 10 MiB",
    413,
  );
  const reader = request.body.getReader(),
    chunks = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_SOURCE_BYTES) {
      await reader.cancel();
      throw new ApiError(413, "ไฟล์ใหญ่เกิน 10 MiB");
    }
    chunks.push(value);
  }
  requireTimed(total > 0, "ไฟล์ว่าง");
  const bytes = new Uint8Array(total);
  let pos = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, pos);
    pos += chunk.length;
  }
  if (type === "pdf")
    requireTimed(
      new TextDecoder().decode(bytes.subarray(0, 5)) === "%PDF-",
      "ไฟล์ไม่ตรงกับรูปแบบ PDF",
      415,
    );
  else {
    requireTimed(!bytes.includes(0), "กรุณาใช้ไฟล์ข้อความ UTF-8", 415);
    try {
      const decoder = new TextDecoder("utf-8", { fatal: true });
      for (let i = 0; i < total; i += 32768)
        decoder.decode(bytes.subarray(i, i + 32768), { stream: true });
      decoder.decode();
    } catch {
      throw new ApiError(415, "กรุณาใช้ไฟล์ข้อความ UTF-8");
    }
  }
  return bytes;
}
async function uploadSource(request, env, db, user, scope, context) {
  requireTimed(request.method === "POST", "ไม่รองรับวิธีนี้", 405);
  const origin = request.headers.get("origin");
  requireTimed(
    !origin || origin === new URL(request.url).origin,
    "ต้นทางไม่ถูกต้อง",
    403,
  );
  const bucket = storage(env),
    meta = metadataFrom(request),
    bytes = await readOriginal(request, meta.type);
  const sha = await fileDigest(bytes),
    id =
      "upload-" + (await timedDigest(JSON.stringify([user, scope, sha, meta])));
  const file = {
    name: meta.name,
    type: SOURCE_TYPES[meta.type],
    bytes: bytes.length,
    sha,
    href: fileLink(scope, id, 0),
  };
  const at = Date.now(),
    topic = researchTopic(meta.note, context);
  const excerpt =
    meta.type === "pdf"
      ? ""
      : new TextDecoder()
          .decode(bytes.subarray(0, 2400), { stream: true })
          .slice(0, 600);
  const source = {
    id,
    kind: "file",
    title: meta.name,
    url: file.href,
    file,
    origin: meta.origin,
    locator: meta.locator,
    excerpt,
    detail: meta.locator,
    review: { decision: "use", note: meta.note, at, hypothesis: "" },
  };
  const run = {
    id,
    kind: "upload",
    baseline: RESEARCH_ROLES[meta.role],
    role: meta.role,
    topic: topic[1],
    at,
    status: "uploading",
    sources: [source],
  };
  await db
    .prepare(
      "INSERT INTO research_runs(id,owner,scope,created,revision,payload) VALUES(?,?,?,?,0,?) ON CONFLICT(id) DO NOTHING",
    )
    .bind(id, user, scope, at, JSON.stringify(run))
    .run();
  const current = await db
    .prepare(
      "SELECT revision FROM research_runs WHERE id=? AND owner=? AND scope=?",
    )
    .bind(id, user, scope)
    .first();
  if (current.revision > 0) return;
  await bucket.put(await privateObjectKey(user, scope, sha), bytes, {
    httpMetadata: { contentType: file.type },
  });
  run.status = "done";
  await db
    .prepare(
      "UPDATE research_runs SET revision=1,payload=? WHERE id=? AND owner=? AND scope=? AND revision=0",
    )
    .bind(JSON.stringify(run), id, user, scope)
    .run();
}
async function archiveCitation(env, user, scope, run, source) {
  const index = run.sources.indexOf(source);
  const record = {
    kind: source.kind,
    title: source.title,
    url: source.url,
    reference: source.id,
    detail: source.detail,
    foundAt: new Date(run.at).toISOString(),
    search: source.kind === "paper" ? run.paper : run.software,
  };
  const bytes = new TextEncoder().encode(
      JSON.stringify(record, null, 2) + "\n",
    ),
    sha = await fileDigest(bytes);
  await storage(env).put(await privateObjectKey(user, scope, sha), bytes, {
    httpMetadata: { contentType: "application/json" },
  });
  return {
    name: "reference-" + sha.slice(0, 12) + ".json",
    type: "application/json",
    sha,
    bytes: bytes.length,
    href: fileLink(scope, run.id, index),
  };
}
async function downloadSource(request, env, db, user, scope, runId, index) {
  requireTimed(
    ["HEAD", "GET"].includes(request.method),
    "ไม่รองรับวิธีนี้",
    405,
  );
  requireTimed(/^\d{1,2}$/.test(index), "ไม่พบไฟล์", 404);
  const saved = await db
    .prepare(
      "SELECT payload FROM research_runs WHERE id=? AND owner=? AND scope=? AND revision>0",
    )
    .bind(runId, user, scope)
    .first();
  const file = saved && JSON.parse(saved.payload).sources[Number(index)]?.file;
  requireTimed(file, "ไม่พบไฟล์", 404);
  const bucket = storage(env),
    key = await privateObjectKey(user, scope, file.sha);
  const obj =
    request.method === "HEAD" ? await bucket.head(key) : await bucket.get(key);
  requireTimed(obj, "ไม่พบต้นฉบับในพื้นที่เก็บไฟล์", 404);
  return new Response(request.method === "HEAD" ? null : obj.body, {
    headers: {
      "content-type": file.type,
      "content-disposition":
        "attachment; filename*=UTF-8''" +
        encodeURIComponent(file.name).replace(
          /['()*]/g,
          (c) => "%" + c.charCodeAt(0).toString(16),
        ),
      "content-length": String(obj.size),
      "cache-control": "private, no-store",
      "x-content-type-options": "nosniff",
    },
  });
}
