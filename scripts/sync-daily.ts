import 'dotenv/config'
import { execFile } from 'child_process'
import { promisify } from 'util'
import { prisma } from '../lib/prisma'

const execFileAsync = promisify(execFile)

async function runNpmScript(name: string, script: string): Promise<void> {
  console.log(`\n${'='.repeat(60)}`)
  console.log(`Running: ${name}`)
  console.log('='.repeat(60))

  try {
    const { stdout, stderr } = await execFileAsync(
      process.platform === 'win32' ? 'npm.cmd' : 'npm',
      ['run', script],
      {
        timeout: 60 * 60 * 1000,
        maxBuffer: 1024 * 1024 * 20,
      }
    )

    if (stdout) console.log(stdout)
    if (stderr) console.error(stderr)
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error)
    throw new Error(`${name} failed: ${message}`)
  }
}

async function syncDaily() {
  console.log('Starting daily sync job...')
  console.log(`Started at: ${new Date().toISOString()}`)

  const syncRun = await prisma.syncRun.create({
    data: {
      status: 'running',
    },
  })

  try {
    await runNpmScript('Sync Playlist', 'sync:playlist')
    await runNpmScript('Fetch Transcripts', 'sync:transcripts')
    await runNpmScript('Extract Products', 'sync:extract')

    const [videosProcessed, videosSuccess, videosFailed] = await Promise.all([
      prisma.video.count(),
      prisma.product.count({ where: { published: true } }),
      prisma.video.count({ where: { syncStatus: 'failed' } }),
    ])

    await prisma.syncRun.update({
      where: { id: syncRun.id },
      data: {
        status: 'completed',
        completedAt: new Date(),
        videosProcessed,
        videosSuccess,
        videosFailed,
      },
    })

    console.log(`\n${'='.repeat(60)}`)
    console.log('Daily sync completed successfully')
    console.log(`Total videos: ${videosProcessed}`)
    console.log(`Published products: ${videosSuccess}`)
    console.log(`Failed videos: ${videosFailed}`)
    console.log(`Completed at: ${new Date().toISOString()}`)
    console.log('='.repeat(60))
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error)
    console.error(`\nDaily sync failed: ${message}`)

    await prisma.syncRun.update({
      where: { id: syncRun.id },
      data: {
        status: 'failed',
        completedAt: new Date(),
        errorMessage: message,
        errorDetails: { error: message },
      },
    })

    process.exit(1)
  }
}

syncDaily()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error)
    process.exit(1)
  })
