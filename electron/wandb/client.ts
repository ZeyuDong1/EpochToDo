const WANDB_API_BASE = 'https://api.wandb.ai/api/v1';

export interface WandbProject {
  id: string;
  name: string;
  entity: string;
  updatedAt?: string;
}

export interface WandbRun {
  id: string;
  name: string;
  state: 'running' | 'finished' | 'crashed' | 'killed' | 'preempted';
  host?: string;
  config: Record<string, unknown>;
  summaryMetrics: Record<string, unknown>;
  url?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface WandbRunFull extends WandbRun {
  project: string;
}

function parseJsonField(field: unknown): Record<string, unknown> {
  if (typeof field === 'string') {
    try { return JSON.parse(field); } catch { return {}; }
  }
  return (field && typeof field === 'object') ? field as Record<string, unknown> : {};
}

async function wandbRequest(path: string, apiKey: string): Promise<Record<string, unknown>> {
  const auth = Buffer.from(`api:${apiKey}`).toString('base64');
  const response = await fetch(`${WANDB_API_BASE}${path}`, {
    headers: {
      'Authorization': `Basic ${auth}`,
      'Content-Type': 'application/json',
    },
  });
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`wandb API ${response.status}: ${text.slice(0, 200)}`);
  }
  return response.json();
}

export async function getRecentProjects(entity: string, apiKey: string, limit = 5): Promise<WandbProject[]> {
  const data = await wandbRequest(
    `/entities/${encodeURIComponent(entity)}/projects?perPage=${limit}&order=-updatedAt`,
    apiKey
  );
  return (data.projects || []) as WandbProject[];
}

interface RawRun {
  id: string;
  name: string;
  state: string;
  host?: string;
  config?: unknown;
  summaryMetrics?: unknown;
  url?: string;
  createdAt?: string;
  updatedAt?: string;
}

export async function getRunningRuns(entity: string, project: string, apiKey: string): Promise<WandbRun[]> {
  const data = await wandbRequest(
    `/entities/${encodeURIComponent(entity)}/projects/${encodeURIComponent(project)}/runs?state=running&perPage=50`,
    apiKey
  );
  const rawRuns = (data.runs || []) as RawRun[];
  return rawRuns.map((r) => ({
    id: r.id,
    name: r.name,
    state: r.state as WandbRun['state'],
    host: r.host,
    config: parseJsonField(r.config),
    summaryMetrics: parseJsonField(r.summaryMetrics),
    url: r.url,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  }));
}

export async function getRunState(entity: string, project: string, runId: string, apiKey: string): Promise<WandbRun['state'] | null> {
  try {
    const data = await wandbRequest(
      `/entities/${encodeURIComponent(entity)}/projects/${encodeURIComponent(project)}/runs/${encodeURIComponent(runId)}`,
      apiKey
    );
    return (data.state as WandbRun['state']) || null;
  } catch {
    return null;
  }
}

export async function validateCredentials(entity: string, apiKey: string): Promise<boolean> {
  try {
    await getRecentProjects(entity, apiKey, 1);
    return true;
  } catch {
    return false;
  }
}
