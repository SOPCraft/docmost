import { BadRequestException } from '@nestjs/common';
import { UUID_PATTERN } from './version-delivery.types';
import { isISO8601 } from 'class-validator';
export interface HistoryFilters {
  from?: string;
  until?: string;
  actorId?: string;
  summaries?: boolean;
}
export function validateHistoryFilters(
  filters: HistoryFilters = {},
  before?: number,
): HistoryFilters {
  if (before !== undefined && (!Number.isSafeInteger(before) || before < 1))
    throw new BadRequestException('Invalid history cursor');
  if (filters.actorId !== undefined && !UUID_PATTERN.test(filters.actorId))
    throw new BadRequestException('Invalid history contributor');
  for (const key of ['from', 'until'] as const) {
    const value = filters[key];
    if (
      value !== undefined &&
      (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?(Z|[+-]\d{2}:\d{2})$/.test(
        value,
      ) ||
        !isISO8601(value, { strict: true, strictSeparator: true }) ||
        !Number.isFinite(Date.parse(value)))
    ) {
      throw new BadRequestException('History dates require a time zone');
    }
  }
  if (
    filters.from &&
    filters.until &&
    Date.parse(filters.from) >= Date.parse(filters.until)
  )
    throw new BadRequestException('Invalid history date range');
  if (filters.summaries !== undefined && typeof filters.summaries !== 'boolean')
    throw new BadRequestException('Invalid summary option');
  return filters;
}
