"use strict";

const crypto = require("node:crypto");
const YAML = require("yaml");
const { merge } = require("./merge");
const { parseYaml } = require("./profiles");

function createMergeService(profiles, { fetchImpl = fetch, logger = console, settingsStore, localPort = 18790 } = {}) {
  let upstream = null;
  let refreshInFlight = null;
  let lastRefreshAt = null;
  let lastRefreshOk = null;
  let lastGood = null;

  function build() {
    const sources = profiles.readSources();
    const sourceKey = JSON.stringify([sources.internetItem.url, sources.internetItem.option?.user_agent]);
    const useUpstream = upstream && upstream.sourceKey === sourceKey && (!sources.localInternet
      || upstream.fetchedAt >= sources.localInternet.modifiedAt);
    if (!useUpstream && !sources.localInternet) {
      throw new Error("No valid MySSR source is available");
    }
    const internet = useUpstream ? upstream.value : sources.localInternet.value;
    const yaml = YAML.stringify(merge(internet, sources.company, settingsStore?.read()), { lineWidth: 0 });
    lastGood = {
      yaml,
      etag: `"${crypto.createHash("sha256").update(yaml).digest("hex")}"`,
      source: useUpstream ? "direct-refresh" : "clash-cache",
      generatedAt: new Date().toISOString(),
    };
    return { ...lastGood, stale: false };
  }

  function currentConfig() {
    try {
      return build();
    } catch {
      return lastGood ? { ...lastGood, stale: true } : null;
    }
  }

  async function refresh() {
    if (refreshInFlight) return refreshInFlight;
    refreshInFlight = (async () => {
      try {
        const { internetItem, company } = profiles.readSources();
        if (typeof internetItem.url !== "string") {
          throw new Error("MySSR subscription URL is missing");
        }
        const subscriptionUrl = new URL(internetItem.url);
        if (["127.0.0.1", "localhost", "[::1]"].includes(subscriptionUrl.hostname) && Number(subscriptionUrl.port || 80) === localPort) {
          throw new Error("The merge service cannot subscribe to itself");
        }
        const headers = { "Cache-Control": "no-cache", "User-Agent": "clash-verge" };
        if (internetItem.option?.user_agent) {
          headers["User-Agent"] = internetItem.option.user_agent;
        }
        const response = await fetchImpl(internetItem.url, {
          headers,
          signal: AbortSignal.timeout(15000),
        });
        if (!response.ok) throw new Error(`Upstream HTTP ${response.status}`);
        const length = Number(response.headers.get("content-length"));
        if (length > 10_000_000) throw new Error("Subscription exceeds size limit");
        const raw = await response.text();
        if (raw.length > 10_000_000) throw new Error("Subscription exceeds size limit");
        const value = parseYaml(raw);
        if (!Array.isArray(value.proxies) || !value.proxies.length) {
          throw new Error("Subscription has no proxy nodes");
        }
        merge(value, company, settingsStore?.read());
        upstream = { value, fetchedAt: Date.now(), sourceKey: JSON.stringify([internetItem.url, internetItem.option?.user_agent]) };
        lastRefreshOk = true;
        lastRefreshAt = new Date().toISOString();
        logger.log(`MySSR refresh succeeded at ${lastRefreshAt}`);
      } catch {
        lastRefreshOk = false;
        lastRefreshAt = new Date().toISOString();
        // Subscription URLs may contain credentials. Never log the URL or raw error.
        logger.error(`MySSR refresh failed at ${lastRefreshAt}; cached profile remains available`);
      }
    })();
    try {
      await refreshInFlight;
    } finally {
      refreshInFlight = null;
    }
  }

  async function waitForRefresh() {
    if (refreshInFlight) await refreshInFlight;
  }

  function health() {
    const config = currentConfig();
    return {
      status: config ? "ok" : "unavailable",
      source: config?.source || null,
      stale: config?.stale ?? true,
      lastRefreshAt,
      lastRefreshOk,
    };
  }

  function invalidate() { upstream = null; lastGood = null; }

  return { currentConfig, refresh, waitForRefresh, health, invalidate, get lastRefreshOk() { return lastRefreshOk; } };
}

module.exports = { createMergeService };
