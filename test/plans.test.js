"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const http = require("node:http");
const YAML = require("yaml");
const { EventEmitter } = require("node:events");
const { migrateSettings, validatePlans, createPlanStore } = require("../src/plans");
const { mergeExits } = require("../src/merge");
const { createRuntime } = require("../src/runtime");
const { createApplicationHandler } = require("../src/app");

const base = () => migrateSettings({ companyDomains: [] });

test("fresh installation has no personal endpoints, domains or enabled exits", () => {
  const settings = migrateSettings();
  assert.equal(settings.plans[0].subscription.url, "");
  assert.deepEqual(settings.plans[0].exits, []);
  assert.deepEqual(validatePlans(settings), settings);
});
const internet = { proxies: [{ name: "Internet", type: "ss", server: "example.com", port: 443 }], "proxy-groups": [{ name: "Proxy", type: "select", proxies: ["Internet"] }], rules: ["MATCH,Proxy"], dns: { enable: true } };
const external = (id, domains = []) => ({ id, name: id, type: "socks5", enabled: true, server: "127.0.0.1", port: 1081, domains });

test("migration retains existing subscription, domains and tunnel and backs up the legacy file", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "clash-plans-"));
  try {
    const file = path.join(dir, "settings.json");
    const legacy = { companyDomains: ["custom.example"], company: { enabled: false, profileName: "cc" }, subscription: { profileName: "default.yaml", url: "https://example.invalid/sub", userAgent: "Clash" } };
    fs.writeFileSync(file, JSON.stringify(legacy));
    const store = createPlanStore(file), migrated = store.read();
    assert.equal(migrated.plans[0].subscription.url, legacy.subscription.url);
    assert.deepEqual(migrated.plans[0].exits[0].domains, ["custom.example"]);
    assert.equal(migrated.plans[0].exits[0].enabled, false);
    store.save(migrated);
    assert.deepEqual(JSON.parse(fs.readFileSync(`${file}.v1-backup`, "utf8")), legacy);
    migrated.plans[0].exits = [];
    store.save(migrated);
    assert.deepEqual(createPlanStore(file).read().plans[0].exits, []);
  } finally { fs.rmSync(dir, { recursive: true }); }
});

test("multiple exits produce independent routes, preserve upstream groups and put bypass rules first", () => {
  const exits = [external("one", ["one.example"]), { ...external("two", ["two.example"]), type: "http", server: "proxy.example.com", username: "user", password: "secret" }, { ...external("off", ["off.example"]), enabled: false }];
  const result = mergeExits(internet, exits);
  assert.deepEqual(result.proxies.map(proxy => proxy.name), ["EXIT-one", "EXIT-two", "Internet"]);
  assert.equal(result.proxies[1].password, "secret");
  assert.deepEqual(result["proxy-groups"], internet["proxy-groups"]);
  assert.deepEqual(result.dns, internet.dns);
  assert.ok(result.rules.indexOf("DOMAIN,proxy.example.com,DIRECT") < result.rules.indexOf("DOMAIN-SUFFIX,one.example,EXIT-one"));
  assert.deepEqual(result.rules.slice(-3), ["DOMAIN-SUFFIX,one.example,EXIT-one", "DOMAIN-SUFFIX,two.example,EXIT-two", "MATCH,Proxy"]);
  assert.equal(internet.proxies.length, 1);
  assert.throws(() => mergeExits({ ...internet, "proxy-groups": [{ name: "EXIT-one" }] }, exits));
});

test("priority follows exit order, duplicates and SSH local port collisions are rejected", () => {
  const doc = base();
  doc.plans[0].exits = [external("one", ["example.com"]), external("two", ["sub.example.com"])];
  assert.ok(validatePlans(doc));
  const first = mergeExits(internet, doc.plans[0].exits).rules;
  doc.plans[0].exits.reverse();
  const second = mergeExits(internet, doc.plans[0].exits).rules;
  assert.notDeepEqual(first, second);
  doc.plans[0].exits[0].domains = ["example.com"];
  assert.throws(() => validatePlans(doc), /domain/);
  const ports = base();
  ports.plans.push({ ...structuredClone(ports.plans[0]), id: "home", name: "home" });
  assert.throws(() => validatePlans(ports), /ports/);
});

