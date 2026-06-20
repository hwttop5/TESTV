import { normalizePublicList, normalizeToSimplifiedChinese } from './text-normalization'

const NEGATIVE_RE = /(不算舒服|不舒服|不够|不太|不支持|不适合|不方便|不能|没有|缺少|欠缺|受限|偏重|偏大|偏小|偏弱|偏慢|偏贵|太重|太大|太小|太吵|太慢|发热|发烫|噪音|误触|延迟|卡顿|吃力|麻烦|刮花|松动|不稳|不顺|一般|风险|压力|糟糕|明显受限|容易被|容易误|容易脏|通用性差|价格高|价格贵|续航短|风量偏小|降噪一般|不够轻巧|容量偏小|不够力|不合理|不易|费劲|鸡肋|遗憾|可惜|槽点|问题|缺点)/u
const POSITIVE_RE = /(不错|很强|很稳|稳定|清晰|舒服|舒适|轻盈|方便|顺手|直观|扎实|细腻|明显提升|很快|很轻|够用|够亮|够强|有效|优秀|出色|好用|好看|省心|安静|自然|合理|丰富|适合|提升|表现不错|表现很好|效率还可以|续航够用|手感不错|质感不错|极低|很实用|实用|可接|供电|无缝切换|延迟低|抠发丝干净|观感更舒服|回弹干脆|降温确实有效)/u

function hasNegativeMeaning(value: string): boolean {
  return NEGATIVE_RE.test(normalizeToSimplifiedChinese(value))
}

function hasPositiveMeaning(value: string): boolean {
  return POSITIVE_RE.test(normalizeToSimplifiedChinese(value))
}

function appendUnique(target: string[], value: string, maxItems: number): void {
  if (target.length >= maxItems) return
  if (!value || target.includes(value)) return
  target.push(value)
}

export function normalizeOpinionGroups(input: {
  pros: string[]
  cons: string[]
  maxItems?: number
  maxLength?: number
}): {
  pros: string[]
  cons: string[]
} {
  const maxItems = input.maxItems ?? 3
  const maxLength = input.maxLength ?? 42
  const rawPros = normalizePublicList(input.pros, { maxItems: maxItems * 2, maxLength })
  const rawCons = normalizePublicList(input.cons, { maxItems: maxItems * 2, maxLength })
  const pros: string[] = []
  const cons: string[] = []

  for (const value of rawPros) {
    if (hasNegativeMeaning(value) && !hasPositiveMeaning(value)) {
      appendUnique(cons, value, maxItems)
    } else {
      appendUnique(pros, value, maxItems)
    }
  }

  for (const value of rawCons) {
    if (hasPositiveMeaning(value) && !hasNegativeMeaning(value)) {
      appendUnique(pros, value, maxItems)
    } else {
      appendUnique(cons, value, maxItems)
    }
  }

  return {
    pros,
    cons,
  }
}
