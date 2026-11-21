import assert from "node:assert/strict";
import test from "node:test";
import { loginReturnPath } from "../src/lib/login-return.ts";

test("login retains the room view, work, tool and agent through sign-in", () => {
  const callback = "/lab-room?view=graph&study=demo-color-change&table=protein&agent=analyst";
  assert.equal(loginReturnPath(callback), callback);
  assert.equal(loginReturnPath("/projects?order=2#summary"), "/projects?order=2#summary");
});

test("login retains its normal and preview defaults for missing or nonlocal callbacks", () => {
  for (const value of [undefined, ["/lab-room", "/projects"], "https://other.invalid/", "//other.invalid/", "/a/..//other.invalid/", "/login"]) {
    assert.equal(loginReturnPath(value), "/projects");
  }
  assert.equal(loginReturnPath(undefined, "/lab-room"), "/lab-room");
});
