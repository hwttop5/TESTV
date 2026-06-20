/**
 * Pagination constants shared by server components and client components.
 *
 * Kept dependency-free on purpose: this module must be safe to import from
 * `'use client'` components. Importing these values from `product-catalog.ts`
 * would drag server-only dependencies (Prisma, node:fs) into the client bundle.
 */

/** Allowed "items per page" values surfaced in the footer control. */
export const PAGE_SIZE_OPTIONS = [12, 24, 48, 96] as const

export const DEFAULT_PAGE_SIZE = 12

/** Clamp an arbitrary input to one of the supported page sizes. */
export function normalizePageSize(value: number | string | undefined | null): number {
  const parsed = typeof value === 'number' ? value : Number.parseInt(value || '', 10)
  return (PAGE_SIZE_OPTIONS as readonly number[]).includes(parsed) ? parsed : DEFAULT_PAGE_SIZE
}
