package vacademy.io.admin_core_service.features.points_ledger.entity;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;
import org.hibernate.annotations.UuidGenerator;

import java.sql.Timestamp;

/**
 * One append-only points award. See V512 for the full rationale.
 *
 * NEVER update or delete a row — a correction is a compensating row with negative
 * points (see {@code PointsLedgerService.reverse}). The entity deliberately exposes
 * no setter-driven update path beyond construction for that reason.
 */
@Entity
@Table(name = "points_ledger")
@Getter
@Setter
@NoArgsConstructor
public class PointsLedger {

    @Id
    @UuidGenerator
    private String id;

    @Column(name = "user_id", nullable = false)
    private String userId;

    @Column(name = "institute_id", nullable = false)
    private String instituteId;

    /** NULL for institute-wide awards not attributable to one batch. */
    @Column(name = "package_session_id")
    private String packageSessionId;

    @Column(name = "source_type", nullable = false)
    private String sourceType;

    /** Soft pointer into the source system; no FK, sources live in other services. */
    @Column(name = "source_id")
    private String sourceId;

    /** Signed — negative reverses an earlier award. */
    @Column(name = "points", nullable = false)
    private Integer points;

    @Column(name = "reason")
    private String reason;

    @Column(name = "awarded_at")
    private Timestamp awardedAt;

    /** Unique. The at-most-once guard against double-awarding on a retried submit. */
    @Column(name = "idempotency_key", nullable = false, updatable = false)
    private String idempotencyKey;

    @Column(name = "created_at", insertable = false, updatable = false)
    private Timestamp createdAt;
}
