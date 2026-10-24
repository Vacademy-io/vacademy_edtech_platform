package vacademy.io.admin_core_service.features.live_activity.entity;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.IdClass;
import jakarta.persistence.Table;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.io.Serializable;
import java.sql.Timestamp;

/** Per-user "unseen since" marker behind the sidebar badge. */
@Entity
@Table(name = "live_activity_seen")
@IdClass(LiveActivitySeen.Key.class)
@Data
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class LiveActivitySeen {

    @Id
    @Column(name = "user_id", nullable = false)
    private String userId;

    @Id
    @Column(name = "institute_id", nullable = false)
    private String instituteId;

    @Column(name = "last_seen_at", nullable = false)
    private Timestamp lastSeenAt;

    @Data
    @NoArgsConstructor
    @AllArgsConstructor
    public static class Key implements Serializable {
        private String userId;
        private String instituteId;
    }
}
