"use strict";

const BUILTIN_TARGETS = new Set(["DIRECT", "REJECT", "REJECT-DROP", "PASS"]);
const net = require("node:net");

function merge(internet, company, settings) {
  if (!Array.isArray(internet.proxies) || !internet.proxies.length) {
    throw new Error("MySSR has no proxy nodes");
  }
  if (!Array.isArray(internet.rules)) {
    throw new Error("MySSR has no rules");
  }
  if (settings?.exits) return mergeExits(internet, settings.exits);
  if (settings?.company?.enabled === false) return structuredClone(internet);
  if (!Array.isArray(company.proxies) || !company.proxies.length) {
    throw new Error("cc has no company proxy");
  }
  if (!Array.isArray(company.rules)) {
    throw new Error("cc has no rules");
  }

  const merged = structuredClone(internet);
  company = structuredClone(company);
  if (settings?.tunnel) {
    const proxy = company.proxies.find(proxy => proxy.name === "COMPANY");
    if (proxy) { proxy.server = "127.0.0.1"; proxy.port = settings.tunnel.socksPort; }
    const host = settings.tunnel.relayHost;
    company.rules.unshift("PROCESS-NAME,ssh,DIRECT", "IP-CIDR,127.0.0.0/8,DIRECT,no-resolve",
      /^\d+\.\d+\.\d+\.\d+$/.test(host) ? `IP-CIDR,${host}/32,DIRECT,no-resolve` : `DOMAIN,${host},DIRECT`);
  }
  const companyNames = new Set(company.proxies.map((proxy) => proxy.name));
  if (internet.proxies.some((proxy) => companyNames.has(proxy.name))) {
    throw new Error("Company proxy name conflicts with MySSR");
  }
  merged.proxies = [...structuredClone(company.proxies), ...merged.proxies];
  const companyRules = [...new Set([...company.rules
    .filter((rule) => !rule.startsWith("MATCH,"))
    .filter((rule) => !settings || !/^DOMAIN(?:-SUFFIX)?,[^,]+,COMPANY$/.test(rule)),
  ...(settings ? settings.companyDomains.map(domain => `DOMAIN-SUFFIX,${domain},COMPANY`) : [])])];
  merged.rules = [...companyRules, ...merged.rules];

  const targets = new Set(merged.proxies.map((proxy) => proxy.name));
  for (const rule of companyRules) {
    const target = rule.split(",")[2];
    if (target && !BUILTIN_TARGETS.has(target) && !targets.has(target)) {
      throw new Error(`Company rule target is missing: ${target}`);
    }
  }
  return merged;
}

function mergeExits(internet, exits) {
  const merged = structuredClone(internet);
  const names = new Set([...merged.proxies.map(p => p.name), ...(merged["proxy-groups"] || []).map(g => g.name), ...BUILTIN_TARGETS]);
  const bypass = [], rules = [], proxies = [];
  for (const exit of exits.filter(exit => exit.enabled)) {
    const name = `EXIT-${exit.id}`;
    if (names.has(name)) throw new Error("Exit name conflicts with subscription");
    names.add(name);
    const proxy = { name, type: exit.type === "ssh" ? "socks5" : exit.type, server: exit.server, port: exit.port };
    for (const key of ["username", "password"]) if (exit[key]) proxy[key] = exit[key];
    proxies.push(proxy);
    if (exit.type === "ssh") bypass.push("PROCESS-NAME,ssh,DIRECT");
    bypass.push("IP-CIDR,127.0.0.0/8,DIRECT,no-resolve");
    const host = exit.tunnel?.relayHost || exit.server;
    if (net.isIP(host) === 4) bypass.push(`IP-CIDR,${host}/32,DIRECT,no-resolve`);
    else if (net.isIP(host) === 6) bypass.push(`IP-CIDR6,${host}/128,DIRECT,no-resolve`);
    else bypass.push(`DOMAIN,${host},DIRECT`);
    for (const domain of exit.domains) rules.push(`DOMAIN-SUFFIX,${domain},${name}`);
  }
  merged.proxies = [...proxies, ...merged.proxies];
  merged.rules = [...new Set(bypass), ...rules, ...merged.rules];
  return merged;
}

module.exports = { merge, mergeExits };
