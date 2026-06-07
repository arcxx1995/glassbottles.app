import express from 'express'
import { readFileSync, existsSync, writeFileSync, statSync, readdirSync, realpathSync } from 'fs'
import { watch } from 'chokidar'
import { spawn } from 'child_process'
import { fileURLToPath } from 'url'
import { dirname, join, relative, extname, sep } from 'path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const PROJECT_ROOT = join(__dirname, '..', '..')
const PROJECT_ROOT_REAL = realpathSync(PROJECT_ROOT) + sep
const PORT = 3333

const app = express()
app.use(express.json())
app.use(express.static(join(__dirname, 'public')))

// Block cross-origin state-changing requests (CSRF defence for a localhost tool)
function requireLocalOrigin(req, res, next) {
  const origin = req.headers['origin'] || ''
  const fetch  = req.headers['sec-fetch-site'] || ''
  if (fetch && fetch !== 'same-origin' && fetch !== 'none') {
    return res.status(403).json({ error: 'cross-site request blocked' })
  }
  if (origin && !origin.startsWith(`http://localhost:${PORT}`) && !origin.startsWith(`http://127.0.0.1:${PORT}`)) {
    return res.status(403).json({ error: 'cross-origin request blocked' })
  }
  next()
}
app.post('*', requireLocalOrigin)
app.delete('*', requireLocalOrigin)

// ── Agent definitions ───────────────────────────────────────────────────────

const AGENTS = {
  cherry: { name: 'Cherry', emoji: '🧑‍🎨', role: 'UI/UX Designer',          log: 'AGENT_LOG_CHERRY.md' },
  bella:  { name: 'Bella',  emoji: '🧑‍💻', role: 'Frontend Engineer',        log: 'AGENT_LOG_BELLA.md' },
  felix:  { name: 'Felix',  emoji: '🧑‍🔧', role: 'Backend Engineer',         log: 'AGENT_LOG_FELIX.md' },
  shiv:   { name: 'Shiv',   emoji: '🛠️',  role: 'DevOps Engineer',           log: 'AGENT_LOG_SHIV.md' },
  nagoya: { name: 'Nagoya', emoji: '📋',   role: 'Product Manager',           log: 'AGENT_LOG_NAGOYA.md' },
  khasi:  { name: 'Khasi',  emoji: '🔍',   role: 'Code Reviewer',             log: 'AGENT_LOG_KHASI.md' },
  kitty:  { name: 'Kitty',  emoji: '📝',   role: 'Docs & Changelog Agent',    log: 'AGENT_LOG_KITTY.md' },
}

// ── Agent state ─────────────────────────────────────────────────────────────

const agentStatus      = {}
const agentTask        = {}
const agentProcs       = {}  // running child processes (for stop)
const pendingPerms     = {}  // key → { id, tool, input } | null

Object.keys(AGENTS).forEach(k => {
  agentStatus[k]  = 'idle'
  agentTask[k]    = null
  agentProcs[k]   = null
  pendingPerms[k] = null
})

// ── SSE broadcast ───────────────────────────────────────────────────────────

const sseClients = new Set()

app.get('/api/stream', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream')
  res.setHeader('Cache-Control', 'no-cache')
  res.setHeader('Connection', 'keep-alive')
  res.flushHeaders()
  sseClients.add(res)
  req.on('close', () => sseClients.delete(res))

  const logs = {}, statuses = {}, tasks = {}, perms = {}
  Object.keys(AGENTS).forEach(k => {
    logs[k]     = readLog(k)
    statuses[k] = agentStatus[k]
    tasks[k]    = agentTask[k]
    perms[k]    = pendingPerms[k]
  })
  res.write(`data: ${JSON.stringify({ type: 'init', logs, statuses, tasks, perms })}\n\n`)
})

function broadcast(event) {
  const data = `data: ${JSON.stringify(event)}\n\n`
  for (const client of sseClients) client.write(data)
}

