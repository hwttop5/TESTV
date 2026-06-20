export type ProductCategoryKey =
  | 'all'
  | 'phone'
  | 'tablet-ereader'
  | 'audio'
  | 'computer'
  | 'camera'
  | 'gaming'
  | 'wearable'
  | 'home-appliance'
  | 'office-peripheral'
  | 'travel-auto'
  | 'lifestyle-other'

export interface ProductCategoryOption {
  key: ProductCategoryKey
  label: string
}

export interface ProductCategoryInferenceInput {
  productNameZh?: string | null
  productName?: string | null
  videoTitleZh?: string | null
  videoTitle?: string | null
}

type InferredProductCategoryKey = Exclude<ProductCategoryKey, 'all'>

interface CategoryRule {
  key: InferredProductCategoryKey
  label: string
  priority: number
  strong: RegExp[]
  medium?: RegExp[]
  weak?: RegExp[]
  negative?: RegExp[]
}

interface WeightedText {
  value: string
  weight: number
}

const PRODUCT_CATEGORY_OPTIONS: ProductCategoryOption[] = [
  { key: 'all', label: '全部' },
  { key: 'phone', label: '手机' },
  { key: 'tablet-ereader', label: '平板/电纸书' },
  { key: 'audio', label: '耳机/音频' },
  { key: 'computer', label: '电脑' },
  { key: 'camera', label: '相机/影像' },
  { key: 'gaming', label: '游戏/娱乐' },
  { key: 'wearable', label: '智能穿戴' },
  { key: 'home-appliance', label: '家居/家电' },
  { key: 'office-peripheral', label: '办公/外设' },
  { key: 'travel-auto', label: '出行/车品' },
  { key: 'lifestyle-other', label: '生活/其他' },
]

const CATEGORY_RULES: CategoryRule[] = [
  {
    key: 'tablet-ereader',
    label: '平板/电纸书',
    priority: 0,
    strong: [
      /平板|电纸书|阅读器|墨水屏|电子书/i,
      /\bipad\b|\btablet\b|\bkindle\b|\bboox\b|\bpaperwhite\b|\bmatepad\b/i,
      /\btab\b|\bk pad\b|\bpad\b/i,
    ],
    medium: [
      /小米平板|荣耀平板|华为平板|联想平板|红米平板/i,
      /\bgalaxy tab\b|\bxiaomi pad\b|\bredmi pad\b/i,
    ],
    negative: [/手机|耳机|手表|笔记本|显示器|风扇|背包/i],
  },
  {
    key: 'camera',
    label: '相机/影像',
    priority: 1,
    strong: [
      /相机|镜头|拍立得|无人机|稳定器|运动相机|微单|胶片机|摄影|影像/i,
      /\bcamera\b|\blens\b|\bgopro\b|\binstax\b|\bmavic\b|\bosmo\b/i,
      /\bsony a\d\b|\bcanon\b|\bnikon\b|\bfujifilm\b|\bdji mavic\b/i,
    ],
    medium: [/\baction\b|\bdrone\b|\btripod\b/i],
    negative: [/手机壳|显示器|耳机|手表|键盘|风扇/i],
  },
  {
    key: 'gaming',
    label: '游戏/娱乐',
    priority: 2,
    strong: [
      /游戏机|掌机|手柄|摇杆|电竞|主机游戏|显卡坞|街机/i,
      /\bswitch\b|\bsteam deck\b|\bps5\b|\bplaystation\b|\bxbox\b|\barcade\b/i,
      /\bvr\b|\bquest\b/i,
    ],
    medium: [/游戏|玩家|掌上游戏|云游戏/i],
    negative: [/手机|平板|相机|耳机|背包|咖啡机/i],
  },
  {
    key: 'office-peripheral',
    label: '办公/外设',
    priority: 3,
    strong: [
      /键盘|鼠标|显示器|显示屏|路由器|扩展坞|打印机|投影仪|硬盘|固态|外设|办公椅|支架|桌面|NAS|网盘/i,
      /便携式显示器|机械键盘|人体工学椅/i,
      /\bkeyboard\b|\bmouse\b|\bmonitor\b|\bdisplay\b|\brouter\b|\bdock\b|\bnas\b|\bssd\b|\bprojector\b/i,
    ],
    medium: [/\bperipheral\b|\bmechanical\b|\bdesk\b|\bworkspace\b/i],
    negative: [/手机|平板|耳机|相机|风扇|背包|手表/i],
  },
  {
    key: 'home-appliance',
    label: '家居/家电',
    priority: 4,
    strong: [
      /风扇|空调|吸尘器|扫地机|净水器|净饮机|咖啡机|洗碗机|冰箱|烤箱|空气炸锅|加湿器|除湿机|制冰机|面包机|按摩仪|按摩椅|料理机|吹风机|挂烫机|取暖器|家居|家电|机器人/i,
      /\bvacuum\b|\bpurifier\b|\bair fryer\b|\bhumidifier\b|\bdehumidifier\b|\bcoffee machine\b|\brobot\b/i,
      /米家净饮机|米家风扇|米家空调|东菱面包机/i,
    ],
    medium: [/家用|客厅|卧室|厨房|清洁|制冷|加热|取暖/i],
    weak: [/\bdyson\b|\bmijia\b|\bhome\b/i],
    negative: [/背包|车载|手机|平板|手表|耳机|相机/i],
  },
  {
    key: 'travel-auto',
    label: '出行/车品',
    priority: 5,
    strong: [
      /背包|行李箱|车载|车品|汽车|露营|骑行|导航|记录仪|电助力|通勤|座椅|头盔/i,
      /\bbackpack\b|\bluggage\b|\bdash cam\b|\bcamping\b|\bcycling\b|\bcar\b|\bauto\b/i,
      /双肩包|汽车座椅|通勤包/i,
    ],
    medium: [/户外|出行|旅行|车内/i],
    negative: [/相机|耳机|手表|风扇|净水器|键盘|鼠标/i],
  },
  {
    key: 'audio',
    label: '耳机/音频',
    priority: 6,
    strong: [
      /耳机|耳塞|音箱|音响|麦克风|录音|解码耳放|声卡|回音壁|音频/i,
      /\bheadphones?\b|\bearbuds?\b|\bairpods?\b|\bspeaker\b|\bmicrophone\b|\bdac\b|\bsoundbar\b/i,
    ],
    medium: [/降噪|通透|漏音|入耳|半入耳|音质/i],
    negative: [/手机|平板|手表|风扇|背包|相机/i],
  },
  {
    key: 'wearable',
    label: '智能穿戴',
    priority: 7,
    strong: [
      /手表|手环|智能眼镜|戒指|穿戴|眼镜/i,
      /\bwatch\b|\bsmart ?watch\b|\bsmart ring\b|\bband\b|\bvision pro\b|\brokid\b/i,
      /\bglass(es)?\b/i,
    ],
    medium: [/佩戴|腕带|头显/i],
    negative: [/相机|手机|平板|耳机|背包|显示器/i],
  },
  {
    key: 'computer',
    label: '电脑',
    priority: 8,
    strong: [
      /笔记本|电脑|主机|迷你主机|工作站|服务器/i,
      /\blaptop\b|\bnotebook\b|\bmacbook\b|\bthinkpad\b|\bmini pc\b|\bdesktop\b|\bworkstation\b/i,
    ],
    medium: [/处理器|显卡|系统性能|便携本/i],
    negative: [/平板|手机|耳机|手表|风扇|背包/i],
  },
  {
    key: 'phone',
    label: '手机',
    priority: 9,
    strong: [
      /手机|折叠屏|直板机|小屏旗舰|影像旗舰/i,
      /\biphone\b|\bgalaxy\b|\bpixel\b|\bmate\b|\bpura\b|\bfind x\d\b|\breno\b|\bmix flip\b|\bmix fold\b|\brazr\b|\boneplus\b/i,
      /(华为\s*(mate|pura|nova)|荣耀\s*magic|OPPO\s*Find|vivo\s*X\d|红米\s*(K|Note|Turbo)|Redmi\s*(K|Note|Turbo)|小米\s*(\d|mix))/i,
    ],
    medium: [/通信|信号|拍照手机|安卓旗舰|苹果手机/i],
    weak: [/小米|红米|荣耀|华为|OPPO|vivo|三星|苹果/i],
    negative: [/平板|电纸书|耳机|手表|相机|显示器|背包|风扇/i],
  },
]

