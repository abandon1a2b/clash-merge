"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { parseUsage } = require("../src/usage");
const { createMergeService } = require("../src/service");
const { createApplicationHandler } = require("../src/app");

test("usage validates values and computes remaining without allowing header injection", () => {
  assert.equal(parseUsage("upload=10; download=20; total=100; expire=0").remaining, 70);
  assert.equal(parseUsage("upload=100; download=20; total=10").remaining, 0);
  for (const value of [null, "upload=-1;download=0;total=10", "upload=0;download=0;total=99999999999999999999", "upload=0;download=0"]) assert.equal(parseUsage(value), null);
});

test("usage persists on refresh failure and is isolated when source is changed", async () => {
  let source = "https://example.com/sub", fail = false;
  const service = createMergeService({ readSources: () => ({ internetItem: { url: source } }) }, {
    settingsStore: { read: () => ({ exits: [] }) }, logger: { log() {}, error() {} },
    fetchImpl: async () => { if (fail) throw Error("offline"); return new Response("proxies:\n  - name: node\nrules: [MATCH,node]\n", { headers: { "subscription-userinfo": "upload=10;download=20;total=100;expire=0" } }); },
  });
  await service.refresh();
  assert.equal(service.health().usage.remaining, 70);
  fail = true; await service.refresh();
  assert.equal(service.health().usage.used, 30);
  source = "https://example.com/other"; service.invalidate();
  assert.equal(service.health().usage, null);
});

test("both subscription aliases forward usage for GET and HEAD", async () => {
  const usage = parseUsage("upload=10;download=20;total=100");
  const handler = createApplicationHandler({ service: () => ({ refresh: async () => {}, currentConfig: () => ({ yaml: "test", usage }) }) }, { read: () => ({ plans: [{ id: "default" }] }) }, {}, { host: "127.0.0.1", port: 18790 });
  for (const url of ["/clash.yaml", "/subscriptions/default/clash.yaml"]) for (const method of ["GET", "HEAD"]) {
    let headers, body;
    await handler({ url, method, headers: { host: "127.0.0.1:18790" }, socket: { remoteAddress: "127.0.0.1" } }, { writeHead(status, value) { assert.equal(status, 200); headers = value; }, end(value) { body = value; } });
    assert.equal(headers["Subscription-Userinfo"], usage.header);
    assert.equal(body, method === "HEAD" ? undefined : "test");
  }
});
