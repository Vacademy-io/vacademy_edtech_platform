package vacademy.io.admin_core_service.features.user_subscription.dto;

import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;
import lombok.Data;

import java.util.List;

@Data
@JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
public class PaymentOptionFilterDTO {
    private List<String>types;
    /**
     * Types to exclude from the result. When null/empty, the service layer applies a
     * default exclusion of ['CPO'] so that CPO-mirror PaymentOptions stay out of the
     * generic admin "Payment Options" listing. Pass an empty list ([]) to disable
     * the default exclusion entirely (useful when the caller explicitly wants to see
     * CPO mirrors mixed with regular options).
     */
    private List<String> excludeTypes;
    private String source;
    private String sourceId;
    private boolean requireApproval;
    private boolean notRequireApproval;
    /**
     * Case-insensitive substring match on the option's name. Null or blank keeps
     * every option, so an existing caller that omits it is unaffected.
     *
     * Exists because this endpoint feeds pickers. One institute carries 6,665
     * options left by a payments migration, and shipping all of them so the
     * browser can filter them was a 5.9 MB response per dialog open.
     */
    private String search;
    /**
     * Cap on how many options come back, newest first. Null means no cap — again,
     * what every caller got before this existed.
     */
    private Integer limit;
}
