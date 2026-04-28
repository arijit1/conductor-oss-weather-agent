import "dotenv/config";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { getWeatherBundle, formatWeatherDigest } from "./lib/weather.js";
import { handleMcpRequest } from "./lib/mcp-server.js";

const __dirname = normalize(new URL(".", import.meta.url).pathname);
const publicDir = join(__dirname, "public");
const workflowPath = join(__dirname, "conductor", "weather-agent.json");
const PORT = Number.parseInt(process.env.PORT ?? "3000", 10);
const CONDUCTOR_BASE_URL = process.env.CONDUCTOR_BASE_URL ?? "";

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml; charset=utf-8"
};

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8"
  });
  res.end(JSON.stringify(payload, null, 2));
}

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(chunk);
  }
  if (chunks.length === 0) return "";
  return Buffer.concat(chunks).toString("utf8");
}

function withCors(res) {
  res.setHeader("access-control-allow-origin", "*");
  res.setHeader("access-control-allow-methods", "GET,POST,OPTIONS");
  res.setHeader("access-control-allow-headers", "content-type,mcp-protocol-version");
}

function conductorApiBase() {
  if (!CONDUCTOR_BASE_URL) {
    throw new Error("CONDUCTOR_BASE_URL is not set.");
  }

  const trimmed = CONDUCTOR_BASE_URL.replace(/\/$/, "");
  return trimmed.endsWith("/api") ? trimmed : `${trimmed}/api`;
}

async function fetchConductor(path, options = {}) {
  const url = new URL(path, `${conductorApiBase()}/`);
  const response = await fetch(url, {
    ...options,
    headers: {
      "content-type": "application/json",
      ...(options.headers ?? {})
    }
  });

  const text = await response.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }

  if (!response.ok) {
    throw new Error(typeof body === "string" ? body : body?.message ?? `Conductor request failed with ${response.status}`);
  }

  return body;
}

async function serveStatic(res, pathname) {
  const safePath = pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "");
  const filePath = join(publicDir, safePath);

  if (!filePath.startsWith(publicDir)) {
    res.writeHead(403, { "content-type": "text/plain; charset=utf-8" });
    res.end("Forbidden");
    return;
  }

  try {
    const data = await readFile(filePath);
    const type = MIME_TYPES[extname(filePath)] ?? "application/octet-stream";
    res.writeHead(200, {
      "content-type": type,
      "cache-control": "no-store"
    });
    res.end(data);
  } catch {
    res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    res.end("Not found");
  }
}

async function handleApi(req, res, url) {
  if (req.method === "GET" && url.pathname === "/api/weather") {
    const location = url.searchParams.get("location");
    const days = url.searchParams.get("days") ?? "3";

    try {
      const bundle = await getWeatherBundle(location, days);
      sendJson(res, 200, bundle);
    } catch (error) {
      sendJson(res, 400, { error: error.message });
    }
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/summary") {
    const location = url.searchParams.get("location");
    const days = url.searchParams.get("days") ?? "3";

    try {
      const bundle = await getWeatherBundle(location, days);
      sendJson(res, 200, {
        digest: formatWeatherDigest(bundle)
      });
    } catch (error) {
      sendJson(res, 400, { error: error.message });
    }
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/mcp/tools") {
    sendJson(res, 200, {
      endpoint: "/mcp",
      tools: [
        "weather_lookup_location",
        "weather_current",
        "weather_forecast"
      ]
    });
    return;
  }

  if (req.method === "GET" && url.pathname === "/workflow/weather-agent.json") {
    try {
      const data = await readFile(workflowPath, "utf8");
      res.writeHead(200, {
        "content-type": "application/json; charset=utf-8",
        "cache-control": "no-store"
      });
      res.end(data);
    } catch (error) {
      sendJson(res, 500, { error: error.message });
    }
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/conductor/register") {
    try {
      const workflow = JSON.parse(await readBody(req) || "{}");
      const body = workflow?.name ? workflow : JSON.parse(await readFile(workflowPath, "utf8"));
      await fetchConductor("/api/metadata/workflow", {
        method: "POST",
        body: JSON.stringify(body)
      });
      sendJson(res, 200, { ok: true, registered: true });
    } catch (error) {
      if (String(error.message).includes("already exists")) {
        sendJson(res, 200, { ok: true, registered: false, message: "Workflow already exists; reusing existing version." });
        return;
      }
      sendJson(res, 400, { ok: false, error: error.message });
    }
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/conductor/start") {
    try {
      const input = JSON.parse(await readBody(req) || "{}");
      const workflow = JSON.parse(await readFile(workflowPath, "utf8"));
      const response = await fetchConductor(`/api/workflow/${encodeURIComponent(workflow.name)}`, {
        method: "POST",
        body: JSON.stringify({
          location: input.location,
          days: input.days ?? 3,
          activity: input.activity ?? "Outdoor plans",
          mcpServerUrl: input.mcpServerUrl ?? `${url.origin}/mcp`
        })
      });

      sendJson(res, 200, {
        ok: true,
        workflowId: response,
        workflowName: workflow.name
      });
    } catch (error) {
      sendJson(res, 400, { ok: false, error: error.message });
    }
    return;
  }

  if (req.method === "GET" && url.pathname.startsWith("/api/conductor/workflow/")) {
    try {
      const workflowId = url.pathname.split("/").pop();
      const response = await fetchConductor(`/api/workflow/${encodeURIComponent(workflowId)}?includeTasks=true`, {
        method: "GET"
      });
      sendJson(res, 200, response);
    } catch (error) {
      sendJson(res, 400, { ok: false, error: error.message });
    }
    return;
  }

  sendJson(res, 404, { error: "Not found" });
}

const server = createServer(async (req, res) => {
  withCors(res);

  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  const url = new URL(req.url, `http://${req.headers.host}`);

  if (url.pathname === "/mcp") {
    if (req.method !== "POST") {
      res.writeHead(405, { "content-type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({ error: "Use POST for MCP JSON-RPC requests." }));
      return;
    }

    try {
      const request = JSON.parse(await readBody(req));
      const response = await handleMcpRequest(request);
      if (!response) {
        res.writeHead(204);
        res.end();
        return;
      }
      sendJson(res, 200, response);
    } catch (error) {
      sendJson(res, 400, { jsonrpc: "2.0", error: { code: -32603, message: error.message } });
    }
    return;
  }

  if (url.pathname.startsWith("/api/") || url.pathname.startsWith("/workflow/")) {
    await handleApi(req, res, url);
    return;
  }

  await serveStatic(res, url.pathname);
});

server.listen(PORT, () => {
  console.log(`Weather Agent demo running at http://localhost:${PORT}`);
  console.log(`MCP endpoint: http://localhost:${PORT}/mcp`);
});
