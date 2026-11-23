package vacademy.io.admin_core_service.features.commerce.pos.entity;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Table;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;
import vacademy.io.admin_core_service.features.commerce.catalogue.entity.CommerceCatalogueEntity;

import java.math.BigDecimal;
import java.time.LocalDate;

/** Cash put into or taken out of a session's drawer. A correction is an opposite movement. */
@Getter
@Setter
@NoArgsConstructor
@Entity
@Table(name = "pos_cash_movement")
public class PosCashMovement extends CommerceCatalogueEntity {

    @Column(name = "session_id", nullable = false, updatable = false, length = 36)
    private String sessionId;

    @Column(name = "type", nullable = false, updatable = false, length = 16)
    private String type;

    @Column(name = "amount", nullable = false, updatable = false, precision = 12, scale = 2)
    private BigDecimal amount;

    @Column(name = "reason", nullable = false, updatable = false, length = 200)
    private String reason;

    @Column(name = "actor_user_id", nullable = false, updatable = false, length = 36)
    private String actorUserId;

    @Column(name = "reference_type", nullable = false, length = 32)
    private String referenceType = "NONE";

    @Column(name = "reference_id", length = 36)
    private String referenceId;

    @Column(name = "document_date")
    private LocalDate documentDate;

    @Column(name = "review_status", nullable = false, length = 16)
    private String reviewStatus = "NONE";

    @Column(name = "client_request_id", updatable = false, length = 64)
    private String clientRequestId;
}
