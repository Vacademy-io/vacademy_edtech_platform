package vacademy.io.admin_core_service.features.telephony.persistence.entity;

import jakarta.persistence.*;
import lombok.*;

import java.sql.Timestamp;

/**
 * A test call placed from the AI agent editor (V615). The call log's subject is
 * AGENT_TEST with subject_id = this id, which is how the voice bot finds the name the
 * admin typed (there is no lead behind the number).
 */
@Entity
@Table(name = "ai_agent_test_call")
@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class AiAgentTestCall {

    @Id
    @Column(name = "id", length = 36, nullable = false, updatable = false)
    private String id;

    @Column(name = "institute_id", nullable = false)
    private String instituteId;

    @Column(name = "agent_id", nullable = false)
    private String agentId;

    @Column(name = "phone_number", nullable = false, length = 32)
    private String phoneNumber;

    @Column(name = "contact_name", length = 120)
    private String contactName;

    @Column(name = "created_by")
    private String createdBy;

    @Column(name = "call_log_id")
    private String callLogId;

    @Column(name = "created_at", insertable = false, updatable = false)
    private Timestamp createdAt;
}
