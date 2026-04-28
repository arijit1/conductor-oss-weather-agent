const OPEN_METEO_GEOCODE_URL = "https://geocoding-api.open-meteo.com/v1/search";
const OPEN_METEO_FORECAST_URL = "https://api.open-meteo.com/v1/forecast";

const WEATHER_CODES = {
  0: "Clear sky",
  1: "Mainly clear",
  2: "Partly cloudy",
  3: "Overcast",
  45: "Fog",
  48: "Depositing rime fog",
  51: "Light drizzle",
  53: "Moderate drizzle",
  55: "Dense drizzle",
  56: "Light freezing drizzle",
  57: "Dense freezing drizzle",
  61: "Slight rain",
  63: "Moderate rain",
  65: "Heavy rain",
  66: "Light freezing rain",
  67: "Heavy freezing rain",
  71: "Slight snow fall",
  73: "Moderate snow fall",
  75: "Heavy snow fall",
  77: "Snow grains",
  80: "Slight rain showers",
  81: "Moderate rain showers",
  82: "Violent rain showers",
  85: "Slight snow showers",
  86: "Heavy snow showers",
  95: "Thunderstorm",
  96: "Thunderstorm with slight hail",
  99: "Thunderstorm with heavy hail"
};

function codeToLabel(code) {
  return WEATHER_CODES[code] ?? "Unknown conditions";
}

function cToF(value) {
  return Math.round((value * 9) / 5 + 32);
}

function ms(value) {
  return typeof value === "number" ? Math.round(value) : value;
}

function clampDays(days) {
  const parsed = Number.parseInt(days, 10);
  if (!Number.isFinite(parsed)) return 3;
  return Math.min(7, Math.max(1, parsed));
}

async function fetchJson(url, options = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? 10000);

  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
      headers: {
        "accept": "application/json",
        ...(options.headers ?? {})
      }
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Request failed with ${response.status}: ${body}`);
    }

    return await response.json();
  } finally {
    clearTimeout(timeout);
  }
}

export async function geocodeLocation(query) {
  if (!query || !query.trim()) {
    throw new Error("Location is required.");
  }

  const url = new URL(OPEN_METEO_GEOCODE_URL);
  url.searchParams.set("name", query.trim());
  url.searchParams.set("count", "1");
  url.searchParams.set("language", "en");
  url.searchParams.set("format", "json");

  const data = await fetchJson(url.toString());
  const hit = data?.results?.[0];
  if (!hit) {
    throw new Error(`No matching location found for "${query}".`);
  }

  return {
    name: hit.name,
    admin1: hit.admin1 ?? "",
    country: hit.country ?? "",
    latitude: hit.latitude,
    longitude: hit.longitude,
    timezone: hit.timezone ?? "auto"
  };
}

export async function getWeatherBundle(query, days = 3) {
  const forecastDays = clampDays(days);
  const location = await geocodeLocation(query);

  const url = new URL(OPEN_METEO_FORECAST_URL);
  url.searchParams.set("latitude", String(location.latitude));
  url.searchParams.set("longitude", String(location.longitude));
  url.searchParams.set("current", "temperature_2m,apparent_temperature,relative_humidity_2m,precipitation,weather_code,wind_speed_10m");
  url.searchParams.set("daily", "weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,wind_speed_10m_max");
  url.searchParams.set("forecast_days", String(forecastDays));
  url.searchParams.set("timezone", "auto");

  const forecast = await fetchJson(url.toString());
  const current = forecast.current ?? {};
  const daily = forecast.daily ?? {};

  const forecastRows = Array.from({ length: forecastDays }, (_, index) => {
    const day = {
      date: daily.time?.[index],
      weatherCode: daily.weather_code?.[index],
      weather: codeToLabel(daily.weather_code?.[index]),
      highC: daily.temperature_2m_max?.[index],
      lowC: daily.temperature_2m_min?.[index],
      rainChance: daily.precipitation_probability_max?.[index],
      windKph: daily.wind_speed_10m_max?.[index]
    };

    return {
      ...day,
      highF: typeof day.highC === "number" ? cToF(day.highC) : null,
      lowF: typeof day.lowC === "number" ? cToF(day.lowC) : null
    };
  });

  const today = forecastRows[0] ?? null;
  const needsUmbrella = forecastRows.some((row) => (row.rainChance ?? 0) >= 50 || [51, 53, 55, 61, 63, 65, 80, 81, 82, 95, 96, 99].includes(row.weatherCode));

  return {
    location,
    current: {
      temperatureC: current.temperature_2m,
      temperatureF: typeof current.temperature_2m === "number" ? cToF(current.temperature_2m) : null,
      feelsLikeC: current.apparent_temperature,
      feelsLikeF: typeof current.apparent_temperature === "number" ? cToF(current.apparent_temperature) : null,
      humidity: current.relative_humidity_2m,
      precipitationMm: current.precipitation,
      weatherCode: current.weather_code,
      weather: codeToLabel(current.weather_code),
      windKph: current.wind_speed_10m
    },
    forecast: forecastRows,
    summary: {
      headline: today?.weather ?? "Weather snapshot unavailable",
      umbrellaRecommended: needsUmbrella,
      activityHint: summarizeActivity(forecastRows)
    },
    raw: {
      latitude: location.latitude,
      longitude: location.longitude,
      timezone: forecast.timezone,
      generationTimeMs: ms(forecast?.generationtime_ms)
    }
  };
}

export function summarizeActivity(forecastRows) {
  const rainy = forecastRows.some((row) => (row.rainChance ?? 0) >= 60);
  const veryWindy = forecastRows.some((row) => (row.windKph ?? 0) >= 30);
  const hot = forecastRows.some((row) => (row.highF ?? 0) >= 90);
  const cold = forecastRows.some((row) => (row.lowF ?? 99) <= 40);

  if (rainy && veryWindy) return "Plan indoors if possible. Rain and wind will be the main story.";
  if (rainy) return "Carry an umbrella and keep outdoor plans flexible.";
  if (veryWindy) return "Expect gusty conditions. Light outdoor plans are better than long ones.";
  if (hot) return "Dress light, hydrate, and avoid the afternoon heat.";
  if (cold) return "Layer up. Mornings and evenings look chilly.";
  return "Looks comfortable enough for normal outdoor plans.";
}

export function formatWeatherDigest(bundle) {
  const lines = [];
  lines.push(`${bundle.location.name}${bundle.location.admin1 ? `, ${bundle.location.admin1}` : ""}${bundle.location.country ? `, ${bundle.location.country}` : ""}`);
  lines.push(`Current: ${bundle.current.temperatureF ?? "?"}°F, ${bundle.current.weather}`);
  lines.push(`Feels like: ${bundle.current.feelsLikeF ?? "?"}°F`);
  lines.push(`Humidity: ${bundle.current.humidity ?? "?"}%`);
  lines.push(`Wind: ${bundle.current.windKph ?? "?"} km/h`);
  lines.push("");
  lines.push("Forecast:");

  for (const day of bundle.forecast) {
    lines.push(`- ${day.date}: ${day.weather}, ${day.highF ?? "?"}°F / ${day.lowF ?? "?"}°F, rain ${day.rainChance ?? "?"}%`);
  }

  lines.push("");
  lines.push(`Advice: ${bundle.summary.activityHint}`);
  lines.push(`Umbrella: ${bundle.summary.umbrellaRecommended ? "yes" : "no"}`);
  return lines.join("\n");
}
