type TeacherNameInput = {
  firstName: string | null;
  lastName: string | null;
  name: string;
};

function normalize(value: string | null): string {
  return value?.trim() ?? "";
}

export function getPublicTeacherName(input: TeacherNameInput): string {
  const fullName = `${normalize(input.firstName)} ${normalize(input.lastName)}`.trim();
  if (fullName.length > 0) {
    return fullName;
  }

  return normalize(input.name);
}
