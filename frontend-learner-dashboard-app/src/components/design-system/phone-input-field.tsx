"use client";

import type React from "react";
import { useEffect } from "react";

import {
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "../ui/form";
import { useWatch, type Control } from "react-hook-form";
import PhoneInput from "react-phone-input-2";
import "react-phone-input-2/lib/bootstrap.css";
import {
  phoneFieldHasInput,
  usePreferredPhoneCountries,
} from "@/hooks/use-preferred-phone-countries";
import {
  normalizeStoredPhone,
  phoneValidateRule,
  repairedStoredPhone,
} from "@/lib/phone-validation";
import { cn } from "@/lib/utils";

/**
 * Writes a repaired bare number back into the form, so validation and submit
 * see the same "+91…" value the widget shows instead of the "8712345678" a
 * prefill put there. Renders nothing.
 */
const RepairStoredPhone = ({
  repaired,
  onRepair,
}: {
  repaired: string | null;
  onRepair: (value: string) => void;
}) => {
  useEffect(() => {
    if (repaired) onRepair(repaired);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [repaired]);
  return null;
};

interface PhoneInputFieldProps {
  label: string;
  name: string;
  placeholder: string;
  // eslint-disable-next-line
  control: any;
  disabled?: boolean;
  country?: string;
  required?: boolean;
  value?: string;
  onChange?: (value: string) => void;
  /**
   * Typography overrides so the field can match the label/input sizing of the
   * form it sits in (public forms use `text-subtitle` labels + large inputs,
   * while the default here stays the compact design-system sizing).
   */
  labelClassName?: string;
  inputClassName?: string;
  /**
   * Country-aware validation is on by default. It only takes effect on forms
   * that do NOT use a zodResolver (RHF ignores field rules when a resolver is
   * set — those forms validate via their schema instead). Pass `false` to opt out.
   */
  validate?: boolean;
}

const PhoneInputField: React.FC<PhoneInputFieldProps> = ({
  label,
  name,
  placeholder,
  control,
  disabled = false,
  country,
  required = false,
  value,
  onChange,
  validate = true,
  labelClassName,
  inputClassName,
}) => {
  // Watched at component level (the Controller below only re-runs its own
  // render prop) purely so the `freeze` flag is current when a late preference
  // arrives — see the second rule in `usePreferredPhoneCountries`.
  const watchedValue = useWatch({ control: control as Control, name });

  // Read institute-configured preferred countries from domain routing cache.
  // First entry becomes the default selected country; the full list is used
  // to order options in the country picker dropdown. An explicit `country`
  // prop still wins for intentional callers.
  //
  // The hook (rather than a memoized one-shot read) is what lets a form that
  // rendered before domain routing answered still land on the right country —
  // on a slow connection the field used to mount first and stay on the platform
  // fallback, showing +91 to a visitor in any country. It takes the institute's
  // answer whenever it lands, and never once this field holds a number.
  const currentValue = value || (watchedValue as string | undefined);
  const { defaultCountry, preferredCountries } = usePreferredPhoneCountries({
    freeze: phoneFieldHasInput(currentValue),
  });
  const effectiveCountry = country ?? defaultCountry;

  return (
    <FormField
      control={control as Control}
      name={name}
      rules={validate ? { validate: phoneValidateRule({ required, label }) } : undefined}
      render={({ field }) => {
        const rawValue = (value || field.value) as string | undefined;
        const displayValue = normalizeStoredPhone(rawValue, effectiveCountry);
        return (
        <FormItem className="!w-full">
          <RepairStoredPhone
            repaired={repairedStoredPhone(rawValue, effectiveCountry)}
            onRepair={(repaired) => {
              field.onChange(repaired);
              if (onChange) onChange(repaired);
            }}
          />
          <FormLabel className={labelClassName}>
            {label}
            {required && <span className="text-danger-600"> *</span>}
          </FormLabel>
          <FormControl>
            <PhoneInput
              {...field}
              country={effectiveCountry}
              enableSearch={true}
              placeholder={placeholder}
              onChange={(val) => {
                // Ensure the value includes the country code with + prefix
                const formattedValue = val.startsWith("+") ? val : `+${val}`;
                field.onChange(formattedValue);
                if (onChange) onChange(formattedValue);
              }}
              inputClass={cn(
                "!w-full h-10 !rounded-md !border-input",
                inputClassName
              )}
              buttonClass="!rounded-s-md !border-input"
              disabled={disabled}
              value={displayValue}
              countryCodeEditable={false}
              enableAreaCodes={false}
              disableCountryGuess={false}
              preferredCountries={preferredCountries}
            />
          </FormControl>
          <FormMessage />
        </FormItem>
        );
      }}
    />
  );
};

export default PhoneInputField;
