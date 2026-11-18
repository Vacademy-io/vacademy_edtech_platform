package vacademy.io.admin_core_service.features.commerce.stock.entity;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Table;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;
import org.hibernate.annotations.DynamicUpdate;
import org.hibernate.annotations.Generated;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.generator.EventType;
import org.hibernate.type.SqlTypes;
import vacademy.io.admin_core_service.features.commerce.catalogue.entity.CommerceCatalogueEntity;

import java.time.LocalDateTime;

/**
 * A physical count of one location, or of one collection there (V730). kind RECOUNT is a blind
 * second count by another person; it posts no movement and is compared with the count it rechecks.
 */
@Getter
@Setter
@NoArgsConstructor
@Entity
@DynamicUpdate
@Table(name = "stock_count")
public class StockCount extends CommerceCatalogueEntity {

    @Column(name = "count_number", nullable = false, updatable = false, length = 32)
    private String countNumber;

    @Column(name = "location_id", nullable = false, updatable = false, length = 36)
    private String locationId;

    @Column(name = "scope_collection_id", updatable = false, length = 36)
    private String scopeCollectionId;

    @Column(name = "kind", nullable = false, updatable = false, length = 16)
    private String kind;

    @Column(name = "recount_of_count_id", updatable = false, length = 36)
    private String recountOfCountId;

    @Column(name = "status", nullable = false, length = 16)
    private String status;

    @Column(name = "note", length = 500)
    private String note;

    @Column(name = "started_by", nullable = false, updatable = false, length = 36)
    private String startedBy;

    /** Database time of the insert (default), like stock_movement.created_at; read back after the insert. */
    @Generated(event = EventType.INSERT)
    @Column(name = "started_at", insertable = false, updatable = false)
    private LocalDateTime startedAt;

    @Column(name = "posted_at")
    private LocalDateTime postedAt;

    @Column(name = "posted_by", length = 36)
    private String postedBy;

    @Column(name = "uncounted_choice", length = 8)
    private String uncountedChoice;

    @JdbcTypeCode(SqlTypes.JSON)
    @Column(name = "summary_json", columnDefinition = "jsonb")
    private String summaryJson;

    @Column(name = "cancelled_at")
    private LocalDateTime cancelledAt;

    @Column(name = "cancelled_by", length = 36)
    private String cancelledBy;

    @Column(name = "client_request_id", updatable = false, length = 64)
    private String clientRequestId;

    @Column(name = "request_hash", updatable = false, length = 64)
    private String requestHash;
}