const DEFAULT_CATEGORY = {
  categoryKey: 'lifestyle-other' as const,
  categoryLabel: '生活/其他',
}

function cleanText(value: string | null | undefined): string {
  return (value || '')
    .replace(/\s+/g, ' ')
    .trim()
}

function buildWeightedTexts(input: ProductCategoryInferenceInput): WeightedText[] {
  return [
    { value: cleanText(input.productNameZh), weight: 1.2 },
    { value: cleanText(input.productName), weight: 1.05 },
    { value: cleanText(input.videoTitleZh), weight: 1 },
    { value: cleanText(input.videoTitle), weight: 0.95 },
  ].filter((item) => item.value.length > 0)
}

function scorePatterns(texts: WeightedText[], patterns: RegExp[] | undefined, base: number): number {
  if (!patterns?.length) return 0

  let total = 0

  for (const { value, weight } of texts) {
    for (const pattern of patterns) {
      if (pattern.test(value)) {
        total += base * weight
      }
    }
  }

  return total
}

function scoreCategory(rule: CategoryRule, texts: WeightedText[]): number {
  let score = 0

  score += scorePatterns(texts, rule.strong, 12)
  score += scorePatterns(texts, rule.medium, 6)
  score += scorePatterns(texts, rule.weak, 2.5)
  score -= scorePatterns(texts, rule.negative, 8)

  return score
}

export function isProductCategoryKey(value: string): value is ProductCategoryKey {
  return PRODUCT_CATEGORY_OPTIONS.some((option) => option.key === value)
}

export function normalizeProductCategoryKey(value: string | null | undefined): ProductCategoryKey {
  if (!value) return 'all'
  return isProductCategoryKey(value) ? value : 'all'
}

export function getProductCategoryLabel(key: ProductCategoryKey): string {
  return PRODUCT_CATEGORY_OPTIONS.find((option) => option.key === key)?.label || DEFAULT_CATEGORY.categoryLabel
}

export function inferProductCategory(input: ProductCategoryInferenceInput): {
  categoryKey: InferredProductCategoryKey
  categoryLabel: string
} {
  const texts = buildWeightedTexts(input)
  if (texts.length === 0) {
    return DEFAULT_CATEGORY
  }

  const ranked = CATEGORY_RULES
    .map((rule) => ({
      key: rule.key,
      label: rule.label,
      priority: rule.priority,
      score: scoreCategory(rule, texts),
    }))
    .sort((left, right) => {
      if (right.score !== left.score) {
        return right.score - left.score
      }

      return left.priority - right.priority
    })

  const best = ranked[0]
  if (!best || best.score <= 0) {
    return DEFAULT_CATEGORY
  }

  return {
    categoryKey: best.key,
    categoryLabel: best.label,
  }
}

export function matchesProductCategory(
  input: ProductCategoryInferenceInput,
  category: ProductCategoryKey,
): boolean {
  if (category === 'all') return true
  return inferProductCategory(input).categoryKey === category
}

export { PRODUCT_CATEGORY_OPTIONS }
