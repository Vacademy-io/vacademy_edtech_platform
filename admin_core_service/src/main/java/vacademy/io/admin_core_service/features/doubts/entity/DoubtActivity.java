package vacademy.io.admin_core_service.features.doubts.entity;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;
import org.hibernate.annotations.UuidGenerator;

import java.util.Date;

/**
 * One audit-trail row for a doubt: who assigned / un-assigned whom, who changed the status (and to
 * what), and remarks left along the way. {@code actorType=RULE} rows are the auto-assignments made
 * by the institute's routing config at creation time, with {@link #ruleSource} naming the rule.
 */
@Entity
@Table(name = "doubt_activity")
@Data
@Builder
@AllArgsConstructor
@NoArgsConstructor
public class DoubtActivity {
    @Id
    @UuidGenerator
    @Column(name = "id")
    private String id;

    @Column(name = "doubt_id")
    private String doubtId;

    /** {@link vacademy.io.admin_core_service.features.doubts.enums.DoubtActivityActionEnum#name()} */
    @Column(name = "action")
    private String action;

    /** {@link vacademy.io.admin_core_service.features.doubts.enums.DoubtActivityActorTypeEnum#name()} */
    @Column(name = "actor_type")
    private String actorType;

    @Column(name = "actor_user_id")
    private String actorUserId;

    @Column(name = "target_user_id")
    private String targetUserId;

    @Column(name = "from_value")
    private String fromValue;

    @Column(name = "to_value")
    private String toValue;

    @Column(name = "rule_source")
    private String ruleSource;

    @Column(name = "remark")
    private String remark;

    @Column(name = "created_at", insertable = false, updatable = false)
    private Date createdAt;
}
