# Conductor Weather Agent

<img width="1038" height="950" alt="image" src="https://github.com/user-attachments/assets/c7932f95-05c2-4b16-8205-9e9d9218e941" />


A small local demo that shows Conductor OSS orchestrating an MCP weather tool flow and ChatGPT summary.

This repo is meant to be easy to explain in a Medium article:

- a simple HTML UI
- a Node.js app that serves the page and exposes an MCP endpoint
- a Conductor OSS workflow that discovers MCP tools, calls weather, and asks ChatGPT for a brief

## What the demo shows

The user enters:

- a location
- number of days
- an activity
- the MCP server URL

Then the workflow does this:

1. Conductor starts the workflow
2. Conductor discovers the available MCP tools
3. Conductor calls the weather forecast tool
4. An inline step turns the forecast into a compact prompt
5. ChatGPT writes the final weather brief
6. The browser shows a simple process log and the final result

This is the main point of the project:

**Conductor OSS can orchestrate MCP tool use and an LLM step in one durable workflow.**

## Repo layout

- `server.js` - Node server, weather API, MCP endpoint, and Conductor helper routes
- `lib/weather.js` - weather lookup and forecast logic using Open-Meteo
- `lib/mcp-server.js` - MCP server for the weather tools
- `conductor/weather-agent.json` - Conductor workflow definition
- `public/index.html` - minimal browser UI
- `public/app.js` - browser flow and process log
- `public/styles.css` - simple styling

## Run the app

Start the local demo app:

```bash
CONDUCTOR_BASE_URL=http://localhost:8080 npm start
```

If you prefer a `.env` file, create one with:

```bash
CONDUCTOR_BASE_URL=http://localhost:8080
PORT=3000
```

Then start the app with:

```bash
npm start
```

Open the UI:

```text
http://localhost:3000
```

## Local prerequisites

You need:

- Conductor OSS running locally
- an OpenAI API key configured in the Conductor server
- this Node app running on port `3000`

The Conductor server reads the OpenAI key from its own config or environment, not from this repo.

## Conductor settings

This workflow expects Conductor to have AI enabled and an OpenAI key configured.

The workflow file is here:

```text
conductor/weather-agent.json
```

The app talks to Conductor through:

- `POST /api/conductor/register`
- `POST /api/conductor/start`
- `GET /api/conductor/workflow/:id`

## MCP endpoint

The Node app exposes an MCP server at:

```text
http://localhost:3000/mcp
```

Available tools:

- `weather_lookup_location`
- `weather_current`
- `weather_forecast`

## How to use the demo

1. Open the page.
2. Enter a location, day count, activity, and MCP URL.
3. Click `Run workflow`.
4. Watch the process log update as Conductor discovers tools, calls MCP, prepares the prompt, and gets the final brief.

## Why this repo exists

This project is not trying to be a full production app.

It is a compact, visual proof that Conductor OSS can:

- orchestrate a workflow
- call MCP tools
- hand a result to ChatGPT
- return a useful human-readable brief

That makes it a good example for a Medium post about agentic workflows.

## Notes for the Medium article

If you want to write about this repo, the strongest framing is:

- Conductor is doing orchestration, not replacing the model
- MCP exposes weather tools in a standard way
- the workflow keeps the process durable and inspectable
- the UI only shows the trace, so the demo is easy to follow

## One-line summary

Conductor OSS weather agent demo with MCP tools, ChatGPT, and a browser process log.
