#!/usr/bin/env node
"use strict";

const http = require("node:http");
const path = require("node:path");
const { createPlanStore } = require("./src/plans");
const { createRuntime } = require("./src/runtime");
const { loadConfig } = require("./src/config");
const { createProfileStore } = require("./src/profiles");
const { createApplicationHandler } = require("./src/app");

const config = loadConfig();
const settingsStore = createPlanStore(path.join(__dirname, "data", "settings.json"));
settingsStore.save(settingsStore.read());
const profiles = createProfileStore(config.appDir);
const runtime = createRuntime(settingsStore, profiles, config);
const server = http.createServer(createApplicationHandler(runtime, settingsStore, profiles, config));

server.listen(config.port, config.host, () => {
  console.log(`Clash merge service listening on http://${config.host}:${config.port}/clash.yaml`);
  void runtime.refreshAll();
});

const timer = setInterval(() => void runtime.refreshAll().catch(() => console.error("Scheduled refresh failed")), config.refreshMinutes * 60_000);
timer.unref();

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, async () => {
    clearInterval(timer);
    await runtime.stopAll();
    server.close(() => process.exit(0));
  });
}
