import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EventEmitter } from 'node:events';
import http from 'node:http';
import { createHookHandler } from '../electron/server';
import type { HookServerDeps } from '../electron/server';

/* ------------------------------------------------------------------ */
/* Fakes                                                               */
/* ------------------------------------------------------------------ */

interface RecordedResponse {
  status?: number;
  headers?: http.OutgoingHttpHeaders;
  body: string[];
}

function makeDeps() {
  return {
    timerManager: {
      handleAiReminder: vi.fn<(data: Record<string, unknown>) => Promise<void>>(),
      updateTrainingStatus: vi.fn<(data: Record<string, unknown>) => Promise<boolean>>(),
      triggerExternalNotification: vi.fn(),
    },
    broadcastFetchTasks: vi.fn(),
  };
}

type FakeDeps = ReturnType<typeof makeDeps>;

function asDeps(deps: FakeDeps): HookServerDeps {
  return deps as unknown as HookServerDeps;
}

/**
 * Invoke the handler with a fake req/res pair. Chunks are emitted as raw
 * Buffers so multibyte characters can be split across boundaries like
 * real TCP delivery would.
 */
async function call(
  deps: FakeDeps,
  method: string,
  url: string,
  chunks: Buffer[] = []
): Promise<RecordedResponse> {
  const handler = createHookHandler(asDeps(deps));

  const req = Object.assign(new EventEmitter(), {
    method,
    url,
  }) as unknown as http.IncomingMessage;

  const recorded: RecordedResponse = { body: [] };
  const res = {
    setHeader: vi.fn(),
    writeHead: vi.fn((status: number, headers?: http.OutgoingHttpHeaders) => {
      recorded.status = status;
      recorded.headers = headers;
    }),
    end: vi.fn((data?: unknown) => {
      recorded.body.push(data == null ? '' : String(data));
    }),
  } as unknown as http.ServerResponse;

  handler(req, res);
  for (const chunk of chunks) req.emit('data', chunk);
  req.emit('end');

  await vi.waitFor(() => expect(res.end).toHaveBeenCalled());
  return recorded;
}

const jsonChunks = (payload: unknown): Buffer[] => [Buffer.from(JSON.stringify(payload), 'utf8')];

/* ------------------------------------------------------------------ */
/* Tests                                                               */
/* ------------------------------------------------------------------ */

describe('hook handler', () => {
  let deps: FakeDeps;
  beforeEach(() => { deps = makeDeps(); });

  it('answers CORS preflight with 200', async () => {
    const res = await call(deps, 'OPTIONS', '/hook');
    expect(res.status).toBe(200);
  });

  it('rejects non-POST or unknown paths with 404', async () => {
    expect((await call(deps, 'GET', '/hook')).status).toBe(404);
    expect((await call(deps, 'POST', '/other', jsonChunks({}))).status).toBe(404);
  });

  it('decodes UTF-8 correctly when a multibyte char spans two chunks', async () => {
    // Regression (956e93c): decoding chunk-by-chunk corrupted split chars
    const json = JSON.stringify({ kind: 'ai', source: 'Claude Code', title: '构建完成', status: 'success' });
    const buf = Buffer.from(json, 'utf8');
    const splitAt = buf.indexOf(0xe6); // first byte of a 构 UTF-8 sequence
    expect(splitAt).toBeGreaterThan(0);

    const res = await call(deps, 'POST', '/hook', [
      buf.subarray(0, splitAt),
      buf.subarray(splitAt),
    ]);

    expect(res.status).toBe(200);
    expect(deps.timerManager.handleAiReminder).toHaveBeenCalledWith(
      expect.objectContaining({ title: '构建完成' })
    );
  });

  it('routes kind:"ai" payloads to handleAiReminder', async () => {
    const res = await call(deps, 'POST', '/hook', jsonChunks({
      kind: 'ai', source: 'bot', title: 'done', status: 'success',
    }));
    expect(res.status).toBe(200);
    expect(res.body[0]).toContain('"success":true');
    expect(deps.timerManager.handleAiReminder).toHaveBeenCalledTimes(1);
    expect(deps.timerManager.triggerExternalNotification).not.toHaveBeenCalled();
  });

  it('returns 400 with the error message when handleAiReminder throws', async () => {
    deps.timerManager.handleAiReminder.mockRejectedValue(new Error('bad payload'));
    const res = await call(deps, 'POST', '/hook', jsonChunks({ kind: 'ai' }));
    expect(res.status).toBe(400);
    expect(res.body[0]).toContain('bad payload');
  });

  it('routes training payloads (model_name) to updateTrainingStatus', async () => {
    deps.timerManager.updateTrainingStatus.mockResolvedValue(true);
    const res = await call(deps, 'POST', '/hook', jsonChunks({
      task_id: 1, model_name: 'llama', metrics: { loss: 0.5 },
    }));
    expect(res.status).toBe(200);
    expect(deps.timerManager.updateTrainingStatus).toHaveBeenCalledTimes(1);
    expect(deps.broadcastFetchTasks).toHaveBeenCalledTimes(1);
  });

  it('returns 404 when the training task is unknown', async () => {
    deps.timerManager.updateTrainingStatus.mockResolvedValue(false);
    const res = await call(deps, 'POST', '/hook', jsonChunks({ task_id: 99, model_name: 'x' }));
    expect(res.status).toBe(404);
    expect(deps.broadcastFetchTasks).not.toHaveBeenCalled();
  });

  it('treats task_id without message as a training update', async () => {
    deps.timerManager.updateTrainingStatus.mockResolvedValue(true);
    await call(deps, 'POST', '/hook', jsonChunks({ task_id: 5 }));
    expect(deps.timerManager.updateTrainingStatus).toHaveBeenCalledTimes(1);
  });

  it('routes plain payloads to triggerExternalNotification', async () => {
    const res = await call(deps, 'POST', '/hook', jsonChunks({
      title: '构建完成', message: '42 tests passed',
    }));
    expect(res.status).toBe(200);
    expect(deps.timerManager.triggerExternalNotification).toHaveBeenCalledWith(
      '构建完成', '42 tests passed'
    );
  });

  it('rejects plain payloads without a title with 400', async () => {
    const res = await call(deps, 'POST', '/hook', jsonChunks({ message: 'no title' }));
    expect(res.status).toBe(400);
    expect(res.body[0]).toContain('Title is required');
  });

  it('returns 500 for invalid JSON', async () => {
    const res = await call(deps, 'POST', '/hook', [Buffer.from('{not json', 'utf8')]);
    expect(res.status).toBe(500);
    expect(res.body[0]).toContain('Invalid JSON');
  });
});
