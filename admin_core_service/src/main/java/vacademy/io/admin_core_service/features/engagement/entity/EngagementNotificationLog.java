package vacademy.io.admin_core_service.features.engagement.entity;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;
import org.hibernate.annotations.UuidGenerator;

import java.sql.Timestamp;
import java.time.LocalDate;

/** Proof that a slot's push already went out for a given institute-local date. */
@Entity
@Table(name = "engagement_notification_log")
@Getter
@Setter
@NoArgsConstructor
public class EngagementNotificationLog {

    @Id
    @UuidGenerator
    private String id;

    @Column(name = "slot_id", nullable = false)
    private String slotId;

    @Column(name = "run_date", nullable = false)
    private LocalDate runDate;

    @Column(name = "institute_id", nullable = false)
    private String instituteId;

    @Column(name = "recipients", nullable = false)
    private Integer recipients = 0;

    /** NOTIFY (the morning "it's live" push) or REVEAL ("the answer is out"). */
    @Column(name = "kind", nullable = false)
    private String kind = "NOTIFY";

    @Column(name = "sent_at")
    private Timestamp sentAt;
}
