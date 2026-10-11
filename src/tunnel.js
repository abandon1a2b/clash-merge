"use strict";

const { spawn, execFile } = require("node:child_process");
const { promisify } = require("node:util");
const net = require("node:net");
const fs = require("node:fs");
const { DEFAULT_TUNNEL } = require("./settings");
const execute = promisify(execFile);

async function listenerProcesses(port) {
  try {
    const { stdout } = await execute("lsof", ["-nP", `-iTCP:${port}`, "-sTCP:LISTEN", "-Fpc"], { timeout: 1500, maxBuffer: 16384 });
    const processes = [];
    for (const line of stdout.split("\n")) {
      if (/^p\d+$/.test(line)) processes.push({ pid: Number(line.slice(1)), name: "" });
      else if (line.startsWith("c") && processes.length) processes.at(-1).name = line.slice(1);
    }
    return { processes };
  } catch (error) {
    return { processes: [], error: error.code === 1 ? "未找到监听进程，可能已退出或无权限查看。" : "无法读取监听进程信息。" };
  }
}

function isListening(port, host = "127.0.0.1") {
  return new Promise(resolve => {
    const socket = net.connect({ host, port });
    const done = value => { socket.destroy(); resolve(value); };
    socket.setTimeout(500);
    socket.once("connect", () => done(true));
    socket.once("error", () => done(false));
    socket.once("timeout", () => done(false));
  });
}

function createTunnelManager(settingsStore, { spawnImpl = spawn, probe = isListening, inspectListeners = listenerProcesses } = {}) {
  let children = [], timer, generation = 0, desired = false, state = "stopped", busy = false;
  const logs = [];
  const diagnosticLogs = [];
  let lastObservation, listenerInfo = [], inspectedAt = 0;
  const log = message => {
    logs.push({ time: new Date().toISOString(), message });
    if (logs.length > 60) logs.shift();
  };
  const config = () => ({ ...DEFAULT_TUNNEL, ...settingsStore.read().tunnel });
  async function cleanup() {
    clearTimeout(timer);
    const owned = children;
    children = [];
    await Promise.all(owned.map(child => new Promise(resolve => {
      if (child.exitCode !== null || child.signalCode) return resolve();
      const timeout = setTimeout(() => child.kill("SIGKILL"), 2000);
      child.once("exit", () => { clearTimeout(timeout); resolve(); });
      child.kill("SIGTERM");
    })));
  }
  function launch(args, token) {
    const child = spawnImpl("/usr/bin/ssh", args, { stdio: ["ignore", "ignore", "pipe"] });
    children.push(child);
    child.stderr.on("data", chunk => {
      const message = String(chunk);
      if (/Permission denied/i.test(message)) log("SSH authentication failed");
      else if (/Host key verification failed|REMOTE HOST IDENTIFICATION HAS CHANGED/i.test(message)) log("SSH host key verification failed");
      else if (/refused|timed out|No route/i.test(message)) log("SSH connection failed");
    });
    child.on("error", () => log("Unable to launch SSH"));
    child.once("exit", () => {
      if (token === generation && desired && state === "connected") void retry(token);
    });
    return child;
  }
  const alive = child => child.exitCode === null && !child.signalCode;
  async function ready(port, child, token) {
    for (let i = 0; i < 40; i++) {
      if (token !== generation || !alive(child)) return false;
      if (await probe(port)) return alive(child) && token === generation;
      await new Promise(resolve => setTimeout(resolve, 250));
    }
    return false;
  }
  async function retry(token) {
    if (token !== generation || !desired || state === "retrying") return;
    state = "retrying";
    log("Tunnel disconnected; retrying in 10 seconds");
    await cleanup();
    if (token === generation && desired) timer = setTimeout(() => void connect(token), 10000);
  }
  async function connect(token) {
    try {
      const c = config();
      if (token !== generation || !desired) return;
      if (await probe(c.relayPort) || await probe(c.socksPort)) {
        if (token !== generation) return;
        state = "external"; desired = false; log("Local port is occupied; existing processes were left untouched"); return;
      }
      if (token !== generation || !desired) return;
      state = "connecting";
      const common = ["-N", "-T", "-i", c.keyFile, "-o", "IdentitiesOnly=yes", "-o", "BatchMode=yes", "-o", "StrictHostKeyChecking=yes", "-o", "ExitOnForwardFailure=yes", "-o", "ConnectTimeout=10", "-o", "ServerAliveInterval=30", "-o", "ServerAliveCountMax=3"];
      const relay = launch([...common, "-p", String(c.relaySshPort || 22), "-L", `127.0.0.1:${c.relayPort}:127.0.0.1:${c.remotePort || 2222}`, `${c.relayUser}@${c.relayHost}`], token);
      if (!await ready(c.relayPort, relay, token)) { await retry(token); return; }
      log("Relay connected");
      const socks = launch([...common, "-p", String(c.relayPort), "-D", `127.0.0.1:${c.socksPort}`, `${c.companyUser}@127.0.0.1`], token);
      if (!await ready(c.socksPort, socks, token) || !alive(relay)) { await retry(token); return; }
      if (token !== generation || !desired) return;
      state = "connected"; log("SOCKS5 listener ready");
    } catch { if (token === generation && desired) await retry(token); }
  }
  async function start() {
    if (busy || desired) return;
    busy = true;
    try {
      fs.accessSync(config().keyFile, fs.constants.R_OK);
      desired = true;
      await connect(++generation);
    } catch { state = "error"; desired = false; log("SSH key is missing or unreadable"); }
    finally { busy = false; }
  }
  async function stop() {
    desired = false; generation++; state = "stopped";
    await cleanup(); log("Managed tunnel stopped");
  }
  async function status() {
    const c = config();
    const socksListening = await probe(c.socksPort), relayListening = await probe(c.relayPort);
    const observation = `${c.socksPort}:${socksListening}/${c.relayPort}:${relayListening}/${desired}`;
    if (observation !== lastObservation) {
      diagnosticLogs.push({ time: new Date().toISOString(), message: `SOCKS 端口 ${c.socksPort}：${socksListening ? "已监听" : "未监听"}；转发端口 ${c.relayPort}：${relayListening ? "已监听" : "未监听"}；归属：${desired ? "本服务管理" : "外部或未启动"}` });
      if (diagnosticLogs.length > 60) diagnosticLogs.shift();
    }
    if (!desired && (socksListening || relayListening) && (observation !== lastObservation || Date.now() - inspectedAt > 10000)) {
      listenerInfo = await Promise.all([["SOCKS", c.socksPort, socksListening], ["转发", c.relayPort, relayListening]].filter(([, , listening]) => listening).map(async ([role, port]) => ({ role, port, ...await inspectListeners(port) })));
      inspectedAt = Date.now();
    } else if (desired || (!socksListening && !relayListening)) listenerInfo = [];
    lastObservation = observation;
    return { state, managed: desired, busy, socksListening, relayListening, logs: [...logs], diagnosticLogs: [...diagnosticLogs], listenerInfo };
  }
  return { start, stop, status, get active() { return desired || busy; } };
}

module.exports = { createTunnelManager, isListening };
