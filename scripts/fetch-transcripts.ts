import 'dotenv/config'
import { execFile } from 'child_process'
import { promisify } from 'util'

const execFileAsync = promisify(execFile)

async function main() {
  const command = process.platform === 'win32' ? 'npm.cmd' : 'npm'
  const { stdout, stderr } = await execFileAsync(command, ['run', 'sync:transcripts:drain'], {
    env: process.env,
    timeout: 60 * 60 * 1000,
    maxBuffer: 1024 * 1024 * 20,
  })

  if (stdout) process.stdout.write(stdout)
  if (stderr) process.stderr.write(stderr)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