function fixture(settings, config) {
  let value = structuredClone(settings);
  const store = { read: () => structuredClone(value), save: next => (value = structuredClone(next)) };
  const profiles = {
    readSources(settings) {
      return { internetItem: { url: settings.subscription.url || "https://one.example/sub", option: { user_agent: settings.subscription.userAgent } }, localInternet: { value: internet, modifiedAt: 1 }, company: null };
    },
    listProfiles: () => [{ name: "default.yaml", type: "remote" }],
    validateSources(settings) { if (settings.subscription.url.includes("127.0.0.1")) throw Error("recursive"); },
  };
  const children = [];
  const runtime = createRuntime(store, profiles, config, {
    logger: { log() {}, error() {} },
    fetchImpl: async url => new Response(YAML.stringify({ ...internet, proxies: [{ ...internet.proxies[0], name: url.includes("two.example") ? "Two" : "One" }] })),
    tunnelOptions: {
      probe: async port => children.some(child => child.port === port && child.exitCode === null),
      spawnImpl(command, args) {
        const child = new EventEmitter(); child.stderr = new EventEmitter(); child.exitCode = null;
        child.port = Number(args[args.indexOf(args.includes("-D") ? "-D" : "-L") + 1].split(":")[1]);
        child.kill = signal => { child.exitCode = 0; child.signalCode = signal; queueMicrotask(() => child.emit("exit", 0)); };
        children.push(child); return child;
      },
    },
  });
  return { store, profiles, runtime };
}

test("plan refresh caches are isolated and live tunnel changes require stopping only that exit", async () => {
  const doc = base();
  doc.plans[0].subscription.url = "https://one.example/sub";
  doc.plans[0].exits[0].tunnel.keyFile = __filename;
  doc.plans.push({ id: "home", name: "Home", subscription: { ...doc.plans[0].subscription, url: "https://two.example/sub" }, exits: [external("remote")] });
  const { runtime, store } = fixture(doc, { host: "127.0.0.1", port: 18790 });
  try {
    await runtime.refreshAll();
    assert.equal(YAML.parse(runtime.service("office").currentConfig().yaml).proxies.at(-1).name, "One");
    assert.equal(YAML.parse(runtime.service("home").currentConfig().yaml).proxies.at(-1).name, "Two");
    await runtime.action("office", "internal", "start");
    assert.equal((await runtime.statuses("office")).internal.state, "connected");
    const next = store.read(); next.plans[0].exits[0].enabled = false;
    assert.throws(() => runtime.save(next), /Stop/);
    const unrelated = store.read(); unrelated.plans[1].name = "Renamed";
    assert.equal(runtime.save(unrelated).plans[1].name, "Renamed");
    assert.equal((await runtime.statuses("office")).internal.state, "connected");
    await runtime.action("office", "internal", "stop");
    assert.equal(runtime.save(next).plans[0].exits[0].enabled, false);
  } finally { await runtime.stopAll(); }
});

test("HTTP supports independent subscriptions, default alias, revision conflicts and origin checks", async () => {
  const doc = base(); doc.plans[0].exits = [];
  doc.plans.push({ id: "home", name: "Home", subscription: { ...doc.plans[0].subscription, url: "https://two.example/sub" }, exits: [] });
  const server = http.createServer();
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const config = { host: "127.0.0.1", port: server.address().port };
  const { runtime, store, profiles } = fixture(doc, config);
  server.on("request", createApplicationHandler(runtime, store, profiles, config));
  const root = `http://${config.host}:${config.port}`;
  try {
    const first = await fetch(`${root}/api/settings`), tag = first.headers.get("etag");
    assert.equal((await first.json()).plans.length, 2);
    const put = (settings, headers = {}) => fetch(`${root}/api/settings`, { method: "PUT", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify(settings) });
    assert.equal((await put(doc, { Origin: "http://attacker.example" })).status, 403);
    doc.defaultPlanId = "home";
    assert.equal((await put(doc, { "If-Match": tag })).status, 200);
    assert.equal((await put(doc, { "If-Match": tag })).status, 409);
    const alias = YAML.parse(await (await fetch(`${root}/clash.yaml`)).text());
    const office = YAML.parse(await (await fetch(`${root}/subscriptions/office/clash.yaml`)).text());
    assert.equal(alias.proxies[0].name, "Two");
    assert.equal(office.proxies[0].name, "One");
    assert.equal((await fetch(`${root}/subscriptions/missing/clash.yaml`)).status, 404);
    const invalid = store.read(); invalid.plans[0].subscription.url = `${root}/clash.yaml`;
    assert.equal((await put(invalid)).status, 400);
  } finally { await runtime.stopAll(); await new Promise(resolve => server.close(resolve)); }
});
