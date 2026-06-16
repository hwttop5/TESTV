import axios from 'axios'
import { z } from 'zod'
import { clampScore, normalizeScore, parseScore } from './scoring'

const RawExtractionSchema = z.object({
  productName: z.string().default(''),
  productNameZh: z.string().default(''),
  videoTitleZh: z.string().default(''),
  scoreRaw: z.string().nullable().optional(),
  scoreValue: z.number().nullable().optional(),
  scoreScale: z.union([z.string(), z.number()]).nullable().optional(),
  normalizedScore: z.number().nullable().optional(),
  pros: z.array(z.string()).default([]),
  cons: z.array(z.string()).default([]),
  prosZh: z.array(z.string()).default([]),
  consZh: z.array(z.string()).default([]),
  evidenceSegments: z.array(
    z.object({
      text: z.string(),
      timestamp: z.string().nullable().optional(),
    })
  ).default([]),
  evidenceSegmentsZh: z.array(
    z.object({
      text: z.string(),
      timestamp: z.string().nullable().optional(),
    })
  ).default([]),
  confidence: z.number().min(0).max(1).default(0),
})

export interface ExtractionResult {
  productName: string
  productNameZh: string
  videoTitleZh: string
  scoreRaw: string | null
  scoreValue: number | null
  scoreScale: string | null
  normalizedScore: number | null
  pros: string[]
  cons: string[]
  prosZh: string[]
  consZh: string[]
  evidenceSegments: Array<{
    text: string
    timestamp?: string
  }>
  evidenceSegmentsZh: Array<{
    text: string
    timestamp?: string
  }>
  confidence: number
}

function cleanString(value: string): string {
  return value.replace(/\s+/g, ' ').trim()
}

function cleanList(values: string[]): string[] {
  return values.map(cleanString).filter(Boolean)
}

export function finalizeExtraction(raw: unknown): ExtractionResult {
  const parsed = RawExtractionSchema.parse(raw)
  const scoreRaw = parsed.scoreRaw ? cleanString(parsed.scoreRaw) : null
  const scoreScale = parsed.scoreScale == null ? null : String(parsed.scoreScale)

  let scoreValue = parsed.scoreValue ?? null
  let normalizedScore = parsed.normalizedScore ?? null
  let finalScoreScale = scoreScale

  if (scoreRaw) {
    const localScore = parseScore(scoreRaw)

    if (localScore) {
      scoreValue = scoreValue ?? localScore.scoreValue
      finalScoreScale = finalScoreScale ?? localScore.scoreScale
      normalizedScore = normalizedScore ?? localScore.normalizedScore
    }
  }

  if (normalizedScore == null && scoreValue != null && finalScoreScale) {
    normalizedScore = normalizeScore(scoreRaw || String(scoreValue), scoreValue, finalScoreScale)
  }

  return {
    productName: cleanString(parsed.productName),
    productNameZh: cleanString(parsed.productNameZh),
    videoTitleZh: cleanString(parsed.videoTitleZh),
    scoreRaw,
    scoreValue,
    scoreScale: finalScoreScale,
    normalizedScore: normalizedScore == null ? null : clampScore(normalizedScore),
    pros: cleanList(parsed.pros),
    cons: cleanList(parsed.cons),
    prosZh: cleanList(parsed.prosZh),
    consZh: cleanList(parsed.consZh),
    evidenceSegments: parsed.evidenceSegments.flatMap((segment) => {
      const text = cleanString(segment.text)
      if (!text) return []

      return [{
        text,
        ...(segment.timestamp ? { timestamp: cleanString(segment.timestamp) } : {}),
      }]
    }),
    evidenceSegmentsZh: parsed.evidenceSegmentsZh.flatMap((segment) => {
      const text = cleanString(segment.text)
      if (!text) return []

      return [{
        text,
        ...(segment.timestamp ? { timestamp: cleanString(segment.timestamp) } : {}),
      }]
    }),
    confidence: parsed.confidence,
  }
}

export async function extractProductInfo(
  transcript: string,
  apiKey: string,
  model = 'gpt-4o-mini',
  videoTitle?: string
): Promise<ExtractionResult> {
  const prompt = `你是一个严谨的产品评测信息抽取助手。请从视频标题和字幕中提取结构化评测信息，并严格返回 JSON。
视频标题：${videoTitle || '未知'}

字幕内容：${transcript.slice(0, 12000)}${transcript.length > 12000 ? '\n\n[字幕已截断]' : ''}

请只返回 JSON，不要返回 Markdown 代码块。字段要求如下：
{
  "productName": "被测产品的原始名称，保留字幕或标题中的原文名称",
  "productNameZh": "面向中文用户展示的产品名称；品牌和型号可保留英文，但必须补充中文品类或中文说明",
  "videoTitleZh": "视频标题的中文翻译",
  "scoreRaw": "视频结尾或总结中出现的原始评分，例如 8/10、85%、4.5 out of 5；没有明确评分则为 null",
  "scoreValue": "评分数值；没有则为 null",
  "scoreScale": "评分满分；没有则为 null",
  "normalizedScore": "归一化到 0-100 的分数；没有则为 null",
  "pros": ["优点的原文，保留字幕原文"],
  "prosZh": ["优点的中文表达，必须是自然中文，不要只复制英文"],
  "cons": ["缺点的原文，保留字幕原文"],
  "consZh": ["缺点的中文表达，必须是自然中文，不要只复制英文"],
  "evidenceSegments": [{"text": "支持抽取结论的字幕原文片段", "timestamp": "可选时间点"}],
  "evidenceSegmentsZh": [{"text": "支持抽取结论的中文证据片段", "timestamp": "可选时间点"}],
  "confidence": 0 到 1 的抽取置信度
}

规则：
- 每个视频只抽取一个主要产品。
- 用户只会看到 productNameZh、videoTitleZh、prosZh、consZh 和 evidenceSegmentsZh，这些字段必须使用中文。
- 品牌名、型号、接口名和平台名可以保留英文，例如 Sony、USB-C、Wi-Fi、YouTube。
- 优点和缺点必须来自字幕内容，不要编造。
- 如果评分没有明确出现，不要猜测。
- 如果无法确认产品名，使用标题中最可能的产品名，并降低 confidence。
- 如果字幕本身是中文，pros/cons 与 prosZh/consZh 可以相同。
- 如果某个优点或缺点无法翻译成中文，就不要放入对应的中文数组。`

  try {
    const response = await axios.post(
      'https://api.openai.com/v1/chat/completions',
      {
        model,
        messages: [
          {
            role: 'system',
            content: '你负责从产品评测字幕中抽取结构化数据。必须只返回严格 JSON，公开展示字段必须是自然中文。',
          },
          {
            role: 'user',
            content: prompt,
          },
        ],
        temperature: 0.1,
        response_format: { type: 'json_object' },
      },
      {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        timeout: 90_000,
      }
    )

    const content = response.data.choices[0]?.message?.content
    if (!content) {
      throw new Error('No response from AI')
    }

    return finalizeExtraction(JSON.parse(content))
  } catch (error) {
    console.error('AI extraction failed:', error)
    throw error
  }
}
