export function setGlobalLoadingCursor(enabled: boolean) {
  if (typeof document === "undefined" || !document.body?.style) {
    return;
  }

  document.body.style.cursor = enabled ? "wait" : "";
}

export async function runAsyncWithCursor<T>(work: () => Promise<T>): Promise<T> {
  setGlobalLoadingCursor(true);

  try {
    return await work();
  } finally {
    setGlobalLoadingCursor(false);
  }
}
