"use strict";

const fs = require("node:fs");
const path = require("node:path");
const net = require("node:net");
const { validateSettings, DEFAULT_SUBSCRIPTION, DEFAULT_TUNNEL } = require("./settings");
const DEFAULT_DOMAINS = [];

function migrateSettings(value) {
  if (!value) return { version: 2, defaultPlanId: "default", plans: [{ id: "default", name: "默认方案", subscription: { ...DEFAULT_SUBSCRIPTION }, exits: [] }] };
  if (value?.version === 2) return validatePlans(value);
  const old = validateSettings(value || { companyDomains: DEFAULT_DOMAINS });
  const tunnel = { ...DEFAULT_TUNNEL, ...old.tunnel, relaySshPort: 22, remotePort: 2222 };
  return validatePlans({ version: 2, defaultPlanId: "office", plans: [{
    id: "office", name: "办公方案", subscription: { ...DEFAULT_SUBSCRIPTION, ...old.subscription },
    exits: [{ id: "internal", name: "内网出口", enabled: old.company?.enabled !== false,
      type: "ssh", server: "127.0.0.1", port: tunnel.socksPort, domains: old.companyDomains, tunnel }],
  }] });
}

function validatePlans(value) {
  const fail = message => { throw new Error(message); };
  const id = value => typeof value === "string" && /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/.test(value) ? value : fail("Invalid identifier");
  const name = value => typeof value === "string" && value.trim() && value.length <= 80 && !/[\r\n\0]/.test(value) ? value.trim() : fail("Invalid name");
  const port = value => Number.isInteger(value) && value >= 1 && value <= 65535 ? value : fail("Invalid port");
  if (value?.version !== 2 || !Array.isArray(value.plans) || !value.plans.length || value.plans.length > 20) fail("Expected 1 to 20 plans");
  const ids = new Set(), managedPorts = new Set();
  const plans = value.plans.map(plan => {
    const planId = id(plan.id);
    if (ids.has(planId)) fail("Duplicate plan identifier");
    ids.add(planId);
    const subscription = validateSettings({ companyDomains: [], subscription: plan.subscription || DEFAULT_SUBSCRIPTION }).subscription;
    if (!Array.isArray(plan.exits) || plan.exits.length > 30) fail("At most 30 exits per plan");
    const exitIds = new Set(), domainsSeen = new Set();
    const exits = plan.exits.map(exit => {
      const exitId = id(exit.id);
      if (exitIds.has(exitId)) fail("Duplicate exit identifier");
      exitIds.add(exitId);
      if (typeof exit.enabled !== "boolean" || !["ssh", "socks5", "http"].includes(exit.type)) fail("Invalid exit type");
      const domains = validateSettings({ companyDomains: exit.domains }).companyDomains;
      if (exit.enabled) for (const domain of domains) {
        if (domainsSeen.has(domain)) fail("A domain cannot belong to two enabled exits");
        domainsSeen.add(domain);
      }
      let tunnel;
      if (exit.type === "ssh") {
        tunnel = { ...validateSettings({ companyDomains: [], tunnel: exit.tunnel || DEFAULT_TUNNEL }).tunnel,
          relaySshPort: port(exit.tunnel?.relaySshPort ?? 22), remotePort: port(exit.tunnel?.remotePort ?? 2222) };
        if (exit.enabled) for (const p of [tunnel.relayPort, tunnel.socksPort]) {
          if (managedPorts.has(p)) fail("Enabled SSH exits must use distinct local ports across plans");
          managedPorts.add(p);
        }
      }
      const server = tunnel ? "127.0.0.1" : String(exit.server || "").trim();
      if (!server || server.length > 253 || (!net.isIP(server) && !/^[a-zA-Z0-9][a-zA-Z0-9.-]*$/.test(server))) fail("Invalid exit server");
      const result = { id: exitId, name: name(exit.name), enabled: exit.enabled, type: exit.type,
        server, port: tunnel ? tunnel.socksPort : port(exit.port), domains };
      if (tunnel) result.tunnel = tunnel;
      for (const key of ["username", "password"]) {
        if (exit[key] !== undefined && (typeof exit[key] !== "string" || exit[key].length > 512 || /[\r\n\0]/.test(exit[key]))) fail("Invalid proxy credentials");
        if (exit[key]) result[key] = exit[key];
      }
      return result;
    });
    return { id: planId, name: name(plan.name), subscription, exits };
  });
  if (!ids.has(value.defaultPlanId)) fail("Default plan is missing");
  return { version: 2, defaultPlanId: value.defaultPlanId, plans };
}

function createPlanStore(file) {
  function read() {
    try { return migrateSettings(JSON.parse(fs.readFileSync(file, "utf8"))); }
    catch (error) { if (error.code === "ENOENT") return migrateSettings(); throw error; }
  }
  function save(value) {
    const settings = validatePlans(value);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    if (fs.existsSync(file)) {
      const previous = JSON.parse(fs.readFileSync(file, "utf8"));
      if (previous.version !== 2 && !fs.existsSync(`${file}.v1-backup`)) fs.copyFileSync(file, `${file}.v1-backup`);
    }
    fs.writeFileSync(`${file}.tmp`, `${JSON.stringify(settings, null, 2)}\n`, { mode: 0o600 });
    fs.renameSync(`${file}.tmp`, file);
    return settings;
  }
  return { read, save };
}

module.exports = { migrateSettings, validatePlans, createPlanStore };
