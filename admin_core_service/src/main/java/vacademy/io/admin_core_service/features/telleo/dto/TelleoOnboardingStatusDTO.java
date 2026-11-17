package vacademy.io.admin_core_service.features.telleo.dto;

import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

/** What the Telleo setup page shows: where setting the account up has got, and the trial. */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
@JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
public class TelleoOnboardingStatusDTO {
    private String instituteId;
    /** NEW (no answers yet) | RUNNING | READY | FAILED. */
    private String status;
    /** PENDING | DONE | FAILED for each step. */
    private String lineStatus;
    private String settingsStatus;
    private String agentStatus;
    private String agentId;
    /** AI (written from the answers) | TEMPLATE (the fallback). */
    private String agentSource;
    private String error;
    private TelleoAnswersDTO answers;
    /** The phone proven at sign-up: where "Call me now" rings. */
    private String verifiedPhone;
    private String trialEndsAt;
}
