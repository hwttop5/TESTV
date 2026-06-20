import type { MetadataRoute } from 'next'
import { buildRobotsMetadata } from '@/lib/seo'

export default function robots(): MetadataRoute.Robots {
  return buildRobotsMetadata()
}
