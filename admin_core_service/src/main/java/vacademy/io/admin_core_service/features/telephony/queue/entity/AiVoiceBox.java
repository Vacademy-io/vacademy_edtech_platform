package vacademy.io.admin_core_service.features.telephony.queue.entity;

import jakarta.persistence.*;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;
import org.hibernate.annotations.UuidGenerator;

import java.time.Instant;

/**
 * One voice-bot box in the fleet, and the number of simultaneous calls it can carry.
 *
 * <p>Fleet capacity for {@code VACADEMY_AI} is {@code SUM(max_concurrent)} over the
 * enabled boxes that are not known-DOWN. Adding a second Mumbai box is therefore an
 * INSERT through the API rather than a redeploy — which is the whole reason capacity
 * is a table and not a constant.
 *
 * <p><b>This table does not route calls.</b> Dialling still resolves the bot address
 * from {@code telephony.vacademy-ai.bot-base-url} exactly as before; {@code base_url}
 * here exists so the health poller knows which box to ask. Keeping routing on the
 * existing property means a bad row in this table can never send a call to the wrong
 * host — the worst it can do is mis-state capacity.
 */
@Entity
@Table(name = "ai_voice_box")
@Getter
@Setter
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class AiVoiceBox {

    /** A box whose base_url is still the seeded placeholder is never polled. */
    public static final String UNCONFIGURED_URL = "CONFIGURE_ME";

    public static final String HEALTH_HEALTHY = "HEALTHY";
    public static final String HEALTH_DOWN = "DOWN";
    public static final String HEALTH_UNKNOWN = "UNKNOWN";

    @Id
    @UuidGenerator
    @Column(name = "id", nullable = false, updatable = false)
    private String id;

    @Column(name = "slug", nullable = false, length = 50, unique = true)
    private String slug;

    @Column(name = "base_url", nullable = false)
    private String baseUrl;

    /** Simultaneous calls this box can carry. The "3" the fleet limit is made of. */
    @Column(name = "max_concurrent", nullable = false)
    private int maxConcurrent;

    @Column(name = "priority", nullable = false)
    private int priority;

    @Column(name = "enabled", nullable = false)
    private boolean enabled;

    /** HEALTHY | DOWN | UNKNOWN. Only DOWN removes the box's capacity. */
    @Column(name = "health_status", nullable = false, length = 20)
    private String healthStatus;

    /** Last {@code /voice-bot-service/health} activeCalls reading; null if never polled. */
    @Column(name = "active_calls")
    private Integer activeCalls;

    @Column(name = "last_health_check")
    private Instant lastHealthCheck;

    @Column(name = "notes")
    private String notes;

    @Column(name = "created_at", nullable = false)
    private Instant createdAt;

    @Column(name = "updated_at", nullable = false)
    private Instant updatedAt;

    /**
     * True when this box contributes capacity. UNKNOWN counts — a box we have never
     * managed to poll (no base_url configured, poller disabled) must not silently
     * take the fleet to zero and stop all AI calling. Only a box we asked and that
     * failed to answer is excluded.
     */
    public boolean countsTowardCapacity() {
        return enabled && !HEALTH_DOWN.equals(healthStatus);
    }

    public boolean isPollable() {
        return enabled && baseUrl != null && !baseUrl.isBlank()
                && !UNCONFIGURED_URL.equals(baseUrl.trim())
                && baseUrl.trim().startsWith("http");
    }

    @PrePersist
    void onCreate() {
        Instant now = Instant.now();
        if (createdAt == null) createdAt = now;
        updatedAt = now;
        if (healthStatus == null) healthStatus = HEALTH_UNKNOWN;
    }

    @PreUpdate
    void onUpdate() {
        updatedAt = Instant.now();
    }
}
