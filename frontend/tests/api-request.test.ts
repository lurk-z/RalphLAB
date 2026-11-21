import assert from "node:assert/strict";
import test from "node:test";

import { ApiError, ApiTimeoutError, api, apiErrorMessage } from "../src/lib/api.ts";

// Authentication precedes the backend fetch, including on an aborted request.
function withSession(backend: typeof fetch): typeof fetch {
  return (input, init) => {
    if (String(input).endsWith("/api/auth/session") || String(input) === "/api/guest") {
      return Promise.resolve(Response.json({ backendToken: "fixture-token" }));
    }
    return backend(input, init);
  };
}

test("API methods forward a caller abort signal to fetch", async () => {
  const originalFetch = globalThis.fetch;
  let receivedSignal: AbortSignal | null = null;
  globalThis.fetch = withSession((_input, init) => {
    receivedSignal = init?.signal ?? null;
    return new Promise<Response>((_resolve, reject) => {
      if (receivedSignal?.aborted) {
        reject(new DOMException("Aborted", "AbortError"));
        return;
      }
      receivedSignal?.addEventListener(
        "abort",
        () => reject(new DOMException("Aborted", "AbortError")),
        { once: true },
      );
    });
  });

  try {
    const controller = new AbortController();
    const request = api.listProjects(controller.signal);
    controller.abort();
    await assert.rejects(request, (cause: unknown) => {
      return cause instanceof Error && cause.name === "AbortError";
    });
    const forwardedSignal = receivedSignal as AbortSignal | null;
    assert.equal(forwardedSignal?.aborted, true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("timeout errors have an actionable Thai message", () => {
  assert.equal(
    apiErrorMessage(new ApiTimeoutError(12000), "โหลดข้อมูลไม่สำเร็จ"),
    "โหลดข้อมูลไม่สำเร็จ: เซิร์ฟเวอร์ไม่ตอบสนอง กรุณาลองใหม่อีกครั้ง",
  );
});

test("project creation returns the backend project and never invents a local fallback", async () => {
  const originalFetch = globalThis.fetch;
  let requestInit: RequestInit | undefined;
  globalThis.fetch = withSession(async (_input, init) => {
    requestInit = init;
    return new Response(
      JSON.stringify({
        id: 42,
        name: "Safety Lab",
        description: null,
        created_at: "2026-07-21T00:00:00Z",
      }),
      { status: 201, headers: { "Content-Type": "application/json" } },
    );
  });

  try {
    const project = await api.createProject("Safety Lab");
    assert.equal(project.id, 42);
    assert.equal(project.name, "Safety Lab");
    assert.equal(requestInit?.method, "POST");
    assert.equal(JSON.parse(String(requestInit?.body)).name, "Safety Lab");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("project creation surfaces backend failure instead of returning a fake project", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = withSession(async () =>
    new Response(JSON.stringify({ detail: "database unavailable" }), {
      status: 503,
      statusText: "Service Unavailable",
      headers: { "Content-Type": "application/json" },
    }));

  try {
    await assert.rejects(api.createProject("Safety Lab"), (cause: unknown) => {
      return cause instanceof ApiError && cause.status === 503;
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("ready registry search requests QSAR-ready verified substances and exposes the count", async () => {
  const originalFetch = globalThis.fetch;
  const urls: string[] = [];
  globalThis.fetch = withSession(async (input) => {
    const url = String(input);
    urls.push(url);
    const body = url.includes("ready-count") ? { count: 189_302 } : [];
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  });

  try {
    await api.searchReadyIngredientRegistry("niacinamide", 25);
    const count = await api.countReadyIngredientRegistry();
    const searchUrl = new URL(urls[0]);
    assert.equal(searchUrl.searchParams.get("verification_status"), "verified");
    assert.equal(searchUrl.searchParams.get("qsar_eligible"), "true");
    assert.equal(searchUrl.searchParams.get("q"), "niacinamide");
    assert.equal(searchUrl.searchParams.get("limit"), "25");
    assert.equal(count.count, 189_302);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
