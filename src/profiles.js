"use strict";

const fs = require("node:fs");
const path = require("node:path");
const YAML = require("yaml");

function parseYaml(raw) {
  const value = YAML.parse(raw);
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("YAML root must be a mapping");
  }
  return value;
}

function createProfileStore(appDir, settingsStore) {
  const profilesDir = path.join(appDir, "profiles");
  const indexPath = path.join(appDir, "profiles.yaml");

  function readProfile(item) {
    if (!item.file || path.basename(item.file) !== item.file) {
      throw new Error("Invalid profile filename");
    }
    const file = path.join(profilesDir, item.file);
    return {
      value: parseYaml(fs.readFileSync(file, "utf8")),
      modifiedAt: fs.statSync(file).mtimeMs,
    };
  }

  function readSources(settings = settingsStore?.read()) {
    let index;
    try { index = parseYaml(fs.readFileSync(indexPath, "utf8")); }
    catch (error) { if (error.code === "ENOENT" && settings?.subscription?.url) index = { items: [] }; else throw error; }
    const items = Array.isArray(index.items) ? index.items : [];
    const find = (name, type) => items.find(
      (item) => item.name === name && item.type === type,
    );
    const internetItem = find(settings?.subscription?.profileName || "default.yaml", "remote");
    const companyItem = find(settings?.company?.profileName || "cc", "local");
    if ((!internetItem && !settings?.subscription?.url) || (!companyItem && settings?.company?.enabled !== false)) {
      throw new Error("Required source profile is missing");
    }
    let localInternet = null;
    try {
      localInternet = readProfile(internetItem);
    } catch {
      // Clash Verge can briefly replace its cache during a refresh.
    }
    if (settings?.subscription?.url && settings.subscription.url !== internetItem?.url) localInternet = null;
    return {
      internetItem: { ...internetItem, ...(settings?.subscription?.url ? { url: settings.subscription.url } : {}),
        option: { ...internetItem?.option, ...(settings?.subscription?.userAgent ? { user_agent: settings.subscription.userAgent } : {}) } },
      localInternet,
      company: settings?.company?.enabled === false ? null : readProfile(companyItem).value,
    };
  }

  function listProfiles() {
    let index;
    try { index = parseYaml(fs.readFileSync(indexPath, "utf8")); }
    catch (error) { if (error.code === "ENOENT") return []; throw error; }
    return (index.items || []).filter(item => ["remote", "local"].includes(item.type))
      .map(item => ({ name: item.name, type: item.type }));
  }
  function validateSources(settings, { host, port }) {
    if (!settings.subscription?.url && !listProfiles().some(item => item.type === "remote" && item.name === settings.subscription?.profileName)) return;
    const sources = readSources(settings);
    const url = new URL(sources.internetItem.url);
    if ([host, "localhost", "[::1]"].includes(url.hostname) && Number(url.port || 80) === port) {
      throw new Error("Cannot subscribe to the merge service itself");
    }
  }
  return { readSources, listProfiles, validateSources };
}

module.exports = { createProfileStore, parseYaml };
