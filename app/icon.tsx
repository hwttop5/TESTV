import { ImageResponse } from 'next/og'

export const size = {
  width: 512,
  height: 512,
}

export const contentType = 'image/png'

export default function Icon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: 'linear-gradient(145deg, #f5f1e8 0%, #f0eee6 100%)',
        }}
      >
        <div
          style={{
            width: 420,
            height: 420,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            borderRadius: 108,
            background: '#141413',
            boxShadow: 'inset 0 0 0 2px rgba(255,255,255,0.06)',
            position: 'relative',
          }}
        >
          <div
            style={{
              position: 'absolute',
              inset: 28,
              borderRadius: 88,
              border: '1px solid rgba(255,255,255,0.08)',
            }}
          />
          <div
            style={{
              display: 'flex',
              alignItems: 'flex-end',
              gap: 18,
              color: '#ffffff',
              fontFamily: '"Geist", "Arial", sans-serif',
              letterSpacing: 0,
            }}
          >
            <span
              style={{
                fontSize: 168,
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
                marginBottom: 10,
              }}
            >
              <span
                style={{
                  fontSize: 40,
                  fontWeight: 600,
                  color: '#d97757',
                  lineHeight: 1,
                }}
              >
                TEST
              </span>
              <span
                style={{
                  fontSize: 74,
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
