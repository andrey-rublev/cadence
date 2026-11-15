// Starts the API and the web app together. Ctrl+C stops both.
//   npm start                                       API on 8000, web app on 5173
//   npm start -- --api-port 8002 --web-port 5175    when those ports are taken
import { spawn, spawnSync } from 'node:child_process'
import { parseArgs } from 'node:util'

const { values } = parseArgs({
  options: { 'api-port': { type: 'string', default: '8000' }, 'web-port': { type: 'string', default: '5173' } },
})
const apiPort = Number(values['api-port'])
const webPort = Number(values['web-port'])
if (!Number.isInteger(apiPort) || !Number.isInteger(webPort)) {
  console.error('Ports must be whole numbers, for example: npm start -- --api-port 8002 --web-port 5175')
  process.exit(1)
}

const windows = process.platform === 'win32'
const services = [
  { name: 'api', color: 36, command: `uv run --project backend uvicorn cadence.main:app --port ${apiPort}` },
  // --strictPort: fail loudly instead of drifting to another port when this one is taken.
  { name: 'web', color: 35, command: `npm run dev -w @cadence/web -- --port ${webPort} --strictPort` },
]
// The web app's dev server forwards /api to this address (apps/web/vite.config.ts).
const env = { ...process.env, CADENCE_API: `http://127.0.0.1:${apiPort}` }

const children = services.map(({ name, color, command }) => {
  const child = spawn(command, { shell: true, env, stdio: ['ignore', 'pipe', 'pipe'] })
  const prefix = `\x1b[${color}m${name.padEnd(4)}|\x1b[0m `
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
      console.error(`${prefix}stopped (exit ${code}); stopping the other service too`)
      stop(code ?? 1)
    }
  })
  return child
})

console.log(
  `\nCadence is starting. Open http://localhost:${webPort} (product) or http://localhost:${webPort}/collect (collection).`,
)
console.log('Press Ctrl+C to stop.\n')

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
