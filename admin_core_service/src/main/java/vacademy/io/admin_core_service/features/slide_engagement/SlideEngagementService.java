package vacademy.io.admin_core_service.features.slide_engagement;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.util.StringUtils;
import vacademy.io.admin_core_service.core.security.InstituteAccessValidator;
import vacademy.io.admin_core_service.features.learner_quiz.repository.LearnerQuizAttemptRepository;
import vacademy.io.admin_core_service.features.learner_quiz.repository.LearnerQuizAttemptRepository.SlideMembershipRow;
import vacademy.io.admin_core_service.features.points_ledger.entity.PointsSourceType;
import vacademy.io.admin_core_service.features.points_ledger.repository.PointsLedgerRepository;
import vacademy.io.admin_core_service.features.points_ledger.service.PointsLedgerService;
import vacademy.io.admin_core_service.features.points_ledger.service.ScoringConfigService;
import vacademy.io.admin_core_service.features.slide_engagement.SlideEngagementRepository.OperationRow;
import vacademy.io.admin_core_service.features.slide_engagement.SlideEngagementRepository.SlideKindRow;
import vacademy.io.common.auth.model.CustomUserDetails;
import vacademy.io.common.exceptions.ForbiddenException;
import vacademy.io.common.exceptions.VacademyException;

import java.sql.Timestamp;
import java.util.List;
import java.util.Optional;
import java.util.Set;

/**
 * "Count as engagement" on a course slide.
 *
 * <p>Daily engagement tasks live in a time window and disappear after it. Course slides
 * do not: an institute whose learners cannot keep a schedule (parents, working adults)
 * puts the activity inside the course instead, and wants it to earn points and badges
 * like a daily task. A teacher marks a Question, Quiz, HTML, Flashcards, Poll or Game
 * slide as an engagement; every enrolled learner who completes it earns the slide's
 * points ONCE, into points_ledger as {@code COURSE_ACTIVITY}. From there they reach the
 * points pill, the leaderboard, the streak and the points badges like any other award.
 *
 * <p>Points are paid only for a completion the server can see (learner_operation: the
 * slide's completion percentage or the manual tick), never on the client's word. The
 * learner app calls {@link #claim} after each completion and when it opens the slide,
 * so a learner who finished the slide before the teacher switched it on, or whose quiz
 * completion is still being rolled up, is paid on the next call. The idempotency key
 * {@code COURSE_ACTIVITY:{slideId}:{userId}} makes every repeat free.
 *
 * <p>Game scores are self-reported by the page, so they never change the points.
 * Switching the slide off or changing its points never touches points already earned.
 */
@Service
@Slf4j
@RequiredArgsConstructor
public class SlideEngagementService {

    public static final int DEFAULT_POINTS = 10;
    public static final int MAX_POINTS = 100;
    /** Same bar as a slide's own tick in the learner app (getSlideCompletionThreshold). */
    static final double COMPLETE_AT_PERCENT = 80.0;

    static final Set<String> ELIGIBLE_SOURCE_TYPES = Set.of("QUESTION", "QUIZ");
    static final Set<String> ELIGIBLE_DOCUMENT_TYPES = Set.of("HTML", "FLASHCARDS", "POLL", "GAME");

    private final SlideEngagementRepository repository;
    private final LearnerQuizAttemptRepository membershipRepository;
    private final PointsLedgerService pointsLedgerService;
    private final PointsLedgerRepository pointsLedgerRepository;
    private final ScoringConfigService scoringConfigService;
    private final InstituteAccessValidator instituteAccessValidator;

    /** Whether a slide of this kind may be marked as an engagement. */
    public static boolean isEligible(String sourceType, String documentType) {
        if (sourceType == null) return false;
        if (ELIGIBLE_SOURCE_TYPES.contains(sourceType)) return true;
        return "DOCUMENT".equals(sourceType) && documentType != null
                && ELIGIBLE_DOCUMENT_TYPES.contains(documentType);
    }

