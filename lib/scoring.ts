export interface ScoreResult {
  scoreRaw: string
  scoreValue: number
  scoreScale: string
  normalizedScore: number
}

export function clampScore(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.min(100, Math.max(0, value))
}

export function normalizeScore(
  scoreRaw: string,
  scoreValue: number,
  scoreScale: string
): number {
  // Convert any score to 0-100 scale
  const scale = parseFloat(scoreScale)
  
  if (isNaN(scale) || scale <= 0) {
    return 0
  }

  return clampScore((scoreValue / scale) * 100)
}

export function formatScoreValue(scoreValue: number): string {
  return scoreValue.toFixed(2).replace(/(?:\.0+|(\.\d*?)0+)$/, '$1')
}

export function compareScoreValueDesc(a: number | null, b: number | null): number {
  if (a == null && b == null) return 0
  if (a == null) return 1
  if (b == null) return -1

  return b - a
}

export function parseScore(scoreText: string): ScoreResult | null {
  const raw = scoreText.trim()
  if (!raw) return null

  // Try to match common patterns:
  // "8/10", "8 out of 10", "4.5/5", "8.5 out of 10", "4 stars out of 5"
  
  // Pattern: X/Y or X out of Y
  const slashMatch = raw.match(/(\d+(?:\.\d+)?)\s*(?:\/|out of|stars?\s+out\s+of)\s*(\d+(?:\.\d+)?)/i)
  if (slashMatch) {
    const value = parseFloat(slashMatch[1])
    const scale = parseFloat(slashMatch[2])
    return {
      scoreRaw: raw,
      scoreValue: value,
      scoreScale: scale.toString(),
      normalizedScore: normalizeScore(raw, value, scale.toString()),
    }
  }

  // Pattern: X% or X percent
  const percentMatch = raw.match(/(\d+(?:\.\d+)?)\s*(?:%|percent)/i)
  if (percentMatch) {
    const value = parseFloat(percentMatch[1])
    return {
      scoreRaw: raw,
      scoreValue: value,
      scoreScale: '100',
      normalizedScore: clampScore(value),
    }
  }

  // Pattern: just a number (assume out of 10)
  const numberMatch = raw.match(/^(\d+(?:\.\d+)?)$/)
  if (numberMatch) {
    const value = parseFloat(numberMatch[1])
    const scale = value <= 5 ? 5 : 10 // Heuristic: if <= 5, assume /5, else /10
    return {
      scoreRaw: raw,
      scoreValue: value,
      scoreScale: scale.toString(),
      normalizedScore: normalizeScore(raw, value, scale.toString()),
    }
  }

  return null
}
