const http = require("node:http");

const LOCAL_BRIDGE_HOST = "127.0.0.1";
const LOCAL_BRIDGE_PORT = 3217;
const ALLOWED_ORIGINS = new Set(["http://127.0.0.1:3000", "http://localhost:3000"]);

function createJsonResponse(response, statusCode, payload, origin) {
  const headers = {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  };

  if (origin && ALLOWED_ORIGINS.has(origin)) {
    headers["Access-Control-Allow-Origin"] = origin;
    headers["Access-Control-Allow-Methods"] = "GET,POST,OPTIONS";
    headers["Access-Control-Allow-Headers"] = "Content-Type";
    headers.Vary = "Origin";
  }

  response.writeHead(statusCode, headers);
  response.end(JSON.stringify(payload));
}

function parseRequestBody(request) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    request.on("data", (chunk) => {
      chunks.push(chunk);
      const size = chunks.reduce((sum, item) => sum + item.length, 0);
      if (size > 10 * 1024 * 1024) {
        reject(new Error("请求体过大"));
        request.destroy();
      }
    });
    request.on("end", () => {
      if (chunks.length === 0) {
        resolve({});
        return;
      }

      try {
        const text = Buffer.concat(chunks).toString("utf8");
        resolve(text.trim() ? JSON.parse(text) : {});
      } catch {
        reject(new Error("请求体不是有效 JSON"));
      }
    });
    request.on("error", reject);
  });
}

function createLocalBridge(options = {}) {
  let server = null;

  function getHealthPayload() {
    return {
      status: "ok",
      bridge: "electron_local_http",
      host: LOCAL_BRIDGE_HOST,
      port: LOCAL_BRIDGE_PORT,
      version: typeof options.getVersion === "function" ? options.getVersion() : "unknown",
      ready: typeof options.isReady === "function" ? Boolean(options.isReady()) : true,
    };
  }

  async function handleRoute(request, response) {
    const origin = String(request.headers.origin || "");
    const method = String(request.method || "GET").toUpperCase();
    const requestUrl = new URL(request.url || "/", `http://${LOCAL_BRIDGE_HOST}:${LOCAL_BRIDGE_PORT}`);

    if (origin && !ALLOWED_ORIGINS.has(origin)) {
      createJsonResponse(response, 403, { error: "当前来源不允许访问 GEO 本地桌面桥。" }, origin);
      return;
    }

    if (method === "OPTIONS") {
      createJsonResponse(response, 204, { ok: true }, origin);
      return;
    }

    if (requestUrl.pathname === "/health") {
      if (method !== "GET") {
        createJsonResponse(response, 405, { error: "health 仅支持 GET。" }, origin);
        return;
      }

      createJsonResponse(response, 200, getHealthPayload(), origin);
      return;
    }

    if (typeof options.isReady === "function" && !options.isReady()) {
      createJsonResponse(response, 503, { error: "GEO 桌面桥尚未就绪，请稍后重试。" }, origin);
      return;
    }

    if (method !== "POST") {
      createJsonResponse(response, 405, { error: "当前本地桥接口仅支持 POST。" }, origin);
      return;
    }

    const routeMap = {
      "/platform/login": options.openPlatformLogin,
      "/platform/session/validate": options.validatePlatformSession,
      "/platform/publish": options.runPlatformPublish,
      "/platform/publish/progress": options.getPlatformPublishProgress,
    };

    const handler = routeMap[requestUrl.pathname];
    if (typeof handler !== "function") {
      createJsonResponse(response, 404, { error: "未找到对应的 GEO 本地桥接口。" }, origin);
      return;
    }

    try {
      const body = await parseRequestBody(request);
      const result = await handler(body);
      createJsonResponse(response, 200, result ?? {}, origin);
    } catch (error) {
      createJsonResponse(
        response,
        500,
        {
          error: error instanceof Error ? error.message : "GEO 本地桥执行失败。",
        },
        origin,
      );
    }
  }

  return {
    async start() {
      if (server) {
        return { host: LOCAL_BRIDGE_HOST, port: LOCAL_BRIDGE_PORT };
      }

      server = http.createServer((request, response) => {
        void handleRoute(request, response);
      });

      await new Promise((resolve, reject) => {
        server.once("error", reject);
        server.listen(LOCAL_BRIDGE_PORT, LOCAL_BRIDGE_HOST, () => {
          server.off("error", reject);
          resolve();
        });
      });

      return { host: LOCAL_BRIDGE_HOST, port: LOCAL_BRIDGE_PORT };
    },
    async stop() {
      if (!server) {
        return;
      }

      const currentServer = server;
      server = null;
      await new Promise((resolve, reject) => {
        currentServer.close((error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        });
      });
    },
  };
}

module.exports = {
  createLocalBridge,
  LOCAL_BRIDGE_HOST,
  LOCAL_BRIDGE_PORT,
};
