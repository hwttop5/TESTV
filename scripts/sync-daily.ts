import 'dotenv/config'
import { execFile } from 'child_process'
import { promisify } from 'util'
import { prisma } from '../lib/prisma'

const execFileAsync = promisify(execFile)

async function runNpmScript(name: string, script: string): Promise<void> {
  console.log(`\n${'='.repeat(60)}`)
  console.log(`执行：${name}`)
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
    throw new Error(`${name} 失败：${message}`)
  }
}

async function syncDaily() {
  console.log('开始日常同步...')
  console.log(`开始时间：${new Date().toISOString()}`)

  const syncRun = await prisma.syncRun.create({
    data: {
      status: 'running',
    },
  })

  try {
    await runNpmScript('同步播放列表', 'sync:playlist')
    await runNpmScript('抓取字幕', 'sync:transcripts')
    await runNpmScript('抽取产品', 'sync:extract')

    const [videosProcessed, videosSuccess, videosFailed] = await Promise.all([
      prisma.video.count(),
      prisma.product.count(),
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
    console.log('日常同步完成')
    console.log(`视频总数：${videosProcessed}`)
    console.log(`产品总数：${videosSuccess}`)
    console.log(`失败视频：${videosFailed}`)
    console.log(`完成时间：${new Date().toISOString()}`)
    console.log('='.repeat(60))
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error)
    console.error(`\n日常同步失败：${message}`)

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
