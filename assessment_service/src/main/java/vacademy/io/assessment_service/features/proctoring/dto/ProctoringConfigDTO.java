package vacademy.io.assessment_service.features.proctoring.dto;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;
import vacademy.io.assessment_service.features.proctoring.enums.ProctoringTier;

/**
 * The stored shape of {@code assessment.proctoring_config}, and what both the
 * admin wizard and the learner runtime exchange with the server.
 * <p>
 * Every knob is nullable on the wire so an older admin build that only knows
 * {@code tier} still round-trips; {@link #withDefaults()} fills what is missing
 * from the tier's defaults before anything reads it. Unknown properties are
 * ignored for the same forward-compatibility reason.
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
@JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
@JsonIgnoreProperties(ignoreUnknown = true)
public class ProctoringConfigDTO {

    private String tier;

    /** Refuse to start the attempt until the camera permission is granted. */
    private Boolean cameraRequired;

    /** Seconds between routine snapshots. 0 disables routine snapshots (flags still upload one). */
    private Integer snapshotIntervalSec;

    /** Run on-device face detection (no face / several faces). */
    private Boolean faceCheck;

    /**
     * FLAG-severity events before the attempt auto-submits. 0 means never: only
     * record and let a reviewer decide. This mirrors the existing tab-switch rule
     * (3 strikes) but is a per-assessment decision now.
     */
    private Integer maxViolations;

    /** Keep a small self-view on screen so the learner knows they are on camera. */
    private Boolean showSelfView;

    public static ProctoringConfigDTO off() {
        return ProctoringConfigDTO.builder()
                .tier(ProctoringTier.NONE.name())
                .cameraRequired(false)
                .snapshotIntervalSec(0)
                .faceCheck(false)
                .maxViolations(0)
                .showSelfView(false)
                .build();
    }

    public static ProctoringConfigDTO defaultsFor(ProctoringTier tier) {
        if (tier == ProctoringTier.BASIC) {
            return ProctoringConfigDTO.builder()
                    .tier(ProctoringTier.BASIC.name())
                    .cameraRequired(true)
                    .snapshotIntervalSec(30)
                    .faceCheck(true)
                    .maxViolations(0)
                    .showSelfView(true)
                    .build();
        }
        return off();
    }

    public ProctoringTier resolvedTier() {
        return ProctoringTier.fromString(tier);
    }

    public boolean isEnabled() {
        return resolvedTier() != ProctoringTier.NONE;
    }

    /** This config with every null knob replaced by its tier's default. */
    public ProctoringConfigDTO withDefaults() {
        ProctoringTier resolved = resolvedTier();
        if (resolved == ProctoringTier.NONE) return off();
        ProctoringConfigDTO d = defaultsFor(resolved);
        return ProctoringConfigDTO.builder()
                .tier(resolved.name())
                .cameraRequired(cameraRequired != null ? cameraRequired : d.cameraRequired)
                .snapshotIntervalSec(clampInterval(snapshotIntervalSec != null ? snapshotIntervalSec : d.snapshotIntervalSec))
                .faceCheck(faceCheck != null ? faceCheck : d.faceCheck)
                .maxViolations(Math.max(0, maxViolations != null ? maxViolations : d.maxViolations))
                .showSelfView(showSelfView != null ? showSelfView : d.showSelfView)
                .build();
    }

    /**
     * Snapshots are the whole storage bill of the BASIC tier; a client cannot be
     * allowed to ask for one a second. 0 stays 0 (routine snapshots off).
     */
    private static int clampInterval(int seconds) {
        if (seconds <= 0) return 0;
        return Math.max(10, Math.min(seconds, 600));
    }
}
