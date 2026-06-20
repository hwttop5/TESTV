import 'dotenv/config'
import { prisma } from '../lib/prisma'

async function main() {
  console.log('清理派生数据：产品、字幕、同步状态...')

  await prisma.affiliateLink.deleteMany()
  await prisma.product.deleteMany()
  await prisma.transcript.deleteMany()
  await prisma.video.updateMany({
    data: {
      syncStatus: 'pending',
      transcriptAttempts: 0,
      extractionAttempts: 0,
      lastTranscriptAt: null,
      lastExtractedAt: null,
      lastError: null,
    },
  })

  console.log('清理完成。')
}

main()
  .catch((error) => {
    console.error(error)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
