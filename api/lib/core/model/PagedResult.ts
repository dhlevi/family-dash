/**
 * Standard envelope for list endpoints that can grow unbounded
 * (news articles, photos, drawings).
 */
export interface PagedResult<T> {
  items: T[]
  total: number
  page: number
  pageSize: number
  pages: number
}

export const DEFAULT_PAGE_SIZE = 50
export const MAX_PAGE_SIZE = 500

/**
 * Clamp caller-supplied paging values into something safe to hand to SQL.
 * A wall display asking for 100k photos would otherwise happily try.
 */
export function normalizePaging(page?: number, pageSize?: number): { page: number; pageSize: number; offset: number } {
  const safePage = Number.isFinite(page) && (page as number) > 0 ? Math.floor(page as number) : 1
  const requested =
    Number.isFinite(pageSize) && (pageSize as number) > 0 ? Math.floor(pageSize as number) : DEFAULT_PAGE_SIZE
  const safePageSize = Math.min(requested, MAX_PAGE_SIZE)

  return { page: safePage, pageSize: safePageSize, offset: (safePage - 1) * safePageSize }
}

export function toPagedResult<T>(items: T[], total: number, page: number, pageSize: number): PagedResult<T> {
  return {
    items,
    total,
    page,
    pageSize,
    pages: pageSize > 0 ? Math.ceil(total / pageSize) : 0
  }
}
