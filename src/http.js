"use strict";
const fs = require("node:fs");
const path = require("node:path");

function createRequestHandler(service, { host, port }, settingsStore, { profiles, tunnel } = {}) {
  return async (request, response) => {
    if (request.headers.host !== `${host}:${port}`) {
      response.writeHead(403);
      response.end();
      return;
    }
    let pathname;
    try {
      pathname = new URL(request.url, `http://${host}:${port}`).pathname;
    } catch {
      response.writeHead(400);
      response.end();
      return;
    }
    const json = (status, value) => {
      response.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
      response.end(JSON.stringify(value));
    };
    if (["POST", "PUT", "DELETE"].includes(request.method) &&
      request.headers.origin && request.headers.origin !== `http://${host}:${port}`) {
      json(403, { error: "Origin rejected" });
      return;
    }
    if (pathname === "/" && request.method === "GET") {
      response.writeHead(200, {
        "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store",
        "Content-Security-Policy": "default-src 'self'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'",
      });
      response.end(fs.readFileSync(path.join(__dirname, "../public/index.html")));
      return;
    }
    if (pathname === "/api/profiles" && request.method === "GET" && profiles) {
      try { json(200, profiles.listProfiles()); } catch { json(500, { error: "Cannot read profiles" }); }
      return;
    }
    if (pathname === "/api/defaults" && request.method === "GET") {
      const { DEFAULT_SUBSCRIPTION, DEFAULT_COMPANY, DEFAULT_TUNNEL } = require("./settings");
      json(200, { subscription: DEFAULT_SUBSCRIPTION, company: DEFAULT_COMPANY, tunnel: DEFAULT_TUNNEL }); return;
    }
    if (pathname === "/api/tunnel" && request.method === "GET" && tunnel) {
      try { json(200, await tunnel.status()); } catch { json(500, { error: "Cannot read tunnel status" }); }
      return;
    }
    if (["/api/tunnel/start", "/api/tunnel/stop", "/api/tunnel/restart"].includes(pathname) && request.method === "POST" && tunnel) {
      try {
        if (pathname !== "/api/tunnel/start") await tunnel.stop();
        if (pathname !== "/api/tunnel/stop") await tunnel.start();
        json(200, await tunnel.status());
      } catch { json(500, { error: "Tunnel operation failed" }); }
      return;
    }
    if (pathname === "/api/settings" && settingsStore) {
      if (request.method === "GET") {
        try { json(200, settingsStore.read()); }
        catch { json(500, { error: "Cannot read settings" }); }
        return;
      }
      if (request.method === "PUT") {
        if (request.headers["content-type"] !== "application/json") {
          json(415, { error: "Expected application/json" }); return;
        }
        try {
          let body = "";
          for await (const chunk of request) {
            body += chunk;
            if (Buffer.byteLength(body) > 65536) { json(413, { error: "Settings too large" }); return; }
          }
          const { validateSettings } = require("./settings");
          let settings;
          try { settings = validateSettings(JSON.parse(body)); }
          catch { json(400, { error: "Invalid settings" }); return; }
          if (tunnel?.active && JSON.stringify(settings.tunnel) !== JSON.stringify(settingsStore.read().tunnel)) {
            json(409, { error: "Stop the managed tunnel before changing its settings" }); return;
          }
          try { profiles?.validateSources(settings, { host, port }); }
          catch { json(400, { error: "Invalid source profile or recursive subscription" }); return; }
          json(200, settingsStore.save(settings));
          service.invalidate?.();
        } catch { json(500, { error: "Cannot save settings" }); }
        return;
      }
    }
    if (pathname === "/health" && request.method === "GET") {
      const health = service.health();
      response.writeHead(health.status === "ok" ? 200 : 503, {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store",
      });
      response.end(JSON.stringify(health));
      return;
    }
    if (pathname === "/refresh" && request.method === "POST") {
      await service.refresh();
      response.writeHead(service.lastRefreshOk ? 200 : 502, {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store",
      });
      response.end(JSON.stringify({ refreshed: service.lastRefreshOk }));
      return;
    }
    if (pathname !== "/clash.yaml" || !["GET", "HEAD"].includes(request.method)) {
      response.writeHead(404);
      response.end();
      return;
    }
    await service.refresh();
    const config = service.currentConfig();
    if (!config) {
      response.writeHead(503, { "Content-Type": "text/plain; charset=utf-8" });
      response.end("Merged profile unavailable\n");
      return;
    }
    response.writeHead(200, {
      "Content-Type": "application/yaml; charset=utf-8",
      "Cache-Control": "no-store",
      ETag: config.etag,
      "X-Config-Source": config.source,
      "X-Config-Stale": String(config.stale),
    });
    response.end(request.method === "HEAD" ? undefined : config.yaml);
  };
}

module.exports = { createRequestHandler };
