import { describe, expect, it } from 'vitest'
import { inferProductCategory, matchesProductCategory, normalizeProductCategoryKey } from '../lib/product-category'

describe('product category inference', () => {
  it('infers phone products', () => {
    expect(inferProductCategory({
      productNameZh: 'iPhone 16',
      productName: 'iPhone 16',
      videoTitleZh: 'iPhone 16 值不值得买',
      videoTitle: '请把iPhone16 Pro卖给真正需要的人【值不值得买第671期】',
    })).toMatchObject({
      categoryKey: 'phone',
      categoryLabel: '手机',
    })
  })

  it('lets tablet signals beat generic phone brand signals', () => {
    expect(inferProductCategory({
      productNameZh: '小米平板7 Ultra',
      productName: 'Xiaomi Pad 7 Ultra',
      videoTitleZh: '做好这些，iPad就悬了！小米平板7 Ultra',
      videoTitle: '做好这些，iPad就悬了！小米平板7 Ultra【值不值得买第698期】',
    }).categoryKey).toBe('tablet-ereader')
  })

  it('lets home appliance and office devices beat brand-only matches', () => {
    expect(inferProductCategory({
      productNameZh: '米家净饮机',
      productName: 'Mijia Water Purifier',
      videoTitleZh: '净饮机体验',
      videoTitle: '米家净饮机体验',
    }).categoryKey).toBe('home-appliance')

    expect(inferProductCategory({
      productNameZh: '便携式显示器',
      productName: 'Portable Monitor',
      videoTitleZh: '便携式显示器测评',
      videoTitle: '便携式显示器测评',
    }).categoryKey).toBe('office-peripheral')
  })

  it('infers camera, gaming, travel and fallback categories', () => {
    expect(inferProductCategory({
      productNameZh: 'DJI Mavic 4 Pro',
      productName: 'DJI Mavic 4 Pro',
      videoTitleZh: '无人机天花板！大疆Mavic 4 Pro',
      videoTitle: '无人机天花板！大疆Mavic 4 Pro【值不值得买第700期】',
    }).categoryKey).toBe('camera')

    expect(inferProductCategory({
      productNameZh: 'Switch 2',
      productName: 'Nintendo Switch 2',
      videoTitleZh: 'Switch 2 体验',
      videoTitle: 'Switch 2 体验',
    }).categoryKey).toBe('gaming')

    expect(inferProductCategory({
      productNameZh: '通勤背包',
      productName: 'Backpack',
      videoTitleZh: '背包体验',
      videoTitle: '夏天背个包不热吗？我还冷！【值不值得买第694期】',
    }).categoryKey).toBe('travel-auto')

    expect(inferProductCategory({
      productNameZh: '赛博吉他',
      productName: 'Cyber Guitar',
      videoTitleZh: '乐器体验',
      videoTitle: '乐器体验',
    }).categoryKey).toBe('lifestyle-other')
  })

  it('normalizes category keys and matches filters', () => {
    expect(normalizeProductCategoryKey('audio')).toBe('audio')
    expect(normalizeProductCategoryKey('unknown')).toBe('all')
    expect(matchesProductCategory({
      productNameZh: '无线耳机',
      productName: 'Wireless Earbuds',
      videoTitleZh: '耳机测评',
      videoTitle: '耳机测评',
    }, 'audio')).toBe(true)
  })
})