// Watch log files for live updates
const logPaths = Object.entries(AGENTS).map(([key, a]) => ({ key, path: join(PROJECT_ROOT, a.log) }))
const watcher = watch(logPaths.map(l => l.path), { ignoreInitial: true })
watcher.on('change', changedPath => {
  const entry = logPaths.find(l => l.path === changedPath)
  if (!entry) return
  broadcast({ type: 'log_update', agent: entry.key, content: readFileSync(changedPath, 'utf-8') })
})

function readLog(key) {
  const p = join(PROJECT_ROOT, AGENTS[key].log)
  return existsSync(p) ? readFileSync(p, 'utf-8') : '(no log yet)'
}

// ── REST: agents ─────────────────────────────────────────────────────────────

app.get('/api/agents', (_req, res) => {
  const result = {}
  Object.entries(AGENTS).forEach(([key, agent]) => {
    result[key] = { ...agent, log: readLog(key), status: agentStatus[key], task: agentTask[key], perm: pendingPerms[key] }
  })
  res.json(result)
})

// ── Run agent via claude CLI ─────────────────────────────────────────────────

app.post('/api/agents/:key/run', (req, res) => {
  const { key } = req.params
  if (!AGENTS[key]) return res.status(404).json({ error: 'agent not found' })
  if (agentStatus[key] === 'running') return res.status(409).json({ error: 'already running' })

  const { task, allowedTools } = req.body
  if (!task) return res.status(400).json({ error: 'task required' })

  // Validate allowedTools — whitelist against known safe tool names
  const VALID_TOOLS = new Set(['Read','Write','Edit','Bash','Glob','Grep','WebFetch','WebSearch','NotebookRead','NotebookEdit'])
  const tools = Array.isArray(allowedTools)
    ? allowedTools.filter(t => VALID_TOOLS.has(t))
    : []

  res.json({ started: true })

  agentStatus[key] = 'running'
  agentTask[key]   = task
  broadcast({ type: 'agent_status', agent: key, status: 'running', task })

  // Build spawn args — include --allowedTools if user pre-approved specific tools
  const spawnArgs = [
    '--agent', key,
    '--print',
    '--output-format', 'stream-json',
    '--verbose',
    '--add-dir', PROJECT_ROOT,
  ]
  if (tools.length) spawnArgs.push('--allowedTools', tools.join(','))

  const proc = spawn('claude', spawnArgs, {
    cwd: PROJECT_ROOT,
    env: { ...process.env, CLAUDE_CODE_DASHBOARD: '1' },
  })

  // Pass task via stdin — avoids --add-dir variadic consuming positional arg
  proc.stdin.write(task)
  proc.stdin.end()

  agentProcs[key] = proc

  let buffer = ''

  proc.stdout.on('data', chunk => {
    buffer += chunk.toString()
    const lines = buffer.split('\n')
    buffer = lines.pop() // keep incomplete line

    for (const line of lines) {
      if (!line.trim()) continue
      try {
        const event = JSON.parse(line)
        const t = event.type
        const sub = event.subtype

        // Permission request — claude paused waiting for approval
        if (
          t === 'permission_request' ||
          (t === 'system' && sub === 'permission_request') ||
          (t === 'user' && event.permission_request)
        ) {
          const perm = {
            id:    event.id    || event.permission_id || `perm_${Date.now()}`,
            tool:  event.tool  || event.tool_name     || event.name || '?',
            input: event.input || event.tool_input    || {},
          }
          pendingPerms[key] = perm
          broadcast({ type: 'permission_request', agent: key, ...perm })
          continue
        }

        // Skip remaining system/hook noise
        if (t === 'system') continue

        // Assistant text output
        if (t === 'assistant' && event.message?.content) {
          for (const block of event.message.content) {
            if (block.type === 'text' && block.text) {
              broadcast({ type: 'agent_output', agent: key, text: block.text })
            }
            if (block.type === 'tool_use') {
              broadcast({ type: 'tool_call', agent: key, tool: block.name, input: block.input })
            }
          }
        }

        // Tool result
        if (t === 'tool_result' || (t === 'user' && event.message?.content?.[0]?.type === 'tool_result')) {
          const content = event.content || event.message?.content?.[0]?.content
          if (content) broadcast({ type: 'tool_result', agent: key, tool: 'result', result: String(content).slice(0, 200) })
        }

        // Final result
        if (t === 'result') {
          const text = event.result || event.output || ''
          if (text) broadcast({ type: 'agent_output', agent: key, text: '\n' + text })
        }
      } catch {
        if (line.trim()) broadcast({ type: 'agent_output', agent: key, text: line + '\n' })
      }
    }
  })

  proc.stderr.on('data', chunk => {
    const text = chunk.toString()
    broadcast({ type: 'agent_output', agent: key, text: text })
  })

  proc.on('close', code => {
    agentProcs[key]  = null
    pendingPerms[key] = null
    agentStatus[key] = code === 0 ? 'idle' : 'error'
    agentTask[key]   = null
    broadcast({ type: 'agent_status',  agent: key, status: agentStatus[key], task: null })
    broadcast({ type: 'agent_done',    agent: key, exitCode: code })
  })
})

