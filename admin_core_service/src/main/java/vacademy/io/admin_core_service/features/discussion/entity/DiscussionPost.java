package vacademy.io.admin_core_service.features.discussion.entity;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.PrePersist;
import jakarta.persistence.PreUpdate;
import jakarta.persistence.Table;
import lombok.Getter;
import lombok.Setter;

import java.sql.Timestamp;
import java.util.UUID;

/** A response to a discussion slide's question, or a comment under one. See V670__discussion_forum.sql. */
@Entity
@Table(name = "discussion_post")
@Getter
@Setter
public class DiscussionPost {

    public static final String STATUS_PUBLISHED = "PUBLISHED";
    public static final String STATUS_PENDING = "PENDING";
    public static final String STATUS_HIDDEN = "HIDDEN";
    public static final String STATUS_DELETED = "DELETED";

    public static final String ROLE_LEARNER = "LEARNER";
    public static final String ROLE_STAFF = "STAFF";

    @Id
    @Column(name = "id")
    private String id;

    @Column(name = "slide_id")
    private String slideId;

    @Column(name = "institute_id")
    private String instituteId;

    @Column(name = "package_session_id")
    private String packageSessionId;

    @Column(name = "parent_id")
    private String parentId;

    @Column(name = "user_id")
    private String userId;

    @Column(name = "author_name")
    private String authorName;

    @Column(name = "author_role")
    private String authorRole;

    @Column(name = "is_anonymous")
    private boolean anonymous;

    @Column(name = "content", columnDefinition = "TEXT")
    private String content;

    @Column(name = "status")
    private String status;

    @Column(name = "is_pinned")
    private boolean pinned;

    @Column(name = "report_count")
    private int reportCount;

    @Column(name = "edited_at")
    private Timestamp editedAt;

    @Column(name = "moderated_by")
    private String moderatedBy;

    @Column(name = "moderated_at")
    private Timestamp moderatedAt;

    @Column(name = "created_at")
    private Timestamp createdAt;

    @Column(name = "updated_at")
    private Timestamp updatedAt;

    @PrePersist
    void onCreate() {
        if (id == null) {
            id = UUID.randomUUID().toString();
        }
        Timestamp now = new Timestamp(System.currentTimeMillis());
        createdAt = now;
        updatedAt = now;
    }

    @PreUpdate
    void onUpdate() {
        updatedAt = new Timestamp(System.currentTimeMillis());
    }

    public boolean isRoot() {
        return parentId == null;
    }

    public boolean isStaffPost() {
        return ROLE_STAFF.equals(authorRole);
    }
}
