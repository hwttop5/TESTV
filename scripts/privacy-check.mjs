#!/usr/bin/env node
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, readdirSync } from 'node:fs'

function parseGitIndex(indexPath = '.git/index') {
  const buffer = readFileSync(indexPath)
  if (buffer.toString('utf8', 0, 4) !== 'DIRC') {
    throw new Error('Unsupported git index header')
  }

  const version = buffer.readUInt32BE(4)
  if (version !== 2 && version !== 3) {
    throw new Error(`Unsupported git index version ${version}`)
  }

  const count = buffer.readUInt32BE(8)
  const files = []
  let offset = 12

  for (let index = 0; index < count; index += 1) {
    const entryStart = offset
    const flags = buffer.readUInt16BE(offset + 60)
    const nameLength = flags & 0x0fff
    offset += 62

    let nameEnd = offset
    if (nameLength < 0x0fff) {
      nameEnd = offset + nameLength
    } else {
      while (nameEnd < buffer.length && buffer[nameEnd] !== 0) nameEnd += 1
    }

    const file = buffer.toString('utf8', offset, nameEnd)
    files.push(file.replace(/\\/g, '/'))

    offset = nameEnd + 1
    const padding = (8 - ((offset - entryStart) % 8)) % 8
    offset += padding
  }

  return files
}

function trackedFiles() {
  try {
    return execFileSync('git', ['ls-files'], { encoding: 'utf8' })
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
  } catch {
    return parseGitIndex()
  }
}

function untrackedFiles() {
  try {
    return execFileSync('git', ['ls-files', '--others', '--exclude-standard'], { encoding: 'utf8' })
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
  } catch {
    return walkFiles('.')
  }
}

function normalizePath(target) {
  return target.replace(/\\/g, '/').replace(/^\.\//, '')
}

function isIgnoredByProjectRules(target) {
  const normalized = normalizePath(target)
  const basename = normalized.split('/').pop() || normalized

  if (normalized === '.env' || /^\.env\./.test(normalized)) return true
  if (normalized === 'youtube-cookies.txt') return true
  if (/\.log$/i.test(normalized)) return true
  if (/\.png$/i.test(normalized)) return true
  if (/\.tsbuildinfo$/i.test(normalized)) return true
  if (normalized === 'next-env.d.ts') return true
  if (/\.pem$/i.test(normalized)) return true
  if (basename.startsWith('dev-server') && basename.endsWith('.log')) return true
  if (basename.startsWith('.codex') && basename.endsWith('.log')) return true
  if (basename.startsWith('.tmp-') || normalized.startsWith('.tmp-/')) return true

  return false
}

function shouldSkipDirectory(directory) {
  const skipped = new Set([
    '.git',
    '.next',
    'node_modules',
    'out',
    'build',
    'coverage',
    '.vercel',
    '.playwright-mcp',
  ])
  const basename = directory.split('/').pop() || directory

  if (skipped.has(directory) || skipped.has(basename)) return true
  if (directory.startsWith('.playwright-youtube-profile')) return true
  if (basename.startsWith('.tmp-')) return true
  if (directory === 'app/generated/prisma') return true

  return false
}

function walkFiles(directory) {
  if (!existsSync(directory)) return []

  const files = []
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const file = normalizePath(directory + '/' + entry.name)
    if (entry.isDirectory()) {
      if (shouldSkipDirectory(file)) continue
      files.push(...walkFiles(file))
    } else if (entry.isFile()) {
      files.push(file)
    }
  }

  return files
}

function isAllowedDataFile(file) {
  return file === 'data/README.md' || file.startsWith('data/samples/')
}

function isLikelyNonIpNumericLine(line) {
  return /<path\b[^>]*\bd=/.test(line) || /Mozilla\/|Chrome\/|Safari\//.test(line)
}

const files = trackedFiles()
const candidateFiles = [...new Set([...files, ...untrackedFiles()])]
const failures = []

function fail(message) {
  failures.push(message)
}

