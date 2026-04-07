import http from "k6/http";

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
    lower.includes("127.0.0.1") ||
    lower.includes("localhost");

  if (!isUatLike) {
    throw new Error(
      `BASE_URL='${normalized}' does not look like UAT/staging/local. This load suite is UAT-only.`,
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

export function request(method, path, body, params = {}) {
  const requestParams = {
    redirects: 5,
    timeout: "30s",
    ...params,
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

