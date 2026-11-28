import { useTranslation } from "react-i18next";
import { CustomFieldValueDisplay } from "@/components/common/custom-fields/CustomFieldValueDisplay";
import { useProfileCustomFields } from "./profile-custom-fields-service";
import { hasProfileValue } from "./profile-custom-fields-utils";

interface ProfileCustomFieldsCardProps {
  instituteId?: string | null;
}

/**
 * "Additional Details" on the learner's profile: the answers they gave on the enroll invite /
 * course purchase form and the values an admin filled in (School, College, Roll No…).
 *
 * Like the page's other detail cards, only filled rows render and the card hides when there is
 * none. It is a supplement to the page, so while loading or on a failed request it stays hidden
 * rather than putting a spinner or an error in the middle of the profile.
 */
export function ProfileCustomFieldsCard({ instituteId }: ProfileCustomFieldsCardProps) {
  const { t } = useTranslation("userProfileExtra");
  const { data } = useProfileCustomFields(instituteId);
  const filled = (data ?? []).filter((field) => hasProfileValue(field.value));

  if (filled.length === 0) return null;

  return (
    <div className="bg-card rounded-xl border shadow p-6 md:p-8 space-y-section">
      <h3 className="text-lg font-semibold text-foreground flex items-center gap-2">
        <span className="w-1 h-6 bg-primary-500 rounded-full"></span>
        {t("profileCustomFields.title")}
      </h3>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-2 xl:grid-cols-3 gap-section">
        {filled.map((field) => (
          <div key={field.custom_field_id} className="min-w-0 space-y-2">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
              {field.field_name}
            </p>
            <CustomFieldValueDisplay
              value={field.value}
              fieldType={field.field_type}
              className="text-base font-medium text-foreground"
            />
          </div>
        ))}
      </div>
    </div>
  );
}
