import { describe, expect, it } from "vitest";

import {
  getMaxProductImageBytes,
  getProductImageUploadLimitLabel,
  getRecommendedProductImageServerActionBodySizeLimit,
} from "../../src/lib/media/product-image-config";

describe("product image config", () => {
  it("uses the default 5 MB product image limit", () => {
    expect(getMaxProductImageBytes({} as NodeJS.ProcessEnv)).toBe(5 * 1024 * 1024);
    expect(getProductImageUploadLimitLabel({} as NodeJS.ProcessEnv)).toBe("5 MB");
    expect(getRecommendedProductImageServerActionBodySizeLimit({} as NodeJS.ProcessEnv)).toBe("8mb");
  });

  it("prefers PRODUCT_IMAGE_MAX_BYTES over IMAGE_UPLOAD_MAX_BYTES", () => {
    const env = {
      PRODUCT_IMAGE_MAX_BYTES: String(7 * 1024 * 1024),
      IMAGE_UPLOAD_MAX_BYTES: String(9 * 1024 * 1024),
    } as NodeJS.ProcessEnv;

    expect(getMaxProductImageBytes(env)).toBe(7 * 1024 * 1024);
    expect(getProductImageUploadLimitLabel(env)).toBe("7 MB");
    expect(getRecommendedProductImageServerActionBodySizeLimit(env)).toBe("9mb");
  });
});
