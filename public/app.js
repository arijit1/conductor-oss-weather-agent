const form = document.getElementById("weather-form");
const runBtn = document.getElementById("run-btn");
const registerBtn = document.getElementById("register-btn");
const conductorStatus = document.getElementById("conductor-status");
const processLog = document.getElementById("process-log");
const finalBrief = document.getElementById("final-brief");

let workflowJson = null;

function logStep(text) {
  const item = document.createElement("li");
  item.textContent = text;
  processLog.appendChild(item);
}

function resetLog() {
  processLog.innerHTML = "";
  finalBrief.textContent = "Waiting for a run...";
}

function setStatus(text) {
  conductorStatus.textContent = text;
}

function getInput() {
  return {
    location: document.getElementById("location").value.trim(),
    days: document.getElementById("days").value,
    activity: document.getElementById("activity").value.trim(),
    mcpServerUrl: document.getElementById("mcpServerUrl").value.trim()
  };
}

async function loadWorkflow() {
  if (workflowJson) return workflowJson;
  const response = await fetch("/workflow/weather-agent.json");
  workflowJson = await response.json();
  return workflowJson;
}

async function registerWorkflow() {
  await loadWorkflow();
  logStep("Registering workflow version in Conductor.");
  const response = await fetch("/api/conductor/register", {
    method: "POST",
    headers: {
      "content-type": "application/json"
    },
    body: JSON.stringify(workflowJson)
  });
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload.error ?? "Failed to register workflow");
  }
  if (payload.registered) {
    logStep("Workflow registered.");
  } else {
    logStep("Workflow already existed, so Conductor reused the same version.");
  }
}

async function startWorkflow() {
  const input = getInput();
  logStep(`Starting workflow for ${input.location}.`);
  const response = await fetch("/api/conductor/start", {
    method: "POST",
    headers: {
      "content-type": "application/json"
    },
    body: JSON.stringify(input)
  });
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload.error ?? "Failed to start workflow");
  }
  logStep(`Conductor returned workflow id ${payload.workflowId}.`);
  return payload.workflowId;
}

async function loadWorkflowStatus(workflowId) {
  const response = await fetch(`/api/conductor/workflow/${encodeURIComponent(workflowId)}`);
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload.error ?? "Failed to load workflow status");
  }
  return payload;
}

function getTaskLine(task) {
  const name = task.referenceTaskName || task.taskDefName || task.taskType;
  const input = task.inputData || {};
  if (name === "discover") {
    return `Conductor picked up MCP discovery with ${input.mcpServer || "no server URL"}.`;
  }
  if (name === "forecast") {
    return `Conductor called the MCP weather tool for ${input.arguments?.location || "the selected city"}.`;
  }
  if (name === "brief_context") {
    return `Conductor shaped the forecast into a compact prompt for ChatGPT.`;
  }
  if (name === "brief") {
    return `ChatGPT generated the final weather brief.`;
  }
  return `${name}: ${task.status}`;
}

function renderWorkflowStatus(workflow) {
  const tasks = Array.isArray(workflow.tasks) ? workflow.tasks : [];
  setStatus(`Workflow ${workflow.workflowId} is ${workflow.status}.`);

  const summaryLines = [
    `Workflow status: ${workflow.status}`,
    ...tasks.map(getTaskLine)
  ];

  const brief = workflow.output?.brief || "";
  finalBrief.textContent = brief || "No brief returned.";
  processLog.innerHTML = "";
  summaryLines.forEach(logStep);

  if (workflow.status === "COMPLETED") {
    logStep("Workflow completed.");
  }
}

async function pollUntilDone(workflowId) {
  const startedAt = Date.now();
  while (true) {
    const workflow = await loadWorkflowStatus(workflowId);
    if (workflow.status === "COMPLETED" || workflow.status === "FAILED" || workflow.status === "TERMINATED") {
      renderWorkflowStatus(workflow);
      return;
    }

    setStatus(`Workflow ${workflowId} is ${workflow.status}...`);
    if (Date.now() - startedAt > 120000) {
      logStep(`Stopped polling after 2 minutes. Current status: ${workflow.status}.`);
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
}

runBtn.addEventListener("click", async () => {
  resetLog();
  try {
    setStatus("Registering workflow...");
    await registerWorkflow();
    setStatus("Starting workflow...");
    const workflowId = await startWorkflow();
    logStep("Polling Conductor for progress.");
    await pollUntilDone(workflowId);
  } catch (error) {
    setStatus(error.message);
    logStep(`Error: ${error.message}`);
  }
});

registerBtn.addEventListener("click", async () => {
  try {
    resetLog();
    await registerWorkflow();
    setStatus("Workflow registration complete.");
  } catch (error) {
    setStatus(error.message);
    logStep(`Error: ${error.message}`);
  }
});

form.addEventListener("submit", (event) => {
  event.preventDefault();
});

resetLog();
