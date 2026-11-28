package vacademy.io.admin_core_service.features.certificate.dto;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

/**
 * Per-course certificate override, stored in {@code package.course_setting} under
 * the {@code CERTIFICATE_SETTING} key via the existing {@code PackageSettingService}.
 *
 * <p>Every field is nullable and every null means "inherit the institute default".
 * That is what lets an institute keep certificates off globally while switching a
 * single course on — the requirement that motivated the whole redesign.
 */
@Setter
@Getter
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class CourseCertificateSettingDto {

    /**
     * Tri-state on purpose. {@code TRUE} forces certificates on for this course
     * even when the institute default is off; {@code FALSE} forces them off even
     * when the institute is on; {@code null} inherits.
     */
    private Boolean enabled;

    /** Completion percentage required for this course. Null inherits. */
    private Integer thresholdPercent;

    /**
     * Which of the institute's saved certificate designs this course uses.
     *
     * <p>An id rather than a copy of the design, deliberately. A course that
     * stores its own {@link #templateHtml} freezes whatever the template looked
     * like the day it was chosen: fix a typo on the institute template
     * afterwards and every course that copied it keeps printing the typo. An id
     * is resolved at issuance, so a course follows the design it points at.
     *
     * <p>Null inherits the institute's default design.
     */
    private String templateId;

    /**
     * Course-specific template HTML, used verbatim. Null inherits.
     *
     * <p>Still supported for a course that uploads finished HTML of its own —
     * that design exists nowhere else, so there is nothing to point at. When
     * both are set, {@link #templateId} wins: it is the newer choice, and the
     * admin UI clears this field when one is picked.
     */
    private String templateHtml;

    /**
     * What a learner must do to earn the certificate: course progress (the
     * default), marks in chosen quizzes/assessments, or both. Null keeps the
     * progress-only rule every course had before.
     */
    private CertificateCriteriaDto criteria;

    // Certificate numbering is deliberately NOT overridable per course. The
    // format is an institute-wide setting so numbers stay consistent and the
    // per-institute sequence remains the single allocator.
}
