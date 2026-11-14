import { Check } from "@phosphor-icons/react";
import { useTranslation } from "react-i18next";
import { useCourseTerms } from "@/routes/$tagName/-utils/catalogue-naming";
import { cn } from "@/lib/utils";
import { useProductPageStore } from "../-stores/product-page-store";

export const StepProgress = ({
  primaryColor = "#2563eb", // design-lint-ignore: page-builder default color
}: {
  primaryColor?: string;
}) => {
  const { t } = useTranslation("productPages");
  const { step } = useProductPageStore();
  const isCpoFlow = step === "CPO_INSTALLMENTS";
  const courses = useCourseTerms().courses.toLocaleLowerCase();
  // The browse step is part of the rail so the visitor sees the whole journey
  // from the first screen. It is also the step CatalogStep is ON: without an
  // entry for it, findIndex returns -1, and `done`/`active` are then false for
  // every step — the rail renders as three dead grey circles with no "you are
  // here" at all.
  const CATALOG_STEP = {
    id: "CATALOG" as const,
    label: t("stepProgress.steps.catalog", { courses }),
  };
  const CHECKOUT_STEPS = [
    CATALOG_STEP,
    { id: "CART" as const, label: t("stepProgress.steps.cart") },
    { id: "FORM" as const, label: t("stepProgress.steps.details") },
    { id: "PAYMENT" as const, label: t("stepProgress.steps.payment") },
  ];
  const CPO_CHECKOUT_STEPS = [
    CATALOG_STEP,
    { id: "CART" as const, label: t("stepProgress.steps.cart") },
    { id: "FORM" as const, label: t("stepProgress.steps.details") },
    { id: "CPO_INSTALLMENTS" as const, label: t("stepProgress.steps.installments") },
  ];
  const steps = isCpoFlow ? CPO_CHECKOUT_STEPS : CHECKOUT_STEPS;
  const currentIndex = steps.findIndex((s) => s.id === step);

  // A step the rail does not know about leaves currentIndex at -1, which makes
  // `done` and `active` false for every entry — the rail then renders as a row
  // of dead grey circles claiming the visitor is nowhere. Showing nothing is
  // the better failure: it is obviously absent rather than subtly broken.
  if (currentIndex < 0) return null;

  return (
    <nav
      aria-label={t("stepProgress.ariaLabel")}
      className="flex items-start justify-center"
    >
      {steps.map((s, i) => {
        const done = i < currentIndex;
        const active = i === currentIndex;
        return (
          <div key={s.id} className="flex min-w-0 items-start">
            <div className="flex w-16 flex-col items-center gap-1.5 sm:w-24">
              <div
                className={cn(
                  "flex size-8 shrink-0 items-center justify-center rounded-full text-sm font-semibold transition-colors",
                  done && "bg-success-500 text-white",
                  !done && !active && "bg-gray-100 text-gray-400",
                )}
                style={
                  active
                    ? {
                        // Dynamic: the institute's own page colour, which only
                        // exists at runtime in page_json.globalSettings.
                        backgroundColor: primaryColor,
                        color: "white",
                        boxShadow: `0 0 0 4px ${primaryColor}33`,
                      }
                    : undefined
                }
                aria-current={active ? "step" : undefined}
              >
                {done ? <Check className="size-4" aria-hidden="true" /> : i + 1}
              </div>
              <span
                className={cn(
                  "text-center text-2xs font-medium leading-tight sm:text-caption",
                  done && "text-success-600",
                  !done && !active && "text-gray-400",
                )}
                // Dynamic: institute page colour, see above.
                style={active ? { color: primaryColor } : undefined}
              >
                {s.label}
              </span>
            </div>
            {i < steps.length - 1 && (
              <div
                className={cn(
                  "mt-4 h-px w-4 shrink-0 sm:w-10",
                  i < currentIndex ? "bg-success-300" : "bg-gray-200",
                )}
                aria-hidden="true"
              />
            )}
          </div>
        );
      })}
    </nav>
  );
};
