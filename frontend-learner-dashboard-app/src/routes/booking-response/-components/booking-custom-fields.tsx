import type { Control } from "react-hook-form";
import { FormControl, FormField, FormItem, FormMessage } from "@/components/ui/form";
import PhoneInputField from "@/components/design-system/phone-input-field";
import {
  FieldRenderType,
  getFieldRenderType,
} from "@/components/common/enroll-by-invite/-utils/custom-field-helpers";
import { CustomFieldRenderer } from "@/components/common/custom-fields/CustomFieldRenderer";
import { capitalise } from "@/utils/custom-field";
import { AssessmentCustomFieldOpenRegistration } from "@/types/assessment-open-registration";
import { useTranslation } from "react-i18next";

interface BookingCustomFieldsProps {
  formFields: AssessmentCustomFieldOpenRegistration[];
  // eslint-disable-next-line
  control: Control<any>;
}

/**
 * Renders the booking page's campaign custom fields inside the details form,
 * mirroring the audience-response form's rendering (shared
 * CustomFieldRenderer for text/number/email/url/date/textarea/checkbox/radio/
 * dropdown/file, specialized PhoneInputField for phone-type fields). Values
 * live under the `custom.<field_key>.value` form paths.
 */
const BookingCustomFields = ({
  formFields,
  control,
}: BookingCustomFieldsProps) => {
  const { t } = useTranslation("liveClassGuest");

  return (
    <>
      {formFields.map((field) => {
        const name = `custom.${field.field_key}.value`;
        const renderType = getFieldRenderType(
          field.field_key,
          field.field_type || "text"
        );

        if (renderType === FieldRenderType.PHONE) {
          return (
            <FormField
              key={field.field_key}
              control={control}
              name={name}
              render={() => (
                <FormItem>
                  <FormControl>
                    <PhoneInputField
                      label={capitalise(field.field_name)}
                      placeholder={t("common.phoneExamplePlaceholder")}
                      name={name}
                      control={control}
                      required={field.is_mandatory}
                      labelClassName="text-subtitle font-regular"
                      inputClassName="!text-subtitle placeholder:!text-body"
                    />
                  </FormControl>
                </FormItem>
              )}
            />
          );
        }

        return (
          <FormField
            key={field.field_key}
            control={control}
            name={name}
            render={({ field: formField }) => (
              <FormItem>
                <div className="flex flex-col gap-1">
                  <label className="text-subtitle font-regular">
                    {capitalise(field.field_name)}
                    {field.is_mandatory && (
                      <span className="text-danger-600"> *</span>
                    )}
                  </label>
                  <FormControl>
                    <CustomFieldRenderer
                      type={renderType}
                      name={field.field_name}
                      value={formField.value || ""}
                      onChange={(val) => formField.onChange(val)}
                      config={field.config}
                      required={field.is_mandatory}
                    />
                  </FormControl>
                  <FormMessage />
                </div>
              </FormItem>
            )}
          />
        );
      })}
    </>
  );
};

export default BookingCustomFields;
