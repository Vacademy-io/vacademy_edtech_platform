package vacademy.io.admin_core_service.features.certificate.dto;

import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

/**
 * The certificate configuration a learner client needs for one batch.
 *
 * <p>Replaces the learner app reading {@code STUDENT_DISPLAY_SETTINGS.certificates},
 * which was a second, unrelated copy of the enable flag and threshold. Both now
 * come from Certificate Settings via {@code CertificateSettingsResolver}, so the
 * client cannot disagree with the server about whether a certificate is due.
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
@JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
public class LearnerCertificateConfigDto {

    /** After course-override resolution. False means never call the issue endpoint. */
    private boolean enabled;

    /** Completion percentage at which a certificate becomes due. */
    private int thresholdPercent;

    /**
     * PROGRESS | SCORE | PROGRESS_AND_SCORE. Anything but PROGRESS means the client
     * cannot judge eligibility from progress alone and must ask the eligibility
     * endpoint, which grades the learner's tests server-side.
     */
    private String criteriaMode;

    /**
     * The calling learner already holds this batch's certificate. The client then asks for
     * it whatever the rule says now - an issued certificate is never taken away, and the
     * issue endpoint returns an existing one without re-checking the rule.
     */
    private boolean certificateIssued;
}
