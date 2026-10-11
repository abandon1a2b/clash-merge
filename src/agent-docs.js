"use strict";

function agentDocs(baseUrl) {
  return {
    version: 1, baseUrl, skill: "/api/skill",
    access: { localOnly: true, remoteAddress: "IPv4/IPv6 loopback only; forwarded headers are ignored", host: new URL(baseUrl).host, origin: "Mutations reject a different Origin. CLI requests may omit Origin." },
    endpoints: [
      { method: "GET", path: "/api/skill", response: "text/markdown; agent workflow" },
      { method: "GET", path: "/api/docs", response: "This JSON document" },
      { method: "GET", path: "/api/settings", response: "Settings document; ETag response header" },
      { method: "PUT", path: "/api/settings", request: "Full Settings document, Content-Type: application/json; use If-Match from GET", response: "Normalized saved settings and new ETag", errors: { 400: "Invalid settings or managed exit must be stopped", 409: "Revision conflict; reread and reapply intended change", 413: "Body exceeds 2 MB", 415: "Expected JSON" } },
      { method: "GET", path: "/api/defaults", response: "subscription and tunnel defaults; do not invent SSH credentials" },
      { method: "GET", path: "/api/profiles", response: "Available local Clash profile descriptors" },
      { method: "GET", path: "/api/plans/{planId}/health", response: "Subscription refresh/cache health" },
      { method: "GET", path: "/api/plans/{planId}/exits", response: "Exit ID keyed runtime status, ownership and logs; SSH diagnosticLogs contains observed listener transitions and listenerInfo contains port, process name/PID or inspection error. These are not external SSH stdout/stderr." },
      { method: "POST", path: "/api/plans/{planId}/refresh", response: "Subscription health; 502 on upstream refresh failure" },
      { method: "GET", path: "/api/plans/{planId}/preview", response: "Generated config including yaml, etag, source, stale; 503 if unavailable" },
      ...["start", "stop", "restart"].map(action => ({ method: "POST", path: `/api/plans/{planId}/exits/{exitId}/${action}`, request: "No body; saved enabled SSH exit", response: "Runtime status; 400 on action failure" })),
      { method: "GET", path: "/subscriptions/{planId}/clash.yaml", response: "Generated YAML; refreshes source; also supports HEAD" },
      { method: "GET", path: "/clash.yaml", response: "Default plan subscription YAML; also supports HEAD" },
      { method: "GET", path: "/health", response: "Default plan health; 503 if unhealthy" },
      { method: "POST", path: "/refresh", response: "Default plan refresh; 502 on failure" },
    ],
    settings: {
      version: 2, defaultPlanId: "Must reference an existing plan ID",
      plans: [{ id: "Unique identifier: /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/", name: "1–80 characters", subscription: { profileName: "Local profile name", url: "HTTP(S) URL or empty to use profile; no credentials or self-reference", userAgent: "Nonempty string" }, exits: [{ id: "Unique identifier within plan", name: "1–80 characters", enabled: "boolean", type: "ssh | socks5 | http", server: "Hostname or IP; SSH normalized to 127.0.0.1", port: "Integer 1–65535; SSH normalized to tunnel.socksPort", domains: ["Domain suffix without scheme/path; optional leading dot or *. normalized"], username: "Optional proxy username", password: "Optional proxy password", tunnel: { relayHost: "SSH relay hostname", relayUser: "Relay SSH user", companyUser: "Target SSH user", keyFile: "Absolute local private key path; never key contents", relaySshPort: "1–65535; default 22", remotePort: "1–65535; default 2222", relayPort: "Local forwarding port 1024–65535", socksPort: "Local SOCKS port 1024–65535" } }] }],
    },
    constraints: ["1–20 plans; 0–30 exits per plan; 0–500 domain inputs per exit", "Exact domains cannot belong to multiple enabled exits in a plan", "Enabled SSH relayPort and socksPort must be distinct across all plans", "Exit order determines overlapping domain suffix priority", "Stop a managed guardian before changing its connection, disabling or deleting it", "External processes are not owned or stopped by this service", "Listening/guardian status does not prove end-to-end connectivity", "Saving settings does not update the client's imported subscription; refresh it separately"],
    errors: "JSON {error: string}; 403 for access rejection, 404 for unknown route/plan, 500 for unexpected service failure. GET settings/preview and subscription YAML may contain secrets: do not print or log them.",
  };
}

function agentSkill(baseUrl) {
  return `# Clash Merge Service Agent Skill

Use this local service to maintain default subscriptions, multiple plans, exits and domain routes.
Base URL: ${baseUrl}
Read GET /api/docs for endpoint and settings definitions before operating.

## Workflow
1. GET /api/settings and retain its ETag. Read /api/profiles and /api/defaults when creating configurations. Preserve unrelated plans, fields and credentials.
2. Resolve the requested plan and exit by ID. GET /api/plans/{planId}/exits to inspect ownership and status. Never claim a listening port proves connectivity.
3. For configuration changes, edit a copy of the full settings document. Add/remove plans and exits through this document; reorder exits for domain priority. For a managed SSH connection change, stop that guardian first. Never stop or take over an external process.
4. PUT /api/settings with Content-Type: application/json and If-Match: the retained ETag. On 409, reread current settings and reapply only the intended change; never blindly overwrite. On 400, inspect documented constraints and runtime state.
5. POST /api/plans/{planId}/refresh when updating source/config output. Inspect health and preview; a stale cache is not a successful fresh retrieval.
6. Start/restart a saved, enabled SSH exit only when requested. HTTP and SOCKS5 exits have no SSH guardian. Check status afterward; actual end-to-end connectivity remains unverified.
7. Return the relevant ${baseUrl}/subscriptions/{planId}/clash.yaml address. The client must refresh its imported subscription to consume changed output; /clash.yaml follows defaultPlanId.

## Access and secrets
All APIs accept only actual loopback connections. Use the exact base URL/Host above; mutations with Origin must match this origin. Forwarded headers cannot grant access.
Settings, preview and YAML can contain subscription tokens/proxy passwords. Read them into memory; avoid logging full responses, credentials or private keys. Documentation contains no live configuration.
`;
}

module.exports = { agentDocs, agentSkill };
