// Local dev server: `node server.js` then POST http://localhost:3000/api/check
const http = require("http");
const fs = require("fs");
const path = require("path");
const checkHandler = require("./api/check");
const indexHandler = require("./api/index");

const PORT = process.env.PORT || 3000;

function readBody(req) {
  return new Promise((resolve) => {
    let data = "";
    req.on("data", (c) => (data += c));
    req.on("end", () => resolve(data));
  });
}

const server = http.createServer(async (req, res) => {
  // Minimal res shim matching the Vercel handler's use of res.status().json()
  const shim = {
    _code: 200,
    status(code) { this._code = code; return this; },
    setHeader: (k, v) => res.setHeader(k, v),
    json(obj) { res.writeHead(this._code, { "content-type": "application/json" }); res.end(JSON.stringify(obj)); },
    end: (d) => { res.writeHead(this._code); res.end(d); },
  };
  try {
    if (req.url === "/api/check") {
      const raw = await readBody(req);
      req.body = raw;
      return await checkHandler(req, shim);
    }
    if (req.url === "/" || req.url === "/api" || req.url === "/api/" || req.url === "/api/index") {
      return await indexHandler(req, shim);
    }
    if (req.url === "/index.html" || req.url === "/demo") {
      const html = fs.readFileSync(path.join(__dirname, "public", "index.html"));
      res.writeHead(200, { "content-type": "text/html" });
      return res.end(html);
    }
    res.writeHead(404, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "not_found" }));
  } catch (e) {
    console.error(e);
    res.writeHead(500, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "internal", detail: String(e.message || e) }));
  }
});

server.listen(PORT, () => console.log(`approval-guard local server on http://localhost:${PORT}`));