    // ── staff ────────────────────────────────────────────────────────────────

    /**
     * @param eligible       the slide's type can be an engagement at all
     * @param gamificationOn the institute has Badges &amp; Rewards on; off = nobody earns points
     * @param earnedCount    learners in this institute who have earned this slide's points
     */
    public record AdminView(String slideId, boolean eligible, boolean enabled, int points, long earnedCount,
                            boolean gamificationOn) {}

    public AdminView adminGet(CustomUserDetails user, String instituteId, String slideId) {
        SlideKindRow slide = requireStaffSlide(user, instituteId, slideId);
        return adminView(slide, instituteId, repository.findById(slideId).orElse(null));
    }

    public AdminView adminSet(CustomUserDetails user, String instituteId, String slideId, Boolean enabled,
                              Integer points) {
        SlideKindRow slide = requireStaffSlide(user, instituteId, slideId);
        if (!isEligible(slide.getSourceType(), slide.getDocumentType())) {
            throw new VacademyException(
                    "Only Question, Quiz, HTML, Flashcards, Poll and Game slides can count as an engagement");
        }
        SlideEngagement row = repository.findById(slideId).orElseGet(() -> {
            SlideEngagement r = new SlideEngagement();
            r.setSlideId(slideId);
            r.setPoints(DEFAULT_POINTS);
            return r;
        });
        if (enabled != null) row.setEnabled(enabled);
        if (points != null) {
            if (points < 1 || points > MAX_POINTS) {
                throw new VacademyException("Points must be between 1 and " + MAX_POINTS);
            }
            row.setPoints(points);
        }
        row.setUpdatedBy(user.getUserId());
        row.setUpdatedAt(new Timestamp(System.currentTimeMillis()));
        row = repository.save(row);
        log.info("[slide-engagement] slide {} enabled={} points={} by {}", slideId, row.isEnabled(),
                row.getPoints(), user.getUserId());
        return adminView(slide, instituteId, row);
    }

    private AdminView adminView(SlideKindRow slide, String instituteId, SlideEngagement row) {
        boolean eligible = isEligible(slide.getSourceType(), slide.getDocumentType());
        return new AdminView(slide.getSlideId(), eligible, row != null && row.isEnabled(),
                row != null ? row.getPoints() : DEFAULT_POINTS,
                repository.countEarners(slide.getSlideId(), instituteId),
                scoringConfigService.isEnabled(instituteId));
    }

    private SlideKindRow requireStaffSlide(CustomUserDetails user, String instituteId, String slideId) {
        if (!StringUtils.hasText(slideId)) throw new VacademyException("slideId is required");
        if (!StringUtils.hasText(instituteId)) throw new VacademyException("instituteId is required");
        instituteAccessValidator.requireInstituteStaff(user, instituteId);
        SlideKindRow slide = repository.findSlideKind(slideId)
                .filter(s -> !"DELETED".equals(s.getStatus()))
                .orElseThrow(() -> new VacademyException("Slide not found"));
        if (!membershipRepository.findInstitutesOfSlide(slideId).contains(instituteId)) {
            throw new ForbiddenException("This slide does not belong to your institute");
        }
        return slide;
    }

    // ── learner ──────────────────────────────────────────────────────────────

    /**
     * What the learner app shows on the slide, and what this call paid.
     *
     * @param active        the slide counts as an engagement for this learner right now
     *                      (switched on, published, enrolled, institute has points on)
     * @param earned        this learner holds the slide's points (also true after the
     *                      teacher switched it off, so "you earned 10" stays visible)
     * @param completed     the server sees the slide completed by this learner
     * @param pointsAwarded paid by THIS call (0 when already earned or not complete yet)
     * @param newTotalPoints the learner's total after this call's award, else null
     */
    public record LearnerView(String slideId, boolean active, int points, boolean earned, boolean completed,
                              int pointsAwarded, Long newTotalPoints) {
        static LearnerView inactive(String slideId) {
            return new LearnerView(slideId, false, 0, false, false, 0, null);
        }
    }

