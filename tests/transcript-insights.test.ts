import { describe, expect, it } from 'vitest'
import { buildTranscriptParagraphs, deriveProsConsFromTranscript } from '../lib/transcript-insights'

describe('transcript insights helpers', () => {
  it('filters intro and transition lines and keeps concrete evaluation sentences', () => {
    const result = deriveProsConsFromTranscript({
      segments: [
        { text: '大家好，今天继续给大家推荐几款耳机。', start: 0, duration: 1 },
        { text: '这款耳机佩戴很舒服，长时间戴着也不夹头。', start: 1, duration: 1 },
        { text: '所以大部分时间不会误触。', start: 2, duration: 1 },
        { text: '不过它的延迟还是偏高，打游戏不太适合。', start: 4, duration: 1 },
        { text: '接下来我们再看下一款。', start: 7.5, duration: 1 },
      ],
    })

    expect(result.pros).toEqual(['这款耳机佩戴很舒服，长时间戴着也不夹头。所以大部分时间不会误触'])
    expect(result.cons).toEqual(['不过它的延迟还是偏高，打游戏不太适合'])
  })

  it('does not turn previous-episode narration into pros or cons', () => {
    const result = deriveProsConsFromTranscript({
      content: '上一期我们推荐了三款耳机。本期继续给你推荐另外三款。接下来我们先看第一个。',
    })

    expect(result.pros).toEqual([])
    expect(result.cons).toEqual([])
  })

  it('builds transcript paragraphs from timed segments', () => {
    const paragraphs = buildTranscriptParagraphs({
      segments: [
        { text: '第一段第一句。', start: 0, duration: 1 },
        { text: '第一段第二句。', start: 1, duration: 1 },
        { text: '第二段第一句。', start: 5.2, duration: 1 },
        { text: '第二段第二句。', start: 6.3, duration: 1 },
      ],
    })

    expect(paragraphs).toEqual([
      '第一段第一句。第一段第二句。',
      '第二段第一句。第二段第二句。',
    ])
  })

  it('falls back to content paragraphing when no segments are available', () => {
    const paragraphs = buildTranscriptParagraphs({
      content: [
        '这是一段很长的字幕内容，主要用于验证没有 segments 时也能分段展示，而且会持续补充很多关于使用场景、功能体验和细节感受的描述。',
        '第二句继续补充说明这个产品的使用体验和优点，确保段落长度足够，同时把自动模式、做工质感、日常通勤这些信息都写进去。',
        '第三句开始讲问题，比如重量偏大、长时间使用会有点累，并且散热位置如果调整不好还可能影响背负舒适度。',
        '第四句继续补充缺点，确保最终会拆成不止一个段落，同时也让回退分段逻辑更接近真实字幕的长度。',
      ].join(''),
    })

    expect(paragraphs.length).toBeGreaterThan(1)
    expect(paragraphs.join('')).toContain('使用体验')
  })
})
