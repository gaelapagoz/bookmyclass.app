import type { Role } from "@prisma/client";

export function isAdminRole(role: Role | undefined): role is "ADMIN" | "MASTER_ADMIN" {
  return role === "ADMIN" || role === "MASTER_ADMIN";
}