const forbiddenTracked = [
  /^\.env(?:\..*)?$/,
  /(^|\/)youtube-cookies\.txt$/,
  /(^|\/)bilibili-cookie.*\.txt$/i,
  /\.(pem|key|p12|pfx)$/i,
  /(^|\/)deploy\/\.env$/,
]

for (const file of files) {
  if (file === '.env.example' || file === '.env.docker.example') continue
  if (forbiddenTracked.some((pattern) => pattern.test(file))) {
    fail(`forbidden tracked secret-like file: ${file}`)
  }

  if (file.startsWith('data/') && existsSync(file)) {
    if (!isAllowedDataFile(file)) {
      fail(`raw data artifact is still present as a tracked working-tree file: ${file}`)
    }
  }
}

for (const file of walkFiles('data')) {
  if (!isAllowedDataFile(file)) {
    fail('raw data artifact is present in working tree: ' + file)
  }
}

const publicIpv4Pattern = /(^|[\s"'=:\[({,])(?!(?:0|10|127|169\.254|172\.(?:1[6-9]|2\d|3[0-1])|192\.168|255)\.)(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]\d?|0)\.(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]\d?|0)\.(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]\d?|0)\.(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]\d?|0)(?=$|[\s"'\])},])/

const secretPatterns = [
  { name: 'OpenAI key', pattern: /sk-[A-Za-z0-9_-]{20,}/ },
  { name: 'GitHub token', pattern: /(ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9_]{20,}/ },
  { name: 'GitHub fine-grained token', pattern: /github_pat_[A-Za-z0-9_]+/ },
  { name: 'AWS access key', pattern: /AKIA[0-9A-Z]{16}/ },
  { name: 'Google API key', pattern: /AIza[0-9A-Za-z_-]{35}/ },
  { name: 'private key block', pattern: /-----BEGIN (?:RSA |OPENSSH |EC |DSA |)?PRIVATE KEY-----/ },
  { name: 'Bilibili login cookie', pattern: /(?:SESSDATA|bili_jct|DedeUserID)=/ },
  { name: 'real TESTV production domain', pattern: /\btestv\.ttop5\.cc\b/i },
  { name: 'real TESTV stack path', pattern: /\/opt\/stacks\/testv\b/i },
  { name: 'real TESTV data path', pattern: /\/srv\/testv\b/i },
]

const textFilePattern = /\.(?:cjs|css|env|example|gitignore|html|js|json|jsonl|md|mjs|prisma|py|sh|sql|svg|toml|ts|tsx|txt|yml|yaml)$/i
const scanFiles = candidateFiles.filter((file) => {
  if (!existsSync(file)) return false
  if (file.startsWith('data/samples/')) return true
  if (file.startsWith('data/')) return false
  if (file === 'package-lock.json') return false
  if (isIgnoredByProjectRules(file)) return false
  return textFilePattern.test(file)
})

for (const file of scanFiles) {
  const content = readFileSync(file, 'utf8')
  for (const { name, pattern } of secretPatterns) {
    if (pattern.test(content)) {
      fail(`${name} pattern found in ${file}`)
    }
  }

  const lines = content.split(/\r?\n/)
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]
    if (isLikelyNonIpNumericLine(line)) continue
    if (publicIpv4Pattern.test(line)) {
      fail(`public IPv4 address pattern found in ${file}:${index + 1}`)
    }
  }
}

const ignoredChecks = [
  '.env',
  'youtube-cookies.txt',
  'debug.log',
  'homepage-local.png',
]

for (const target of ignoredChecks) {
  if (!isIgnoredByProjectRules(target)) {
    fail(`expected local private artifact to be ignored: ${target}`)
  }
}

if (failures.length > 0) {
  console.error('Privacy check failed:')
  for (const failure of failures.slice(0, 80)) {
    console.error(`- ${failure}`)
  }
  if (failures.length > 80) {
    console.error(`- ... ${failures.length - 80} more`)
  }
  process.exit(1)
}

console.log(`Privacy check passed (${scanFiles.length} text files scanned, ${files.length} tracked paths checked, ${candidateFiles.length - files.length} untracked paths checked).`)
