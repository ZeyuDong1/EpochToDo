const WANDB_GRAPHQL_URL = 'https://api.wandb.ai/graphql';

export interface WandbProject {
  id: string;
  name: string;
  entity: string;
  lastActive?: string;
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

function escapeGqlString(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

async function gqlRequest(query: string, apiKey: string): Promise<Record<string, unknown>> {
  const auth = Buffer.from(`api:${apiKey}`).toString('base64');
  const response = await fetch(WANDB_GRAPHQL_URL, {
    method: 'POST',
    headers: {
      'Authorization': `Basic ${auth}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ query }),
  });
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`wandb API ${response.status}: ${text.slice(0, 200)}`);
  }
  const json = await response.json() as { data?: Record<string, unknown>; errors?: Array<{ message: string }> };
  if (json.errors && json.errors.length > 0) {
    throw new Error(`wandb GraphQL error: ${json.errors.map(e => e.message).join('; ')}`);
  }
  return json.data ?? {};
}

export async function getRecentProjects(entity: string, apiKey: string, limit = 5): Promise<WandbProject[]> {
  const data = await gqlRequest(
    `{ projects(entityName: "${escapeGqlString(entity)}", first: ${limit}, order: "-lastActive") { edges { node { name entityName runCount lastActive } } } }`,
    apiKey
  );
  const conn = data.projects as { edges?: Array<{ node: { name: string; entityName: string; runCount?: number; lastActive?: string } }> } | null;
  if (!conn?.edges) return [];
  return conn.edges.map((edge) => ({
    id: edge.node.name,
    name: edge.node.name,
    entity: edge.node.entityName || entity,
    lastActive: edge.node.lastActive,
  }));
}

export async function getRunningRuns(entity: string, project: string, apiKey: string): Promise<WandbRun[]> {
  const data = await gqlRequest(
    `{ project(entityName: "${escapeGqlString(entity)}", name: "${escapeGqlString(project)}") { runs(first: 50, order: "-createdAt") { edges { node { name displayName state host config summaryMetrics createdAt updatedAt } } } } }`,
    apiKey
  );
  const proj = data.project as { runs?: { edges?: Array<{ node: RawRunGql }> } } | null;
  if (!proj?.runs?.edges) return [];
  return proj.runs.edges
    .map((edge) => mapGqlRun(edge.node, entity, project))
    .filter((r) => r.state === 'running');
}

export async function getRunState(entity: string, project: string, runId: string, apiKey: string): Promise<WandbRun['state'] | null> {
  try {
    const data = await gqlRequest(
      `{ project(entityName: "${escapeGqlString(entity)}", name: "${escapeGqlString(project)}") { run(name: "${escapeGqlString(runId)}") { state } } }`,
      apiKey
    );
    const proj = data.project as { run?: { state?: string } } | null;
    return (proj?.run?.state as WandbRun['state']) || null;
  } catch {
    return null;
  }
}

export async function validateCredentials(entity: string, apiKey: string): Promise<{ valid: boolean; projectCount: number; error?: string }> {
  try {
    const projects = await getRecentProjects(entity, apiKey, 50);
    return { valid: true, projectCount: projects.length };
  } catch (err) {
    return { valid: false, projectCount: 0, error: err instanceof Error ? err.message : 'Unknown error' };
  }
}

interface RawRunGql {
  name: string;
  displayName?: string;
  state: string;
  host?: string;
  config?: unknown;
  summaryMetrics?: unknown;
  createdAt?: string;
  updatedAt?: string;
}

function mapGqlRun(node: RawRunGql, entity: string, project: string): WandbRun {
  const state = (node.state || 'finished') as WandbRun['state'];
  return {
    id: node.name,
    name: node.displayName || node.name,
    state,
    host: node.host,
    config: parseJsonField(node.config),
    summaryMetrics: parseJsonField(node.summaryMetrics),
    url: `https://wandb.ai/${entity}/${project}/runs/${node.name}`,
    createdAt: node.createdAt,
    updatedAt: node.updatedAt,
  };
}
