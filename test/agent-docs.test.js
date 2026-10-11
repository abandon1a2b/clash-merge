"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const { createApplicationHandler, isLoopback } = require("../src/app");

test("agent documentation is discoverable over local HTTP and contains no live settings", async () => {
  const server = http.createServer();
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const config = { host: "127.0.0.1", port: server.address().port };
  server.on("request", createApplicationHandler({}, { read() { throw Error("Documentation must not read settings"); } }, {}, config));
  const root = `http://${config.host}:${config.port}`;
  try {
    const skill = await fetch(`${root}/api/skill`);
    assert.equal(skill.status, 200);
    assert.match(skill.headers.get("content-type"), /text\/markdown/);
    assert.match(await skill.text(), /If-Match/);
    const response = await fetch(`${root}/api/docs`);
    assert.equal(response.status, 200);
    const docs = await response.json();
    assert.equal(docs.baseUrl, root);
    assert.equal(docs.access.localOnly, true);
    assert.ok(docs.endpoints.some(item => item.method === "PUT" && item.path === "/api/settings"));
    assert.ok(docs.endpoints.some(item => item.path.endsWith("/restart")));
  } finally { await new Promise(resolve => server.close(resolve)); }
});

test("remote peers cannot access docs, settings or operations even with forged local headers", async () => {
  const handler = createApplicationHandler({}, {}, {}, { host: "127.0.0.1", port: 18790 });
  for (const [method, url] of [["GET", "/api/docs"], ["GET", "/api/skill"], ["GET", "/api/settings"], ["PUT", "/api/settings"], ["POST", "/api/plans/office/exits/internal/start"], ["POST", "/refresh"]]) {
    for (const remoteAddress of ["192.168.1.10", "::ffff:192.168.1.10", "2001:db8::1", undefined]) {
      let status, body;
      await handler({ method, url, socket: { remoteAddress }, headers: { host: "127.0.0.1:18790", origin: "http://127.0.0.1:18790", "x-forwarded-for": "127.0.0.1" } }, { writeHead(code) { status = code; }, end(value) { body = JSON.parse(value); } });
      assert.equal(status, 403);
      assert.equal(body.error, "Local connections only");
    }
  }
  for (const address of ["127.0.0.1", "127.2.3.4", "::1", "::ffff:127.0.0.1"]) assert.equal(isLoopback(address), true);
});
