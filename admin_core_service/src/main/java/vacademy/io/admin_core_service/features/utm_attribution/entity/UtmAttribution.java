package vacademy.io.admin_core_service.features.utm_attribution.entity;

import jakarta.persistence.*;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;
import org.hibernate.annotations.UuidGenerator;

import java.sql.Timestamp;

/**
 * One campaign touch, tied to the person it produced.
 *
 * Written only on a SUCCESSFUL submission — a form sent, a session registered
 * for, an assessment joined, an enrolment completed. A visit that never
 * converts is anonymous traffic and belongs in {@code catalogue_page_event},
 * which is deliberately un-joinable to a person; this table is the opposite
 * trade, and exists so the counsellor looking at a learner can see the campaign
 * that produced them rather than only a total in someone else's analytics tool.
 */
@Entity
@Table(name = "utm_attribution")
@Data
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class UtmAttribution {

    @Id
    @UuidGenerator
    @Column(name = "id", nullable = false, unique = true)
    private String id;

    @Column(name = "institute_id", nullable = false, length = 36)
    private String instituteId;

    /**
     * Nullable: a couple of capture surfaces only learn the created user id on a
     * second call. The row is still worth keeping — {@code email}/
     * {@code mobileNumber} let it be matched to the person afterwards.
     */
    @Column(name = "user_id")
    private String userId;

    @Column(name = "email")
    private String email;

    @Column(name = "mobile_number", length = 32)
    private String mobileNumber;

    /** AUDIENCE | LIVE_SESSION | ASSESSMENT | ENROLL_INVITE | PRODUCT_PAGE | CATALOGUE */
    @Column(name = "source_type", nullable = false, length = 32)
    private String sourceType;

    /** The campaign / session / assessment / invite / page the link pointed at. */
    @Column(name = "source_id")
    private String sourceId;

    @Column(name = "utm_source", length = 128)
    private String utmSource;

    @Column(name = "utm_medium", length = 128)
    private String utmMedium;

    @Column(name = "utm_campaign", length = 191)
    private String utmCampaign;

    @Column(name = "utm_content", length = 191)
    private String utmContent;

    @Column(name = "utm_term", length = 191)
    private String utmTerm;

    /** Host only — a referring path can carry PII in its query string. */
    @Column(name = "referrer_host", length = 255)
    private String referrerHost;

    /** Path only, query stripped: which page of ours they landed on. */
    @Column(name = "landing_path", length = 512)
    private String landingPath;

    @Column(name = "created_at", insertable = false, updatable = false)
    private Timestamp createdAt;
}
