"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const YAML = require("yaml");
const { createProfileStore } = require("../src/profiles");

test("subscription overrides never use another URL's cache and recursive sources are rejected", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "clash-profiles-"));
  try {
    fs.mkdirSync(path.join(dir, "profiles"));
    fs.writeFileSync(path.join(dir, "profiles.yaml"), YAML.stringify({ items: [
      { name: "default.yaml", type: "remote", file: "internet.yaml", url: "https://example.invalid/subscription" },
      { name: "cc", type: "local", file: "company.yaml" },
      { name: "loop", type: "remote", file: "internet.yaml", url: "http://127.0.0.1:18790/clash.yaml" },
    ] }));
    fs.writeFileSync(path.join(dir, "profiles/internet.yaml"), "proxies: [{name: Internet}]\nrules: [MATCH,Internet]\n");
    fs.writeFileSync(path.join(dir, "profiles/company.yaml"), "proxies: [{name: COMPANY}]\nrules: []\n");
    const store = createProfileStore(dir);
    assert.ok(store.readSources().localInternet);
    const override = { subscription: { profileName: "default.yaml", url: "https://new.example/sub", userAgent: "Clash" } };
    assert.equal(store.readSources(override).localInternet, null);
    assert.equal(store.readSources(override).internetItem.option.user_agent, "Clash");
    assert.throws(() => store.validateSources({ subscription: { profileName: "loop" } }, { host: "127.0.0.1", port: 18790 }));
    assert.equal(store.readSources({ company: { enabled: false } }).company, null);
  } finally { fs.rmSync(dir, { recursive: true }); }
});
