import {
  AssessmentCustomFieldOpenRegistration,
  DynamicSchemaData,
  OpenRegistrationUserDetails,
} from "@/types/assessment-open-registration";
import { UserDetailsOpenTest } from "@/types/open-test";
import { z } from "zod";
import {
  getFieldRenderType,
  FieldRenderType,
} from "@/components/common/enroll-by-invite/-utils/custom-field-helpers";
import { isBlankPhone, isValidPhoneValue } from "@/lib/phone-validation";

/**
 * Builds the zod schema for a custom field's `value`. Phone fields get
 * country-aware validation (the same `getFieldRenderType` detection the renderer
 * uses, so validation and UI stay in lockstep); everything else keeps the
 * generic required / optional string rule.
 */
const buildValueSchema = (
  field: AssessmentCustomFieldOpenRegistration
): z.ZodTypeAny => {
  const requiredMsg = `${field.field_name} is required`;
  const isPhone =
    getFieldRenderType(field.field_key, field.field_type) ===
    FieldRenderType.PHONE;

  if (isPhone) {
    const invalidMsg = `Enter a valid ${field.field_name.toLowerCase()} for the selected country`;
    return field.is_mandatory
      ? z.string().min(1, requiredMsg).refine(isValidPhoneValue, invalidMsg)
      : z
          .string()
          .refine((v) => isBlankPhone(v) || isValidPhoneValue(v), invalidMsg);
  }

  return field.is_mandatory ? z.string().min(1, requiredMsg) : z.string();
};

const parseBackendDate = (raw: string): number => {
  // Backend may send timestamps with or without an explicit timezone.
  // Without a zone marker, modern browsers parse the string as *local*
  // time, which makes the countdown drift by the local UTC offset.
  // Force UTC interpretation when no zone marker is present.
  const hasTimezone = /Z$|[+-]\d{2}:?\d{2}$/i.test(raw);
  const normalized = hasTimezone ? raw : `${raw.replace(" ", "T")}Z`;
  return new Date(normalized).getTime();
};

export const calculateTimeDifference = (
  serverTime: number,
  startDate: string
) => {
  if (!startDate) return false;
  const startTime = parseBackendDate(startDate);
  if (isNaN(startTime)) return false;

  const difference: number = startTime - serverTime;

  return difference > 0 ? true : false;
};

/**
 * Assessments created without an explicit end are stored as 9999-12-31, and the
 * registration window is backfilled from that bound — so the countdown rendered
 * "REGISTRATION CLOSES IN 2912177 DAYS". Past this horizon the deadline carries
 * no information, so the countdown is dropped and the page just says
 * registration is open.
 */
const UNBOUNDED_DEADLINE_DAYS = 366;

export const isEffectivelyUnbounded = (
  serverTime: number,
  endDate: string | null | undefined
): boolean => {
  if (!endDate) return true;
  const endTime = parseBackendDate(endDate);
  if (isNaN(endTime)) return true;
  return endTime - serverTime > UNBOUNDED_DEADLINE_DAYS * 24 * 60 * 60 * 1000;
};

export const calculateTimeLeft = (serverTime: number, startDate: string) => {
  if (!startDate) return { days: 0, hours: 0, minutes: 0, seconds: 0 };
  const startTime = parseBackendDate(startDate);
  if (isNaN(startTime)) return { days: 0, hours: 0, minutes: 0, seconds: 0 };

  const difference: number = startTime - serverTime;

  if (difference <= 0) {
    return { days: 0, hours: 0, minutes: 0, seconds: 0 };
  }

  return {
    days: Math.floor(difference / (1000 * 60 * 60 * 24)),
    hours: Math.floor((difference / (1000 * 60 * 60)) % 24),
    minutes: Math.floor((difference / (1000 * 60)) % 60),
    seconds: Math.floor((difference / 1000) % 60),
  };
};

