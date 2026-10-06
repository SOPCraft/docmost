export const ASIDE_DEFAULT_WIDTH = 420;
export const ASIDE_MIN_WIDTH = 320;
export const ASIDE_MAX_WIDTH = 720;
export const ASIDE_WIDTH_KEY = 'sop.native-aside-width';

export function asideBounds(viewport: number, navigation: number) {
  const available = Math.max(ASIDE_MIN_WIDTH, viewport - Math.max(0, navigation) - 360);
  return { min: ASIDE_MIN_WIDTH, max: Math.min(ASIDE_MAX_WIDTH, available) };
}
export function clampAsideWidth(value: unknown, viewport: number, navigation: number) {
  const candidate = Number(value);
  const width = value !== null && value !== '' && Number.isFinite(candidate) ? candidate : ASIDE_DEFAULT_WIDTH;
  const { min, max } = asideBounds(viewport, navigation);
  return Math.round(Math.min(max, Math.max(min, width)));
}
export function widthAfterKey(key: string, width: number, viewport: number, navigation: number, fast = false) {
  const { min, max } = asideBounds(viewport, navigation);
  const step = fast ? 48 : 16;
  if (key === 'Home') return min;
  if (key === 'End') return max;
  if (key === 'ArrowLeft') return clampAsideWidth(width + step, viewport, navigation);
  if (key === 'ArrowRight') return clampAsideWidth(width - step, viewport, navigation);
  return null;
}
