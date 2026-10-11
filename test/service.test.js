"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { createMergeService } = require("../src/service");
const YAML = require("yaml");

test("self subscriptions cannot recursively fetch the merge service", async () => {
  const profiles = { readSources: () => ({ internetItem: { url: "http://127.0.0.1:18790/clash.yaml" }, company: null }) };
  const service = createMergeService(profiles, {
    fetchImpl() { throw new Error("Must not fetch itself"); },
    logger: { log() {}, error() {} },
  });
  await service.refresh();
  assert.equal(service.lastRefreshOk, false);
});

test("refresh uses Clash format and replaces old nodes with the latest upstream nodes", async () => {
  const company = { proxies: [{ name: "COMPANY" }], rules: ["DOMAIN,internal.example,COMPANY"] };
  const profiles = { readSources: () => ({
    internetItem: { url: "https://example.invalid/subscription" },
    localInternet: { value: { proxies: [{ name: "Old" }], rules: ["MATCH,Old"] }, modifiedAt: 1 },
    company,
  }) };
  const service = createMergeService(profiles, {
    async fetchImpl(url, options) {
      assert.equal(options.headers["User-Agent"], "clash-verge");
      return new Response(YAML.stringify({ proxies: [{ name: "New" }], rules: ["MATCH,New"] }));
    },
    logger: { log() {}, error() {} },
  });
  await service.refresh();
  const config = service.currentConfig();
  assert.equal(config.source, "direct-refresh");
  assert.deepEqual(YAML.parse(config.yaml).proxies.map(p => p.name), ["COMPANY", "New"]);
});

test("refresh failure keeps the last valid merged profile", async () => {
  let broken = false;
  const company = { proxies: [{ name: "COMPANY" }], rules: ["DOMAIN,api.internal.example,COMPANY"] };
  const internet = { proxies: [{ name: "Internet" }], rules: ["MATCH,Internet"] };
  const profiles = {
    readSources() {
      if (broken) throw new Error("temporary profile read failure");
      return {
        internetItem: { url: "https://example.invalid/subscription" },
        localInternet: { value: internet, modifiedAt: 1 },
        company,
      };
    },
  };
  const service = createMergeService(profiles, {
    fetchImpl: async () => { throw new Error("offline"); },
    logger: { log() {}, error() {} },
  });
  const good = service.currentConfig();
  assert.equal(good.stale, false);
  await service.refresh();
  broken = true;
  const fallback = service.currentConfig();
  assert.equal(fallback.stale, true);
  assert.equal(fallback.yaml, good.yaml);
  assert.equal(service.health().lastRefreshOk, false);
});
