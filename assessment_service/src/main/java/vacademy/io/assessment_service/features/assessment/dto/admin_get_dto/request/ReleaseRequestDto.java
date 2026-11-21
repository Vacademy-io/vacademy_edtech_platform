package vacademy.io.assessment_service.features.assessment.dto.admin_get_dto.request;

import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;
import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.util.List;

@Data
@AllArgsConstructor
@NoArgsConstructor
@JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
public class ReleaseRequestDto {
    private List<String> attemptIds;

    // Submission review (phase 1a), opt-in. All null = the old behaviour: every addressed
    // attempt is (re-)released and (re-)emailed - the PDF tool and older callers rely on it.
    /** Leave attempts with unmarked answers (or an AI check running) out of this release. */
    private Boolean skipUnready;
    /** Do not release (and re-email) attempts that are already released. */
    private Boolean skipAlreadyReleased;
    /** Release attempts with unmarked answers too (the "I understand" tick). */
    private Boolean allowUnmarked;
    /** The skipped attempts are released automatically once they are fully marked. */
    private Boolean releaseWhenMarked;

    public ReleaseRequestDto(List<String> attemptIds) {
        this.attemptIds = attemptIds;
    }

    public boolean hasReleaseOptions() {
        return skipUnready != null || skipAlreadyReleased != null || allowUnmarked != null
                || releaseWhenMarked != null;
    }
}
