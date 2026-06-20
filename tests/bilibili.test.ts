import { describe, expect, it } from 'vitest'
import {
  buildBilibiliSearchQueries,
  extractEpisodeNumber,
  parseBilibiliSubtitle,
} from '../lib/bilibili'

describe('bilibili helpers', () => {
  it('extracts the episode number from Chinese titles', () => {
    expect(extractEpisodeNumber('提升最大，但不推荐-iPhone16【值不值得买第670期】')).toBe('670')
  })

  it('builds search queries around the main title and episode number', () => {
    const queries = buildBilibiliSearchQueries(
      '提升最大，但不推荐-iPhone16【值不值得买第670期】',
    )

    expect(queries).toContain('提升最大，但不推荐-iPhone16')
    expect(queries).toContain('值不值得买 670')
    expect(queries).toContain('值不值得买 第670期')
  })

  it('parses bilibili subtitle json into transcript segments', () => {
    const transcript = parseBilibiliSubtitle({
      lan: 'zh-CN',
      body: [
        { from: 0, to: 1.2, content: '第一句' },
        { from: 1.2, to: 2.8, content: '第二句' },
      ],
    })

    expect(transcript).not.toBeNull()
    expect(transcript?.language).toBe('zh-CN')
    expect(transcript?.content).toBe('第一句 第二句')
    expect(transcript?.segments).toHaveLength(2)
  })
})
