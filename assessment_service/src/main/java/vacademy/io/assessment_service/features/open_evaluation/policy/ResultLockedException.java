package vacademy.io.assessment_service.features.open_evaluation.policy;

import lombok.Getter;
import vacademy.io.common.exceptions.ConflictException;

/**
 * The attempt's result is finalized (report_release_status = RELEASED) and may not change
 * until it is unfinalized. A {@link ConflictException}, so dashboard callers get the
 * common 409 body; the partner API renders it as 409 {@code submission_finalized}.
 */
@Getter
public class ResultLockedException extends ConflictException {

    private final String attemptId;

    public ResultLockedException(String attemptId) {
        super("This result has been released (finalized) and can no longer be changed. Unfinalize it first.");
        this.attemptId = attemptId;
    }
}
