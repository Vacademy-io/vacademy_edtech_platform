import React, { useId, useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useTranslation } from "react-i18next";
import { useStore } from "zustand";
import { CheckCircle, WarningCircle } from "@phosphor-icons/react";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import PhoneInputField from "@/components/design-system/phone-input-field";
import { cn } from "@/lib/utils";
import {
  buildContactFields,
  buildContactSchema,
  emptyContactValues,
  toContactBody,
  type ContactFieldSpec,
} from "./contact-form";
import { useSiteAssistantUi } from "./context";
import type { SiteAssistantCard } from "./types";

type ContactCard = Extract<SiteAssistantCard, { type: "contact_form" }>;

const labelClass = "text-xs font-medium text-palette-body";

/**
 * The contact_form card as a real form in the chat: the campaign's fields,
 * why we are asking, the consent sentence, inline errors in the site's
 * language, and a success state that survives navigation (the controller
 * remembers it). Leads go through POST /contact → the website-lead pipeline.
 */
export const ContactFormCard: React.FC<{ card: ContactCard; cardKey: string }> = ({ card, cardKey }) => {
  const { t } = useTranslation("siteAssistant");
  const { controller, consentText, onLeadSubmitted } = useSiteAssistantUi();
  const done = useStore(controller.store, (s) => !!s.contactDone[cardKey]);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const headingId = useId();

  const specs = useMemo(
    () =>
      buildContactFields(card.fields, {
        name: t("contact.name"),
        email: t("contact.email"),
        phone: t("contact.phone"),
      }),
    [card.fields, t],
  );
  const schema = useMemo(
    () =>
      buildContactSchema(specs, {
        required: (label) => t("contact.required", { label }),
        email: t("contact.invalidEmail"),
        phone: t("contact.invalidPhone"),
        oneOf: t("contact.oneOf"),
        consent: t("contact.consentRequired"),
        tooLong: t("contact.tooLong"),
      }),
    [specs, t],
  );
  const form = useForm<Record<string, string | boolean>>({
    resolver: zodResolver(schema),
    defaultValues: emptyContactValues(specs),
    mode: "onTouched",
  });

  if (done) {
    return (
      <div
        role="status"
        className="flex items-start gap-2 rounded-catalogue-lg border border-success-200 bg-success-50 p-3 text-sm text-success-700"
        data-card="contact_form"
        data-state="success"
      >
        <CheckCircle className="mt-0.5 size-5 shrink-0" weight="fill" aria-hidden="true" />
        <span>{t("contact.success")}</span>
      </div>
    );
  }

  const onSubmit = form.handleSubmit(async (values) => {
    setSubmitError(null);
    try {
      await controller.submitContact(cardKey, toContactBody(specs, values, card.kind, card.course_ids));
      onLeadSubmitted?.();
    } catch {
      setSubmitError(t("contact.failed"));
    }
  });

  const submitting = form.formState.isSubmitting;
  const consent = card.consent_text || consentText || t("contact.consentDefault");

  const renderField = (f: ContactFieldSpec) => {
    if (f.role === "phone") {
      return (
        <PhoneInputField
          key={f.name}
          control={form.control}
          name={f.name}
          label={f.label}
          placeholder={f.label}
          required={f.required}
          validate={false}
          labelClassName={labelClass}
          inputClassName="!text-sm"
        />
      );
    }
    return (
      <FormField
        key={f.name}
        control={form.control}
        name={f.name}
        render={({ field }) => {
          if (f.role === "checkbox") {
            return (
              <FormItem className="space-y-1">
                <div className="flex items-start gap-2">
                  <FormControl>
                    <input
                      type="checkbox"
                      className="mt-0.5 size-4 shrink-0 accent-primary-500"
                      checked={field.value === true}
                      onChange={(e) => field.onChange(e.target.checked)}
                      onBlur={field.onBlur}
                      ref={field.ref}
                    />
                  </FormControl>
                  <FormLabel className={cn(labelClass, "font-normal")}>
                    {f.label}
                    {f.required && <span aria-hidden="true"> *</span>}
                  </FormLabel>
                </div>
                <FormMessage />
              </FormItem>
            );
          }
          const common = {
            name: field.name,
            value: typeof field.value === "string" ? field.value : "",
            onChange: field.onChange,
            onBlur: field.onBlur,
            "aria-required": f.required || undefined,
            className: "catalogue-input",
          };
          return (
            <FormItem className="space-y-1">
              <FormLabel className={labelClass}>
                {f.label}
                {f.required && <span aria-hidden="true"> *</span>}
              </FormLabel>
              <FormControl>
                {f.role === "textarea" ? (
                  <textarea {...common} ref={field.ref} rows={3} />
                ) : f.role === "select" ? (
                  <select {...common} ref={field.ref}>
                    <option value="">{t("contact.select")}</option>
                    {(f.options ?? []).map((o) => (
                      <option key={o} value={o}>
                        {o}
                      </option>
                    ))}
                  </select>
                ) : (
                  <input
                    {...common}
                    ref={field.ref}
                    type={f.role === "email" ? "email" : f.role === "number" ? "number" : "text"}
                    inputMode={f.role === "email" ? "email" : f.role === "number" ? "numeric" : undefined}
                    autoComplete={f.role === "name" ? "name" : f.role === "email" ? "email" : undefined}
                  />
                )}
              </FormControl>
              <FormMessage />
            </FormItem>
          );
        }}
      />
    );
  };

  return (
    <section
      aria-labelledby={headingId}
      className="rounded-catalogue-lg border border-palette-border bg-catalogue-bg-elevated p-3 text-palette-text"
      data-card="contact_form"
    >
      <h3 id={headingId} className="text-sm font-semibold">
        {card.kind === "SUPPORT" ? t("contact.titleSupport") : t("contact.titleSales")}
      </h3>
      {card.reason && <p className="mt-1 text-xs text-palette-body">{card.reason}</p>}
      <Form {...form}>
        <form onSubmit={onSubmit} noValidate className="mt-3 flex flex-col gap-3">
          {specs.map(renderField)}
          <FormField
            control={form.control}
            name="consent"
            render={({ field }) => (
              <FormItem className="space-y-1">
                <div className="flex items-start gap-2">
                  <FormControl>
                    <input
                      type="checkbox"
                      className="mt-0.5 size-4 shrink-0 accent-primary-500"
                      checked={field.value === true}
                      onChange={(e) => field.onChange(e.target.checked)}
                      onBlur={field.onBlur}
                      ref={field.ref}
                    />
                  </FormControl>
                  <FormLabel className="text-xs font-normal text-palette-muted">{consent}</FormLabel>
                </div>
                <FormMessage />
              </FormItem>
            )}
          />
          {submitError && (
            <p role="alert" className="flex items-center gap-1 text-xs text-danger-600">
              <WarningCircle className="size-4 shrink-0" aria-hidden="true" />
              {submitError}
            </p>
          )}
          <button type="submit" disabled={submitting} className="catalogue-btn catalogue-btn-primary w-full">
            {submitting ? t("contact.sending") : t("contact.submit")}
          </button>
        </form>
      </Form>
    </section>
  );
};
