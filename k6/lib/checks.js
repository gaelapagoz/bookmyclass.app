import { check } from "k6";

function issue(message) {
  throw new Error(message);
}

export function assertStatus(response, expected, label) {
  const allowed = Array.isArray(expected) ? expected : [expected];
  const ok = check(response, {
    [label || `status in [${allowed.join(", ")}]`]: (res) => allowed.includes(res.status),
  });
  if (!ok) {
    issue(
      `${label || "Unexpected response status"}: got=${response.status} expected=${allowed.join(", ")} body=${String(response.body).slice(0, 300)}`,
    );
  }
}

export function assertJsonPath(response, label, resolver) {
  const ok = check(response, {
    [label]: (res) => {
      try {
        return Boolean(resolver(res.json()));
      } catch (_error) {
        return false;
      }
    },
  });
  if (!ok) {
    issue(`${label} failed. body=${String(response.body).slice(0, 300)}`);
  }
}

