package vacademy.io.admin_core_service.features.discussion.entity;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.PrePersist;
import jakarta.persistence.Table;
import lombok.Getter;
import lombok.Setter;

import java.sql.Timestamp;
import java.util.UUID;

@Entity
@Table(name = "discussion_report")
@Getter
@Setter
public class DiscussionReport {

    @Id
    @Column(name = "id")
    private String id;

    @Column(name = "post_id")
    private String postId;

    @Column(name = "user_id")
    private String userId;

    @Column(name = "reason")
    private String reason;

    @Column(name = "created_at")
    private Timestamp createdAt;

    @PrePersist
    void onCreate() {
        if (id == null) {
            id = UUID.randomUUID().toString();
        }
        createdAt = new Timestamp(System.currentTimeMillis());
    }
}
