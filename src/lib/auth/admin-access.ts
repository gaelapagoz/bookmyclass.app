import type { Role } from "@prisma/client";

export function isAdminRole(role: Role | undefined): role is "ADMIN" | "MASTER_ADMIN" {
  return role === "ADMIN" || role === "MASTER_ADMIN";
}

export function isStaffRole(role: Role | undefined): role is "MASTER_ADMIN" | "ADMIN" | "TEACHER" {
  return role === "MASTER_ADMIN" || role === "ADMIN" || role === "TEACHER";
}

export function resolveStaffWorkspacePath(role: Role | undefined): "/admin/dashboard" | "/teacher" | null {
  if (isAdminRole(role)) {
    return "/admin/dashboard";
  }
  if (role === "TEACHER") {
    return "/teacher";
  }
  return null;
}
