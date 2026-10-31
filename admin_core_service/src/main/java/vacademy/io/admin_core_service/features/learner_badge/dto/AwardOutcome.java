package vacademy.io.admin_core_service.features.learner_badge.dto;

import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;

/** Per-learner result of an award call. */
@Data
@NoArgsConstructor
@AllArgsConstructor
public class AwardOutcome {

    public static final String NEW = "NEW";
    public static final String ALREADY_ACTIVE = "ALREADY_ACTIVE";
    public static final String UPGRADED_FROM_AUTO = "UPGRADED_FROM_AUTO";
    /** The user id has no enrollment/contact row in this institute — nothing was written or sent. */
    public static final String NOT_ENROLLED = "NOT_ENROLLED";

    private String userId;
    /** One of {@link #NEW}, {@link #ALREADY_ACTIVE}, {@link #UPGRADED_FROM_AUTO}, {@link #NOT_ENROLLED}. */
    private String status;
    private LearnerBadgeDTO badge;
}
