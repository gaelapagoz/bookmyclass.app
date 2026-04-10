import { describe, expect, it, vi } from "vitest";
import { runAsyncWithCursor, setGlobalLoadingCursor } from "@/lib/ui/async-loading";

describe("async-loading helper", () => {
  beforeEach(() => {
    global.document = {
      body: {
        style: {
          cursor: "",
        },
      },
    } as unknown as Document;
  });

  it("sets and resets the body cursor while running async work", async () => {
    const work = vi.fn(async () => {
      expect(document.body.style.cursor).toBe("wait");
      return "done";
    });

    const result = await runAsyncWithCursor(async () => work());

    expect(result).toBe("done");
    expect(work).toHaveBeenCalledOnce();
    expect(document.body.style.cursor).toBe("");
  });

  it("resets the body cursor when the work throws", async () => {
    await expect(
      runAsyncWithCursor(async () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");

    expect(document.body.style.cursor).toBe("");
  });

  it("no-ops setGlobalLoadingCursor when document is unavailable", () => {
    const originalDocument = global.document;
    // @ts-expect-error simulate undefined document
    global.document = undefined;

    expect(() => setGlobalLoadingCursor(true)).not.toThrow();
    expect(() => setGlobalLoadingCursor(false)).not.toThrow();

    global.document = originalDocument;
  });
});
