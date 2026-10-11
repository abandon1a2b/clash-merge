"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { domainToASCII } = require("node:url");
const os = require("node:os");
const DEFAULT_DOMAINS = [];
const DEFAULT_SUBSCRIPTION = { profileName: "default.yaml", url: "", userAgent: "clash-verge" };
const DEFAULT_COMPANY = { enabled: true, profileName: "cc" };
const DEFAULT_TUNNEL = { relayHost: "relay.example.com", relayUser: "relay", companyUser: "user", keyFile: path.join(os.homedir(), ".ssh/id_ed25519"), relayPort: 2222, socksPort: 1080 };

function validateSettings(value) {
  if (!value || !Array.isArray(value.companyDomains) || value.companyDomains.length > 500) {
    throw new Error("companyDomains must be an array with at most 500 domains");
  }
  const domains = value.companyDomains.map((input) => {
    if (typeof input !== "string") throw new Error("Invalid domain");
    const domain = domainToASCII(input.trim().toLowerCase().replace(/^\*?\./, ""));
    if (!domain || domain.length > 253 || !domain.includes(".") ||
      !domain.split(".").every(part => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(part))) {
      throw new Error("Invalid domain");
    }
    return domain;
  });
  const result = { companyDomains: [...new Set(domains)] };
  const text = (v, max = 255) => {
    if (typeof v !== "string" || !v.trim() || v.length > max || /[\r\n\0]/.test(v)) throw new Error("Invalid setting");
    return v.trim();
  };
  if (value.subscription) {
    const sub = { ...DEFAULT_SUBSCRIPTION, ...value.subscription };
    sub.profileName = text(sub.profileName);
    sub.userAgent = text(sub.userAgent);
    if (typeof sub.url !== "string") throw new Error("Invalid subscription URL");
    sub.url = sub.url.trim();
    if (sub.url) {
      const url = new URL(sub.url);
      if (!["https:", "http:"].includes(url.protocol) || url.username || url.password || sub.url.length > 8192) throw new Error("Invalid subscription URL");
    }
    result.subscription = { profileName: sub.profileName, url: sub.url, userAgent: sub.userAgent };
  }
  if (value.company) {
    if (typeof value.company.enabled !== "boolean") throw new Error("Invalid company switch");
    result.company = { enabled: value.company.enabled, profileName: text(value.company.profileName) };
  }
  if (value.tunnel) {
    const tunnel = { ...DEFAULT_TUNNEL, ...value.tunnel };
    if (!/^[a-zA-Z0-9][a-zA-Z0-9.-]*$/.test(tunnel.relayHost)) throw new Error("Invalid relay host");
    for (const key of ["relayUser", "companyUser"]) {
      if (!/^[a-zA-Z0-9_][a-zA-Z0-9_.-]*$/.test(tunnel[key])) throw new Error("Invalid SSH user");
    }
    tunnel.keyFile = text(tunnel.keyFile, 4096);
    if (!path.isAbsolute(tunnel.keyFile)) throw new Error("SSH key path must be absolute");
    for (const key of ["relayPort", "socksPort"]) {
      if (!Number.isInteger(tunnel[key]) || tunnel[key] < 1024 || tunnel[key] > 65535) throw new Error("Invalid tunnel port");
    }
    if (tunnel.relayPort === tunnel.socksPort) throw new Error("Tunnel ports must differ");
    result.tunnel = Object.fromEntries(Object.keys(DEFAULT_TUNNEL).map(key => [key, tunnel[key]]));
  }
  return result;
}

function createSettingsStore(file) {
  return {
    read() {
      try { return validateSettings(JSON.parse(fs.readFileSync(file, "utf8"))); }
      catch (error) {
        if (error.code === "ENOENT") return { companyDomains: [...DEFAULT_DOMAINS] };
        throw error;
      }
    },
    save(value) {
      const settings = validateSettings(value);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      const temporary = `${file}.tmp`;
      fs.writeFileSync(temporary, `${JSON.stringify(settings, null, 2)}\n`, { mode: 0o600 });
      fs.renameSync(temporary, file);
      return settings;
    },
  };
}

module.exports = { createSettingsStore, validateSettings, DEFAULT_SUBSCRIPTION, DEFAULT_COMPANY, DEFAULT_TUNNEL };
