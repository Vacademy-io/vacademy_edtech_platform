package vacademy.io.admin_core_service.features.onboarding.dto;

import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

/**
 * One field's actual submitted value for a completed FORM step instance.
 *
 * <p>{@code fieldType} and {@code config} ride along so a read-only view can render the value AS
 * ITS TYPE instead of as a string: a `file` field's value is an uploaded file's URL, and printing
 * that raw leaves the viewer a URL to copy-paste rather than a file to open.
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
@JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
public class OnboardingSubmittedFieldDTO {
    private String instituteCustomFieldId;
    private String fieldName;
    /** custom_fields.field_type -- casing is whatever created the field, so compare case-insensitively. */
    private String fieldType;
    /** custom_fields.config JSON verbatim (dropdown options, file limits, ...). */
    private String config;
    private String value;
}
