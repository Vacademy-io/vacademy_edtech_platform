package vacademy.io.admin_core_service.features.enrollment_policy.dto;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import com.fasterxml.jackson.annotation.JsonInclude;
import lombok.Value;
import lombok.experimental.SuperBuilder;
import lombok.extern.jackson.Jacksonized;

import java.util.List;

/**
 * Serialized with NON_NULL so a package session with no policy configured comes
 * back as {@code {}} rather than five null keys. EnrollmentPolicyController
 * already returns an empty builder for that case ("Return empty policy instead
 * of null"), but with Spring Boot's default ALWAYS inclusion the learner enroll
 * form read the null-filled body as "a policy exists" and showed its
 * "Already Enrolled" dialog for every enrollment failure.
 *
 * Serialization-only: every other consumer of this DTO deserializes
 * (ObjectMapper.readValue on package_session.enrollment_policy_settings), and
 * that is unaffected. The single HTTP client is the learner enroll form.
 */
@Value
@Jacksonized
@SuperBuilder
@JsonIgnoreProperties(ignoreUnknown = true)
@JsonInclude(JsonInclude.Include.NON_NULL)
public class EnrollmentPolicySettingsDTO {
    OnExpiryPolicyDTO onExpiry;
    List<NotificationPolicyDTO> notifications;

    /**
     * Reenrollment policy with upgrade options.
     * upgradeOptions inside contains enrollment invite links for frontend display.
     */
    ReenrollmentPolicyDTO reenrollmentPolicy;

    OnEnrollmentPolicyDTO onEnrollment;

    /**
     * Workflow configuration with frontend actions.
     * frontendActions inside contains WhatsApp buttons and other interactive
     * elements.
     */
    WorkflowConfigDTO workflow;
}
