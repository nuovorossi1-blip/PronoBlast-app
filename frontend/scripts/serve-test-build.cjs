// Serves a staged SPA for browser tests, without importing the backend or secrets.
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const root = path.resolve(process.argv[2]);
const port = Number(process.argv[3] || 3100);
const types = { ".js": "text/javascript", ".css": "text/css", ".html": "text/html", ".json": "application/json", ".ttf": "font/ttf", ".png": "image/png" };
http.createServer((req, res) => {
  let file = path.resolve(root, "." + decodeURIComponent(new URL(req.url, "http://localhost").pathname));
  if (!file.startsWith(root + path.sep) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(root, "index.html");
  res.writeHead(200, { "Content-Type": types[path.extname(file)] || "application/octet-stream" });
  fs.createReadStream(file).pipe(res);
}).listen(port, "127.0.0.1", () => console.log("Staged test server ready on " + port));
