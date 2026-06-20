const mode = process.argv[2] === 'slow' ? 'slow' : 'fast'

const file =
  mode === 'slow'
    ? 'scripts/playwright-transcript-browser-slow.js'
    : 'scripts/playwright-transcript-batch-parallel.js'

console.log(
  JSON.stringify(
    {
      mode,
      message: 'Run this file with Playwright MCP browser_run_code_unsafe.',
      file,
    },
    null,
    2
  )
)
