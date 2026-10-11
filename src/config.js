"use strict";

const os = require("node:os");
const path = require("node:path");

function loadConfig(env = process.env) {
  const port = Number(env.CLASH_MERGE_PORT || 18790);
  const refreshMinutes = Number(env.CLASH_MERGE_REFRESH_MINUTES || 60);
  if (!Number.isInteger(port) || port < 1024 || port > 65535) {
    throw new Error("CLASH_MERGE_PORT must be between 1024 and 65535");
  }
  if (!Number.isInteger(refreshMinutes) || refreshMinutes < 5) {
    throw new Error("CLASH_MERGE_REFRESH_MINUTES must be at least 5");
  }
  return {
    host: "127.0.0.1",
    port,
    refreshMinutes,
    appDir: env.CLASH_VERGE_DIR || path.join(
      os.homedir(),
      "Library/Application Support/io.github.clash-verge-rev.clash-verge-rev",
    ),
  };
}

module.exports = { loadConfig };
