package vacademy.io.admin_core_service.features.live_session.service;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.util.StringUtils;
import vacademy.io.admin_core_service.features.institute_learner.repository.StudentSessionInstituteGroupMappingRepository;
import vacademy.io.admin_core_service.features.packages.repository.PackageSessionRepository;

import java.util.List;
import java.util.Optional;

/**
 * Decides whether a learner's live-class lists should also carry the
 * institute's UNASSIGNED public classes — public, LIVE, and with no batch or
 * learner attached. Without this, such a class only ever reaches people through
 * its registration link; enrolled learners never see it in the app.
 *
 * <p>Opt-in per institute ({@code STUDENT_DISPLAY_SETTINGS.liveClasses.showUnassignedPublicSessions},
 * default off) and only for an enrolled learner of that institute, so a
 * non-opted institute keeps the exact old query and plan.
 *
 * <p>Never throws: it sits on learner list endpoints, and any failure simply
 * means "no broadcast" (the targeted classes are still returned).
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class LearnerPublicSessionVisibilityService {

    private static final List<String> ACTIVE_ENROLLMENT_STATUSES = List.of("ACTIVE");

    private final LiveSessionLearnerDisplaySettingsService displaySettingsService;
    private final PackageSessionRepository packageSessionRepository;
    private final StudentSessionInstituteGroupMappingRepository mappingRepository;

    /**
     * Resolves the institute and returns its id when the broadcast applies,
     * otherwise null. Institute comes from the batch first (the list the learner
     * is looking at), then the explicit instituteId, then the learner's enrolment.
     *
     * @param learnerUserId whose list this is — the learner, or the child when a
     *                      parent views it. Falls back to the caller when blank.
     */
    public String resolveBroadcastInstituteId(String batchId, String instituteId, String learnerUserId,
            String callerUserId) {
        try {
            String userId = StringUtils.hasText(learnerUserId) ? learnerUserId : callerUserId;
            if (!StringUtils.hasText(userId)) {
                return null;
            }
            String resolvedInstituteId = resolveInstituteId(batchId, instituteId, userId);
            return isBroadcastEnabledFor(resolvedInstituteId, userId) ? resolvedInstituteId : null;
        } catch (Exception e) {
            log.warn("Unassigned public session visibility check failed (batch={}, institute={}): {}",
                    batchId, instituteId, e.getMessage());
            return null;
        }
    }

    /**
     * For callers that already resolved the institute and read its flags (the
     * Past tab): only the enrolment check is left.
     */
    public boolean isEnrolledLearner(String instituteId, String userId) {
        try {
            return StringUtils.hasText(instituteId) && StringUtils.hasText(userId)
                    && mappingRepository.existsActiveLearnerInInstitute(userId, instituteId);
        } catch (Exception e) {
            log.warn("Enrolment check failed for institute {}: {}", instituteId, e.getMessage());
            return false;
        }
    }

    private boolean isBroadcastEnabledFor(String instituteId, String userId) {
        if (!StringUtils.hasText(instituteId)) {
            return false;
        }
        // Flag first: it is off for most institutes, which then skip the enrolment query.
        if (!displaySettingsService.getFlags(instituteId).showUnassignedPublicSessions()) {
            return false;
        }
        return isEnrolledLearner(instituteId, userId);
    }

    private String resolveInstituteId(String batchId, String instituteId, String userId) {
        if (StringUtils.hasText(batchId)) {
            Optional<String> fromBatch = packageSessionRepository.findInstituteIdByPackageSessionId(batchId);
            if (fromBatch.isPresent()) {
                return fromBatch.get();
            }
        }
        if (StringUtils.hasText(instituteId)) {
            return instituteId;
        }
        return mappingRepository.findInstituteIdByUserIdAndStatus(userId, ACTIVE_ENROLLMENT_STATUSES)
                .orElse(null);
    }
}
