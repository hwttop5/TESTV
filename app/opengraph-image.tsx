import { ImageResponse } from 'next/og'
import { SITE_NAME } from '@/lib/seo'

export const size = {
  width: 1200,
  height: 630,
}

export const contentType = 'image/png'

export default function Image() {
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          background: '#f0eee6',
          color: '#141413',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          padding: '72px',
          fontFamily: 'Arial, "Microsoft YaHei", sans-serif',
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '20px',
            fontSize: 32,
            fontWeight: 700,
          }}
        >
          <div
            style={{
              width: 72,
              height: 72,
              borderRadius: 16,
              background: '#d97757',
              color: '#fff',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              letterSpacing: 2,
            }}
          >
            TV
          </div>
          <span>TESTV</span>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          <h1
            style={{
              margin: 0,
              fontSize: 82,
              lineHeight: 1.05,
              letterSpacing: -2,
              fontWeight: 700,
            }}
          >
            {SITE_NAME}
          </h1>
          <p
            style={{
              margin: '28px 0 0',
              fontSize: 30,
              lineHeight: 1.35,
              color: '#5f5b52',
            }}
          >
            产品评分、优缺点、文字版与购买参考
          </p>
        </div>
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            fontSize: 24,
            color: '#6d675e',
          }}
        >
          <span>Bunny try before you buy.</span>
          <span>testv</span>
        </div>
      </div>
    ),
    size,
  )
}
