import { createServer } from 'node:http'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import next from 'next'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const projectDir = path.resolve(__dirname, '..')

const host = process.env.HOST || '127.0.0.1'
const port = Number.parseInt(process.env.PORT || process.env.NEXT_PORT || '3001', 10) || 3001
const dev = process.env.NODE_ENV !== 'production'

const app = next({
  dev,
  dir: projectDir,
  hostname: host,
  port,
  webpack: true,
})

const handle = app.getRequestHandler()

try {
  await app.prepare()

  createServer((req, res) => {
    handle(req, res)
  }).listen(port, host, () => {
    process.stdout.write(`> Custom Next server listening at http://${host}:${port}\n`)
  })
} catch (error) {
  console.error('Failed to start custom Next server:', error)
  process.exitCode = 1
}