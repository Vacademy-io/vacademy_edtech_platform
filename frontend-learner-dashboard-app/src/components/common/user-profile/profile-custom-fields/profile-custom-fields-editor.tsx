import { useTranslation } from "react-i18next";
import { IdentificationCard } from "@phosphor-icons/react";
import { Label } from "@/components/ui/label";
import { CustomFieldRenderer } from "@/components/common/custom-fields/CustomFieldRenderer";
import { CustomFieldValueDisplay } from "@/components/common/custom-fields/CustomFieldValueDisplay";
import { FieldRenderType } from "@/components/common/enroll-by-invite/-utils/custom-field-helpers";
import { cn } from "@/lib/utils";
import {
  hasProfileValue,
  isProfileFieldEditable,
  resolveProfileFieldControl,
  type LearnerProfileCustomField,
} from "./profile-custom-fields-utils";

interface ProfileCustomFieldsEditorProps {
  fields: LearnerProfileCustomField[];
  /** Values the learner has typed, by field id; untouched fields show their stored value. */
  edits: Record<string, string>;
  errors: Record<string, string>;
  onChange: (customFieldId: string, value: string) => void;
  disabled?: boolean;
}

/**
 * "Additional Details" section of Edit Profile: every custom field on the learner's profile
 * (filled or not), each rendered as its configured type. The parent form owns the values and
 * saves only the ones that changed. A field the institute locked (it drives invoice numbering
 * or a system field) is shown read-only, and left out when it has no value.
 */
export function ProfileCustomFieldsEditor({
  fields,
  edits,
  errors,
  onChange,
  disabled = false,
}: ProfileCustomFieldsEditorProps) {
  const { t } = useTranslation("userProfileExtra");

  const visibleFields = fields.filter(
    (field) => isProfileFieldEditable(field) || hasProfileValue(field.value)
  );
  if (visibleFields.length === 0) return null;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 border-b pb-2 text-lg font-semibold text-foreground">
        <IdentificationCard size={20} className="text-primary-500" weight="bold" />
        <h3>{t("profileCustomFields.title")}</h3>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {visibleFields.map((field) => {
          const id = field.custom_field_id;
          if (!isProfileFieldEditable(field)) {
            return (
              <div key={id} className="min-w-0 space-y-2">
                <Label className="text-xs font-medium uppercase text-muted-foreground">
                  {field.field_name}
                </Label>
                <CustomFieldValueDisplay
                  value={field.value}
                  fieldType={field.field_type}
                  className="block text-sm font-medium text-foreground"
                />
                <p className="text-xs text-muted-foreground">
                  {t("profileCustomFields.lockedHint")}
                </p>
              </div>
            );
          }
          const control = resolveProfileFieldControl(field);
          const error = errors[id];
          return (
            <div key={id} className="min-w-0 space-y-2">
              {/* A checkbox carries the field name as its own label. */}
              {control.type !== FieldRenderType.CHECKBOX && (
                <Label className="text-xs font-medium uppercase text-muted-foreground">
                  {field.field_name}
                </Label>
              )}
              <div className={cn(error && "[&_input]:border-danger-400")}>
                <CustomFieldRenderer
                  type={control.type}
                  name={field.field_name}
                  value={id in edits ? edits[id] : (field.value ?? "")}
                  onChange={(value) => onChange(id, value)}
                  options={control.options}
                  config={field.config}
                  disabled={disabled}
                />
              </div>
              {error && <p className="text-xs text-danger-600">{error}</p>}
            </div>
          );
        })}
      </div>
    </div>
  );
}
