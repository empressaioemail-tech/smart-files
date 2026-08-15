import http from "node:http";

const port = Number(process.env.PORT || 8080);
const service = "smart-files";

const server = http.createServer((req, res) => {
  const path = (req.url || "/").split("?")[0];
  if (req.method === "GET" && (path === "/healthz" || path === "/")) {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: true, service }));
    return;
  }
  res.writeHead(404, { "content-type": "application/json" });
  res.end(JSON.stringify({ ok: false, service }));
});

server.listen(port, "0.0.0.0", () => {
  process.stdout.write(`${service} listening on ${port}\n`);
});
