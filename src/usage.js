"use strict";

function parseUsage(header) {
  if (typeof header !== "string" || header.length > 1024) return null;
  const fields = {};
  for (const part of header.split(";")) {
    const match = part.trim().match(/^(upload|download|total|expire)\s*=\s*(\d+)$/);
    if (match) {
      const value = Number(match[2]);
      if (!Number.isSafeInteger(value)) return null;
      fields[match[1]] = value;
    }
  }
  if (["upload", "download", "total"].some(key => fields[key] === undefined)) return null;
  const used = fields.upload + fields.download;
  if (!Number.isSafeInteger(used)) return null;
  return { ...fields, used, remaining: Math.max(0, fields.total - used), header: ["upload", "download", "total", "expire"].filter(key => fields[key] !== undefined).map(key => `${key}=${fields[key]}`).join("; ") };
}

module.exports = { parseUsage };