// ── Stop agent ───────────────────────────────────────────────────────────────

app.post('/api/agents/:key/stop', (req, res) => {
  const { key } = req.params
  const proc = agentProcs[key]
  if (proc) {
    proc.kill('SIGTERM')
    res.json({ stopped: true })
  } else {
    res.json({ stopped: false, reason: 'not running' })
  }
})

// ── Permission approve/deny ───────────────────────────────────────────────────

app.post('/api/agents/:key/permission', (req, res) => {
  const { key } = req.params
  const { approved } = req.body
  const proc = agentProcs[key]
  const perm = pendingPerms[key]

  if (!proc || !perm) return res.status(409).json({ error: 'no pending permission' })

  // Write approval/denial to claude stdin (JSON line + plain fallback)
  const response = JSON.stringify({ type: 'permission_response', id: perm.id, approved: !!approved }) + '\n'
  try {
    proc.stdin.write(response)
    // Also try plain y/n in case claude uses interactive-style prompting
    if (approved) proc.stdin.write('y\n')
    else          proc.stdin.write('n\n')
  } catch (_) {}

  pendingPerms[key] = null
  broadcast({ type: 'permission_resolved', agent: key, id: perm.id, approved: !!approved })
  res.json({ ok: true })
})

// ── File Explorer ────────────────────────────────────────────────────────────

const IGNORE = new Set([
  'node_modules', '.next', '.git', '.superpowers', 'dist', 'build',
  '.DS_Store', 'data', 'stream_store',
])

function buildTree(dir, depth = 0) {
  if (depth > 6) return []
  let entries
  try { entries = readdirSync(dir, { withFileTypes: true }) } catch { return [] }

  return entries
    .filter(e => !IGNORE.has(e.name) && !e.name.startsWith('.') || e.name === '.claude' || e.name === '.env.example' || e.name === '.github' || e.name === '.gitignore')
    .sort((a, b) => {
      if (a.isDirectory() && !b.isDirectory()) return -1
      if (!a.isDirectory() && b.isDirectory()) return 1
      return a.name.localeCompare(b.name)
    })
    .map(e => {
      const abs = join(dir, e.name)
      const rel = relative(PROJECT_ROOT, abs)
      if (e.isDirectory()) {
        return { type: 'dir', name: e.name, path: rel, children: buildTree(abs, depth + 1) }
      }
      return { type: 'file', name: e.name, path: rel, ext: extname(e.name).slice(1) }
    })
}

app.get('/api/files/tree', (_req, res) => {
  res.json(buildTree(PROJECT_ROOT))
})

