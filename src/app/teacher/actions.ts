"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";

import { requireTeacherSession } from "@/lib/auth/require-auth";
import { assertSameOriginServerAction } from "@/lib/security/same-origin";
import { normalizeTeacherTagList, assertTeacherSelfScope } from "@/lib/teacher/teacher-helpers";
import {
  addTeacherSessionAttendee,
  removeTeacherSessionAttendee,
  updateTeacherSelfProfile,
} from "@/lib/teacher/teacher-service";
import {
  changeAuthenticatedUserPassword,
  type PasswordServiceError,
} from "@/lib/auth/password-service";

const profileSchema = z.object({
  firstName: z.string().trim().min(1),
  lastName: z.string().trim().min(1),
  phone: z.string().optional(),
  bio: z.string().optional(),
  specialtiesRaw: z.string().optional(),
  certificationsRaw: z.string().optional(),
});

const passwordSchema = z.object({
  currentPassword: z.string(),
  newPassword: z.string(),
  confirmPassword: z.string(),
});

const attendeeAddSchema = z.object({
  clientId: z.string().trim().min(1),
  note: z.string().trim().max(400).optional(),
});

const attendeeRemoveSchema = z.object({
  bookingId: z.string().trim().min(1),
  note: z.string().trim().max(400).optional(),
});

const attendanceUpdateSchema = z.object({
  bookingId: z.string().trim().min(1),
  targetStatus: z.enum(["CHECKED_IN", "ATTENDED", "NO_SHOW", "CLEAR"]),
  note: z.string().trim().max(400).optional(),
});

function redirectWithError(path: string, message: string): never {
  const separator = path.includes("?") ? "&" : "?";
  redirect(`${path}${separator}error=${encodeURIComponent(message)}`);
}

function resolvePasswordErrorCode(error: unknown): string | null {
  if (error instanceof Error && "code" in error) {
    return (error as PasswordServiceError).code as string;
  }
  return null;
}

function mapPasswordActionError(error: unknown): string | null {
  const errorCode = resolvePasswordErrorCode(error);
  if (errorCode === "INVALID_CURRENT_PASSWORD") {
    return "invalid_current";
  }
  if (errorCode === "INVALID_PASSWORD") {
    return "invalid_password";
  }
  if (errorCode === "PASSWORD_MISMATCH") {
    return "password_mismatch";
  }
  if (errorCode === "PASSWORD_NOT_SET") {
    return "password_not_set";
  }
  return null;
}

function mapTeacherActionError(error: unknown): string {
  const code = error instanceof Error ? error.message : "";
  if (code === "INVALID_TEACHER_PROFILE_INPUT") {
    return "First and last name are required.";
  }
  if (code === "TEACHER_NOT_FOUND") {
    return "Teacher profile not found.";
  }
  if (code === "TEACHER_SESSION_FORBIDDEN") {
    return "You can manage rosters only for your own sessions.";
  }
  if (code === "SESSION_NOT_FOUND") {
    return "Session not found.";
  }
  if (code === "SESSION_NOT_BOOKABLE") {
    return "This session is no longer bookable.";
  }
  if (code === "SESSION_FULL") {
    return "This session is already full.";
  }
  if (code === "SESSION_ELIGIBILITY_REQUIRED") {
    return "You can only add clients with eligible credit or qualifying subscription.";
  }
  if (code === "SESSION_ATTENDEE_NOT_FOUND") {
    return "Attendee booking not found for this session.";
  }
  if (code === "BOOKING_NOT_CONFIRMED") {
    return "Attendance can be managed only for confirmed bookings.";
  }
  if (code === "ATTENDANCE_NOT_FOUND") {
    return "No check-in record exists to clear.";
  }
  if (code === "ATTENDANCE_ALREADY_FINALIZED") {
    return "Attendance is finalized and cannot be changed from this state.";
  }
  if (code === "CLIENT_NOT_FOUND") {
    return "Selected client was not found.";
  }
  if (code === "SESSION_MANAGER_FORBIDDEN" || code === "TEACHER_SELF_SCOPE_FORBIDDEN") {
    return "You are not allowed to perform this action.";
  }

  return "Unexpected server error.";
}

export async function updateTeacherProfileAction(formData: FormData) {
  await assertSameOriginServerAction();
  const session = await requireTeacherSession({ throwOnFailure: true });
  const returnTo = "/teacher/profile";

  const parsed = profileSchema.safeParse({
    firstName: formData.get("firstName"),
    lastName: formData.get("lastName"),
    phone: String(formData.get("phone") ?? "").trim() || undefined,
    bio: String(formData.get("bio") ?? "").trim() || undefined,
    specialtiesRaw: String(formData.get("specialties") ?? ""),
    certificationsRaw: String(formData.get("certifications") ?? ""),
  });
  if (!parsed.success) {
    redirectWithError(returnTo, "Please complete the required profile fields.");
  }

  try {
    await updateTeacherSelfProfile({
      teacherUserId: session.user.id,
      requestedTeacherUserId: session.user.id,
      firstName: parsed.data.firstName,
      lastName: parsed.data.lastName,
      phone: parsed.data.phone,
      bio: parsed.data.bio,
      specialties: normalizeTeacherTagList(parsed.data.specialtiesRaw ?? ""),
      certifications: normalizeTeacherTagList(parsed.data.certificationsRaw ?? ""),
    });
  } catch (error) {
    redirectWithError(returnTo, mapTeacherActionError(error));
  }

  revalidatePath(returnTo);
  redirect(`${returnTo}?success=${encodeURIComponent("Profile updated.")}`);
}

