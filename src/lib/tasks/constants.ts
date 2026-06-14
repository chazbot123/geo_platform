export const MIN_PUBLISH_DAYS = 1;
export const DEFAULT_ARTICLES_PER_ACCOUNT_PER_DAY = 2;
export const ARTICLES_PER_ACCOUNT_PER_DAY = DEFAULT_ARTICLES_PER_ACCOUNT_PER_DAY;
export const DEFAULT_TIME_WINDOW = { start: "09:00", end: "18:00" } as const;
export const MIN_SAME_ACCOUNT_INTERVAL_HOURS = 3;
export const DEFAULT_EXPECTED_IMAGE_COUNT = 5;
export const MAX_EXPECTED_IMAGE_COUNT = 10;

export function normalizeExpectedImageCount(value?: number) {
  const parsed = Math.floor(Number(value));
  if (!Number.isFinite(parsed) || parsed < 1) {
    return DEFAULT_EXPECTED_IMAGE_COUNT;
  }
  return Math.min(MAX_EXPECTED_IMAGE_COUNT, parsed);
}
