import 'dotenv/config'
import { execFile } from 'child_process'
import { promisify } from 'util'
import { isUsableOpenAiKey } from '../lib/transcript'
import { prisma } from '../lib/prisma'
import { backfillTranscriptStageState } from '../lib/transcript-state-backfill'

const execFileAsync = promisify(execFile)

async function runNpmScript(
  script: string,
  extraEnv: Record<string, string> = {}
) {
  const command = process.platform === 'win32' ? 'npm.cmd' : 'npm'
  const { stdout, stderr } = await execFileAsync(command, ['run', script], {
    env: {
      ...process.env,
      ...extraEnv,
    },
    timeout: 60 * 60 * 1000,
    maxBuffer: 1024 * 1024 * 20,
  })

  if (stdout) process.stdout.write(stdout)
  if (stderr) process.stderr.write(stderr)
}

async function main() {
  await backfillTranscriptStageState(prisma)
  await prisma.$disconnect()

  console.log('[drain] browser fast pass file: scripts/playwright-transcript-batch-parallel.js')
  console.log('[drain] browser slow pass file: scripts/playwright-transcript-browser-slow.js')
  console.log('[drain] run the two browser passes with Playwright MCP until coverage stops increasing, then continue with server-side stages.')

  await runNpmScript('sync:transcripts:ytdlp', {
    CONTINUOUS_MODE: 'true',
  })

  await runNpmScript('sync:transcripts:bilibili', {
    CONTINUOUS_MODE: 'true',
  })

  if (isUsableOpenAiKey(process.env.OPENAI_API_KEY)) {
    console.log('[drain] running ASR sample validation (10 videos)')
    await runNpmScript('sync:transcripts:asr', {
      CONTINUOUS_MODE: 'false',
      ASR_LIMIT: '10',
      ASR_MARK_TERMINAL: 'false',
      ASR_INCLUDE_BROWSER_FAILED: process.env.ASR_INCLUDE_BROWSER_FAILED || 'true',
    })

    console.log('[drain] running full ASR drain')
    await runNpmScript('sync:transcripts:asr', {
      CONTINUOUS_MODE: 'true',
      ASR_MARK_TERMINAL: 'true',
      ASR_INCLUDE_BROWSER_FAILED: process.env.ASR_INCLUDE_BROWSER_FAILED || 'true',
    })
  } else {
    console.log('[drain] skipping ASR because OPENAI_API_KEY is not configured')
  }

  await runNpmScript('export:transcripts')
  await runNpmScript('sync:status')
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
