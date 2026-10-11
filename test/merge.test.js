"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { merge } = require("../src/merge");

test("reject self, indirect and dialer proxy cycles while allowing shared acyclic groups", () => {
  const config = groups => ({ proxies: [{ name: "node" }], rules: ["MATCH,DIRECT"], "proxy-groups": groups });
  for (const groups of [[{ name: "A", proxies: ["A"] }], [{ name: "A", proxies: ["B"] }, { name: "B", proxies: ["A"] }]]) {
    assert.throws(() => merge(config(groups), null, { exits: [] }), /Circular/);
    assert.throws(() => merge(config(groups), null, { company: { enabled: false } }), /Circular/);
  }
  const dialer = config([{ name: "A", proxies: ["node"] }]);
  dialer.proxies[0]["dialer-proxy"] = "A";
  assert.throws(() => merge(dialer, null, { exits: [] }), /Circular/);
  assert.doesNotThrow(() => merge(config([{ name: "A", proxies: ["node", "DIRECT"] }, { name: "B", proxies: ["A", "node"] }]), null, { exits: [] }));
});

test("legacy merge preserves explicit company rules without injecting personal domains", () => {
  const internet = {
    proxies: [{ name: "Internet" }],
    rules: ["MATCH,Internet"],
    dns: { enable: false },
  };
  const company = {
    proxies: [{ name: "COMPANY", type: "socks5", port: 1080 }],
    rules: [
      "DOMAIN,api.internal.example,COMPANY",
      "DOMAIN,api.tools.example,COMPANY",
      "MATCH,DIRECT",
    ],
    dns: { enable: true },
  };
  const result = merge(internet, company);
  assert.deepEqual(result.rules, [
    "DOMAIN,api.internal.example,COMPANY",
    "DOMAIN,api.tools.example,COMPANY",
    "MATCH,Internet",
  ]);
  assert.deepEqual(result.proxies.map((proxy) => proxy.name), ["COMPANY", "Internet"]);
  assert.deepEqual(result.dns, internet.dns);
  assert.deepEqual(internet.rules, ["MATCH,Internet"]);
  assert.deepEqual(company.rules[0], "DOMAIN,api.internal.example,COMPANY");
});

test("company network settings do not override the working internet profile", () => {
  const internet = {
    proxies: [{ name: "Internet" }], rules: ["MATCH,Internet"],
    mode: "rule", "mixed-port": 7897, dns: { nameserver: ["https://dns.example/dns-query"] },
    tun: { enable: false },
  };
  const company = {
    proxies: [{ name: "COMPANY" }], rules: ["MATCH,DIRECT"],
    mode: "global", "mixed-port": 7890, dns: { nameserver: ["223.5.5.5"] },
    tun: { enable: true, "strict-route": true },
  };
  const result = merge(internet, company);
  for (const key of ["mode", "mixed-port", "dns", "tun"]) {
    assert.deepEqual(result[key], internet[key]);
  }
  delete internet.tun;
  assert.equal(Object.hasOwn(merge(internet, company), "tun"), false);
});

test("missing company rule target rejects an unusable merged profile", () => {
  assert.throws(() => merge(
    { proxies: [{ name: "Internet" }], rules: ["MATCH,Internet"] },
    { proxies: [{ name: "COMPANY" }], rules: ["DOMAIN,internal.example,MISSING"] },
  ), /Company rule target is missing/);
});
