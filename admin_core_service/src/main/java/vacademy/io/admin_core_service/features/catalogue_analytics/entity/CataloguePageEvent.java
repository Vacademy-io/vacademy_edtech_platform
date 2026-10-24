package vacademy.io.admin_core_service.features.catalogue_analytics.entity;

import jakarta.persistence.*;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;
import org.hibernate.annotations.UuidGenerator;

import java.sql.Timestamp;

/**
 * One recorded interaction with a catalogue (page-builder) site.
 *
 * Catalogue sites fire GA4/Meta events but recorded nothing here, so an admin
 * could only see traffic inside a Google property they usually had not
 * connected — while the LEADS those visits produced sat in our own database.
 * The two halves of the funnel were on opposite sides of a boundary we could
 * not join. This is the missing half.
 *
 * Contains no PII by construction: no cookies, no raw IP, no full referring
 * URL. See visitorHash.
 */
@Entity
@Table(name = "catalogue_page_event")
@Data
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class CataloguePageEvent {

    @Id
    @UuidGenerator
    @Column(name = "id", nullable = false, unique = true)
    private String id;

    @Column(name = "institute_id", nullable = false, length = 36)
    private String instituteId;

    @Column(name = "catalogue_id", length = 36)
    private String catalogueId;

    /** '' is the site root; otherwise the page's route slug. */
    @Column(name = "page_route", nullable = false, length = 255)
    private String pageRoute;

    /** VIEW today. CTA/LEAD reserved so click tracking needs no new table. */
    @Column(name = "event_type", nullable = false, length = 32)
    private String eventType;

    /**
     * Salted hash of IP + user-agent that ROTATES DAILY. Enough for "unique
     * visitors today", deliberately useless for following someone across days
     * — the salt changes, so yesterday's hash cannot be matched to today's.
     */
    @Column(name = "visitor_hash", length = 64)
    private String visitorHash;

    /** Client-generated per browsing session; no persistent identifier. */
    @Column(name = "session_id", length = 64)
    private String sessionId;

    /** Host only. A referring PATH can carry PII in its query string. */
    @Column(name = "referrer_host", length = 255)
    private String referrerHost;

    @Column(name = "utm_source", length = 128)
    private String utmSource;

    @Column(name = "utm_medium", length = 128)
    private String utmMedium;

    @Column(name = "utm_campaign", length = 191)
    private String utmCampaign;

    @Column(name = "device", length = 16)
    private String device;

    @Column(name = "created_at", insertable = false, updatable = false)
    private Timestamp createdAt;
}
