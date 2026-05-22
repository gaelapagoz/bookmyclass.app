import { RuntimeEnvError, validateRuntimeEnvForServer } from "@/lib/config/runtime-env-server";

export { RuntimeEnvError };

export function validateRuntimeEnv(): void {
  validateRuntimeEnvForServer();
}

