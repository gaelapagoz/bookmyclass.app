const SENSITIVE_HEADER_KEYS = new Set(["authorization", "cookie", "set-cookie", "x-api-key"]);
const SENSITIVE_FIELD_KEYS = new Set(["password", "token", "access_token", "refresh_token", "secret"]);

function removeSensitiveFields(record: Record<string, unknown> | undefined) {
  if (!record) {
    return;
  }

  for (const key of Object.keys(record)) {
    if (SENSITIVE_FIELD_KEYS.has(key.toLowerCase())) {
      delete record[key];
    }
  }
}

export function sanitizeSentryEvent<T>(event: T): T {
  const mutableEvent = event as {
    request?: {
      headers?: Record<string, unknown>;
      data?: unknown;
    };
    user?: Record<string, unknown>;
    extra?: Record<string, unknown>;
    contexts?: Record<string, unknown>;
  };

  const headers = mutableEvent.request?.headers;
  if (headers) {
    for (const key of Object.keys(headers)) {
      if (SENSITIVE_HEADER_KEYS.has(key.toLowerCase())) {
        delete headers[key];
      }
    }
  }

  if (mutableEvent.request && "data" in mutableEvent.request) {
    delete mutableEvent.request.data;
  }

  removeSensitiveFields(mutableEvent.user);
  removeSensitiveFields(mutableEvent.extra);
  removeSensitiveFields(mutableEvent.contexts);

  return event;
}
