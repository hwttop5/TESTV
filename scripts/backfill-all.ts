import 'dotenv/config'

async function backfillAll() {
  console.log('=== Starting Full Backfill ===\n')
  console.log('This will run all sync steps in sequence until queues are drained.\n')

  const { execSync } = await import('child_process')

  try {
    // Step 1: Sync playlist
    console.log('\n--- Step 1: Syncing Playlist ---')
    execSync('npm run sync:playlist', { stdio: 'inherit' })

    // Step 2: Fetch transcripts (continuous mode)
    console.log('\n--- Step 2: Fetching Transcripts (Continuous) ---')
    execSync('npm run sync:transcripts', {
      stdio: 'inherit',
      env: { ...process.env, CONTINUOUS_MODE: 'true' }
    })

    // Step 3: Extract products (continuous mode)
    console.log('\n--- Step 3: Extracting Products (Continuous) ---')
    execSync('npm run sync:extract', {
      stdio: 'inherit',
      env: { ...process.env, CONTINUOUS_MODE: 'true' }
    })

    console.log('\n=== Full Backfill Complete ===')
  } catch (error) {
    console.error('\n=== Backfill Failed ===')
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
