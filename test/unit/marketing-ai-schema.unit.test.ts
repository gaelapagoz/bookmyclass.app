import { describe, expect, it } from "vitest";

import { buildMarketingDraftJsonSchema } from "../../src/lib/marketing/marketing-ai";

type JsonSchemaNode = {
  type?: string;
  properties?: Record<string, JsonSchemaNode>;
  items?: JsonSchemaNode;
  oneOf?: JsonSchemaNode[];
  required?: string[];
  additionalProperties?: boolean;
  const?: string;
};

function collectObjectSchemaViolations(node: JsonSchemaNode, path: string, violations: string[]) {
  if (node.type === "object") {
    if (node.additionalProperties !== false) {
      violations.push(`${path}: additionalProperties must be false`);
    }
    if (!node.properties || typeof node.properties !== "object") {
      violations.push(`${path}: properties object is required`);
    }
  }

  if (node.properties) {
    for (const [key, child] of Object.entries(node.properties)) {
      collectObjectSchemaViolations(child, `${path}.properties.${key}`, violations);
    }
  }

  if (node.items) {
    collectObjectSchemaViolations(node.items, `${path}.items`, violations);
  }

  if (node.oneOf) {
    node.oneOf.forEach((child, index) => {
      collectObjectSchemaViolations(child, `${path}.oneOf[${index}]`, violations);
    });
  }
}

describe("marketing ai json schema", () => {
  it("uses strict object nodes required by OpenAI json_schema format", () => {
    const schema = buildMarketingDraftJsonSchema() as JsonSchemaNode;
    const violations: string[] = [];

    collectObjectSchemaViolations(schema, "schema", violations);

    expect(violations).toEqual([]);
  });

  it("defines blocks items as strict object variants", () => {
    const schema = buildMarketingDraftJsonSchema() as JsonSchemaNode;
    const blockItems = schema.properties?.contentJson?.properties?.blocks?.items;

    expect(blockItems?.oneOf).toBeDefined();
    expect(blockItems?.oneOf?.length).toBe(6);

    const typeConsts = blockItems?.oneOf?.map((variant) => variant.properties?.type?.const) ?? [];
    expect(typeConsts).toEqual(["heading", "paragraph", "button", "image", "divider", "spacer"]);
  });
});