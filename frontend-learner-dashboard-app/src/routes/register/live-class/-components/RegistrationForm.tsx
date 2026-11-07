import { MyButton } from "@/components/design-system/button";
import PhoneInputField from "@/components/design-system/phone-input-field";
import { zodResolver } from "@hookform/resolvers/zod";
import { FieldErrors, FormProvider, useForm } from "react-hook-form";
import SelectField from "@/components/design-system/select-field";
import {
  FormControl,
  FormField,
  FormItem,
  FormLabel,
} from "@/components/ui/form";
import { generateZodSchema } from "../-types/registrationFormSchema";
import { RegistrationFormValues, CustomField } from "../-types/type";
import { type GuestIdentity } from "../-utils/guestSessionStorage";
import { useEffect, useMemo, useRef, useState } from "react";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { CustomFieldRenderer } from "@/components/common/custom-fields/CustomFieldRenderer";
import {
  getFieldRenderType,
  FieldRenderType,
} from "@/components/common/enroll-by-invite/-utils/custom-field-helpers";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { useTranslation } from "react-i18next";
import { getTerminology } from "@/components/common/layout-container/sidebar/utils";
import { ContentTerms, SystemTerms } from "@/types/naming-settings";

interface RegistrationFormProps {
  customFields: CustomField[];
  verifiedEmail: string;
  verifiedEmails: string[];
  paymentRequired: boolean;
  /** Session's verification config — drives which identity the
   *  "Already registered?" lookup asks for. */
  requireEmailVerification?: boolean;
  requirePhoneVerification?: boolean;
  onSubmit: (formValues: RegistrationFormValues) => void;
  onError: (errors: FieldErrors) => void;
  /** Resolves to true when a registration was found for the identity. */
  onIdentityChange: (identity: GuestIdentity) => Promise<boolean>;
}

/**
 * Identify the email field by its render type (and name as a fallback) rather
 * than a hardcoded `fieldKey === "email"`. The email custom field's key varies
 * per institute (name/UUID-derived), so keying off the literal string meant the
 * verified email never prefilled and the field stayed editable.
 */
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

const isEmailField = (field: CustomField): boolean => {
  if (getFieldRenderType(field.fieldKey, field.fieldType) === FieldRenderType.EMAIL) {
    return true;
  }
  const key = (field.fieldKey || "").toLowerCase();
  const label = (field.fieldName || "").toLowerCase();
  return (
    key === "email" ||
    key.includes("mail") ||
    label.includes("email") ||
    label.includes("e-mail")
  );
};

