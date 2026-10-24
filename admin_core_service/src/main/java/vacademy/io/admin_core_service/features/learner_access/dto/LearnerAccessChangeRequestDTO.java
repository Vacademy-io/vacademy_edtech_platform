package vacademy.io.admin_core_service.features.learner_access.dto;

import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.util.Date;
import java.util.List;

/**
 * Bulk change to learners' course-access windows.
 *
 * <p>Targets are the cross product of {@code userIds} × {@code packageSessionIds}: every
 * ACTIVE enrollment matching a pair is changed. Leaving {@code packageSessionIds} empty
 * targets every ACTIVE enrollment the listed learners have in the institute.
 *
 * <p>Exactly one of {@code extendByDays}, {@code accessDaysFromEnrollment},
 * {@code newExpiryDate} or {@code makeUnlimited} must be set — they are four different
 * questions and combining them would leave the outcome ambiguous.
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
@JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
public class LearnerAccessChangeRequestDTO {

    private String instituteId;

    /** Learners to change. Required. */
    private List<String> userIds;

    /** Restrict to these batches. Empty/null = all of the learner's ACTIVE enrollments. */
    private List<String> packageSessionIds;

    /**
     * Push the current expiry out by this many days. Negative pulls it in.
     * An enrollment that currently has unlimited access is skipped rather than
     * silently given a finite window.
     */
    private Integer extendByDays;

    /** Set expiry to enrolled_date + N days, recomputing from scratch. */
    private Integer accessDaysFromEnrollment;

    /** Set expiry to this exact instant, whatever it is now. */
    private Date newExpiryDate;

    /** Clear expiry — unlimited access. */
    private Boolean makeUnlimited;

    /**
     * When extending an already-expired enrollment, count from today instead of from the
     * stale expiry date. Defaults to true: extending a learner who lapsed 90 days ago by
     * 30 days should give them 30 usable days, not a window that is still in the past.
     */
    @Builder.Default
    private Boolean extendFromToday = true;

    /**
     * Also flip enrollments whose status went INACTIVE on expiry back to ACTIVE when the
     * new window is in the future. Defaults to true — extending access to a learner who
     * stays locked out is not what the admin asked for.
     */
    @Builder.Default
    private Boolean reactivateExpired = true;

    /** Free-text note stored on every log row this request writes. */
    /**
     * Move the learner's JOIN date (ssigm.enrolled_date). Independent of the expiry
     * operations above: either, both or neither may be set in one request.
     *
     * <p>Used when someone enrolled for an intake they cannot start — the trial that begins
     * next Monday moving to the Monday after, say. The plan's term and charge date follow it
     * unless {@link #shiftPlanWindow} says otherwise, because leaving them behind is what
     * made a learner's access window and their billing window disagree in the first place.
     */
    private Date newJoinDate;

    /**
     * Whether moving the join date also moves the plan's term (start_date, end_date) and its
     * next charge. Defaults to true: a trial shifted a week later should end a week later and
     * be billed a week later, which is the whole point of moving it.
     */
    private Boolean shiftPlanWindow = true;

    private String reason;

    /** Preview only: compute and return the changes without writing them. */
    @Builder.Default
    private boolean dryRun = false;
}
