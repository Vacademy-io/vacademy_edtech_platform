import { z } from "zod";
import { isBlankPhone, isValidPhoneValue } from "@/lib/phone-validation";
import type { ContactBody, ContactFormField, ContactKind } from "./types";

/**
 * The contact_form card (SPEC §4.4) → a native form. The card's fields come
 * from the lead campaign, so their keys are the institute's; the visitor API
 * wants the name/email/phone pulled out of them (§4.1 /contact) and the rest
 * as `fields`. Pure, so the rules are unit-tested without a DOM.
 */

export type ContactRole = "name" | "email" | "phone" | "textarea" | "select" | "checkbox" | "number" | "text";

export interface ContactFieldSpec extends ContactFormField {
  role: ContactRole;
  /** Form-safe name (react-hook-form treats "." in names as a path). */
  name: string;
}

/**
 * admin_core names a campaign field "<slug>_inst_<instituteId>[_<n>]" (CustomFieldKeyGenerator).
 * The server sends the short key already; this keeps role detection right for any card that
 * still carries the long one, so a campaign's own name field never sits next to a second one.
 */
const INST_SUFFIX = /_inst_[A-Za-z0-9-]+(?:_\d+)?$/;
export const stripInstSuffix = (key: string): string => key.trim().replace(INST_SUFFIX, "");

const NAME_KEYS = new Set(["full_name", "fullname", "name", "your_name", "student_name", "parent_name"]);
const EMAIL_KEYS = new Set(["email", "email_address", "emailaddress", "mail"]);
const PHONE_KEYS = new Set(["phone", "mobile", "phone_number", "mobile_number", "phonenumber", "mobilenumber", "contact_number", "whatsapp"]);

export const roleOf = (field: ContactFormField): ContactRole => {
  const key = stripInstSuffix(field.key).toLowerCase();
  const type = field.type.toLowerCase();
  if (type === "email" || EMAIL_KEYS.has(key)) return "email";
  if (type === "phone" || type === "tel" || type === "mobile" || PHONE_KEYS.has(key)) return "phone";
  if (type === "name" || NAME_KEYS.has(key)) return "name";
  if (type === "textarea" || type === "long_text" || type === "paragraph") return "textarea";
  if ((type === "select" || type === "dropdown" || type === "radio") && field.options?.length) return "select";
  if (type === "checkbox" || type === "boolean") return "checkbox";
  if (type === "number") return "number";
  return "text";
};

/**
 * The fields to render, in the campaign's order, with one name, email and
 * phone at most. The API needs a name and at least one of email/phone, so a
 * campaign without them still gets a (required) name and an (optional)
 * phone + email pair — never a form that cannot be submitted.
 */
export const buildContactFields = (fields: ContactFormField[], labels: { name: string; email: string; phone: string }): ContactFieldSpec[] => {
  const seen = new Set<ContactRole>();
  const out: ContactFieldSpec[] = [];
  fields.forEach((f, i) => {
    const role = roleOf(f);
    if ((role === "name" || role === "email" || role === "phone") && seen.has(role)) return;
    seen.add(role);
    out.push({ ...f, role, name: `f${i}` });
  });
  if (!seen.has("name")) {
    out.unshift({ key: "full_name", label: labels.name, type: "text", required: true, role: "name", name: "f_name" });
  } else {
    // The API needs a name: whatever the campaign says, it is required here.
    out.forEach((f) => {
      if (f.role === "name") f.required = true;
    });
  }
  if (!seen.has("phone") && !seen.has("email")) {
    out.push({ key: "phone", label: labels.phone, type: "tel", required: false, role: "phone", name: "f_phone" });
    out.push({ key: "email", label: labels.email, type: "email", required: false, role: "email", name: "f_email" });
  }
  return out;
};

export interface ContactMessages {
  required: (label: string) => string;
  email: string;
  phone: string;
  oneOf: string;
  consent: string;
  tooLong: string;
}

const EMAIL = z.string().email();

/**
 * Every problem with the values, one per field at most (first wins), so the
 * visitor sees all of them at once — including "phone or email", which needs
 * two fields and so can't be a per-field rule.
 */
export const validateContact = (
  specs: ContactFieldSpec[],
  values: Record<string, unknown>,
  msg: ContactMessages,
): { path: string; message: string }[] => {
  const issues = new Map<string, string>();
  const text = (name: string) => (typeof values[name] === "string" ? (values[name] as string) : "");
  for (const f of specs) {
    if (f.role === "checkbox") {
      if (f.required && values[f.name] !== true) issues.set(f.name, msg.required(f.label));
      continue;
    }
    const v = text(f.name);
    const blank = f.role === "phone" ? isBlankPhone(v) : !v.trim();
    if (blank) {
      if (f.required) issues.set(f.name, msg.required(f.label));
      continue;
    }
    if (v.length > (f.role === "textarea" ? 2000 : 200)) issues.set(f.name, msg.tooLong);
    else if (f.role === "email" && !EMAIL.safeParse(v.trim()).success) issues.set(f.name, msg.email);
    else if (f.role === "phone" && !isValidPhoneValue(v)) issues.set(f.name, msg.phone);
  }
  const email = specs.find((f) => f.role === "email");
  const phone = specs.find((f) => f.role === "phone");
  const hasEmail = !!email && !!text(email.name).trim();
  const hasPhone = !!phone && !isBlankPhone(text(phone.name));
  const target = phone ?? email;
  if (!hasEmail && !hasPhone && target && !issues.has(target.name)) issues.set(target.name, msg.oneOf);
  if (values.consent !== true) issues.set("consent", msg.consent);
  return Array.from(issues, ([path, message]) => ({ path, message }));
};

/** zod schema (for zodResolver) over validateContact; messages from the site's locale. */
export const buildContactSchema = (specs: ContactFieldSpec[], msg: ContactMessages) =>
  z.record(z.unknown()).superRefine((values, ctx) => {
    for (const issue of validateContact(specs, values, msg)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: issue.message, path: [issue.path] });
    }
  });

export const emptyContactValues = (specs: ContactFieldSpec[]): Record<string, string | boolean> => {
  const values: Record<string, string | boolean> = { consent: false };
  for (const f of specs) values[f.name] = f.role === "checkbox" ? false : "";
  return values;
};

/** Form values → the POST /contact body. */
export const toContactBody = (
  specs: ContactFieldSpec[],
  values: Record<string, unknown>,
  kind: ContactKind,
  courseIds?: string[],
): ContactBody => {
  const body: ContactBody = { kind, full_name: "", fields: {}, consent: true };
  for (const f of specs) {
    const raw = values[f.name];
    if (f.role === "checkbox") {
      body.fields[f.key] = raw === true;
      continue;
    }
    const v = typeof raw === "string" ? raw.trim() : "";
    if (f.role === "name") body.full_name = v;
    else if (f.role === "email") {
      if (v) body.email = v;
    } else if (f.role === "phone") {
      if (!isBlankPhone(v)) body.phone = v;
    } else if (v) body.fields[f.key] = v;
  }
  if (courseIds?.length) body.course_ids = courseIds;
  return body;
};
