import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");
const adminWebRoot = path.join(projectRoot, "server", "admin-web", "src");
const proxyHost = "127.0.0.1";
const proxyPort = Number(process.env.GEO_ADMIN_API_PORT ?? 8080);
const listenPort = Number(process.env.GEO_ADMIN_WEB_PORT ?? 8086);

const contentTypes = new Map([
  [".html", "text/html; charset=utf-8"],
  [".js", "application/javascript; charset=utf-8"],
  [".css", "text/css; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".svg", "image/svg+xml"],
  [".png", "image/png"],
  [".jpg", "image/jpeg"],
  [".jpeg", "image/jpeg"],
  [".ico", "image/x-icon"],
]);

function resolveStaticPath(urlPath) {
  const normalizedPath = decodeURIComponent((urlPath || "/").split("?")[0]).replace(/^\/+/, "");
  const relativePath = normalizedPath || "index.html";
  const absolutePath = path.resolve(adminWebRoot, relativePath);

  if (!absolutePath.startsWith(adminWebRoot)) {
    return null;
  }

  if (fs.existsSync(absolutePath) && fs.statSync(absolutePath).isFile()) {
    return absolutePath;
  }

  return path.join(adminWebRoot, "index.html");
}

function serveStatic(request, response) {
  const filePath = resolveStaticPath(request.url);
  if (!filePath || !fs.existsSync(filePath)) {
    response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    response.end("Not found");
    return;
  }

  const extension = path.extname(filePath).toLowerCase();
  response.writeHead(200, {
    "Content-Type": contentTypes.get(extension) ?? "application/octet-stream",
    "Cache-Control": "no-store",
  });
  fs.createReadStream(filePath).pipe(response);
}

function proxyApi(request, response) {
  const upstream = http.request(
    {
      hostname: proxyHost,
      port: proxyPort,
      path: request.url,
      method: request.method,
      headers: request.headers,
    },
    (upstreamResponse) => {
      response.writeHead(upstreamResponse.statusCode ?? 502, upstreamResponse.headers);
      upstreamResponse.pipe(response);
    },
  );

  upstream.on("error", (error) => {
    response.writeHead(502, { "Content-Type": "application/json; charset=utf-8" });
    response.end(JSON.stringify({ error: `Admin API unavailable: ${error.message}` }));
  });

  request.pipe(upstream);
}

const server = http.createServer((request, response) => {
  if ((request.url || "/").startsWith("/api/")) {
    proxyApi(request, response);
    return;
  }

  if ((request.url || "/") === "/health") {
    response.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
    response.end(JSON.stringify({ ok: true, proxyPort, listenPort }));
    return;
  }

  serveStatic(request, response);
});

server.listen(listenPort, () => {
  console.log(`geo admin dev proxy ready at http://127.0.0.1:${listenPort}`);
});
