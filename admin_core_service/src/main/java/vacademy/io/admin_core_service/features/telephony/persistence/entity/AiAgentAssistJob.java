package vacademy.io.admin_core_service.features.telephony.persistence.entity;

import jakarta.persistence.*;
import lombok.*;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;

import java.time.Instant;
import java.util.Map;

/**
 * One prompt-assistant run (draft / analyze / improve / feedback / regenerate) executed
 * in the background — see AiAgentAssistService. RUNNING → DONE (result set) or FAILED
 * (error set). A RUNNING row whose pod died is reported FAILED by the poll once stale.
 */
@Entity
@Table(name = "ai_agent_assist_job")
@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class AiAgentAssistJob {

    public static final String RUNNING = "RUNNING";
    public static final String DONE = "DONE";
    public static final String FAILED = "FAILED";

    @Id
    @Column(name = "id", length = 36, nullable = false, updatable = false)
    private String id;

    @Column(name = "institute_id", nullable = false)
    private String instituteId;

    @Column(name = "agent_id")
    private String agentId;

    @Column(name = "operation", nullable = false, length = 32)
    private String operation;

    @Column(name = "status", nullable = false, length = 16)
    private String status;

    @Column(name = "model", length = 128)
    private String model;

    @JdbcTypeCode(SqlTypes.JSON)
    @Column(name = "result", columnDefinition = "jsonb")
    private Map<String, Object> result;

    @Column(name = "error", columnDefinition = "TEXT")
    private String error;

    @Column(name = "created_at", nullable = false)
    private Instant createdAt;

    @Column(name = "updated_at", nullable = false)
    private Instant updatedAt;
}
