package vacademy.io.admin_core_service.features.learner_badge.dto;

import com.fasterxml.jackson.annotation.JsonIgnore;
import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import com.fasterxml.jackson.annotation.JsonInclude;
import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.util.Set;

/**
 * One badge of an institute's catalogue, as stored in the {@code badges} array of the
 * {@code BADGES_REWARDS_SETTING} institute setting. Mirrors {@code BadgeDefinitionConfig}
 * in both frontends (admin {@code badge-config.ts}, learner {@code badge-config.ts}).
 *
 * <p>Fields are boxed so an entry read back from the blob keeps exactly what was stored
 * (an old entry without {@code hidden} stays {@code null}, not {@code false}). Unknown keys
 * are ignored on read; the catalogue writer keeps untouched entries as raw maps so nothing
 * an FE may have added is dropped by a server-side append.
 */
@Data
@NoArgsConstructor
@AllArgsConstructor
@JsonIgnoreProperties(ignoreUnknown = true)
@JsonInclude(JsonInclude.Include.NON_NULL)
public class BadgeDefinition {

    public static final String TRIGGER_MANUAL = "manual";

    /** Every trigger key both frontends understand (admin/learner badge-config.ts BadgeTriggerType). */
    public static final Set<String> KNOWN_TRIGGERS = Set.of(
            TRIGGER_MANUAL, "course_count", "slide_count", "streak", "xp_total",
            "course_completion", "assessment_score", "live_session_count", "live_session_streak");

    private String id;
    private String name;
    private String description;
    private String icon;
    /** One of the trigger keys; {@link #TRIGGER_MANUAL} never auto-unlocks. */
    private String trigger;
    /** Long, not Integer: the Settings number input has no upper bound, so stored values can exceed int range. */
    private Long threshold;
    private Boolean enabled;
    /** Hidden from learners until earned (UI affordance only). */
    private Boolean hidden;

    /** {@code enabled !== false} — an absent flag counts as enabled, like both frontends. */
    @JsonIgnore
    public boolean isEffectivelyEnabled() {
        return !Boolean.FALSE.equals(enabled);
    }

    @JsonIgnore
    public boolean isManual() {
        return TRIGGER_MANUAL.equals(trigger);
    }
}
