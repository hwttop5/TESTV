import 'dotenv/config'
import { prisma } from '../lib/prisma'
import { toProductDetail, toProductSummary } from '../lib/review-types'
import { hasEnglishSentence, hasPublicTextIssue, isLikelyTraditionalText } from '../lib/text-normalization'
import { backfillTranscriptStageState } from '../lib/transcript-state-backfill'

type StatusRow = {
  label: string
  value: number
}

async function main() {
  await backfillTranscriptStageState(prisma)

  const [
    totalVideos,
    availableVideos,
    unavailableVideos,
    transcriptCount,
    transcriptCovered,
    noTranscript,
    browserRecovered,
    ytDlpRecovered,
    bilibiliRecovered,
    asrRecovered,
    unresolvedTerminal,
    transcriptStages,
    totalProducts,
    productsWithTranscripts,
    productStatuses,
  ] = await Promise.all([
    prisma.video.count(),
    prisma.video.count({ where: { isAvailable: true } }),
    prisma.video.count({ where: { isAvailable: false } }),
    prisma.transcript.count(),
    prisma.video.count({ where: { transcripts: { some: {} } } }),
    prisma.video.count({ where: { transcripts: { none: {} } } }),
    prisma.transcript.count({ where: { source: 'browser_network_timedtext' } }),
    prisma.transcript.count({ where: { source: 'yt_dlp_subtitle' } }),
    prisma.transcript.count({ where: { source: 'bilibili_subtitle' } }),
    prisma.transcript.count({
      where: {
        source: {
          in: ['openai_audio', 'local_faster_whisper'],
        },
      },
    }),
    prisma.video.count({
      where: {
        transcripts: { none: {} },
        transcriptStage: 'terminal',
      },
    }),
    prisma.video.groupBy({
      by: ['transcriptStage'],
      _count: { _all: true },
      orderBy: { transcriptStage: 'asc' },
    }),
    prisma.product.count(),
    prisma.product.count({ where: { video: { transcripts: { some: {} } } } }),
    prisma.product.groupBy({
      by: ['contentStatus'],
      _count: { _all: true },
      orderBy: { contentStatus: 'asc' },
    }),
  ])

  const productsForDisplayAudit = await prisma.product.findMany({
    include: {
      video: {
        select: {
          youtubeId: true,
          title: true,
          publishedAt: true,
          thumbnailUrl: true,
          videoUrl: true,
          transcripts: {
            select: {
              id: true,
              content: true,
              segments: true,
            },
            orderBy: { createdAt: 'desc' },
            take: 1,
          },
        },
      },
    },
  })

  const productStatusCounts = {
    complete: 0,
    partial: 0,
    placeholder: 0,
  }
  for (const group of productStatuses) {
    if (group.contentStatus === 'complete' || group.contentStatus === 'partial' || group.contentStatus === 'placeholder') {
      productStatusCounts[group.contentStatus] = group._count._all
    }
  }

  const displayAudit = productsForDisplayAudit.reduce((summary, product) => {
    const publicSummary = toProductSummary(product)
    const detail = toProductDetail(product)
    const displayTexts = [
      publicSummary.displayName,
      publicSummary.displayVideoTitle,
      ...publicSummary.displayPros,
      ...publicSummary.displayCons,
      ...detail.displayTranscriptParagraphs,
    ]

    if (publicSummary.prosCount === 0) summary.missingPros += 1
    if (publicSummary.consCount === 0) summary.missingCons += 1
    if (displayTexts.some(isLikelyTraditionalText)) summary.traditional += 1
    if (displayTexts.some(hasEnglishSentence)) summary.englishSentence += 1
    if (displayTexts.some(hasPublicTextIssue)) {
      summary.issueSamples.push({
        id: product.id,
        youtubeId: product.video.youtubeId,
        title: product.video.title,
      })
    }

    return summary
  }, {
    missingPros: 0,
    missingCons: 0,
    traditional: 0,
    englishSentence: 0,
    issueSamples: [] as Array<{ id: string; youtubeId: string; title: string }>,
  })

  const rows: StatusRow[] = [
    { label: 'Video.total', value: totalVideos },
    { label: 'Video.available', value: availableVideos },
    { label: 'Video.unavailable', value: unavailableVideos },
    { label: 'Transcript.total', value: transcriptCount },
    { label: 'Transcript.covered', value: transcriptCovered },
    { label: 'Video.noTranscript', value: noTranscript },
    { label: 'BrowserRecovered', value: browserRecovered },
    { label: 'YtDlpRecovered', value: ytDlpRecovered },
    { label: 'BilibiliRecovered', value: bilibiliRecovered },
    { label: 'AsrRecovered', value: asrRecovered },
    { label: 'UnresolvedTerminal', value: unresolvedTerminal },
    { label: 'Product.total', value: totalProducts },
    { label: 'Product.withTranscript', value: productsWithTranscripts },
    { label: 'Product.complete', value: productStatusCounts.complete },
    { label: 'Product.partial', value: productStatusCounts.partial },
    { label: 'Product.placeholder', value: productStatusCounts.placeholder },
    { label: 'Display.missingPros', value: displayAudit.missingPros },
    { label: 'Display.missingCons', value: displayAudit.missingCons },
    { label: 'Display.traditional', value: displayAudit.traditional },
    { label: 'Display.englishSentence', value: displayAudit.englishSentence },
  ]

  console.log('=== Transcript Status ===')
  for (const row of rows) {
    console.log(`${row.label}: ${row.value}`)
  }

  console.log('\n=== PendingByStage ===')
  for (const group of transcriptStages) {
    console.log(`${group.transcriptStage}: ${group._count._all}`)
  }

  if (displayAudit.issueSamples.length > 0) {
    console.log('\n=== Display Issue Samples ===')
    for (const sample of displayAudit.issueSamples.slice(0, 10)) {
      console.log(`${sample.id} ${sample.youtubeId} ${sample.title}`)
    }
  }
}

main()
  .catch((error) => {
    console.error(error)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
