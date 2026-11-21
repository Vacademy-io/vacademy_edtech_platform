package vacademy.io.admin_core_service.features.commerce.stock.entity;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Table;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;
import vacademy.io.admin_core_service.features.commerce.catalogue.entity.CommerceCatalogueEntity;

import java.time.LocalDateTime;

/**
 * What was counted (V730). Written by the native upserts of {@code StockCountLineRepository} only;
 * {@code counted_at} is database time, compared with {@code stock_movement.created_at} at post.
 */
@Getter
@Setter
@NoArgsConstructor
@Entity
@Table(name = "stock_count_line")
public class StockCountLine extends CommerceCatalogueEntity {

    @Column(name = "count_id", nullable = false, updatable = false, length = 36)
    private String countId;

    @Column(name = "package_session_id", nullable = false, updatable = false)
    private String packageSessionId;

    @Column(name = "piece_id", updatable = false, length = 36)
    private String pieceId;

    @Column(name = "counted_qty", nullable = false, updatable = false)
    private Integer countedQty;

    @Column(name = "counted_at", nullable = false, updatable = false)
    private LocalDateTime countedAt;

    /** Database time of the first save of the line; a SET starts it again, an ADD keeps it. */
    @Column(name = "first_counted_at", nullable = false, updatable = false)
    private LocalDateTime firstCountedAt;

    @Column(name = "counted_by", updatable = false, length = 36)
    private String countedBy;

    /** A manager accepted a line whose stock moved while it was counted; cleared by any later save. */
    @Column(name = "accepted_by", updatable = false, length = 36)
    private String acceptedBy;

    @Column(name = "accepted_at", updatable = false)
    private LocalDateTime acceptedAt;

    @Column(name = "on_hand_at_post", updatable = false)
    private Integer onHandAtPost;

    @Column(name = "moved_since", updatable = false)
    private Integer movedSince;

    @Column(name = "packed_unshipped", updatable = false)
    private Integer packedUnshipped;

    @Column(name = "adjustment", updatable = false)
    private Integer adjustment;

    @Column(name = "movement_id", updatable = false, length = 36)
    private String movementId;
}