export default function RegistrationForm({
  customFields,
  verifiedEmail,
  verifiedEmails,
  paymentRequired,
  requireEmailVerification,
  requirePhoneVerification,
  onSubmit,
  onError,
  onIdentityChange,
}: RegistrationFormProps) {
  const { t } = useTranslation("registrationA");
  const session = getTerminology(ContentTerms.Session, SystemTerms.Session);
  const schema = generateZodSchema(customFields);
  // Actual keys of every email field in this form (keys vary per institute).
  const emailFieldKeys = useMemo(
    () => (customFields || []).filter(isEmailField).map((f) => f.fieldKey),
    [customFields],
  );
  const phoneFieldKeys = useMemo(
    () =>
      (customFields || [])
        .filter(
          (f) =>
            getFieldRenderType(f.fieldKey, f.fieldType) === FieldRenderType.PHONE
        )
        .map((f) => f.fieldKey),
    [customFields],
  );
  // Phone-identity institutes: a mandatory phone field makes the mobile number
  // a valid registration identity on its own, so email isn't forced. Paid
  // sessions always need an email (the invoice is billed and mailed to it).
  const hasMandatoryPhone = useMemo(
    () =>
      (customFields || []).some(
        (f) =>
          f.mandatory &&
          getFieldRenderType(f.fieldKey, f.fieldType) === FieldRenderType.PHONE
      ),
    [customFields],
  );
  const injectStandaloneEmail =
    emailFieldKeys.length === 0 && (paymentRequired || !hasMandatoryPhone);

  // "Already registered?" quick lookup: instead of the full form, ask only for
  // one identity field and resolve the existing registration server-side. The
  // channel follows the session's verification config (phone verification →
  // phone, email verification → email); without any verification configured it
  // falls back to the form's identity shape, defaulting to email.
  const lookupChannel: "email" | "phone" =
    requirePhoneVerification && !requireEmailVerification
      ? "phone"
      : requireEmailVerification
        ? "email"
        : hasMandatoryPhone && emailFieldKeys.length === 0
          ? "phone"
          : "email";
  const [lookupMode, setLookupMode] = useState(false);
  const [lookupValue, setLookupValue] = useState("");
  const [lookupBusy, setLookupBusy] = useState(false);
  const [lookupNotFound, setLookupNotFound] = useState(false);

  const runLookup = async () => {
    const raw = lookupValue.trim();
    if (lookupChannel === "email") {
      if (!EMAIL_REGEX.test(raw)) {
        toast.error(t("liveClass.registrationForm.toast.invalidEmail"));
        return;
      }
    } else if (raw.replace(/\D/g, "").length < 8) {
      toast.error(t("liveClass.registrationForm.toast.invalidMobile"));
      return;
    }
    setLookupBusy(true);
    setLookupNotFound(false);
    try {
      const found = await onIdentityChange(
        lookupChannel === "phone" ? { mobileNumber: raw } : { email: raw }
      );
      if (!found) setLookupNotFound(true);
    } finally {
      setLookupBusy(false);
    }
  };
  const form = useForm({
    resolver: zodResolver(schema),
    defaultValues: emailFieldKeys.reduce<Record<string, string>>(
      (acc, key) => ({ ...acc, [key]: verifiedEmail }),
      {},
    ),
  });

  const {
    handleSubmit,
    formState: { errors },
  } = form;

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastCheckedEmailRef = useRef<string>(verifiedEmail || "");
  const lastCheckedPhoneRef = useRef<string>("");

  useEffect(() => {
    if (verifiedEmail) {
      lastCheckedEmailRef.current = verifiedEmail;
      emailFieldKeys.forEach((key) => {
        form.setValue(key as never, verifiedEmail as never);
      });
      if (injectStandaloneEmail) {
        form.setValue("email" as never, verifiedEmail as never);
      }
    }
  }, [verifiedEmail, emailFieldKeys, injectStandaloneEmail, form]);

  // As the learner types their email or mobile number, silently check
  // (debounced) whether that identity is already registered for this session —
  // the parent then swaps the form for the "already registered" state, so
  // nobody fills the form twice.
  useEffect(() => {
    const subscription = form.watch((values, { name }) => {
      if (!name) return;
      const isEmailKey = emailFieldKeys.includes(name) || name === "email";
      const isPhoneKey = phoneFieldKeys.includes(name);
      if (!isEmailKey && !isPhoneKey) return;
      const raw = (values as Record<string, unknown>)[name];
      const value = typeof raw === "string" ? raw.trim() : "";
      if (debounceRef.current) clearTimeout(debounceRef.current);

      if (isEmailKey) {
        if (!EMAIL_REGEX.test(value) || value === lastCheckedEmailRef.current) {
          return;
        }
        debounceRef.current = setTimeout(() => {
          lastCheckedEmailRef.current = value;
          onIdentityChange({ email: value });
        }, 700);
        return;
      }

      const digits = value.replace(/\D/g, "");
      if (digits.length < 8 || digits === lastCheckedPhoneRef.current) {
        return;
      }
      debounceRef.current = setTimeout(() => {
        lastCheckedPhoneRef.current = digits;
        onIdentityChange({ mobileNumber: value });
      }, 700);
    });
    return () => {
      subscription.unsubscribe();
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [form, emailFieldKeys, phoneFieldKeys, onIdentityChange]);

  if (lookupMode) {
    return (
      <Card className="w-full border-primary-100/60 shadow-lg">
        <CardHeader className="pb-2 pt-6 px-6">
          <CardTitle className="text-xl font-bold text-gray-900">
            {t("liveClass.registrationForm.lookup.title")}
          </CardTitle>
          <CardDescription className="text-gray-500">
            {lookupChannel === "phone"
              ? t("liveClass.registrationForm.lookup.descriptionPhone")
              : t("liveClass.registrationForm.lookup.descriptionEmail")}
          </CardDescription>
        </CardHeader>

        <Separator className="mx-6 w-auto" />

        <CardContent className="pt-5 px-6 pb-6">
          <div className="flex flex-col gap-4">
            <Input
              type={lookupChannel === "phone" ? "tel" : "email"}
              inputMode={lookupChannel === "phone" ? "tel" : "email"}
              placeholder={
                lookupChannel === "phone"
                  ? t("liveClass.registrationForm.lookup.placeholderPhone")
                  : t("liveClass.registrationForm.lookup.placeholderEmail")
              }
              value={lookupValue}
              onChange={(e) => {
                setLookupValue(e.target.value);
                setLookupNotFound(false);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !lookupBusy) runLookup();
              }}
            />
            {lookupNotFound && (
              <p className="text-sm text-red-500">
                {t("liveClass.registrationForm.lookup.notFound", {
                  channel:
                    lookupChannel === "phone"
                      ? t("liveClass.registrationForm.lookup.channelMobile")
                      : t("liveClass.registrationForm.lookup.channelEmail"),
                })}
              </p>
            )}
            <MyButton
              buttonType="primary"
              type="button"
              className="w-full h-11 text-sm font-semibold rounded-lg"
              disable={lookupBusy}
              onClick={runLookup}
            >
              {lookupBusy ? t("liveClass.registrationForm.lookup.checking") : t("liveClass.registrationForm.lookup.continue")}
            </MyButton>
            <button
              type="button"
              className="text-sm text-gray-500 underline-offset-2 hover:underline"
              onClick={() => {
                setLookupMode(false);
                setLookupNotFound(false);
              }}
            >
              {t("liveClass.registrationForm.lookup.backToForm")}
            </button>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="w-full border-primary-100/60 shadow-lg">
      <CardHeader className="pb-2 pt-6 px-6">
        <CardTitle className="text-xl font-bold text-gray-900">
          {t("common.registrationFormHeading")}
        </CardTitle>
        <CardDescription className="text-gray-500">
          {t("liveClass.registrationForm.joinPrompt", { session })}
        </CardDescription>
      </CardHeader>

      <Separator className="mx-6 w-auto" />

      <CardContent className="pt-5 px-6 pb-6 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-primary-100 bg-primary-50 px-4 py-3">
          <span className="text-sm text-gray-700">{t("liveClass.registrationForm.alreadyRegistered")}</span>
          <button
            type="button"
            className="text-sm font-semibold text-primary-500 underline-offset-2 hover:underline"
            onClick={() => setLookupMode(true)}
          >
            {t("liveClass.registrationForm.continueHere")}
          </button>
        </div>
        <FormProvider {...form}>
          <form
            onSubmit={handleSubmit(onSubmit, onError)}
            className="flex flex-col gap-5"
          >
            <div className="flex flex-col gap-4 overflow-auto max-h-screen-50 pe-1">
              {/* Some institutes configure the form without an email custom
                  field. Email is still required unless a mandatory phone field
                  provides the registration identity (and always for paid
                  sessions), so render a standalone one in that case. */}
              {injectStandaloneEmail && (
                <FormField
                  control={form.control}
                  name={"email" as never}
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-sm font-medium text-gray-700">
                        {t("common.email")}<span className="text-red-500 ms-0.5">*</span>
                      </FormLabel>
                      <FormControl>
                        <CustomFieldRenderer
                          type={FieldRenderType.EMAIL}
                          name={t("common.email")}
                          value={(field.value as string) || ""}
                          onChange={(val) => field.onChange(val)}
                          config=""
                          required
                        />
                      </FormControl>
                    </FormItem>
                  )}
                />
              )}
              {[...(customFields || [])].sort((a, b) => (a.formOrder ?? 0) - (b.formOrder ?? 0)).map((responseField) => {
                const renderType = getFieldRenderType(
                  responseField.fieldKey,
                  responseField.fieldType
                );
                // Only show the email picker when there's an actual choice
                // (a returning user with 2+ verified emails). For a single
                // verified email, render it as a clean prefilled/locked field
                // instead of a pointless one-option dropdown.
                const isEmailWithVerifiedList =
                  isEmailField(responseField) && verifiedEmails.length > 1;
                // Detect phone fields by render type, not a literal
                // "mobile_number" key (keys are institute-suffixed), so every
                // phone field renders with the shared picker and is validated.
                const isPhoneField = renderType === FieldRenderType.PHONE;

                return (
                  <div key={responseField.id} className="flex flex-col gap-4">
                    {isPhoneField ? (
                      // Reuse the shared design-system phone field (same as the
                      // enroll-by-invite flow) so the country picker, styling and
                      // E.164 formatting stay consistent across forms. Validation
                      // is handled by this form's zod schema, so opt out of the
                      // component's own country-aware rule.
                      <PhoneInputField
                        label={responseField.fieldName}
                        name={responseField.fieldKey}
                        placeholder={t("liveClass.registrationForm.enterFieldPlaceholder", {
                          fieldName: responseField.fieldName.toLowerCase(),
                        })}
                        control={form.control}
                        required={responseField.mandatory}
                        validate={false}
                      />
                    ) : isEmailWithVerifiedList ? (
                      <SelectField
                        label={responseField.fieldName}
                        name={responseField.fieldKey}
                        options={verifiedEmails.map((email, idx) => ({
                          value: email,
                          label: email,
                          _id: idx,
                        }))}
                        control={form.control}
                        className="mt-2 w-full font-thin"
                        onSelect={(value) => {
                          form.setValue(responseField.fieldKey as never, value as never);
                          onIdentityChange({ email: value });
                        }}
                      />
                    ) : (
                      <FormField
                        control={form.control}
                        name={responseField.fieldKey as never}
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel className="text-sm font-medium text-gray-700">
                              {responseField.fieldName}
                              {responseField.mandatory && (
                                <span className="text-red-500 ms-0.5">*</span>
                              )}
                            </FormLabel>
                            <FormControl>
                              <CustomFieldRenderer
                                type={renderType}
                                name={responseField.fieldName}
                                value={field.value || ""}
                                onChange={(val) => field.onChange(val)}
                                config={responseField.config}
                                required={responseField.mandatory}
                              />
                            </FormControl>
                          </FormItem>
                        )}
                      />
                    )}

                    {typeof responseField.fieldKey === "string" &&
                      !!errors &&
                      Object.prototype.hasOwnProperty.call(
                        errors,
                        responseField.fieldKey
                      ) &&
                      (errors as Record<string, FieldErrors>)[
                        responseField.fieldKey
                      ] && (
                        <p className="text-sm text-red-500">
                          {(errors as Record<string, FieldErrors>)[
                            responseField.fieldKey
                          ]?.message?.toString()}
                        </p>
                      )}
                  </div>
                );
              })}
            </div>

            <MyButton
              buttonType="primary"
              type="submit"
              className="w-full h-11 text-sm font-semibold rounded-lg mt-1"
            >
              {t("liveClass.registrationForm.joinNow")}
            </MyButton>
          </form>
        </FormProvider>
      </CardContent>
    </Card>
  );
}
