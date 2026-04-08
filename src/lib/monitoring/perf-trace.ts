import { randomUUID } from "node:crypto";

type PerfTraceContext = Record<string, unknown>;

type SlowestDbQuery = {
  durationMs: number;
  label: string;
};

function resolveSlowThresholdMs(): number | null {
  const raw = process.env.PERF_TRACE_SLOW_MS;
  if (!raw) {
    return null;
  }

  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return null;
  }

  return parsed;
}

function shouldLogTrace(totalDurationMs: number): boolean {
  if (process.env.PERF_TRACE_ENABLED === "1") {
    return true;
  }

  const thresholdMs = resolveSlowThresholdMs();
  return thresholdMs !== null && totalDurationMs >= thresholdMs;
}

export type PerfTrace = {
  correlationId: string;
  db<T>(label: string, operation: () => Promise<T>): Promise<T>;
  log(extra?: PerfTraceContext): void;
};

export function createPerfTrace(operation: string, context?: PerfTraceContext): PerfTrace {
  const correlationId = randomUUID();
  const startedAt = Date.now();
  let dbQueryCount = 0;
  let dbTotalMs = 0;
  let slowestDbQuery: SlowestDbQuery | null = null;
  let finished = false;

  async function db<T>(label: string, operationFn: () => Promise<T>): Promise<T> {
    const dbStartedAt = Date.now();
    try {
      return await operationFn();
    } finally {
      const durationMs = Date.now() - dbStartedAt;
      dbQueryCount += 1;
      dbTotalMs += durationMs;

      if (!slowestDbQuery || durationMs > slowestDbQuery.durationMs) {
        slowestDbQuery = { label, durationMs };
      }
    }
  }

  function log(extra?: PerfTraceContext): void {
    if (finished) {
      return;
    }
    finished = true;

    const totalDurationMs = Date.now() - startedAt;
    if (!shouldLogTrace(totalDurationMs)) {
      return;
    }

    const nonDbMs = Math.max(0, totalDurationMs - dbTotalMs);
    console.info("[perf-trace]", {
      operation,
      correlationId,
      totalDurationMs,
      dbQueryCount,
      dbTotalMs,
      nonDbMs,
      slowestDbQuery,
      ...context,
      ...extra,
    });
  }

  return {
    correlationId,
    db,
    log,
  };
}
