import type { Role } from "@prisma/client";

export function isTeacherRole(role: Role | undefined): role is "TEACHER" {
  return role === "TEACHER";
}

export function assertTeacherSelfScope(input: {
  teacherUserId: string;
  requestedTeacherUserId: string;
}) {
  if (input.teacherUserId !== input.requestedTeacherUserId) {
    throw new Error("TEACHER_SELF_SCOPE_FORBIDDEN");
  }
}

export function assertTeacherSessionScope(input: {
  teacherUserId: string;
  sessionTeacherId: string;
}) {
  if (input.teacherUserId !== input.sessionTeacherId) {
    throw new Error("TEACHER_SESSION_FORBIDDEN");
  }
}

export function canTeacherManageSession(input: {
  teacherUserId: string;
  sessionTeacherId: string;
}): boolean {
  return input.teacherUserId === input.sessionTeacherId;
}

export function normalizeTeacherTagList(raw: string): string[] {
  const parts = raw
    .split(/\r?\n|,/)
    .map((value) => value.trim())
    .filter(Boolean);

  return [...new Set(parts)];
}
