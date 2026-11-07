package vacademy.io.admin_core_service.features.onboarding.dto;

import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

/**
 * One FORM step field, resolved for a specific caller role (ADMIN/STUDENT/PARENT): the field is
 * already filtered by view permission (a field the role can't view is simply absent from the
 * response, not sent with canView=false) and carries whether the caller may edit it, plus its
 * already-submitted value if any -- so the client can render editable / read-only fields
 * correctly instead of showing everything as an editable text input regardless of role.
 *
 * <p>{@code fieldType}/{@code config}/{@code defaultValue} are carried through from the backing
 * custom_fields row so a client can render the field AS ITS CONFIGURED TYPE (a dropdown's
 * options, a date picker, a phone input, a file upload...). Without them both apps could only
 * ever render a plain text box, which is what a dropdown/date/checkbox field used to degrade to
 * on every onboarding form.
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
@JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
public class OnboardingResolvedFieldDTO {
    private String instituteCustomFieldId;
    private String fieldName;
    /** custom_fields.field_type -- text/dropdown/number/email/url/date/phone/textarea/checkbox/radio/file/multi_select. */
    private String fieldType;
    /** custom_fields.config JSON verbatim (dropdown/radio options, min/max, allowedFileTypes, heading/description...). */
    private String config;
    private String defaultValue;
    private Integer fieldOrder;
    private Boolean isMandatory;
    private Boolean canEdit;
    private String value;
}
