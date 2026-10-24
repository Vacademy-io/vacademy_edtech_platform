package vacademy.io.admin_core_service.features.doubts.entity;

import jakarta.persistence.*;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;
import org.hibernate.annotations.UuidGenerator;

import java.util.Date;
import java.util.List;

@Entity
@Table(name = "doubts")
@Data
@Builder
@AllArgsConstructor
@NoArgsConstructor
public class Doubts {
    @Id
    @UuidGenerator
    @Column(name = "id")
    private String id;

    @Column(name = "user_id")
    private String userId;

    @Column(name = "source")
    private String source;

    @Column(name = "source_id")
    private String sourceId;

    /**
     * Configurable query type key (e.g. DOUBT, TECHNICAL, PAYMENT). Defaults to DOUBT for legacy
     * rows. The label/order/routing for each key lives in DOUBT_MANAGEMENT_SETTING.queryTypes.
     */
    @Column(name = "type")
    private String type;

    /**
     * Owning institute. For SLIDE doubts this is derivable from package_session_id, but GENERAL
     * queries may have no batch — so the institute is stored directly to scope the admin inbox and
     * resolve notification/routing settings.
     */
    @Column(name = "institute_id")
    private String instituteId;

    /**
     * Contact for logged-out ("guest") queries — set only when user_id is null. Reply/resolved
     * notifications are emailed directly to guest_email (guests have no auth_service account).
     */
    @Column(name = "guest_name")
    private String guestName;

    @Column(name = "guest_email")
    private String guestEmail;

    @Column(name = "raised_time")
    private Date raisedTime;

    @Column(name = "resolved_time")
    private Date resolvedTime;

    @Column(name = "content_position")
    private String contentPosition;

    @Column(name = "content_type")
    private String contentType;

    @Column(name = "html_text")
    private String htmlText;

    @Column(name = "status")
    private String status;

    /**
     * Institute-configurable workflow status key (PENDING / RESOLVED built in; IN_PROGRESS etc. per
     * DOUBT_MANAGEMENT_SETTING.statuses). NULL on legacy rows — see
     * {@link vacademy.io.admin_core_service.features.doubts.service.DoubtStatusCatalog#effectiveKey}.
     * Kept in step with the coarse {@link #status}: a RESOLVED-kind key ⇔ status RESOLVED.
     */
    @Column(name = "workflow_status")
    private String workflowStatus;

    @Column(name = "parent_id")
    private String parentId;

    @Column(name = "parent_level")
    private Integer parentLevel;

    @Column(name = "package_session_id")
    private String packageSessionId;

    @Column(name = "created_at", insertable = false, updatable = false)
    private Date createdAt;

    @Column(name = "updated_at", insertable = false, updatable = false)
    private Date updatedAt;

    @OneToMany(mappedBy = "doubts", cascade = CascadeType.ALL, orphanRemoval = true)
    private List<DoubtAssignee> assignees;
}
