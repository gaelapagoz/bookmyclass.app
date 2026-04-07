import { check } from "k6";
import { get, postForm } from "./http.js";

function failMissingUsers() {
  throw new Error(
    "No users loaded from k6/data/users.csv. Add seeded client credentials (email,password,name,phone).",
  );
}

export function pickUser(users) {
  if (!users || users.length === 0) {
    failMissingUsers();
  }
  const index = (__VU + __ITER) % users.length;
  return users[index];
}

export function loginWithCredentials(user, tags = {}) {
  if (!user?.email || !user?.password) {
    throw new Error("Each CSV user row must include email and password.");
  }

  const csrfRes = get("/api/auth/csrf", {
    tags: { flow: "auth", endpoint: "auth_csrf", ...tags },
  });
  check(csrfRes, {
    "auth csrf status 200": (res) => res.status === 200,
  });

  const csrfBody = csrfRes.json();
  const csrfToken = csrfBody && csrfBody.csrfToken ? String(csrfBody.csrfToken) : "";
  if (!csrfToken) {
    throw new Error("Could not resolve csrfToken from /api/auth/csrf.");
  }

  const callbackRes = postForm(
    "/api/auth/callback/credentials",
    {
      csrfToken,
      email: user.email,
      password: user.password,
      callbackUrl: "/dashboard",
      redirect: "false",
      json: "true",
    },
    {
      tags: { flow: "auth", endpoint: "auth_callback_credentials", ...tags },
      redirects: 0,
    },
  );

  check(callbackRes, {
    "auth callback status": (res) => res.status === 200 || res.status === 302,
  });

  const sessionRes = get("/api/auth/session", {
    tags: { flow: "auth", endpoint: "auth_session", ...tags },
  });

  check(sessionRes, {
    "auth session 200": (res) => res.status === 200,
  });

  const sessionBody = sessionRes.json();
  const userId = sessionBody && sessionBody.user && sessionBody.user.id ? String(sessionBody.user.id) : "";

  check(sessionRes, {
    "auth session contains user id": () => Boolean(userId),
  });

  if (!userId) {
    throw new Error(`Authentication failed for ${user.email}.`);
  }

  return {
    userId,
    email: user.email,
  };
}

