package vacademy.io.admin_core_service.features.commerce.order.entity;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;
import org.hibernate.annotations.UuidGenerator;

import java.time.LocalDateTime;

/** One step of an order's timeline. Append-only: no column is ever updated. */
@Getter
@Setter
@NoArgsConstructor
@Entity
@Table(name = "commerce_order_status_history")
public class CommerceOrderStatusHistory {

    @Id
    @UuidGenerator
    @Column(name = "id", length = 36)
    private String id;

    @Column(name = "institute_id", nullable = false, updatable = false, length = 36)
    private String instituteId;

    @Column(name = "order_id", nullable = false, updatable = false, length = 36)
    private String orderId;

    @Column(name = "from_status", updatable = false, length = 32)
    private String fromStatus;

    @Column(name = "to_status", nullable = false, updatable = false, length = 32)
    private String toStatus;

    @Column(name = "actor_user_id", updatable = false, length = 36)
    private String actorUserId;

    @Column(name = "note", updatable = false, length = 500)
    private String note;

    @Column(name = "created_at", insertable = false, updatable = false)
    private LocalDateTime createdAt;
}
