export type SortMode = 'score' | 'date'

export const DEFAULT_SORT_MODE: SortMode = 'date'

export function normalizeSortMode(value: string | null | undefined): SortMode {
  return value === 'score' ? 'score' : DEFAULT_SORT_MODE
}
