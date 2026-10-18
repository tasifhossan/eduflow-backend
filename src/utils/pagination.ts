export interface PaginationOptions {
  defaultLimit?: number;
  maxLimit?: number;
}

export interface PaginationResult {
  page: number;
  limit: number;
  skip: number;
  take: number;
}

export interface PaginationMeta {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

/**
 * Parses page and limit parameters from request query.
 * Enforces minimum page = 1 and clamps limit between 1 and maxLimit.
 */
export function parsePagination(
  query: Record<string, any> = {},
  options: PaginationOptions = {}
): PaginationResult {
  const defaultLimit = options.defaultLimit ?? 12;
  const maxLimit = options.maxLimit ?? 50;

  let page = parseInt(String(query.page), 10);
  if (isNaN(page) || page < 1) {
    page = 1;
  }

  let limit = parseInt(String(query.limit), 10);
  if (isNaN(limit) || limit < 1) {
    limit = defaultLimit;
  } else if (limit > maxLimit) {
    limit = maxLimit;
  }

  const skip = (page - 1) * limit;
  const take = limit;

  return { page, limit, skip, take };
}

/**
 * Builds standard pagination metadata object.
 */
export function buildMeta(total: number, page: number, limit: number): PaginationMeta {
  const safeTotal = Math.max(0, total);
  const safeLimit = Math.max(1, limit);
  const totalPages = Math.ceil(safeTotal / safeLimit) || 1;

  return {
    page,
    limit: safeLimit,
    total: safeTotal,
    totalPages,
  };
}
