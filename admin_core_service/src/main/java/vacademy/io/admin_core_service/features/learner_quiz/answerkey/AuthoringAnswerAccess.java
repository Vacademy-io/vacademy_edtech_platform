package vacademy.io.admin_core_service.features.learner_quiz.answerkey;

import lombok.RequiredArgsConstructor;
import org.springframework.security.core.GrantedAuthority;
import org.springframework.stereotype.Component;
import org.springframework.util.StringUtils;
import org.springframework.web.context.request.RequestAttributes;
import org.springframework.web.context.request.RequestContextHolder;
import org.springframework.web.context.request.ServletRequestAttributes;
import vacademy.io.admin_core_service.core.security.InstituteAccessValidator;
import vacademy.io.admin_core_service.features.learner_quiz.repository.LearnerQuizAttemptRepository;
import vacademy.io.admin_core_service.features.learner_quiz.repository.LearnerQuizAttemptRepository.CourseOwnerRow;
import vacademy.io.common.auth.model.CustomUserDetails;
import vacademy.io.common.exceptions.ForbiddenException;

import java.util.List;
import java.util.Set;

/**
 * Who keeps answers on an authoring read. Holding a staff role somewhere is not enough:
 * authorities are minted for whichever institute the clientId header names, so the content
 * being read has to belong to that institute too. There the caller must be staff, which a
 * learner who also carries TEACHER is not, or the creator of a course holding that content,
 * which is the one thing that TEACHER is for. The root flag is not read: learners are created
 * as root. The admin dashboard and the AI assistant both send the header.
 */
@Component
@RequiredArgsConstructor
public class AuthoringAnswerAccess {

    private static final Set<String> LEARNER_ROLES = Set.of("STUDENT", "PARENT", "GUARDIAN");

    private final LearnerQuizAttemptRepository repository;
    private final InstituteAccessValidator instituteAccessValidator;

    public boolean keepsAnswersOnSlide(CustomUserDetails user, String slideId) {
        return StringUtils.hasText(slideId) && keeps(user, repository.findOwnersOfSlide(slideId));
    }

    public boolean keepsAnswersOnChapter(CustomUserDetails user, String chapterId) {
        return StringUtils.hasText(chapterId) && keeps(user, repository.findOwnersOfChapter(chapterId));
    }

    public boolean keepsAnswersOnBatch(CustomUserDetails user, String packageSessionId) {
        return StringUtils.hasText(packageSessionId) && keeps(user, repository.findOwnersOfBatch(packageSessionId));
    }

    /**
     * The Quiz Results screens, on the admin dashboard only. A login there always has a role
     * beyond the learner ones, and every batch it opens comes from its own institute's course
     * list, so this refuses nobody who gets there through the dashboard.
     */
    public void requireResultsReader(CustomUserDetails user, String batchId) {
        if (user == null || user.getAuthorities() == null || user.getAuthorities().stream()
                .map(GrantedAuthority::getAuthority)
                .allMatch(authority -> authority == null || LEARNER_ROLES.contains(authority.trim().toUpperCase()))) {
            throw new ForbiddenException("Quiz results are for institute staff");
        }
        String instituteId = clientIdHeader();
        if (!StringUtils.hasText(instituteId) || !StringUtils.hasText(batchId)
                || repository.findOwnersOfBatch(batchId).stream()
                        .noneMatch(owner -> instituteId.equals(owner.getInstituteId()))) {
            throw new ForbiddenException("This batch does not belong to your institute");
        }
    }

    private boolean keeps(CustomUserDetails user, List<CourseOwnerRow> owners) {
        String instituteId = clientIdHeader();
        if (user == null || !StringUtils.hasText(user.getUserId()) || !StringUtils.hasText(instituteId)
                || user.getAuthorities() == null || user.getAuthorities().isEmpty()) {
            return false;
        }
        List<CourseOwnerRow> here = owners.stream().filter(o -> instituteId.equals(o.getInstituteId())).toList();
        if (here.isEmpty()) {
            return false;
        }
        if (here.stream().anyMatch(o -> user.getUserId().equals(o.getCreatedByUserId()))) {
            return true;
        }
        try {
            instituteAccessValidator.requireInstituteStaff(user, instituteId);
            return true;
        } catch (RuntimeException notStaff) {
            return false;
        }
    }

    private static String clientIdHeader() {
        RequestAttributes attributes = RequestContextHolder.getRequestAttributes();
        return attributes instanceof ServletRequestAttributes servlet ? servlet.getRequest().getHeader("clientId") : null;
    }
}
