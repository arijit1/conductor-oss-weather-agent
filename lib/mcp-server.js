import { getWeatherBundle } from "./weather.js";

const PROTOCOL_VERSION = "2025-06-18";

function jsonRpcResult(id, result) {
  return {
    jsonrpc: "2.0",
    id,
    result
  };
}

function jsonRpcError(id, code, message, data) {
  const error = { code, message };
  if (data !== undefined) error.data = data;
  return {
    jsonrpc: "2.0",
    id,
    error
  };
}

function toTextContent(text) {
  return [{ type: "text", text }];
}

function toolList() {
  return [
    {
      name: "weather_lookup_location",
      title: "Weather Location Lookup",
      description: "Resolve a city or place name to latitude and longitude.",
      inputSchema: {
        type: "object",
        properties: {
          location: { type: "string", description: "City, region, or place name" }
        },
        required: ["location"]
      }
    },
    {
      name: "weather_current",
      title: "Current Weather",
      description: "Get a current weather snapshot for a location.",
      inputSchema: {
        type: "object",
        properties: {
          location: { type: "string", description: "City, region, or place name" }
        },
        required: ["location"]
      }
    },
    {
      name: "weather_forecast",
      title: "Weather Forecast",
      description: "Get a forecast for the next 1 to 7 days.",
      inputSchema: {
        type: "object",
        properties: {
          location: { type: "string", description: "City, region, or place name" },
          days: { type: "integer", minimum: 1, maximum: 7, description: "Number of days to fetch" }
        },
        required: ["location"]
      }
    }
  ];
}

async function handleToolCall(name, args) {
  if (name === "weather_lookup_location") {
    const bundle = await getWeatherBundle(args.location, 1);
    return {
      content: toTextContent(JSON.stringify(bundle.location, null, 2)),
      structuredContent: bundle.location
    };
  }

  if (name === "weather_current") {
    const bundle = await getWeatherBundle(args.location, 1);
    return {
      content: toTextContent(JSON.stringify({
        location: bundle.location,
        current: bundle.current,
        summary: bundle.summary
      }, null, 2)),
      structuredContent: {
        location: bundle.location,
        current: bundle.current,
        summary: bundle.summary
      }
    };
  }

  if (name === "weather_forecast") {
    const bundle = await getWeatherBundle(args.location, args.days ?? 3);
    return {
      content: toTextContent(JSON.stringify(bundle, null, 2)),
      structuredContent: bundle
    };
  }

  return {
    isError: true,
    content: toTextContent(`Unknown tool: ${name}`)
  };
}

export async function handleMcpRequest(request) {
  if (!request || typeof request !== "object") {
    return jsonRpcError(null, -32600, "Invalid Request");
  }

  const { id = null, method, params = {} } = request;

  if (method === "initialize") {
    const supportedVersion = params.protocolVersion === PROTOCOL_VERSION ? PROTOCOL_VERSION : PROTOCOL_VERSION;
    return jsonRpcResult(id, {
      protocolVersion: supportedVersion,
      serverInfo: {
        name: "weather-agent-mcp",
        version: "1.0.0"
      },
      capabilities: {
        tools: {
          listChanged: false
        }
      }
    });
  }

  if (method === "notifications/initialized") {
    return null;
  }

  if (method === "tools/list") {
    return jsonRpcResult(id, {
      tools: toolList()
    });
  }

  if (method === "tools/call") {
    const name = params.name;
    const args = params.arguments ?? {};
    const result = await handleToolCall(name, args);
    return jsonRpcResult(id, result);
  }

  if (method === "ping") {
    return jsonRpcResult(id, {});
  }

  return jsonRpcError(id, -32601, `Method not found: ${method}`);
}
