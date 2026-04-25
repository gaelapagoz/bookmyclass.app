type GlobalWithSentry = typeof globalThis & {
  __sentryCaptureException?: ((error: unknown) => void) | undefined;
};

export async function withServerActionInstrumentation<T>(
  _name: string,
  _options: { recordResponse?: boolean },
  callback: () => Promise<T>,
): Promise<T> {
  return callback();
}

type Scope = {
  setTag: (key: string, value: string) => void;
  setExtra: (key: string, value: unknown) => void;
  setUser?: (user: unknown) => void;
};

export function withScope(callback: (scope: Scope) => void): void {
  const scope: Scope = {
    setTag: () => undefined,
    setExtra: () => undefined,
    setUser: () => undefined,
  };
  callback(scope);
}

export function captureException(error: unknown): void {
  const globalRef = globalThis as GlobalWithSentry;
  globalRef.__sentryCaptureException?.(error);
}

export function setTag(_key: string, _value: string): void {
  // no-op in tests
}