    public LearnerView claim(CustomUserDetails user, String slideId, String packageSessionId) {
        if (user == null || !StringUtils.hasText(user.getUserId())) {
            throw new ForbiddenException("Sign in to earn points");
        }
        if (!StringUtils.hasText(slideId)) throw new VacademyException("slideId is required");
        String userId = user.getUserId();

        SlideEngagement config = repository.findById(slideId).orElse(null);
        if (config == null) return LearnerView.inactive(slideId);

        String key = idempotencyKey(slideId, userId);
        boolean earned = pointsLedgerRepository.existsByIdempotencyKey(key);

        Optional<SlideKindRow> slide = repository.findSlideKind(slideId);
        boolean live = slide.isPresent()
                && ("PUBLISHED".equals(slide.get().getStatus()) || "UNSYNC".equals(slide.get().getStatus()))
                && isEligible(slide.get().getSourceType(), slide.get().getDocumentType());

        List<SlideMembershipRow> memberships = membershipRepository.findLiveMemberships(userId, slideId);
        SlideMembershipRow membership = memberships.stream()
                .filter(m -> StringUtils.hasText(packageSessionId)
                        && packageSessionId.equals(m.getPackageSessionId()))
                .findFirst()
                .orElse(memberships.isEmpty() ? null : memberships.get(0));

        boolean active = config.isEnabled() && live && membership != null
                && scoringConfigService.isEnabled(membership.getInstituteId());
        if (!active) {
            // Switched off, unpublished, not enrolled (a teacher previewing) or points off:
            // nothing to earn, but points already earned stay on show.
            return new LearnerView(slideId, false, earned ? config.getPoints() : 0, earned, false, 0, null);
        }
        if (earned) {
            return new LearnerView(slideId, true, config.getPoints(), true, true, 0, null);
        }
        if (!isCompleted(repository.findCompletionRows(slideId, userId))) {
            return new LearnerView(slideId, true, config.getPoints(), false, false, 0, null);
        }

        String title = slide.get().getTitle();
        String reason = "Course activity" + (StringUtils.hasText(title) ? ": " + truncate(title.strip(), 120) : "");
        boolean paid = pointsLedgerService.award(userId, membership.getInstituteId(),
                membership.getPackageSessionId(), PointsSourceType.COURSE_ACTIVITY, slideId,
                config.getPoints(), reason, key).isPresent();
        Long total = paid ? pointsLedgerRepository.sumForUser(membership.getInstituteId(), userId) : null;
        if (paid) {
            log.info("[slide-engagement] {} earned {} points for slide {}", userId, config.getPoints(), slideId);
        }
        // Not paid = a concurrent claim won the race; the points are held either way.
        return new LearnerView(slideId, true, config.getPoints(), true, true, paid ? config.getPoints() : 0, total);
    }

    static String idempotencyKey(String slideId, String userId) {
        return PointsSourceType.COURSE_ACTIVITY.name() + ":" + slideId + ":" + userId;
    }

    /** The slide's own completion, as the course progress sees it. */
    static boolean isCompleted(List<OperationRow> rows) {
        for (OperationRow r : rows) {
            if (r == null || r.getOperation() == null || r.getValue() == null) continue;
            if ("MARKED_AS_WATCHED".equals(r.getOperation())) {
                if ("true".equalsIgnoreCase(r.getValue().strip())) return true;
                continue;
            }
            try {
                if (Double.parseDouble(r.getValue().strip()) >= COMPLETE_AT_PERCENT) return true;
            } catch (NumberFormatException ignored) {
                // a malformed value is simply not a completion
            }
        }
        return false;
    }

    private static String truncate(String s, int max) {
        return s.length() <= max ? s : s.substring(0, max - 1) + "…";
    }
}
