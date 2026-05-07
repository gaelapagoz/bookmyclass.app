import http from "k6/http";

const MUTATION_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

function normalizeBaseUrl() {
  const baseUrl = (__ENV.BASE_URL || "").trim();
  if (!baseUrl) {
    throw new Error("Missing required env var BASE_URL.");
  }

  const normalized = baseUrl.replace(/\/+$/, "");
  const lower = normalized.toLowerCase();
  const isUatLike =
    lower.includes("uat") ||
    lower.includes("staging") ||
    lower.includes("demo.bookmyclass.app") ||
    lower.includes("127.0.0.1") ||
    lower.includes("localhost");

  if (!isUatLike) {
    throw new Error(
      `BASE_URL='${normalized}' does not look like UAT/staging/demo/local. This load suite is UAT-only.`,
    );
  }

  return normalized;
}

export function getBaseUrl() {
  return normalizeBaseUrl();
}

export function buildUrl(path) {
  return `${getBaseUrl()}${path.startsWith("/") ? path : `/${path}`}`;
}

export function jsonHeaders(extra = {}) {
  return {
    "content-type": "application/json",
    ...extra,
  };
}

function hasHeader(headers, headerName) {
  const target = headerName.toLowerCase();
  return Object.keys(headers).some((key) => key.toLowerCase() === target);
}

function resolveOriginFromBaseUrl(baseUrl) {
  const match = String(baseUrl).match(/^https?:\/\/[^/]+/i);
  if (!match) {
    throw new Error(`BASE_URL='${baseUrl}' must include protocol and host (for example, https://uat.bookmyclass.app).`);
  }
  return match[0];
}

function ensureSameOriginMutationHeaders(method, headers = {}) {
  const normalizedMethod = String(method || "").trim().toUpperCase();
  if (!MUTATION_METHODS.has(normalizedMethod)) {
    return headers;
  }

  const merged = { ...headers };
  const baseUrl = getBaseUrl();
  const origin = resolveOriginFromBaseUrl(baseUrl);

  if (!hasHeader(merged, "origin")) {
    merged.Origin = origin;
  }

  if (!hasHeader(merged, "referer")) {
    merged.Referer = `${baseUrl}/`;
  }

  return merged;
}

export function request(method, path, body, params = {}) {
  const headers = ensureSameOriginMutationHeaders(method, params.headers || {});
  const requestParams = {
    redirects: 5,
    timeout: "30s",
    ...params,
    headers,
  };
  return http.request(method, buildUrl(path), body, requestParams);
}

export function get(path, params = {}) {
  return request("GET", path, null, params);
}

export function postJson(path, payload, params = {}) {
  return request("POST", path, JSON.stringify(payload), {
    headers: jsonHeaders(params.headers || {}),
    ...params,
  });
}

export function postForm(path, values, params = {}) {
  const encoded = Object.entries(values)
    .filter(([, value]) => value !== undefined && value !== null)
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`)
    .join("&");

  return request("POST", path, encoded, {
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      ...(params.headers || {}),
    },
    ...params,
  });
}
