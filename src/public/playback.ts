export function playbackRate(value: unknown, recording: boolean): number {
  if (recording) return 1;
  const requested = Number(value);
  return requested === 1.5 || requested === 2 ? requested : 1;
}

export function playbackElapsed(
  startOffset: number,
  wallElapsed: number,
  rate: number,
  duration: number
): number {
  const safeDuration = Math.max(0, Number.isFinite(duration) ? duration : 0);
  const safeStart = Math.max(0, Number.isFinite(startOffset) ? startOffset : 0);
  const safeWallElapsed = Math.max(0, Number.isFinite(wallElapsed) ? wallElapsed : 0);
  const safeRate = rate === 1.5 || rate === 2 ? rate : 1;
  return Math.min(safeDuration, safeStart + safeWallElapsed * safeRate);
}
