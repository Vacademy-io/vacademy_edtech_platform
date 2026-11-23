package vacademy.io.admin_core_service.features.commerce.pos.entity;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

import java.time.LocalDateTime;

/**
 * The one "walk-in customer" auth user of an institute. Written once by
 * {@code CommercePosWalkInRepository.insertIfMissing} and never changed, so the table has no
 * {@code updated_at} and the entity does not extend the commerce base class.
 */
@Getter
@Setter
@NoArgsConstructor
@Entity
@Table(name = "commerce_pos_walk_in")
public class CommercePosWalkIn {

    @Id
    @Column(name = "id", length = 36)
    private String id;

    @Column(name = "institute_id", nullable = false, updatable = false, length = 36)
    private String instituteId;

    @Column(name = "user_id", nullable = false, updatable = false, length = 36)
    private String userId;

    @Column(name = "created_at", insertable = false, updatable = false)
    private LocalDateTime createdAt;
}
