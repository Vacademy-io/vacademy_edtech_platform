package vacademy.io.admin_core_service.features.points_ledger.service;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import vacademy.io.admin_core_service.features.institute.service.InstituteTimezoneService;
import vacademy.io.admin_core_service.features.points_ledger.entity.PointsSourceType;
import vacademy.io.admin_core_service.features.points_ledger.repository.PointsLedgerRepository;

import java.sql.Timestamp;
import java.time.LocalDate;
import java.time.ZoneId;
import java.util.LinkedHashMap;
import java.util.Map;

/**
 * Points for passing a practice quiz the learner AI tutor set.
 *
 * <p>Practice quizzes are unlimited and self-requested, so the award is deliberately small and
 * capped: {@value #POINTS} points for a pass (≥ {@value #PASS_PERCENT}%), at most
 * {@value #DAILY_CAP} awards per learner per institute-local day, once per quiz. A ledger row
 * also makes that day an active day, so the server streak counts it. Institutes with
 * gamification off accrue nothing, like every other source.
 */
@Service
@RequiredArgsConstructor
@Slf4j
public class TutorQuizPointsService {

    static final int POINTS = 5;
    static final int PASS_PERCENT = 60;
    static final int DAILY_CAP = 2;

    private final PointsLedgerService pointsLedgerService;
    private final PointsLedgerRepository pointsLedgerRepository;
    private final ScoringConfigService scoringConfigService;
    private final InstituteTimezoneService instituteTimezoneService;

    public Map<String, Object> award(String userId, String instituteId, String quizId, double percentage) {
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("awarded", false);
        out.put("points", 0);
        if (userId == null || userId.isBlank() || instituteId == null || instituteId.isBlank()
                || quizId == null || quizId.isBlank()) {
            out.put("reason", "missing_fields");
            return out;
        }
        if (!scoringConfigService.isEnabled(instituteId)) {
            out.put("reason", "gamification_off");
            return out;
        }
        if (percentage < PASS_PERCENT) {
            out.put("reason", "not_passed");
            return out;
        }
        ZoneId zone = instituteTimezoneService.getZone(instituteId);
        Timestamp dayStart = Timestamp.from(LocalDate.now(zone).atStartOfDay(zone).toInstant());
        long today = pointsLedgerRepository.countByInstituteIdAndUserIdAndSourceTypeAndAwardedAtGreaterThanEqual(
                instituteId, userId, PointsSourceType.AI_TUTOR_QUIZ.name(), dayStart);
        if (today >= DAILY_CAP) {
            out.put("reason", "daily_cap");
            return out;
        }
        boolean awarded = pointsLedgerService.award(userId, instituteId, null, PointsSourceType.AI_TUTOR_QUIZ,
                quizId, POINTS, "Passed an AI tutor practice quiz",
                PointsSourceType.AI_TUTOR_QUIZ.name() + ":" + quizId + ":" + userId).isPresent();
        out.put("awarded", awarded);
        out.put("points", awarded ? POINTS : 0);
        out.put("reason", awarded ? "awarded" : "already_awarded");
        out.put("awards_left_today", Math.max(0, DAILY_CAP - today - (awarded ? 1 : 0)));
        return out;
    }
}
