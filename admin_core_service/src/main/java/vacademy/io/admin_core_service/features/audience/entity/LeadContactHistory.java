package vacademy.io.admin_core_service.features.audience.entity;

import jakarta.persistence.*;
import lombok.*;
import org.hibernate.annotations.UuidGenerator;

import java.sql.Timestamp;

/**
 * A phone number a lead used to have, kept when a lead profile edit replaces it, so the
 * lead stays findable by the old number. {@code oldPhoneLast10} is what lookups match on.
 */
@Entity
@Table(name = "lead_contact_history")
@Data
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class LeadContactHistory {

    public static final String PHONE = "PHONE";

    @Id
    @UuidGenerator
    @Column(name = "id", nullable = false, unique = true)
    private String id;

    @Column(name = "institute_id", nullable = false)
    private String instituteId;

    @Column(name = "user_id")
    private String userId;

    @Column(name = "audience_response_id", nullable = false)
    private String audienceResponseId;

    @Column(name = "contact_type", nullable = false, length = 20)
    private String contactType;

    @Column(name = "old_value", nullable = false)
    private String oldValue;

    @Column(name = "new_value")
    private String newValue;

    @Column(name = "old_phone_last10", length = 10)
    private String oldPhoneLast10;

    @Column(name = "created_at", insertable = false, updatable = false)
    private Timestamp createdAt;
}
