export function sleep(delayMs: number) {
  return new Promise((resolve) => setTimeout(resolve, delayMs));
}

export function getRemainingDelayMs(targetAtMs: number, nowMs = Date.now()) {
  return Math.max(0, targetAtMs - nowMs);
}

export function extendCooldownTarget(currentTargetAtMs: number, delayMs: number, nowMs = Date.now()) {
  return Math.max(currentTargetAtMs, nowMs + delayMs);
}

export function toIsoTimestamp(nowMs = Date.now()) {
  return new Date(nowMs).toISOString();
}
