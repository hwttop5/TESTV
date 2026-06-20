import type { MetadataRoute } from 'next'

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'TESTV值不值得买',
    short_name: 'TESTV',
    description: 'TESTV 产品评测目录，支持搜索、分类筛选和评分浏览。',
    start_url: '/',
    display: 'standalone',
    background_color: '#f0eee6',
    theme_color: '#d97757',
    icons: [
      { src: '/icon', sizes: '192x192', type: 'image/png' },
      { src: '/icon', sizes: '512x512', type: 'image/png' },
    ],
  }
}
