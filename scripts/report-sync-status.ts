import 'dotenv/config'
import { prisma } from '../lib/prisma'
import { toProductSummary } from '../lib/review-types'

async function main() {
  const [
    totalVideos,
    availableVideos,
    unavailableVideos,
    transcriptCount,
    productCount,
    publishedProducts,
    syncStatusGroups,
    unavailableGroups,
    availableWithoutTranscript,
    products,
  ] = await Promise.all([
    prisma.video.count(),
    prisma.video.count({ where: { isAvailable: true } }),
    prisma.video.count({ where: { isAvailable: false } }),
    prisma.transcript.count(),
    prisma.product.count(),
    prisma.product.count({ where: { published: true } }),
    prisma.video.groupBy({
      by: ['syncStatus'],
      _count: { _all: true },
      orderBy: { syncStatus: 'asc' },
    }),
    prisma.video.groupBy({
      by: ['unavailableReason'],
      where: { isAvailable: false },
      _count: { _all: true },
      orderBy: { unavailableReason: 'asc' },
    }),
    prisma.video.count({
      where: {
        isAvailable: true,
        transcripts: { none: {} },
      },
    }),
    prisma.product.findMany({
      where: { published: true },
      include: {
        video: {
          select: {
            youtubeId: true,
            publishedAt: true,
            thumbnailUrl: true,
            videoUrl: true,
          },
        },
      },
    }),
  ])

  const displayableProducts = products.flatMap((product) => {
    const summary = toProductSummary(product)
    return summary ? [summary] : []
  })

  console.log('=== 同步状态 ===')
  console.log(`视频总数：${totalVideos}`)
  console.log(`可用视频：${availableVideos}`)
  console.log(`不可用视频：${unavailableVideos}`)
  console.log(`字幕记录：${transcriptCount}`)
  console.log(`可用但无字幕：${availableWithoutTranscript}`)
  console.log(`产品记录：${productCount}`)
  console.log(`已发布产品：${publishedProducts}`)
  console.log(`中文可展示产品：${displayableProducts.length}`)
  console.log(`已发布但缺中文字段：${Math.max(0, publishedProducts - displayableProducts.length)}`)

  console.log('\n=== 视频状态分布 ===')
  for (const group of syncStatusGroups) {
    console.log(`${group.syncStatus}：${group._count._all}`)
  }

  if (unavailableGroups.length > 0) {
    console.log('\n=== 不可用原因分布 ===')
    for (const group of unavailableGroups) {
      console.log(`${group.unavailableReason || 'unknown'}：${group._count._all}`)
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
