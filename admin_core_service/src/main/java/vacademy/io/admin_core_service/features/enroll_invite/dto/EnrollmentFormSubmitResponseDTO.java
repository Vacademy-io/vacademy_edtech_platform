package vacademy.io.admin_core_service.features.enroll_invite.dto;

import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.util.List;

@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
@JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
public class EnrollmentFormSubmitResponseDTO {
    private String userId;
    private List<String> abandonedCartEntryIds;
    private String message;

    /**
     * Whether THIS learner still gets the invite's free trial.
     *
     * <p>False once they have consumed one — matched on phone where the institute
     * identifies by phone, so a second account on the same number does not earn a second
     * trial. The form reads it to stop promising "start your trial for Rs 1" to someone the
     * backend is about to charge the full plan price, which is how the two came to disagree
     * on screen in the first place.
     *
     * <p>True whenever the invite configures no trial at all — there is nothing to lose.
     */
    private Boolean trialAvailable;
}
