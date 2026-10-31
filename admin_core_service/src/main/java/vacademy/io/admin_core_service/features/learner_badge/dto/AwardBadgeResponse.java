package vacademy.io.admin_core_service.features.learner_badge.dto;

import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.util.List;

/**
 * Envelope returned by the award endpoint: one outcome per requested learner plus the
 * counts the UI toasts, and whether a notification was dispatched (false when the
 * institute's badges master toggle is off or nobody was newly awarded).
 */
@Data
@NoArgsConstructor
@AllArgsConstructor
public class AwardBadgeResponse {
    private List<AwardOutcome> results;
    private int awardedCount;
    private int alreadyHadCount;
    private int upgradedCount;
    /** Ids that are not members of the institute — skipped, never written or notified. */
    private int notEnrolledCount;
    private boolean notified;
}
