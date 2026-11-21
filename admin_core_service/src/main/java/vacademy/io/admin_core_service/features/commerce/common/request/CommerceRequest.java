package vacademy.io.admin_core_service.features.commerce.common.request;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;

import java.util.Date;

/**
 * One staff state change, by its client key (V688). Written first in the transaction of the
 * change, by one INSERT, so a repeat of the request meets the unique key and is answered from
 * the current state instead of acting twice. Never updated.
 */
@Getter
@Setter
@NoArgsConstructor
@Entity
@Table(name = "commerce_request")
public class CommerceRequest {

    @Id
    @Column(name = "id", length = 36)
    private String id;

    @Column(name = "institute_id", nullable = false, updatable = false, length = 36)
    private String instituteId;

    @Column(name = "client_request_id", nullable = false, updatable = false, length = 64)
    private String clientRequestId;

    @Column(name = "action", nullable = false, updatable = false, length = 32)
    private String action;

    @Column(name = "reference_type", updatable = false, length = 32)
    private String referenceType;

    @Column(name = "reference_id", updatable = false, length = 36)
    private String referenceId;

    @Column(name = "request_hash", nullable = false, updatable = false, length = 64)
    private String requestHash;

    @JdbcTypeCode(SqlTypes.JSON)
    @Column(name = "response_json", columnDefinition = "jsonb", updatable = false)
    private String responseJson;

    @Column(name = "actor_user_id", updatable = false, length = 36)
    private String actorUserId;

    @Column(name = "created_at", insertable = false, updatable = false)
    private Date createdAt;
}
