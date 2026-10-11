"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { createRequestHandler } = require("../src/http");

test("subscription requests refresh before returning the merged configuration", async () => {
  let refreshed = false;
  const service = {
    async refresh() { refreshed = true; },
    currentConfig() {
      assert.equal(refreshed, true);
      return { yaml: "proxies: []\n", etag: '"test"', source: "direct-refresh", stale: false };
    },
  };
  let status;
  let body;
  const handler = createRequestHandler(service, { host: "127.0.0.1", port: 18790 });
  await handler({ headers: { host: "127.0.0.1:18790" }, url: "/clash.yaml", method: "GET" }, {
    writeHead(value) { status = value; },
    end(value) { body = value; },
  });
  assert.equal(status, 200);
  assert.equal(body, "proxies: []\n");
});
