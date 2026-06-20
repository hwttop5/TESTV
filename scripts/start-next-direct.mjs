import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const projectDir = path.resolve(__dirname, '..')
const { startServer } = await import('../node_modules/next/dist/server/lib/start-server.js')

const port = Number.parseInt(process.env.PORT || process.env.NEXT_PORT || '3001', 10) || 3001
const isDev = String(process.env.NEXT_DIRECT_DEV || 'true').toLowerCase() === 'true'

await startServer({
  dir: projectDir,
  port,
  hostname: '0.0.0.0',
  isDev,
  allowRetry: false,
  minimalMode: false,
  keepAliveTimeout: undefined,
  selfSignedCertificate: undefined,
  serverFastRefresh: true,
})
