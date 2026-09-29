import { z } from "zod";

export function validateLength(value: unknown, max: number) {
  return typeof value === "string" && value.length > max
    ? `Use ${max.toLocaleString("en-US")} characters or fewer.`
    : null;
}

export function validateRequiredText(
  value: unknown,
  label: string,
  max: number,
) {
  const text = typeof value === "string" ? value.trim() : "";
  if (!text) return `Enter ${label}.`;
  return validateLength(text, max);
}

export function validateName(value: unknown, label: string) {
  const error = validateRequiredText(value, label, 160);
  if (error) return error;
  return /[\x00-\x1f/\\]/.test(String(value).trim())
    ? "Use a name without slashes or control characters."
    : null;
}

const emailSchema = z.string().trim().email().max(254);

export function validateEmail(value: unknown) {
  if (typeof value !== "string" || !value.trim())
    return "Enter an email address.";
  return emailSchema.safeParse(value).success
    ? null
    : "Enter a valid email address.";
}

export function validatePassword(value: unknown, register: boolean) {
  if (typeof value !== "string" || !value) return "Enter your password.";
  if (register && value.length < 12) return "Use at least 12 characters.";
  return validateLength(value, 128);
}

export function parseModelList(value: string) {
  return value
    .split(/[,\n]/)
    .map((model) => model.trim())
    .filter(Boolean);
}

export function validateModelList(value: unknown) {
  const models = parseModelList(typeof value === "string" ? value : "");
  if (models.length > 30) return "Add up to 30 models.";
  if (models.some((model) => model.length > 150))
    return "Each model ID must be 150 characters or fewer.";
  return null;
}

export function validateProviderConfig(value: unknown) {
  if (typeof value !== "string" || !value.trim()) return null;
  try {
    const config = JSON.parse(value);
    if (!config || Array.isArray(config) || typeof config !== "object")
      return "Enter a JSON object with setting names and values.";
    return null;
  } catch {
    return "Enter valid JSON. Check the quotes, commas, and brackets.";
  }
}
