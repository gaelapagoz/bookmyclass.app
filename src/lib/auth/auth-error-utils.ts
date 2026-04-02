import { AuthError } from "next-auth";

const INVALID_CREDENTIALS_AUTH_ERROR_TYPE = "CredentialsSignin";

type AuthErrorLike = {
  type?: unknown;
  message?: unknown;
};

export function isInvalidCredentialsAuthError(error: unknown): boolean {
  if (!(error instanceof AuthError)) {
    return false;
  }

  const authError = error as AuthErrorLike;
  return (
    authError.type === INVALID_CREDENTIALS_AUTH_ERROR_TYPE ||
    authError.message === INVALID_CREDENTIALS_AUTH_ERROR_TYPE
  );
}
