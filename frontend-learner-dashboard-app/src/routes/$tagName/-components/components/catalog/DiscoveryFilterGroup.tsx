import React, { useId } from "react";
import { cn } from "@/lib/utils";

export interface DiscoveryFilterOption {
  value: string;
  label: string;
  /** Live count; undefined when counts are off. */
  count?: number;
  /** Shown after the label, e.g. "Soon". */
  note?: string;
}

/**
 * One sidebar filter group of the Courses page — checkboxes (OR within the
 * group) or, for single-choice groups like Price, radios with an "Any"
 * option. With counts on, an option that would empty the grid is disabled
 * unless it is already selected (so it can still be switched off).
 */
export const DiscoveryFilterGroup: React.FC<{
  title: string;
  options: DiscoveryFilterOption[];
  selected: string[];
  mode: "multi" | "single";
  onToggle: (value: string) => void;
  /** Single mode: label of the "no choice" radio. */
  anyLabel?: string;
  onClear?: () => void;
}> = ({ title, options, selected, mode, onToggle, anyLabel, onClear }) => {
  const name = useId();
  if (!options.length) return null;

  const row = (
    key: string,
    label: string,
    checked: boolean,
    onChange: () => void,
    count?: number,
    note?: string,
  ) => {
    const disabled = count === 0 && !checked;
    return (
      <label
        key={key}
        className={cn(
          "flex items-center text-catalogue-text-secondary transition-colors",
          disabled ? "cursor-not-allowed opacity-50" : "cursor-pointer hover:text-catalogue-text-primary",
        )}
      >
        <input
          type={mode === "single" ? "radio" : "checkbox"}
          name={mode === "single" ? name : undefined}
          className={cn(
            "h-3.5 w-3.5 shrink-0 border-catalogue-border text-primary-500 focus:ring-primary-400 me-2",
            mode === "single" ? "form-radio" : "form-checkbox rounded-catalogue-xs",
          )}
          checked={checked}
          disabled={disabled}
          onChange={onChange}
        />
        <span className="min-w-0 flex-1 truncate text-sm">
          {label}
          {note && <span className="ms-1.5 text-xs text-catalogue-text-muted">· {note}</span>}
        </span>
        {count !== undefined && (
          <span className="ps-2 text-xs tabular-nums text-catalogue-text-muted">{count}</span>
        )}
      </label>
    );
  };

  return (
    <div className="mb-5">
      <h3 className="mb-2.5 text-sm font-semibold text-catalogue-text-primary">{title}</h3>
      <div className="space-y-1.5" role={mode === "single" ? "radiogroup" : "group"} aria-label={title}>
        {mode === "single" &&
          anyLabel &&
          row("__any__", anyLabel, selected.length === 0, () => onClear?.())}
        {options.map((o) =>
          row(
            o.value,
            o.label,
            selected.includes(o.value),
            () => onToggle(o.value),
            o.count,
            o.note,
          ),
        )}
      </div>
    </div>
  );
};
