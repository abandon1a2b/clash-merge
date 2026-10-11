"use strict";

const { createMergeService } = require("./service");
const { createTunnelManager, isListening } = require("./tunnel");
const { validatePlans } = require("./plans");

function createRuntime(store, profiles, config, options = {}) {
  const services = new Map(), tunnels = new Map();
  const getPlan = id => {
    const settings = store.read();
    const plan = settings.plans.find(plan => plan.id === (id || settings.defaultPlanId));
    if (!plan) throw new Error("Plan not found");
    return plan;
  };
  const sourceSettings = plan => ({ subscription: plan.subscription, company: { enabled: false } });
  function service(id) {
    const plan = getPlan(id);
    if (!services.has(plan.id)) {
      const read = () => getPlan(plan.id);
      services.set(plan.id, createMergeService({ readSources: () => profiles.readSources(sourceSettings(read())) },
        { ...options, settingsStore: { read }, localPort: config.port }));
    }
    return services.get(plan.id);
  }
  function tunnel(planId, exitId) {
    const plan = getPlan(planId);
    const exit = plan.exits.find(exit => exit.id === exitId);
    if (!exit || exit.type !== "ssh") throw new Error("SSH exit not found");
    const key = `${plan.id}/${exitId}`;
    if (!tunnels.has(key)) tunnels.set(key, createTunnelManager({ read: () => {
      const current = getPlan(plan.id).exits.find(exit => exit.id === exitId);
      return { tunnel: current.tunnel };
    } }, options.tunnelOptions));
    return tunnels.get(key);
  }
  async function statuses(id) {
    const plan = getPlan(id);
    return Object.fromEntries(await Promise.all(plan.exits.map(async exit => [exit.id,
      exit.type === "ssh" ? await tunnel(plan.id, exit.id).status() : { state: "external", managed: false, listening: await isListening(exit.port, exit.server), logs: [] }])));
  }
  function save(value) {
    const settings = validatePlans(value);
    const old = store.read();
    for (const plan of settings.plans) profiles.validateSources(sourceSettings(plan), config);
    for (const [key, manager] of tunnels) {
      if (!manager.active) continue;
      const [planId, exitId] = key.split("/");
      const before = old.plans.find(plan => plan.id === planId)?.exits.find(exit => exit.id === exitId);
      const after = settings.plans.find(plan => plan.id === planId)?.exits.find(exit => exit.id === exitId);
      if (!after?.enabled || after.type !== "ssh" || JSON.stringify(before.tunnel) !== JSON.stringify(after.tunnel)) {
        throw new Error("Stop the managed exit before disabling, deleting or changing its tunnel");
      }
    }
    const result = store.save(settings);
    for (const [id, current] of services) {
      if (!settings.plans.some(plan => plan.id === id)) services.delete(id);
      else current.invalidate();
    }
    for (const key of tunnels.keys()) {
      const [planId, exitId] = key.split("/");
      if (!settings.plans.find(plan => plan.id === planId)?.exits.some(exit => exit.id === exitId && exit.type === "ssh")) tunnels.delete(key);
    }
    return result;
  }
  async function action(planId, exitId, action) {
    const plan = getPlan(planId), exit = plan.exits.find(exit => exit.id === exitId);
    if (!exit?.enabled && action !== "stop") throw new Error("Enable and save the exit before starting it");
    const manager = tunnel(plan.id, exitId);
    if (action !== "start") await manager.stop();
    if (action !== "stop") await manager.start();
    return manager.status();
  }
  async function refreshAll() {
    await Promise.all(store.read().plans.map(plan => service(plan.id).refresh()));
  }
  async function stopAll() { await Promise.all([...tunnels.values()].map(manager => manager.stop())); }
  return { getPlan, service, save, statuses, action, refreshAll, stopAll };
}

module.exports = { createRuntime };
