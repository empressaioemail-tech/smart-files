/**
 * QA BFF. Holds the files service token. Browser never sees a files DSN.
 * PLAN-ROW G-59.
 */

const FORBIDDEN_DSN = /DATABASE|neon\.tech|snowy-bread|winter-shape|fancy-fire/i;

export default async function handler(req, res) {
  const dsnKeys = Object.keys(process.env).filter((k) => FORBIDDEN_DSN.test(k));
  if (dsnKeys.length > 0) {
    res.status(503).json({
      error: "dsn_refused",
      message: "QA UI must not hold a files DSN",
    });
    return;
  }
  const backend = (process.env.SMART_FILES_BACKEND_URL || "").replace(/\/$/, "");
  const key = process.env.SMART_FILES_API_KEY || "";
  if (!backend || /cortex-api/i.test(backend)) {
    res.status(503).json({ error: "mount_not_configured" });
    return;
  }
  if (!key) {
    res.status(503).json({ error: "mount_not_configured" });
    return;
  }

  const incoming = new URL(req.url, "http://local");
  const path = incoming.searchParams.get("path") || "";
  if (!path.startsWith("/api/smart-files/")) {
    res.status(400).json({ error: "path must start with /api/smart-files/" });
    return;
  }
  incoming.searchParams.delete("path");
  const qs = incoming.searchParams.toString();
  const target = `${backend}${path}${qs ? `?${qs}` : ""}`;

  const headers = {
    accept: req.headers.accept || "application/json",
    authorization: `Bearer ${key}`,
    "user-agent": "smart-files-qa-ui/g59",
  };
  if (req.headers["content-type"]) headers["content-type"] = req.headers["content-type"];

  let body;
  if (req.method !== "GET" && req.method !== "HEAD") {
    body = await readRaw(req);
  }

  const upstream = await fetch(target, { method: req.method, headers, body });
  const buf = Buffer.from(await upstream.arrayBuffer());
  res.status(upstream.status);
  const ct = upstream.headers.get("content-type");
  if (ct) res.setHeader("content-type", ct);
  const cd = upstream.headers.get("content-disposition");
  if (cd) res.setHeader("content-disposition", cd);
  res.send(buf);
}

function readRaw(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}
