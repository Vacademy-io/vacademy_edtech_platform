package vacademy.io.admin_core_service.features.product_config.dto;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.util.List;

/**
 * How a product's self sign-up differs from Evalezy's. auth_service reads these over HMAC
 * (InternalProductConfigController), so they live in the product row and never need a common
 * library release. A product with none signs up exactly as Evalezy does.
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
@JsonIgnoreProperties(ignoreUnknown = true)
@JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
public class SignupRulesDTO {
    /** The visitor proves a phone number with a WhatsApp code, and one phone gets one trial. */
    private Boolean phoneVerificationRequired;
    /**
     * A new institute starts as a TRIAL that can only call its verified phone number until it
     * goes live (institute_telleo_state, telleo_trial_phone).
     */
    private Boolean trialDialLock;
    /** The sign-up form does not ask how many teachers there are. */
    private Boolean hideTeachers;
    /** The "what kind of business" choices; none keeps the platform's institute types. */
    private List<String> instituteTypes;

    public boolean requiresPhone() {
        return Boolean.TRUE.equals(phoneVerificationRequired);
    }

    public boolean locksTrialDialling() {
        return Boolean.TRUE.equals(trialDialLock);
    }
}