app.get('/api/files/content', (req, res) => {
  const rel = req.query.path
  if (!rel) return res.status(400).json({ error: 'path required' })
  // Reject absolute paths and path traversal segments before joining
  if (rel.startsWith('/') || rel.startsWith('\\') || rel.split('/').includes('..')) {
    return res.status(403).json({ error: 'forbidden' })
  }
  const abs = join(PROJECT_ROOT, rel)
  if (!existsSync(abs)) return res.status(404).json({ error: 'not found' })
  // Resolve symlinks before comparing to prevent symlink escape
  try {
    const realAbs = realpathSync(abs)
    if (!realAbs.startsWith(PROJECT_ROOT_REAL)) return res.status(403).json({ error: 'forbidden' })
    const stat = statSync(realAbs)
    if (stat.size > 500_000) return res.json({ content: '(file too large to preview)', truncated: true })
    res.json({ content: readFileSync(realAbs, 'utf-8') })
  } catch {
    res.json({ content: '(binary file)', truncated: true })
  }
})

// ── Tags ──────────────────────────────────────────────────────────────────────

const TAGS_FILE = join(PROJECT_ROOT, '.claude', 'tags.json')

// Server-side allowlists — must match TAG_COLORS in index.html
const VALID_TAG_COLORS = new Set(['seafoam', 'coral', 'yellow', 'purple', 'blue', 'sand'])
// Safe charset for tag labels: word chars, space, dot, hyphen — max 40 chars.
// Mirrors the client-side regex in addTag() so errors are caught at both layers.
const TAG_LABEL_RE = /^[\w .\-]{1,40}$/

function loadTags() {
  if (!existsSync(TAGS_FILE)) return {}
  try { return JSON.parse(readFileSync(TAGS_FILE, 'utf-8')) } catch { return {} }
}

function saveTags(tags) {
  writeFileSync(TAGS_FILE, JSON.stringify(tags, null, 2), 'utf-8')
}

app.get('/api/tags', (_req, res) => res.json(loadTags()))

app.post('/api/tags', (req, res) => {
  const { path: p, tag, color = 'seafoam' } = req.body

  // Presence check
  if (!p || !tag) return res.status(400).json({ error: 'path and tag required' })

  // Type + length guard on path (path is from client; cap it to prevent DoS / oversized keys)
  if (typeof p !== 'string' || p.length > 500) {
    return res.status(400).json({ error: 'invalid path' })
  }

  // Tag label: safe charset + max length (defence-in-depth alongside client validation)
  if (typeof tag !== 'string' || !TAG_LABEL_RE.test(tag)) {
    return res.status(400).json({ error: 'invalid tag: max 40 chars, alphanumeric / space / dot / hyphen only' })
  }

  // Color: must be one of the known CSS class ids — no free-form class injection
  if (!VALID_TAG_COLORS.has(color)) {
    return res.status(400).json({ error: 'invalid color' })
  }

  const tags = loadTags()
  if (!tags[p]) tags[p] = []
  if (!tags[p].find(t => t.label === tag)) tags[p].push({ label: tag, color })
  saveTags(tags)
  broadcast({ type: 'tags_update', tags })
  res.json({ ok: true })
})

app.delete('/api/tags', (req, res) => {
  const { path: p, tag } = req.body
  if (!p || !tag) return res.status(400).json({ error: 'path and tag required' })
  const tags = loadTags()
  if (tags[p]) {
    tags[p] = tags[p].filter(t => t.label !== tag)
    if (!tags[p].length) delete tags[p]
  }
  saveTags(tags)
  broadcast({ type: 'tags_update', tags })
  res.json({ ok: true })
})

app.listen(PORT, '127.0.0.1', () => {
  console.log(`\n🫙 glassbottles agent dashboard`)
  console.log(`   http://localhost:${PORT}`)
  console.log(`   Project: ${PROJECT_ROOT}`)
  console.log(`   Auth: claude CLI (Pro subscription — no API key needed)\n`)
})
