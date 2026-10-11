"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const http = require("node:http");
const { createSettingsStore, validateSettings } = require("../src/settings");
const { createRequestHandler } = require("../src/http");
const { merge } = require("../src/merge");

test("settings normalize suffixes, reject rule injection, and persist deletions", () => {
  assert.deepEqual(validateSettings({ companyDomains: [".Example.COM", "*.example.com"] }), { companyDomains: ["example.com"] });
  for (const domain of ["example.com,REJECT", "https://example.com", "bad domain.com", "-bad.com"]) {
    assert.throws(() => validateSettings({ companyDomains: [domain] }));
  }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "clash-settings-"));
  try {
    const file = path.join(dir, "settings.json");
    const store = createSettingsStore(file);
    assert.equal(store.read().companyDomains.length, 0);
    store.save({ companyDomains: [] });
    assert.deepEqual(createSettingsStore(file).read(), { companyDomains: [] });
  } finally { fs.rmSync(dir, { recursive: true }); }
});

test("managed domains replace inherited company domains while retaining SSH bypass rules", () => {
  const internet = { proxies: [{ name: "Internet" }], rules: ["MATCH,Internet"] };
  const company = { proxies: [{ name: "COMPANY" }], rules: ["PROCESS-NAME,ssh,DIRECT", "DOMAIN,api.internal.example,COMPANY"] };
  assert.deepEqual(merge(internet, company, { companyDomains: ["new.example"] }).rules,
    ["PROCESS-NAME,ssh,DIRECT", "DOMAIN-SUFFIX,new.example,COMPANY", "MATCH,Internet"]);
  assert.deepEqual(merge(internet, company, { companyDomains: [] }).rules,
    ["PROCESS-NAME,ssh,DIRECT", "MATCH,Internet"]);
});

test("settings API saves valid JSON and rejects cross-origin changes and invalid input", async () => {
  let settings = { companyDomains: [] };
  const store = { read: () => settings, save: value => (settings = value) };
  const server = http.createServer();
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  server.on("request", createRequestHandler({}, { host: "127.0.0.1", port }, store));
  const url = `http://127.0.0.1:${port}/api/settings`;
  try {
    const put = (body, origin) => fetch(url, { method: "PUT", headers: { "Content-Type": "application/json", ...(origin ? { Origin: origin } : {}) }, body: JSON.stringify(body) });
    assert.equal((await put({ companyDomains: ["example.com"] })).status, 200);
    assert.deepEqual(await (await fetch(url)).json(), { companyDomains: ["example.com"] });
    assert.equal((await put({ companyDomains: [] }, "http://untrusted.example")).status, 403);
    assert.equal((await put({ companyDomains: ["bad,REJECT"] })).status, 400);
    assert.deepEqual(settings.companyDomains, ["example.com"]);
  } finally { await new Promise(resolve => server.close(resolve)); }
});
