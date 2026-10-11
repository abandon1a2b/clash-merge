"use strict";

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { DEFAULT_SUBSCRIPTION, DEFAULT_TUNNEL } = require("./settings");
const { agentDocs, agentSkill } = require("./agent-docs");

function isLoopback(address) {
  return address === "::1" || /^(?:127\.|::ffff:127\.)/.test(address || "");
}

function createApplicationHandler(runtime, store, profiles, { host, port }) {
  const uiDir = path.join(__dirname, "../public/app");
  const revision = settings => `"${crypto.createHash("sha256").update(JSON.stringify(settings)).digest("hex")}"`;
  return async (request, response) => {
    const json = (status, value, headers = {}) => {
      response.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...headers });
      response.end(JSON.stringify(value));
    };
    if (!isLoopback(request.socket?.remoteAddress)) { json(403, { error: "Local connections only" }); return; }
    if (request.headers.host !== `${host}:${port}`) { json(403, { error: "Host rejected" }); return; }
    if (request.headers.origin && request.headers.origin !== `http://${host}:${port}` && !["GET", "HEAD"].includes(request.method)) {
      json(403, { error: "Origin rejected" }); return;
    }
    try {
      const url = new URL(request.url, `http://${host}:${port}`);
      const pathname = url.pathname;
      if (pathname === "/api/docs" && request.method === "GET") { json(200, agentDocs(`http://${host}:${port}`)); return; }
      if (pathname === "/api/skill" && request.method === "GET") {
        response.writeHead(200, { "Content-Type": "text/markdown; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" });
        response.end(agentSkill(`http://${host}:${port}`)); return;
      }
      if (pathname === "/api/settings") {
        if (request.method === "GET") { const settings = store.read(); json(200, settings, { ETag: revision(settings) }); return; }
        if (request.method === "PUT") {
          if (request.headers["content-type"]?.split(";")[0] !== "application/json") { json(415, { error: "Expected JSON" }); return; }
          let body = "";
          for await (const chunk of request) { body += chunk; if (Buffer.byteLength(body) > 2_000_000) { json(413, { error: "Settings too large" }); return; } }
          if (request.headers["if-match"] && request.headers["if-match"] !== revision(store.read())) { json(409, { error: "配置已被其他页面更新，请重新加载" }); return; }
          try {
            const settings = runtime.save(JSON.parse(body));
            json(200, settings, { ETag: revision(settings) });
          } catch (error) {
            const message = /Stop the managed/.test(error.message) ? "请先停止正在守护的出口，再修改隧道、停用或删除出口。" : "配置无效：检查域名重复、端口冲突、订阅来源或自引用。";
            json(400, { error: message });
          }
          return;
        }
      }
      if (pathname === "/api/profiles" && request.method === "GET") { json(200, profiles.listProfiles()); return; }
      if (pathname === "/api/defaults" && request.method === "GET") {
        json(200, { subscription: DEFAULT_SUBSCRIPTION, tunnel: { ...DEFAULT_TUNNEL, relaySshPort: 22, remotePort: 2222 } }); return;
      }
      const planRoute = pathname.match(/^\/api\/plans\/([a-zA-Z0-9_-]+)\/(health|refresh|exits|preview)$/);
      if (planRoute) {
        const [, id, operation] = planRoute;
        if (!store.read().plans.some(plan => plan.id === id)) { json(404, { error: "方案不存在" }); return; }
        if (operation === "health" && request.method === "GET") { json(200, runtime.service(id).health()); return; }
        if (operation === "exits" && request.method === "GET") { json(200, await runtime.statuses(id)); return; }
        if (operation === "preview" && request.method === "GET") {
          const result = runtime.service(id).currentConfig();
          json(result ? 200 : 503, result || { error: "订阅暂不可用，请先刷新默认订阅。" }); return;
        }
        if (operation === "refresh" && request.method === "POST") {
          const service = runtime.service(id); await service.refresh(); json(service.lastRefreshOk ? 200 : 502, service.health()); return;
        }
      }
      const action = pathname.match(/^\/api\/plans\/([a-zA-Z0-9_-]+)\/exits\/([a-zA-Z0-9_-]+)\/(start|stop|restart)$/);
      if (action && request.method === "POST") {
        try { json(200, await runtime.action(action[1], action[2], action[3])); }
        catch { json(400, { error: "出口操作失败，请确认出口已启用并保存。" }); }
        return;
      }
      if (pathname === "/health" && request.method === "GET") { const health = runtime.service().health(); json(health.status === "ok" ? 200 : 503, health); return; }
      if (pathname === "/refresh" && request.method === "POST") { const service = runtime.service(); await service.refresh(); json(service.lastRefreshOk ? 200 : 502, { refreshed: service.lastRefreshOk }); return; }
      const subscription = pathname.match(/^\/subscriptions\/([a-zA-Z0-9_-]+)\/clash\.yaml$/);
      if ((subscription || pathname === "/clash.yaml") && ["GET", "HEAD"].includes(request.method)) {
        const id = subscription?.[1];
        if (id && !store.read().plans.some(plan => plan.id === id)) { json(404, { error: "方案不存在" }); return; }
        const service = runtime.service(id); await service.refresh(); const config = service.currentConfig();
        if (!config) { json(503, { error: "订阅暂不可用，请检查来源" }); return; }
        response.writeHead(200, { "Content-Type": "application/yaml; charset=utf-8", "Cache-Control": "no-store", ETag: config.etag, "X-Config-Source": config.source, "X-Config-Stale": String(config.stale), ...(config.usage ? { "Subscription-Userinfo": config.usage.header } : {}) });
        response.end(request.method === "HEAD" ? undefined : config.yaml); return;
      }
      if (["GET", "HEAD"].includes(request.method) && (pathname === "/" || /^\/assets\/[a-zA-Z0-9_.-]+$/.test(pathname))) {
        const file = path.join(uiDir, pathname === "/" ? "index.html" : pathname);
        if (!fs.existsSync(file)) { json(503, { error: "请先运行 npm run build" }); return; }
        const type = file.endsWith(".js") ? "text/javascript" : file.endsWith(".css") ? "text/css" : file.endsWith(".svg") ? "image/svg+xml" : "text/html";
        response.writeHead(200, { "Content-Type": `${type}; charset=utf-8`, "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", "Content-Security-Policy": "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'" });
        response.end(request.method === "HEAD" ? undefined : fs.readFileSync(file)); return;
      }
      json(404, { error: "Not found" });
    } catch { if (!response.headersSent) json(500, { error: "服务暂不可用" }); else response.end(); }
  };
}

module.exports = { createApplicationHandler, isLoopback };
