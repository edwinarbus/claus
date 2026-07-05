// Raw-fetch client for the Claude Managed Agents beta API, used by the Overnight
// Concierge (api/concierge-setup.js + api/concierge-webhook.js). No SDK — same
// build-less, package.json-free style as the rest of api/*.
//
// Managed Agents is a beta surface: every call sends the
// `anthropic-beta: managed-agents-2026-04-01` header (the Files endpoints also
// need files-api-2025-04-14). Provision the agent/environment/memory store once
// (concierge-setup); a nightly scheduled deployment then fires a session per
// night, and concierge-webhook services it.

const crypto = require('crypto');
const { ANTHROPIC_VERSION, apiKey } = require('./claus-anthropic.js');

const BASE = 'https://api.anthropic.com/v1';
const MA_BETA = 'managed-agents-2026-04-01';
const FILES_BETA = 'files-api-2025-04-14';

async function maRequest(path, { method = 'GET', body, betas = [MA_BETA], query } = {}) {
  const key = apiKey();
  if (!key) { const e = new Error('not_configured'); e.status = 503; throw e; }

  let url = `${BASE}${path}`;
  if (query) {
    const qs = new URLSearchParams(query).toString();
    if (qs) url += `?${qs}`;
  }
  const headers = {
    'x-api-key': key,
    'anthropic-version': ANTHROPIC_VERSION,
    'anthropic-beta': betas.join(','),
  };
  if (body != null) headers['content-type'] = 'application/json';

  const r = await fetch(url, { method, headers, body: body != null ? JSON.stringify(body) : undefined });
  if (!r.ok) {
    const d = await r.text().catch(() => '');
    const e = new Error(`ma_${r.status}: ${d.slice(0, 300)}`);
    e.status = r.status;
    throw e;
  }
  return r;
}

const json = (path, opts) => maRequest(path, opts).then((r) => r.json());

// ---- control plane (provisioned once by concierge-setup) -------------------

function createEnvironment(name) {
  return json('/environments', {
    method: 'POST',
    body: { name, config: { type: 'cloud', networking: { type: 'unrestricted' } } },
  });
}

function createAgent(config) {
  return json('/agents', { method: 'POST', body: config });
}

function createMemoryStore(name, description) {
  return json('/memory_stores', { method: 'POST', body: { name, description } });
}

function createMemory(memoryStoreId, path, content) {
  return json(`/memory_stores/${encodeURIComponent(memoryStoreId)}/memories`, {
    method: 'POST',
    body: { path, content },
  });
}

function createDeployment(config) {
  return json('/deployments', { method: 'POST', body: config });
}

// ---- data plane (used at runtime by the webhook) ---------------------------

function getDeploymentRun(runId) {
  return json(`/deployment_runs/${encodeURIComponent(runId)}`);
}

// List a deployment's runs, newest-first. Each run carries the created
// `session_id` (on success) or an `error.type` (on failure). Used by the app's
// self-heal read path to find the most recent run when a webhook was missed.
function listDeploymentRuns(deploymentId, { limit = 10 } = {}) {
  return json('/deployment_runs', {
    query: { deployment_id: deploymentId, limit: String(limit) },
  });
}

// Session details, including the resolved `agent` config — used to verify a
// webhook-delivered session actually belongs to THIS app's own agent before
// servicing/harvesting it (see the ownership check in concierge.js: session
// webhooks fire workspace-wide, not per-registered-endpoint, so any other app
// sharing this Anthropic workspace will otherwise receive and act on it too).
function getSession(sessionId) {
  return json(`/sessions/${encodeURIComponent(sessionId)}`);
}

// Fire a deployment on demand (outside its cron schedule) via the deployment's
// `run` action endpoint. It creates a session immediately (a deployment run with
// trigger_context.type "manual") and returns that run — { id, session_id, … }.
// The run inherits the deployment's initial_events, so it kicks off the same
// "prepare tomorrow's brief" session. (The collection POST /deployment_runs does
// NOT exist — that path is GET-only for list/retrieve — hence the earlier 405.)
function createDeploymentRun(deploymentId) {
  return json(`/deployments/${encodeURIComponent(deploymentId)}/run`, { method: 'POST' });
}

function listSessionEvents(sessionId) {
  return json(`/sessions/${encodeURIComponent(sessionId)}/events`, { query: { limit: '1000' } });
}

function sendSessionEvents(sessionId, events) {
  return json(`/sessions/${encodeURIComponent(sessionId)}/events`, {
    method: 'POST',
    body: { events },
  });
}

// Files written by the agent to /mnt/session/outputs during the session. Needs
// BOTH the managed-agents and files betas.
function listSessionFiles(sessionId) {
  return json('/files', {
    betas: [MA_BETA, FILES_BETA],
    query: { scope_id: sessionId },
  });
}

async function downloadFileText(fileId) {
  const r = await maRequest(`/files/${encodeURIComponent(fileId)}/content`, {
    betas: [MA_BETA, FILES_BETA],
  });
  return r.text();
}

// ---- webhook signature verification ----------------------------------------

// Standard HMAC webhook scheme: signed content is `${id}.${timestamp}.${body}`,
// HMAC-SHA256 with the base64 secret (after the `whsec_` prefix), compared to
// the base64 signatures in the `webhook-signature` header (space-separated
// `v1,<sig>` entries). Fails closed. Requires ANTHROPIC_WEBHOOK_SIGNING_KEY.
function verifyWebhook(rawBody, headers, secret) {
  if (!secret) return false;
  const id = headers['webhook-id'];
  const ts = headers['webhook-timestamp'];
  const sigHeader = headers['webhook-signature'];
  if (!id || !ts || !sigHeader) return false;

  const now = Math.floor(Date.now() / 1000);
  if (!Number.isFinite(Number(ts)) || Math.abs(now - Number(ts)) > 300) return false;

  let secretBytes;
  try { secretBytes = Buffer.from(String(secret).replace(/^whsec_/, ''), 'base64'); } catch { return false; }
  const expected = crypto.createHmac('sha256', secretBytes)
    .update(`${id}.${ts}.${rawBody}`)
    .digest();

  const provided = String(sigHeader).split(' ')
    .map((part) => part.split(',')[1] || '')
    .filter(Boolean);
  for (const sig of provided) {
    let buf;
    try { buf = Buffer.from(sig, 'base64'); } catch { continue; }
    if (buf.length === expected.length && crypto.timingSafeEqual(buf, expected)) return true;
  }
  return false;
}

module.exports = {
  MA_BETA,
  FILES_BETA,
  maRequest,
  createEnvironment,
  createAgent,
  createMemoryStore,
  createMemory,
  createDeployment,
  getDeploymentRun,
  listDeploymentRuns,
  createDeploymentRun,
  getSession,
  listSessionEvents,
  sendSessionEvents,
  listSessionFiles,
  downloadFileText,
  verifyWebhook,
};
