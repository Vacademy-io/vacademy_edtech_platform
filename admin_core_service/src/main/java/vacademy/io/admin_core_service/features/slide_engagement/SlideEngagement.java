package vacademy.io.admin_core_service.features.slide_engagement;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

import java.sql.Timestamp;

/** "Count as engagement" on one course slide (V731). */
@Entity
@Table(name = "slide_engagement")
@Getter
@Setter
@NoArgsConstructor
public class SlideEngagement {

    @Id
    @Column(name = "slide_id")
    private String slideId;

    @Column(name = "enabled", nullable = false)
    private boolean enabled;

    @Column(name = "points", nullable = false)
    private int points;

    @Column(name = "updated_by")
    private String updatedBy;

    @Column(name = "created_at", insertable = false, updatable = false)
    private Timestamp createdAt;

    @Column(name = "updated_at")
    private Timestamp updatedAt;
}
