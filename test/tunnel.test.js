"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const { createTunnelManager } = require("../src/tunnel");
const { DEFAULT_TUNNEL, validateSettings } = require("../src/settings");
const { merge } = require("../src/merge");

test("tunnel owns only spawned processes, uses strict SSH options and cleans up both hops", async () => {
  const calls = [];
  const children = [];
  const manager = createTunnelManager({ read: () => ({ tunnel: { ...DEFAULT_TUNNEL, keyFile: __filename } }) }, {
    probe: async port => children.some(child => child.port === port && child.exitCode === null),
    spawnImpl(command, args) {
      calls.push({ command, args });
      const child = new EventEmitter();
      child.stderr = new EventEmitter(); child.exitCode = null;
      child.port = args.includes("-D") ? 1080 : 2222;
      child.kill = signal => { child.exitCode = 0; child.signalCode = signal; queueMicrotask(() => child.emit("exit", 0)); };
      children.push(child);
      return child;
    },
  });
  await manager.start();
  assert.equal((await manager.status()).state, "connected");
  assert.equal(calls.length, 2);
  assert.ok(calls.every(call => call.args.includes("StrictHostKeyChecking=yes") && call.command === "/usr/bin/ssh"));
  await manager.stop();
  assert.equal((await manager.status()).socksListening, false);
  assert.ok(children.every(child => child.signalCode === "SIGTERM"));
});

test("occupied ports never spawn or kill external processes", async () => {
  const manager = createTunnelManager({ read: () => ({ tunnel: { ...DEFAULT_TUNNEL, keyFile: __filename } }) }, {
    probe: async () => true,
    spawnImpl() { throw new Error("Must not spawn"); },
  });
  await manager.start();
  assert.equal((await manager.status()).state, "external");
  await manager.stop();
  assert.equal((await manager.status()).socksListening, true);
});

test("group switch and custom tunnel update output without changing internet settings", () => {
  const internet = { proxies: [{ name: "Internet" }], rules: ["MATCH,Internet"], dns: { enable: true } };
  const company = { proxies: [{ name: "COMPANY", server: "127.0.0.1", port: 1080 }], rules: [] };
  assert.deepEqual(merge(internet, null, { company: { enabled: false } }), internet);
  const settings = validateSettings({ companyDomains: ["internal.example"], tunnel: { ...DEFAULT_TUNNEL, relayHost: "relay.example.com", socksPort: 1081 } });
  const output = merge(internet, company, settings);
  assert.equal(output.proxies[0].port, 1081);
  assert.ok(output.rules.includes("DOMAIN,relay.example.com,DIRECT"));
  assert.deepEqual(output.dns, internet.dns);
  assert.equal(company.proxies[0].port, 1080);
  assert.throws(() => validateSettings({ companyDomains: [], tunnel: { relayUser: "-oProxyCommand=bad" } }));
});
