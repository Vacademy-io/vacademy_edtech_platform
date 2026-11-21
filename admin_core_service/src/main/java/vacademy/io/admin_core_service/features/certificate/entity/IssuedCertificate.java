package vacademy.io.admin_core_service.features.certificate.entity;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import jakarta.persistence.Temporal;
import jakarta.persistence.TemporalType;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;
import org.hibernate.annotations.CreationTimestamp;
import org.hibernate.annotations.UpdateTimestamp;

import java.util.Date;

@Entity
@Table(name = "issued_certificate")
@Data
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class IssuedCertificate {

    // Stable identifier embedded into the issued certificate via the
    // {{CERTIFICATE_ID}} placeholder. Generated on the server when a new
    // certificate is rendered.
    @Id
    @Column(name = "id", length = 36, nullable = false, updatable = false)
    private String id;

    // Mirror of `id` exposed under a self-documenting column name so SQL
    // reports / downstream consumers don't need to know that `id` is the
    // cert code. Always written alongside `id` at insert time — both come
    // from the same generateUniqueCertificateId() call so they stay 1:1.
    @Column(name = "certificate_id", length = 36, nullable = false, updatable = false)
    private String certificateId;

    @Column(name = "institute_id", length = 255, nullable = false)
    private String instituteId;

    @Column(name = "user_id", length = 255, nullable = false)
    private String userId;

    @Column(name = "package_session_id", length = 255, nullable = false)
    private String packageSessionId;

    @Column(name = "course_name", length = 500)
    private String courseName;

    @Column(name = "completion_percentage")
    private Integer completionPercentage;

    @Temporal(TemporalType.TIMESTAMP)
    @Column(name = "issued_at", nullable = false)
    private Date issuedAt;

    // S3 / MediaService file id of the rendered PDF.
    @Column(name = "file_id", length = 255)
    private String fileId;

    // Random, unguessable companion to certificateId, required by the public
    // verification endpoint. Certificate numbers are sequential by design, so a
    // public lookup keyed on the number alone would let anyone holding one
    // certificate enumerate every learner in the institute. Null on certificates
    // issued before verification existed; those cannot be verified publicly.
    @Column(name = "verification_token", length = 64)
    private String verificationToken;

    // The barcode's credential. Same job as verificationToken, but short enough
    // that `<number>*<code>` fits in a Code 128 barcode that still scans at a
    // sane print width — the full token would need a barcode ~76mm wide. 50 bits
    // rather than 128, which is fine because the endpoint gives no oracle: a
    // wrong code and an unknown number return the identical 404.
    // Null on certificates issued before short codes existed; their barcodes
    // encode the bare number and cannot verify. Re-issuing mints one.
    @Column(name = "short_code", length = 16)
    private String shortCode;

    /**
     * Which kind of certificate this is — {@code COURSE_COMPLETION} (the default, and what every
     * row before the column existed is) or {@code SUB_ORG_AFFILIATION}. Lets one learner hold a
     * course certificate and, as a partner admin, an affiliation certificate on the same batch
     * without the two sharing a number.
     */
    @Column(name = "certificate_type")
    private String certificateType;

    // Captures the exact HTML used so the same PDF can be reproduced even after
    // the institute edits its template later.
    @Column(name = "template_html_snapshot", columnDefinition = "TEXT")
    private String templateHtmlSnapshot;

    @CreationTimestamp
    @Temporal(TemporalType.TIMESTAMP)
    @Column(name = "created_at", updatable = false)
    private Date createdAt;

    @UpdateTimestamp
    @Temporal(TemporalType.TIMESTAMP)
    @Column(name = "updated_at")
    private Date updatedAt;
}