export const getDynamicSchema = (
  formFields: AssessmentCustomFieldOpenRegistration[]
) => {
  const dynamicSchema = z.object(
    formFields.reduce<Record<string, z.ZodTypeAny>>((schema, field) => {
      if (field.field_type === "dropdown") {
        const options = field.comma_separated_options
          ? field.comma_separated_options.split(",").map((opt) => opt.trim())
          : [];

        schema[field.field_key] = z.object({
          id: z.string().optional(),
          name: z.string(),
          value: buildValueSchema(field),
          is_mandatory: z.boolean(),
          type: z.string(),
          comma_separated_options: z.array(z.string()).optional(),
        });
      } else {
        schema[field.field_key] = z.object({
          id: z.string().optional(),
          name: z.string(),
          value: buildValueSchema(field),
          is_mandatory: z.boolean(),
          type: z.string(),
        });
      }
      return schema;
    }, {})
  );

  return dynamicSchema;
};

export const getOpenRegistrationUserDetailsByEmail = (
  users: unknown,
  email: string | undefined
): UserDetailsOpenTest | null => {
  // The learner-details call can answer with an error envelope instead of a
  // list (expired token, wrong institute); `.find` on that would throw.
  if (!Array.isArray(users)) return null;
  return (
    (users as UserDetailsOpenTest[]).find((user) => user.email === email) ||
    null
  );
};

export function transformIntoCustomFieldRequestListData(
  data1: AssessmentCustomFieldOpenRegistration[],
  data2: DynamicSchemaData
) {
  return {
    custom_field_request_list: data1.map((field) => ({
      id: field.id,
      assessment_custom_field_id: field.id,
      assessment_custom_field_key: field.field_key,
      answer: data2[field.field_key]?.value || "",
    })),
  };
}

export function mergeDataToGetUserId(
  data1: OpenRegistrationUserDetails,
  data2: DynamicSchemaData
): OpenRegistrationUserDetails {
  const result: OpenRegistrationUserDetails = { ...data1 }; // Copy structure

  Object.keys(result).forEach((key) => {
    if (
      key in data2 &&
      typeof data2[key as keyof DynamicSchemaData] === "object" &&
      "value" in data2[key as keyof DynamicSchemaData]
    ) {
      const value = data2[key as keyof DynamicSchemaData].value;

      if (
        typeof value === "string" &&
        typeof result[key as keyof OpenRegistrationUserDetails] === "string"
      ) {
        (result[key as keyof OpenRegistrationUserDetails] as string) = value;
      }
    }
  });

  return result;
}

/**
 * A PUBLIC assessment may carry no registration window at all — the backend
 * treats each missing bound as "no limit on that side", so the page must too.
 *
 * These three used to do a bare `Date.parse(null)`, which is NaN, and every
 * comparison against NaN is false — so case1/case2/case3 were ALL false and the
 * registration form simply never rendered. The page came up blank, with no
 * error: verified against the live bundle by serving it a payload with
 * can_register:true and both dates null.
 */
type WindowBound = string | null | undefined;

const boundOrNaN = (date: WindowBound): number =>
  date ? Date.parse(date) : NaN;

/** Before registration opens. An absent open date never gates. */
export const case1 = (serverTime: number, startDate: WindowBound) => {
  const registrationStartDate = boundOrNaN(startDate);
  if (isNaN(registrationStartDate)) return false;
  return serverTime < registrationStartDate;
};

/** Inside the registration window. An absent bound means that side is open. */
export const case2 = (
  serverTime: number,
  startDate: WindowBound,
  endDate: WindowBound,
) => {
  const registrationStartDate = boundOrNaN(startDate);
  const registrationEndDate = boundOrNaN(endDate);
  const hasOpened =
    isNaN(registrationStartDate) || registrationStartDate <= serverTime;
  const notYetClosed =
    isNaN(registrationEndDate) || serverTime <= registrationEndDate;
  return hasOpened && notYetClosed;
};

/** After registration closed. An absent close date never closes. */
export const case3 = (serverTime: number, endDate: WindowBound) => {
  const registrationEndDate = boundOrNaN(endDate);
  if (isNaN(registrationEndDate)) return false;
  return serverTime > registrationEndDate;
};
