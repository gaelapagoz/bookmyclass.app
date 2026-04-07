import { pickUser, loginWithCredentials } from "../lib/auth.js";
import { users } from "../lib/data.js";
import { pace } from "../lib/pacing.js";

export function loginScenario() {
  const user = pickUser(users);
  loginWithCredentials(user, { scenario_flow: "login" });
  pace(0.1, 0.8);
}

