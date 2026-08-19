import http from 'node:http'
import type { TimerManager } from './timer/manager'

export interface HookServerDeps {
  timerManager: TimerManager
  broadcastFetchTasks: () => void
}

/**
 * The pure request-handling part of the hook server. Exported for testing —
 * createHookServer below wires it to the network.
 */
export function createHookHandler(deps: HookServerDeps): http.RequestListener {
  return (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', 'http://localhost:*')
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type')

    if (req.method === 'OPTIONS') {
      res.writeHead(200)
      res.end()
      return
    }

    if (req.method === 'POST' && req.url === '/hook') {
      const chunks: Buffer[] = []
      req.on('data', chunk => { chunks.push(chunk) })
      req.on('end', async () => {
        try {
          // Concatenate raw bytes FIRST, then decode as UTF-8 — decoding
          // chunk-by-chunk would corrupt multibyte characters split across
          // TCP packet boundaries (mojibake bug).
          const body = Buffer.concat(chunks).toString('utf8')
          const data = JSON.parse(body)

          if (data.kind === 'ai') {
            try {
              await deps.timerManager.handleAiReminder(data);
              res.writeHead(200, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ success: true }));
            } catch (e) {
              console.error('AI hook error:', e);
              res.writeHead(400, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ error: (e as Error).message }));
            }
            return;
          }

          const isTrainingUpdate = data.model_name || data.gpu_name || data.eta || data.metrics || (data.task_id && !data.message)

          if (isTrainingUpdate) {
            const success = await deps.timerManager.updateTrainingStatus(data)
            if (success) {
              deps.broadcastFetchTasks()
              res.writeHead(200, { 'Content-Type': 'application/json' })
              res.end(JSON.stringify({ success: true, message: 'Training status updated' }))
            } else {
              res.writeHead(404, { 'Content-Type': 'application/json' })
              res.end(JSON.stringify({ error: 'Task not found' }))
            }
            return
          }

          const { title, message } = data
          if (!title) {
            res.writeHead(400, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ error: 'Title is required' }))
            return
          }

          deps.timerManager.triggerExternalNotification(title, message)
          res.writeHead(200, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ success: true }))
        } catch (e) {
          console.error('Webhook error:', e)
          res.writeHead(500, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ error: 'Invalid JSON or Server Error' }))
        }
      })
    } else {
      res.writeHead(404)
      res.end()
    }
  }
}

export function createHookServer(deps: HookServerDeps): http.Server {
  const server = http.createServer(createHookHandler(deps))

  server.on('error', (err) => {
    // Common case: EADDRINUSE when a dev instance is already running and
    // holding port 62222. Without this handler the error is swallowed and
    // AI agents silently can't reach the production build.
    if ((err as NodeJS.ErrnoException).code === 'EADDRINUSE') {
      console.error('[hook-server] Port 62222 is already in use — another EpochToDo instance (likely dev mode) is running. AI reminders will NOT be received until that process is killed.')
    } else {
      console.error('[hook-server] Listen error:', err)
    }
  })

  server.listen(62222, '0.0.0.0', () => {
    console.log('External hook server listening on port 62222 (all interfaces)')
  })

  return server
}
