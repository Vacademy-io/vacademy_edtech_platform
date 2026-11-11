package vacademy.io.admin_core_service.features.telleo.dto;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

/** The onboarding questions a new Telleo account answers; the draft agent is built from these. */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
@JsonIgnoreProperties(ignoreUnknown = true)
@JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
public class TelleoAnswersDTO {
    /** 1. What the business does, in a line. */
    private String businessDescription;
    /** Optional, for the agent's product knowledge. */
    private String website;
    /** 2. QUALIFY_LEADS | BOOK_APPOINTMENTS | PAYMENT_REMINDERS | FEEDBACK | OTHER. */
    private String goal;
    /** When goal is OTHER: the job in their words. */
    private String goalDetail;
    /** 3. Who the agent calls, and why they expect the call. */
    private String audience;
    /** 4. BOOKED | INTERESTED | TRANSFER | DETAILS_COLLECTED. */
    private String successOutcome;
    /** 5. What the agent may say about price or offers. Blank = "our team will confirm". */
    private String pricing;
    /** 6. english | hindi | hinglish. */
    private String language;
    /** female | male. */
    private String voiceGender;
    /** Optional name the agent introduces itself with. */
    private String agentName;
}
