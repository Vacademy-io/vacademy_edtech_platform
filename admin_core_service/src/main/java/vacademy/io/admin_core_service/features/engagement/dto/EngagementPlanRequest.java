package vacademy.io.admin_core_service.features.engagement.dto;

import lombok.Data;

import java.util.List;

/** Create/update payload for a plan. */
@Data
public class EngagementPlanRequest {
    private String title;
    private String description;
    private String packageSessionId;
    /**
     * Create the same plan for several batches at once. A plan is still scoped to ONE
     * batch — the service fans out and writes one plan per id — so per-batch tracking,
     * feeds and leaderboards keep working unchanged. Takes precedence over
     * {@code packageSessionId} when both are present.
     */
    private List<String> packageSessionIds;
    private String subjectId;
    /** DRAFT | PUBLISHED | ARCHIVED */
    private String status;
    private String defaultMissPolicy;
    /** CALENDAR (default) or RELATIVE (days after each learner joins). Fixed at creation. */
    private String scheduleMode;
    private Integer defaultCatchUpDays;
    private Integer defaultCatchUpPercent;
    private List<EngagementSlotRequest> slots;
}
