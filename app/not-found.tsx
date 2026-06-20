import type { Metadata } from 'next'
import Link from 'next/link'
import { SITE_NAME } from '@/lib/seo'

export const metadata: Metadata = {
  title: `页面不存在 | ${SITE_NAME}`,
  robots: { index: false, follow: true },
}

export default function NotFound() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-background px-4">
      <p className="text-sm font-medium uppercase tracking-[0.18em] text-foreground/40">404</p>
      <h1 className="font-display mt-4 text-4xl text-foreground">页面不存在</h1>
      <p className="mt-4 text-base text-foreground/60">您访问的页面已被删除或从未存在。</p>
      <Link
        href="/"
        className="mt-8 inline-flex rounded-control border border-foreground/15 bg-white px-5 py-2.5 text-sm font-medium text-foreground/80 transition hover:border-foreground/30 dark:bg-stone-900 dark:hover:bg-stone-800"
      >
        返回首页
      </Link>
    </main>
  )
}
