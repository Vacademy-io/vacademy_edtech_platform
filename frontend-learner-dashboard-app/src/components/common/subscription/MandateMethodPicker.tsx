import { useTranslation } from "react-i18next";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { cn } from "@/lib/utils";

/** How a recurring mandate is authorised — the same two options the enrol form offers. */
export type MandateMethod = "upi" | "card";

export const DEFAULT_MANDATE_METHOD: MandateMethod = "upi";

interface MandateMethodPickerProps {
    value: MandateMethod;
    onChange: (method: MandateMethod) => void;
    disabled?: boolean;
    className?: string;
}

/**
 * UPI Autopay vs card e-mandate choice for a mandate (re-)registration. A Razorpay
 * recurring order is bound to ONE authorisation method, so the learner must pick before
 * the order is created — the checkout cannot switch afterwards. Shown wherever the
 * learner opts to (re)enable auto-pay: pay-to-continue and plan-change upgrades.
 */
export function MandateMethodPicker({
    value,
    onChange,
    disabled,
    className,
}: MandateMethodPickerProps) {
    const { t } = useTranslation("dashboard");
    const options: { key: MandateMethod; label: string; hint: string }[] = [
        {
            key: "upi",
            label: t("membership.mandateMethod.upiLabel"),
            hint: t("membership.mandateMethod.upiHint"),
        },
        {
            key: "card",
            label: t("membership.mandateMethod.cardLabel"),
            hint: t("membership.mandateMethod.cardHint"),
        },
    ];

    return (
        <div className={cn("space-y-1.5", className)}>
            <p className="text-caption text-muted-foreground">
                {t("membership.mandateMethod.heading")}
            </p>
            <RadioGroup
                value={value}
                onValueChange={(next) => onChange(next as MandateMethod)}
                disabled={disabled}
                className="flex flex-col gap-2 sm:flex-row"
            >
                {options.map((option) => (
                    <label
                        key={option.key}
                        className={cn(
                            "flex flex-1 cursor-pointer items-start gap-2 rounded-lg border p-2.5 text-caption",
                            value === option.key
                                ? "border-primary-300 bg-primary-50"
                                : "border-border bg-background",
                            disabled && "cursor-default opacity-60"
                        )}
                    >
                        <RadioGroupItem value={option.key} className="mt-0.5" />
                        <span>
                            <span className="block font-medium text-foreground">{option.label}</span>
                            <span className="block text-muted-foreground">{option.hint}</span>
                        </span>
                    </label>
                ))}
            </RadioGroup>
        </div>
    );
}
