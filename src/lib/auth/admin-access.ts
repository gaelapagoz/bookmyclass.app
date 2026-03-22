import type { Role } from "@prisma/client";

export function isAdminRole(role: Role | undefined): boolean {
  return role === "ADMIN" || role === "MASTER_ADMIN";
}
