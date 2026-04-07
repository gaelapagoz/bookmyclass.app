import { sleep } from "k6";

export function pace(minSeconds = 0.2, maxSeconds = 1.2) {
  const lower = Number.isFinite(minSeconds) ? minSeconds : 0.2;
  const upper = Number.isFinite(maxSeconds) ? maxSeconds : 1.2;
  const duration = lower + Math.random() * Math.max(0, upper - lower);
  sleep(duration);
}

