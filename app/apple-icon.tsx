import { ImageResponse } from 'next/og'

export const size = {
  width: 180,
  height: 180,
}

export const contentType = 'image/png'

export default function AppleIcon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: '#f0eee6',
        }}
      >
        <div
          style={{
            width: 156,
            height: 156,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            borderRadius: 40,
            background: '#141413',
            color: '#ffffff',
            fontFamily: '"Geist", "Arial", sans-serif',
            boxShadow: 'inset 0 0 0 1px rgba(255,255,255,0.08)',
          }}
        >
          <div
            style={{
              display: 'flex',
              alignItems: 'flex-end',
              gap: 6,
            }}
          >
            <span
              style={{
                fontSize: 62,
                fontWeight: 700,
                lineHeight: 0.9,
              }}
            >
              T
            </span>
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                marginBottom: 4,
              }}
            >
              <span
                style={{
                  fontSize: 15,
                  fontWeight: 600,
                  color: '#d97757',
                  lineHeight: 1,
                }}
              >
                TEST
              </span>
              <span
                style={{
                  fontSize: 28,
                  fontWeight: 700,
                  lineHeight: 0.9,
                }}
              >
                V
              </span>
            </div>
          </div>
        </div>
      </div>
    ),
    { ...size },
  )
}
