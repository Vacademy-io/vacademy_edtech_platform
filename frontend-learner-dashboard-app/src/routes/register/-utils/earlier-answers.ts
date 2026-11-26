import type { DynamicSchemaData } from "@/types/assessment-open-registration";

/** Never filled from earlier answers: the email is the one just verified. */
const NEVER_FILLED = new Set(["email"]);

/**
 * Fills the register form with the learner's answers from an earlier
 * registration (field key → answer). Only empty fields are filled, so anything
 * already there (the profile, or what the learner typed) stays. A dropdown takes
 * the earlier answer only when it is still one of its options.
 */
export function applyEarlierAnswers(
  values: DynamicSchemaData,
  earlier: Record<string, string> | null | undefined,
): DynamicSchemaData {
  if (!earlier || typeof earlier !== "object") return values;
  const next: DynamicSchemaData = { ...values };
  for (const key of Object.keys(values)) {
    if (NEVER_FILLED.has(key)) continue;
    const field = values[key];
    // A half-formed field (no name) breaks the form render; leave it alone.
    if (!field || typeof field.name !== "string") continue;
    const answer = typeof earlier[key] === "string" ? earlier[key].trim() : "";
    if (!answer) continue;
    if (field.type === "dropdown") {
      if (field.comma_separated_options?.includes(answer)) {
        next[key] = { ...field, value: answer };
      }
      continue;
    }
    if (!field.value?.trim()) {
      next[key] = { ...field, value: answer };
    }
  }
  return next;
}
