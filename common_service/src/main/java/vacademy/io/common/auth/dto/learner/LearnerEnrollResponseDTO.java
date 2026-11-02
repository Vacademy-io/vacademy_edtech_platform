package vacademy.io.common.auth.dto.learner;

import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;
import lombok.Data;
import vacademy.io.common.payment.dto.PaymentResponseDTO;
import vacademy.io.common.auth.dto.UserDTO;

@Data
@JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
public class LearnerEnrollResponseDTO {
    private UserDTO user;
    private PaymentResponseDTO paymentResponse;
    private String userPlanId;
    /**
     * One-time code the buyer's browser exchanges for a session right after a paid
     * checkout (invite setting postformfillConfiguration.autoLoginAfterPayment). Null
     * when the invite does not ask for it or the purchase does not qualify.
     */
    private String loginCode;
}
