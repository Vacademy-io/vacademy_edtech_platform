package vacademy.io.admin_core_service.features.learner_quiz.service;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.util.StringUtils;
import vacademy.io.admin_core_service.core.security.InstituteAccessValidator;
import vacademy.io.admin_core_service.features.learner_quiz.repository.LearnerQuizAttemptRepository;
import vacademy.io.admin_core_service.features.learner_quiz.repository.LearnerQuizAttemptRepository.SlideMembershipRow;
import vacademy.io.common.auth.model.CustomUserDetails;
import vacademy.io.common.exceptions.ForbiddenException;

import java.util.Comparator;
import java.util.List;

/**
 * Who may be graded on a slide: a learner with a live membership in a course that holds it,
 * or staff of an institute whose course holds it, for previews. The root flag is not read:
 * learners are created as root users, so it says nothing about access.
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class LearnerQuizAccessService {

    public static final String NOT_ENROLLED = "NOT_ENROLLED";

    private final LearnerQuizAttemptRepository repository;
    private final InstituteAccessValidator instituteAccessValidator;

    public record Access(String instituteId, String packageSessionId, String chapterId) {
    }

    /**
     * @param clientInstituteId the clientId header: the institute the app is signed in to.
     *                          Staff access is judged in this institute. A learner is judged
     *                          on the membership itself, which the query ties to the institute
     *                          owning the course; the header only breaks a tie.
     * @throws ForbiddenException when the caller may not be graded on this slide
     */
    public Access requireAccess(CustomUserDetails user, String slideId, String clientInstituteId,
            String requestedPackageSessionId, String requestedChapterId) {
        if (user == null || !StringUtils.hasText(user.getUserId())) {
            throw new ForbiddenException(NOT_ENROLLED);
        }
        List<SlideMembershipRow> memberships = repository.findLiveMemberships(user.getUserId(), slideId);
        if (!memberships.isEmpty()) {
            SlideMembershipRow chosen = memberships.stream()
                    .max(Comparator.comparingInt((SlideMembershipRow m) -> score(m, clientInstituteId,
                            requestedPackageSessionId, requestedChapterId)))
                    .orElseThrow();
            return new Access(chosen.getInstituteId(), chosen.getPackageSessionId(), chosen.getChapterId());
        }
        if (StringUtils.hasText(clientInstituteId)
                && repository.findInstitutesOfSlide(slideId).contains(clientInstituteId)) {
            try {
                instituteAccessValidator.requireInstituteStaff(user, clientInstituteId);
                return new Access(clientInstituteId, requestedPackageSessionId, requestedChapterId);
            } catch (RuntimeException notStaff) {
                log.debug("[quiz-access] not staff of {}: {}", clientInstituteId, notStaff.getMessage());
            }
        }
        log.info("[quiz-access] refused user {} on slide {}", user.getUserId(), slideId);
        throw new ForbiddenException(NOT_ENROLLED);
    }

    /** The membership the request names, so progress lands on the batch the learner is in. */
    private static int score(SlideMembershipRow membership, String instituteId, String packageSessionId,
            String chapterId) {
        int score = 0;
        if (membership.getPackageSessionId().equals(packageSessionId)) {
            score += 4;
        }
        if (membership.getChapterId().equals(chapterId)) {
            score += 2;
        }
        if (membership.getInstituteId().equals(instituteId)) {
            score += 1;
        }
        return score;
    }
}