export async function addTeacherSessionAttendeeAction(sessionId: string, formData: FormData) {
  await assertSameOriginServerAction();
  const session = await requireTeacherSession({ throwOnFailure: true });
  const returnTo = `/teacher/sessions/${sessionId}`;

  const parsed = attendeeAddSchema.safeParse({
    clientId: formData.get("clientId"),
    note: String(formData.get("note") ?? "").trim() || undefined,
  });
  if (!parsed.success) {
    redirectWithError(returnTo, "Please choose a client to add.");
  }

  try {
    await addTeacherSessionAttendee({
      teacherUserId: session.user.id,
      studioSessionId: sessionId,
      clientId: parsed.data.clientId,
      note: parsed.data.note,
    });
  } catch (error) {
    redirectWithError(returnTo, mapTeacherActionError(error));
  }

  revalidatePath(returnTo);
  redirect(`${returnTo}?success=${encodeURIComponent("Attendee added.")}`);
}

export async function removeTeacherSessionAttendeeAction(sessionId: string, formData: FormData) {
  await assertSameOriginServerAction();
  const session = await requireTeacherSession({ throwOnFailure: true });
  const returnTo = `/teacher/sessions/${sessionId}`;

  const parsed = attendeeRemoveSchema.safeParse({
    bookingId: formData.get("bookingId"),
    note: String(formData.get("note") ?? "").trim() || undefined,
  });
  if (!parsed.success) {
    redirectWithError(returnTo, "Please choose an attendee to remove.");
  }

  try {
    await removeTeacherSessionAttendee({
      teacherUserId: session.user.id,
      studioSessionId: sessionId,
      bookingId: parsed.data.bookingId,
      note: parsed.data.note,
    });
  } catch (error) {
    redirectWithError(returnTo, mapTeacherActionError(error));
  }

  revalidatePath(returnTo);
  redirect(`${returnTo}?success=${encodeURIComponent("Attendee removed.")}`);
}

export async function updateTeacherSessionAttendanceAction(sessionId: string, formData: FormData) {
  await assertSameOriginServerAction();
  const session = await requireTeacherSession({ throwOnFailure: true });
  const returnTo = `/teacher/sessions/${sessionId}`;

  const parsed = attendanceUpdateSchema.safeParse({
    bookingId: formData.get("bookingId"),
    targetStatus: formData.get("targetStatus"),
    note: String(formData.get("note") ?? "").trim() || undefined,
  });

  if (!parsed.success) {
    redirectWithError(returnTo, "Please submit a valid attendance update.");
  }

  try {
    const { markBookingAttendanceByStaff } = await import("@/lib/attendance/attendance-service");
    await markBookingAttendanceByStaff({
      bookingId: parsed.data.bookingId,
      studioSessionId: sessionId,
      actorUserId: session.user.id,
      targetStatus: parsed.data.targetStatus,
      notes: parsed.data.note,
    });
  } catch (error) {
    redirectWithError(returnTo, mapTeacherActionError(error));
  }

  revalidatePath(returnTo);
  redirect(`${returnTo}?success=${encodeURIComponent("Attendance updated.")}`);
}

export async function changeTeacherPasswordAction(formData: FormData) {
  await assertSameOriginServerAction();
  const session = await requireTeacherSession({ throwOnFailure: true });
  const returnTo = "/teacher/profile";

  const currentPassword = String(formData.get("currentPassword") ?? "");
  const newPassword = String(formData.get("newPassword") ?? "");
  const confirmPassword = String(formData.get("confirmPassword") ?? "");

  const parsed = passwordSchema.safeParse({
    currentPassword,
    newPassword,
    confirmPassword,
  });
  if (!parsed.success) {
    redirectWithError(returnTo, "Please complete all password fields.");
  }

  // Scope check: teacher can only change their own password
  assertTeacherSelfScope({
    teacherUserId: session.user.id,
    requestedTeacherUserId: session.user.id,
  });

  try {
    await changeAuthenticatedUserPassword({
      userId: session.user.id,
      currentPassword: parsed.data.currentPassword,
      newPassword: parsed.data.newPassword,
      confirmNewPassword: parsed.data.confirmPassword,
    });
  } catch (error) {
    const mappedError = mapPasswordActionError(error);
    if (mappedError) {
      redirectWithError(returnTo, `Password error: ${mappedError}`);
    }
    redirectWithError(returnTo, "Could not update password right now.");
  }

  revalidatePath(returnTo);
  redirect(`${returnTo}?password_success=${encodeURIComponent("Password updated successfully.")}`);
}
