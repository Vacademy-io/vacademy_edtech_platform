package vacademy.io.assessment_service.features.assessment.copy_intake.scan.entity;

import jakarta.persistence.*;
import lombok.*;
import org.hibernate.annotations.CreationTimestamp;
import org.hibernate.annotations.UpdateTimestamp;
import org.hibernate.annotations.UuidGenerator;

import java.util.Date;

/**
 * One load of a scan session: the two pass scans of one scanner feed, and what
 * ai_service read from them (result_json, the analyse-load answer verbatim). See V72.
 */
@Entity
@Table(name = "ai_scan_load")
@Getter
@Setter
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class AiScanLoad {

    public static final String PENDING = "PENDING";
    public static final String ANALYSING = "ANALYSING";
    public static final String DONE = "DONE";
    public static final String FAILED = "FAILED";
    public static final String REMOVED = "REMOVED";

    @Id
    @UuidGenerator
    @Column(name = "id", length = 36)
    private String id;

    @Column(name = "session_id", nullable = false, length = 36)
    private String sessionId;

    @Column(name = "load_no", nullable = false)
    private int loadNo;

    @Builder.Default
    @Column(name = "status", nullable = false, length = 20)
    private String status = PENDING;

    /** The load request as the dashboard sent it (passes, intake mode, order source, warnings). */
    @Column(name = "passes_json", nullable = false, columnDefinition = "TEXT")
    private String passesJson;

    @Column(name = "result_json", columnDefinition = "TEXT")
    private String resultJson;

    @Column(name = "decisions_json", columnDefinition = "TEXT")
    private String decisionsJson;

    @Builder.Default
    @Column(name = "attempts", nullable = false)
    private int attempts = 0;

    @Column(name = "claimed_at")
    private Date claimedAt;

    @Column(name = "error_message", columnDefinition = "TEXT")
    private String errorMessage;

    @Version
    @Column(name = "version", nullable = false)
    private Long version;

    @CreationTimestamp
    @Column(name = "created_at", updatable = false)
    private Date createdAt;

    @UpdateTimestamp
    @Column(name = "updated_at")
    private Date updatedAt;

    public boolean isLive() {
        return !REMOVED.equals(status);
    }
}
