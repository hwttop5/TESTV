import 'dotenv/config'

async function backfillAll() {
  console.log('=== 开始全量回填 ===\n')

  const { execSync } = await import('child_process')

  try {
    console.log('\n--- Step 0: 清理派生数据 ---')
    execSync('npx tsx scripts/reset-derived-data.ts', { stdio: 'inherit' })

    console.log('\n--- Step 1: 同步播放列表 ---')
    execSync('npm run sync:playlist', { stdio: 'inherit' })

    console.log('\n--- Step 2: 全量抓取字幕 ---')
    execSync('npm run sync:transcripts', {
      stdio: 'inherit',
      env: {
        ...process.env,
        CONTINUOUS_MODE: 'true',
        FORCE_RETRY_FAILED_TRANSCRIPTS: 'true',
      },
    })

    console.log('\n--- Step 3: 全量抽取产品 ---')
    execSync('npm run sync:extract', {
      stdio: 'inherit',
      env: {
        ...process.env,
        CONTINUOUS_MODE: 'true',
        REPROCESS_ALL_PRODUCTS: 'true',
        FORCE_RETRY_FAILED_EXTRACTIONS: 'true',
      },
    })

    console.log('\n--- Step 4: 输出状态 ---')
    execSync('npm run sync:status', { stdio: 'inherit' })

    console.log('\n=== 全量回填完成 ===')
  } catch (error) {
    console.error('\n=== 回填失败 ===')
    console.error(error)
    process.exit(1)
  }
}

backfillAll()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error)
    process.exit(1)
  })
