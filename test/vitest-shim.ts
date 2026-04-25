/**
 * Vitest ESM import shim.
 *
 * In this repo, Vitest is configured with `globals: true`, so the test runtime
 * provides global `describe/it/expect/...`.
 *
 * Some environments have issues importing from the real `vitest` package
 * (e.g. `Cannot read properties of undefined (reading 'config')`).
 *
 * This shim keeps existing tests working without changing every test file.
 */

export const describe = globalThis.describe;
export const it = globalThis.it;
export const test = globalThis.test;
export const expect = globalThis.expect;

export const beforeAll = globalThis.beforeAll;
export const afterAll = globalThis.afterAll;
export const beforeEach = globalThis.beforeEach;
export const afterEach = globalThis.afterEach;

export const vi = globalThis.vi;

