// Starts Cadence and the demo partner site together. Ctrl+C stops everything.
//   npm start            Cadence API 8000, Cadence site 5173, Northwind API 8100, Northwind site 5180
//   npm start -- --api-port 8002 --web-port 5175 --partner-api-port 8102 --partner-web-port 5182
import { spawn, spawnSync } from 'node:child_process'
import { parseArgs } from 'node:util'

const { values } = parseArgs({
  options: {
    'api-port': { type: 'string', default: '8000' },
    'web-port': { type: 'string', default: '5173' },
    'partner-api-port': { type: 'string', default: '8100' },
    'partner-web-port': { type: 'string', default: '5180' },
  },
})
const port = Object.fromEntries(Object.entries(values).map(([k, v]) => [k, Number(v)]))
if (Object.values(port).some((p) => !Number.isInteger(p))) {
  console.error('Ports must be whole numbers, for example: npm start -- --api-port 8002 --web-port 5175')
  process.exit(1)
}

const cadenceApi = `http://127.0.0.1:${port['api-port']}`
const cadenceWeb = `http://localhost:${port['web-port']}`
const partnerWeb = `http://localhost:${port['partner-web-port']}`
const partnerOrigins = [partnerWeb, `http://127.0.0.1:${port['partner-web-port']}`]

// Every service learns where the others are, so non-default ports still line up.
const env = {
  ...process.env,
  CADENCE_API: cadenceApi, // Cadence site dev proxy
  CADENCE_CADENCE_WEB_URL: cadenceWeb,
  CADENCE_DEMO_SITE_ORIGINS: JSON.stringify(partnerOrigins),
  CADENCE_DEMO_SITE_REDIRECTS: JSON.stringify(partnerOrigins.map((o) => `${o}/cadence/callback`)),
  VITE_PARTNER_URL: partnerWeb,
  NORTHWIND_CADENCE_API: cadenceApi,
  NORTHWIND_CADENCE_WEB: cadenceWeb,
  NORTHWIND_WEB: partnerWeb,
  NORTHWIND_API: `http://127.0.0.1:${port['partner-api-port']}`, // Northwind site dev proxy
  VITE_CADENCE_API: `http://localhost:${port['api-port']}`,
}

const windows = process.platform === 'win32'
const services = [
  { name: 'cadence api', color: 36, command: `uv run --project backend uvicorn cadence.main:app --port ${port['api-port']}` },
  // --strictPort: fail loudly instead of drifting to another port when this one is taken.
  { name: 'cadence web', color: 35, command: `npm run dev -w @cadence/web -- --port ${port['web-port']} --strictPort` },
  {
    name: 'partner api',
    color: 33,
    command: `uv run --project backend uvicorn partner_demo.main:app --port ${port['partner-api-port']}`,
  },
  { name: 'partner web', color: 32, command: `npm run dev -w @cadence/partner -- --port ${port['partner-web-port']} --strictPort` },
]

const children = services.map(({ name, color, command }) => {
  const child = spawn(command, { shell: true, env, stdio: ['ignore', 'pipe', 'pipe'] })
  const prefix = `\x1b[${color}m${name.padEnd(11)}|\x1b[0m `
  const forward = (stream, out) => {
    let pending = ''
    stream.on('data', (chunk) => {
      const lines = (pending + chunk).split(/\r?\n/)
      pending = lines.pop()
      for (const line of lines) out.write(prefix + line + '\n')
    })
  }
  forward(child.stdout, process.stdout)
  forward(child.stderr, process.stderr)
  child.on('exit', (code) => {
    if (!stopping) {
      console.error(`${prefix}stopped (exit ${code}); stopping the others too`)
      stop(code ?? 1)
    }
  })
  return child
})

console.log(`
Cadence is starting.
  Cadence (set up, dashboard):   ${cadenceWeb}
  Volunteer collection:          ${cadenceWeb}/collect
  Northwind CRM (demo partner):  ${partnerWeb}
Press Ctrl+C to stop.
`)

let stopping = false
function stop(code = 0) {
  if (stopping) return
  stopping = true
  for (const child of children) {
    if (child.exitCode !== null) continue
    // On Windows the shell's grandchildren survive a plain kill, so end the whole tree.
    if (windows) spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' })
    else child.kill('SIGTERM')
  }
  process.exit(code)
}
process.on('SIGINT', () => stop(0))
process.on('SIGTERM', () => stop(0))
