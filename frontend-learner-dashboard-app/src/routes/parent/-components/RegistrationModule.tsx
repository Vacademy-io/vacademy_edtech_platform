// ─────────────────────────────────────────────────────────────
// Registration Module — Multi-stage form with auto-save
// ─────────────────────────────────────────────────────────────

import { useState, useCallback, useEffect, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useTranslation } from "react-i18next";
import type { ChildProfile } from "@/types/parent-portal";
import {
  useRegistrationForm,
  useSaveRegistrationSection,
  useSubmitRegistration,
  usePaymentSummary,
  useInitiatePayment,
} from "@/hooks/use-parent-portal";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import {
  CaretLeft,
  CaretRight,
  Check,
  FloppyDisk,
  PaperPlaneTilt,
  WarningCircle,
  SpinnerGap,
  CreditCard,
} from "@phosphor-icons/react";

interface RegistrationModuleProps {
  child: ChildProfile;
  title?: string;
}

export function RegistrationModule({ child, title }: RegistrationModuleProps) {
  const { t } = useTranslation("parent");
  const { data: formData, isLoading } = useRegistrationForm(child.id);
  const saveMutation = useSaveRegistrationSection();
  const submitMutation = useSubmitRegistration();
  const { data: paymentSummary } = usePaymentSummary(child.id);
  const initiatePaymentMutation = useInitiatePayment();

  const registrationFee = paymentSummary?.fee_items.find(
    (item) => item.category === "REGISTRATION"
  );
  const isFeePending =
    registrationFee &&
    (registrationFee.status === "PENDING" ||
      registrationFee.status === "OVERDUE" ||
      registrationFee.status === "PARTIAL");

  const [currentSection, setCurrentSection] = useState(0);
  const [formValues, setFormValues] = useState<
    Record<string, Record<string, string>>
  >({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const autoSaveRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Initialize form values from fetched data
  useEffect(() => {
    if (formData?.sections) {
      const values: Record<string, Record<string, string>> = {};
      formData.sections.forEach((section) => {
        const sectionVals: Record<string, string> = {};
        section.fields.forEach((field) => {
          sectionVals[field.id] = field.value ?? field.default_value ?? "";
        });
        values[section.id] = sectionVals;
      });
      setFormValues(values);
    }
  }, [formData]);

  // Section data
  const sections = formData?.sections ?? [];
  const section = sections[currentSection];
  const totalSections = sections.length;

  // Auto‑save after 3 seconds of inactivity
  useEffect(() => {
    if (autoSaveRef.current) clearTimeout(autoSaveRef.current);
    if (!section) return;
    autoSaveRef.current = setTimeout(() => {
      handleSaveDraft();
    }, 3000);
    return () => {
      if (autoSaveRef.current) clearTimeout(autoSaveRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [formValues, currentSection]);

  const handleSaveDraft = useCallback(() => {
    if (!formData || !section) return;
    
    const currentData = formValues[section.id] ?? {};
    const fieldsPayload = Object.entries(currentData).map(([fieldId, value]) => ({
      field_id: fieldId,
      value: value,
    }));

    saveMutation.mutate(
      {
        registration_id: formData.id,
        section_id: section.id,
        fields: fieldsPayload,
        is_draft: true,
      },
      {
        onSuccess: () =>
          toast.success(t("admissionPortal.registration.draftSaved"), {
            duration: 1500,
          }),
      }
    );
  }, [formData, section, formValues, saveMutation]);

  const validateSection = useCallback(() => {
    if (!section) return true;
    const newErrors: Record<string, string> = {};
    section.fields.forEach((field) => {
      if (
        field.is_required &&
        !formValues[section.id]?.[field.id]?.trim()
      ) {
        newErrors[field.id] = t("admissionPortal.registration.fieldRequired", {
          label: field.label,
        });
      }
    });
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  }, [section, formValues]);

  const handleNext = () => {
    if (!validateSection()) {
      toast.error(t("admissionPortal.registration.fillRequiredFields"));
      return;
    }
    handleSaveDraft();
    setCurrentSection((prev) => Math.min(prev + 1, totalSections - 1));
  };

  const handlePrev = () => {
    handleSaveDraft();
    setCurrentSection((prev) => Math.max(prev - 1, 0));
  };

  const handleSubmit = () => {
    if (!validateSection()) {
      toast.error(t("admissionPortal.registration.fillRequiredFields"));
      return;
    }
    submitMutation.mutate(
      formData!.id,
      {
        onSuccess: () => {
          toast.success(t("admissionPortal.registration.submitSuccess"));
        },
      }
    );
  };

  const handlePayRegistrationFee = () => {
    if (!registrationFee) return;
    initiatePaymentMutation.mutate(
      {
        child_id: child.id,
        fee_item_ids: [registrationFee.id],
        payment_method: "ONLINE",
        amount: registrationFee.total,
      },
      {
        onSuccess: (response) => {
          if (response.gateway_url) {
            window.open(response.gateway_url, "_self");
          } else {
            toast.success(t("admissionPortal.registration.paymentInitiated"));
          }
        },
      }
    );
  };

  const handleFieldChange = (fieldId: string, value: string) => {
    if (!section) return;
    setFormValues((prev) => ({
      ...prev,
      [section.id]: {
        ...(prev[section.id] ?? {}),
        [fieldId]: value,
      },
    }));
    if (errors[fieldId]) {
      setErrors((prev) => {
        const next = { ...prev };
        delete next[fieldId];
        return next;
      });
    }
  };

  if (isLoading) {
    return (
      <div className="p-4 sm:p-6 lg:p-8 max-w-3xl mx-auto space-y-4">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-3 w-full" />
        <div className="space-y-3">
          {[...Array(5)].map((_, i) => (
            <Skeleton key={i} className="h-14 w-full" />
          ))}
        </div>
      </div>
    );
  }

  if (!formData || sections.length === 0) {
    return (
      <div className="p-4 sm:p-6 lg:p-8 max-w-3xl mx-auto">
        <Card className="shadow-sm">
          <CardContent className="py-12 text-center">
            <WarningCircle
              size={28}
              className="mx-auto text-muted-foreground/40 mb-3"
            />
            <p className="text-sm font-medium text-muted-foreground">
              {t("admissionPortal.registration.unavailable")}
            </p>
            <p className="text-xs text-muted-foreground/60 mt-1">
              {t("admissionPortal.registration.unavailableBody")}
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-3xl mx-auto w-full space-y-5 pb-20 lg:pb-8">
      {/* Header */}
      <div>
        <h2 className="text-lg sm:text-xl font-bold text-foreground">
          {title || t("admissionPortal.registration.heading")}
        </h2>
        <p className="text-sm text-muted-foreground mt-0.5">
          {formData.form_title ||
            t("admissionPortal.registration.subheading")}
        </p>
      </div>

      {/* ── Section Progress ──────────────────────────────────── */}
      <div className="flex items-center gap-1.5 overflow-x-auto pb-2">
        {sections.map((s, idx) => {
          const isActive = idx === currentSection;
          const isCompleted = idx < currentSection;
          return (
            <button
              key={s.id}
              onClick={() => {
                if (idx < currentSection) setCurrentSection(idx);
              }}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium whitespace-nowrap transition-all ${
                isActive
                  ? "bg-primary text-primary-foreground shadow-sm"
                  : isCompleted
                    ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300 cursor-pointer"
                    : "bg-muted text-muted-foreground"
              }`}
            >
              {isCompleted ? (
                <Check size={12} className="shrink-0" />
              ) : (
                <span className="w-4 h-4 rounded-full border text-center text-caption leading-4 shrink-0">
                  {idx + 1}
                </span>
              )}
              {s.title}
            </button>
          );
        })}
      </div>

      {/* ── Form Section ──────────────────────────────────────── */}
      <AnimatePresence mode="wait">
        {section && (
          <motion.div
            key={section.id}
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -20 }}
            transition={{ duration: 0.2 }}
          >
            <Card className="shadow-sm">
              <CardHeader className="pb-3">
                <CardTitle className="text-base">{section.title}</CardTitle>
                {section.description && (
                  <CardDescription className="text-xs">
                    {section.description}
                  </CardDescription>
                )}
              </CardHeader>
              <CardContent className="space-y-4">
                {section.fields.map((field) => (
                  <FormField
                    key={field.id}
                    field={field}
                    value={formValues[section.id]?.[field.id] ?? ""}
                    onChange={(val) => handleFieldChange(field.id, val)}
                    error={errors[field.id]}
                  />
                ))}
              </CardContent>
            </Card>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Navigation ────────────────────────────────────────── */}
      <div className="flex items-center justify-between gap-3">
        <Button
          variant="outline"
          onClick={handlePrev}
          disabled={currentSection === 0}
          className="gap-1.5 text-xs h-9"
        >
          <CaretLeft size={14} />
          {t("admissionPortal.registration.previous")}
        </Button>

        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={handleSaveDraft}
            disabled={saveMutation.isPending}
            className="gap-1.5 text-xs h-9"
          >
            {saveMutation.isPending ? (
              <SpinnerGap size={12} className="animate-spin" />
            ) : (
              <FloppyDisk size={12} />
            )}
            {t("admissionPortal.registration.saveProgress")}
          </Button>

          {currentSection < totalSections - 1 ? (
            <Button
              onClick={handleNext}
              className="gap-1.5 text-xs h-9"
            >
              {t("admissionPortal.registration.continue")}
              <CaretRight size={14} />
            </Button>
          ) : (
            <Button
              onClick={handleSubmit}
              disabled={submitMutation.isPending}
              className="gap-1.5 text-xs h-9 bg-emerald-600 hover:bg-emerald-700"
            >
              {submitMutation.isPending ? (
                <SpinnerGap size={12} className="animate-spin" />
              ) : (
                <PaperPlaneTilt size={12} />
              )}
              {t("admissionPortal.registration.submitApplication")}
            </Button>
          )}
        </div>
      </div>

      {/* ── Registration Fee Payment ──────────────────────────── */}
      {isFeePending && (
        <Card className="border-primary/20 bg-primary/5 shadow-sm mt-6">
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <CreditCard size={18} className="text-primary" />
              {t("admissionPortal.registration.feePendingTitle")}
            </CardTitle>
            <CardDescription className="text-xs">
              {t("admissionPortal.registration.feePendingBody")}
            </CardDescription>
          </CardHeader>
          <CardContent className="flex items-center justify-between gap-4">
            <div>
              <p className="text-xs text-muted-foreground uppercase tracking-wider font-semibold">
                {t("admissionPortal.registration.amountDue")}
              </p>
              <p className="text-lg font-bold text-foreground">
                {paymentSummary?.currency}
                {registrationFee.total.toLocaleString()}
              </p>
            </div>
            <Button
              onClick={handlePayRegistrationFee}
              disabled={initiatePaymentMutation.isPending}
              className="gap-2"
            >
              {initiatePaymentMutation.isPending ? (
                <SpinnerGap size={16} className="animate-spin" />
              ) : (
                <CreditCard size={16} />
              )}
              {t("admissionPortal.registration.payFeeNow")}
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Auto‑save indicator */}
      {saveMutation.isPending && (
        <motion.p
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="fixed bottom-20 lg:bottom-4 end-4 text-caption text-muted-foreground bg-card/80 backdrop-blur-sm px-3 py-1.5 rounded-full shadow-sm border flex items-center gap-1.5"
        >
          <SpinnerGap size={10} className="animate-spin" />
          {t("admissionPortal.registration.autoSaving")}
        </motion.p>
      )}
    </div>
  );
}

// ── Form Field Renderer ──────────────────────────────────────────

interface FormFieldProps {
  field: {
    id: string;
    label: string;
    type: string;
    is_required: boolean;
    placeholder?: string;
    options?: string[];
    value?: string;
    default_value?: string;
  };
  value: string;
  onChange: (value: string) => void;
  error?: string;
}

function FormField({ field, value, onChange, error }: FormFieldProps) {
  const { t } = useTranslation("parent");
  return (
    <div>
      <label className="text-xs font-medium text-foreground mb-1.5 block">
        {field.label}
        {field.is_required && <span className="text-destructive ms-0.5">*</span>}
      </label>

      {field.type === "select" && field.options ? (
        <select
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="w-full h-9 rounded-lg border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
        >
          <option value="">{t("admissionPortal.registration.selectOption")}</option>
          {field.options.map((opt) => (
            <option key={opt} value={opt}>
              {opt}
            </option>
          ))}
        </select>
      ) : field.type === "textarea" ? (
        <textarea
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={field.placeholder}
          className="w-full min-h-20 rounded-lg border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary resize-y"
        />
      ) : field.type === "date" ? (
        <Input
          type="date"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="h-9 text-sm"
        />
      ) : field.type === "checkbox" ? (
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={value === "true"}
            onChange={(e) => onChange(e.target.checked ? "true" : "false")}
            className="rounded border-input h-4 w-4"
          />
          <span className="text-sm text-foreground">
            {field.placeholder || field.label}
          </span>
        </label>
      ) : (
        <Input
          type={field.type === "email" ? "email" : field.type === "number" ? "number" : "text"}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={field.placeholder}
          className="h-9 text-sm"
        />
      )}

      {error && (
        <p className="text-caption text-destructive mt-1 flex items-center gap-1">
          <WarningCircle size={10} />
          {error}
        </p>
      )}
    </div>
  );
}
