package vacademy.io.admin_core_service.features.learner_profile.dto;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

/** One observation about a learner (learner_profile_signal, V608). */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class LearnerProfileSignalDto {
    private Long id;
    /** CHAT for now; TEST and TUTOR later. */
    private String source;
    /** STRENGTH | WEAKNESS | MISCONCEPTION | GOAL | PREFERENCE | INTEREST */
    private String kind;
    private String topic;
    private String detail;
    private Double confidence;
    /** The learner said it about themselves (a goal, a preference). */
    private Boolean stated;
    /** The learner's own message the observation rests on. */
    private String evidenceQuote;
    private String evidenceSessionId;
    /** ACTIVE | DISMISSED */
    private String status;
    /** Epoch millis. */
    private Long observedAt;
}
