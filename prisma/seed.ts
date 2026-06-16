import { PrismaClient, Prisma } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import pg from 'pg'

const connectionString = process.env.DATABASE_URL || 'postgresql://postgres:postgres@127.0.0.1:5432/youtube_reviews?schema=public'
const pool = new pg.Pool({ connectionString })
const adapter = new PrismaPg(pool)
const prisma = new PrismaClient({ adapter })

async function main() {
  console.log('Seeding database...')

  await prisma.affiliateLink.deleteMany()
  await prisma.product.deleteMany()
  await prisma.transcript.deleteMany()
  await prisma.video.deleteMany()

  const video = await prisma.video.create({
    data: {
      youtubeId: 'PG1dNbGq1vQ',
      title: 'Sample Product Review: Portable Monitor',
      publishedAt: new Date('2026-06-01T10:00:00Z'),
      thumbnailUrl: 'https://i.ytimg.com/vi/PG1dNbGq1vQ/hqdefault.jpg',
      videoUrl: 'https://www.youtube.com/watch?v=PG1dNbGq1vQ',
      syncStatus: 'extracted',
      lastTranscriptAt: new Date(),
      lastExtractedAt: new Date(),
    },
  })

  await prisma.transcript.create({
    data: {
      videoId: video.id,
      content: '这款便携式显示器的色彩很明亮，机身做工扎实，USB-C 连接也很简单。主要缺点是屏幕反光比较明显，内置扬声器偏弱。我的评分是 8.2/10。',
      source: 'seed',
      language: 'zh',
      segments: [
        { text: '色彩很明亮，机身做工扎实', start: 15, duration: 4 },
        { text: '屏幕反光比较明显，内置扬声器偏弱', start: 48, duration: 5 },
      ] as unknown as Prisma.InputJsonValue,
    },
  })

  const product = await prisma.product.create({
    data: {
      videoId: video.id,
      productName: 'Sample Portable Monitor',
      productNameZh: '便携式显示器',
      videoTitleZh: '便携式显示器测评',
      scoreRaw: '8.2/10',
      scoreValue: 8.2,
      scoreScale: '10',
      normalizedScore: 82,
      pros: [
        'Bright color',
        'Strong build quality',
        'Simple USB-C setup',
      ] as unknown as Prisma.InputJsonValue,
      cons: [
        'Reflective panel',
        'Weak speakers',
      ] as unknown as Prisma.InputJsonValue,
      evidenceSegments: [
        { text: 'I would rate it 8.2 out of 10.', timestamp: '08:40' },
      ] as unknown as Prisma.InputJsonValue,
      prosZh: [
        '色彩表现明亮',
        '机身做工扎实',
        'USB-C 连接简单',
      ] as unknown as Prisma.InputJsonValue,
      consZh: [
        '屏幕反光比较明显',
        '内置扬声器偏弱',
      ] as unknown as Prisma.InputJsonValue,
      evidenceSegmentsZh: [
        { text: '我的评分是 8.2/10。', timestamp: '08:40' },
      ] as unknown as Prisma.InputJsonValue,
      confidence: 0.92,
      published: false,
    },
  })

  await prisma.affiliateLink.createMany({
    data: [
      { productId: product.id, platform: 'jd', url: null },
      { productId: product.id, platform: 'taobao', url: null },
    ],
  })

  console.log('Sample data created')
  console.log(`Video: ${video.title}`)
  console.log(`Product: ${product.productNameZh}`)
}

main()
  .catch((error) => {
    console.error(error)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
    await pool.end()
  })
