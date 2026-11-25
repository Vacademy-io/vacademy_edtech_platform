package vacademy.io.assessment_service.features.notification.service;

import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.scheduling.annotation.Async;
import org.springframework.stereotype.Service;
import org.springframework.util.StringUtils;
import vacademy.io.assessment_service.features.assessment.entity.AssessmentReattemptRequest;
import vacademy.io.assessment_service.features.assessment.repository.AssessmentReattemptRequestRepository;
import vacademy.io.assessment_service.features.assessment.repository.QuestionAssessmentSectionMappingRepository;
import vacademy.io.assessment_service.features.assessment.service.QuestionTextPreview;
import vacademy.io.assessment_service.features.auth_service.service.AuthService;
import vacademy.io.assessment_service.features.client.AdminCoreServiceClient;
import vacademy.io.assessment_service.features.client.AdminCoreServiceClient.LearnerRequestNotificationSettings;
import vacademy.io.assessment_service.features.notification.dto.NotificationDTO;
import vacademy.io.assessment_service.features.notification.dto.NotificationToUserDTO;
import vacademy.io.assessment_service.features.notification.enums.NotificationSourceEnum;
import vacademy.io.assessment_service.features.notification.enums.NotificationType;
import vacademy.io.common.auth.dto.UserWithRolesDTO;

import java.util.ArrayList;
import java.util.Date;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * Tells the staff, role-wise, that a learner raised a request from inside a test: a problem
 * with a question, more time, or another attempt. The roles and channels come from the
 * institute's Assessment settings ({@code ASSESSMENT_SETTING.learnerRequestNotifications});
 * by default every ADMIN gets the dashboard bell, an app push and an email.
 *
 * <p>Runs on its own small pool ({@code learnerRequestNoticeExecutor}), never on the learner's
 * request thread or the pool that carries live-exam marks recalculation: the learner is in a
 * timed exam and must not wait on auth-service or notification-service. Every failure is logged
 * and swallowed; the request itself is already saved and visible in the Learner Requests tab.
 *
 * <p>Problem reports are grouped per question: staff are told about the earliest open report on
 * a question in the last {@link #REPORT_NOTICE_WINDOW_MS}, so a whole class reporting the same
 * broken question raises one alert.
 */
@Slf4j
@Service
public class LearnerRequestStaffNotifier {

    /** Characters of the learner's message carried in the bell / push text. */
    static final int SHORT_REASON_CHARS = 160;

    static final long REPORT_NOTICE_WINDOW_MS = 10 * 60 * 1000L;

    @Autowired
    private AdminCoreServiceClient adminCoreServiceClient;

    @Autowired
    private AuthService authService;

    @Autowired
    private NotificationService notificationService;

    @Autowired
    private AssessmentReattemptRequestRepository requestRepository;

    @Autowired
    private QuestionAssessmentSectionMappingRepository questionMappingRepository;

    /** What the notice is about, captured when the request is saved. */
    public record NewRequest(String instituteId, String assessmentId, String assessmentName, String requestType,
                             String requestId, String questionId,
                             String learnerUserId, String learnerName, String reason) {
    }

    /** Where the reported question sits in the paper, for the notice text. */
    record QuestionInfo(String label, String text) {
    }

    @Async("learnerRequestNoticeExecutor")
    public void notifyStaffAsync(NewRequest request) {
        notifyStaff(request);
    }

    public void notifyStaff(NewRequest request) {
        if (request == null || !StringUtils.hasText(request.instituteId())) return;
        try {
            if (alreadyAlertedForQuestion(request)) {
                return;
            }
            QuestionInfo question = questionInfo(request);
            LearnerRequestNotificationSettings settings =
                    adminCoreServiceClient.getLearnerRequestNotificationSettings(request.instituteId());
            if ((!settings.inApp() && !settings.email()) || settings.roles().isEmpty()) {
                return;
            }
            List<UserWithRolesDTO> staff = recipients(settings.roles(), request);
            if (staff.isEmpty()) {
                log.info("[learner-request] no staff in roles {} of institute {}; nobody notified",
                        settings.roles(), request.instituteId());
                return;
            }
            String title = title(request);
            if (settings.inApp()) {
                notificationService.sendSystemAlertToUsers(request.instituteId(),
                        staff.stream().map(UserWithRolesDTO::getId).toList(), title, shortBody(request, question));
            }
            if (settings.email()) {
                sendEmail(request, question, staff, title);
            }
        } catch (Exception e) {
            log.warn("[learner-request] could not notify staff for assessment {}: {}",
                    request.assessmentId(), e.getMessage());
        }
    }

    /**
     * True for a problem report that is not the earliest open report on its question in the
     * window: staff were told about that one already.
     */
    private boolean alreadyAlertedForQuestion(NewRequest request) {
        if (!AssessmentReattemptRequest.TYPE_PROBLEM_REPORT.equals(request.requestType())
                || !StringUtils.hasText(request.questionId()) || !StringUtils.hasText(request.requestId())) {
            return false;
        }
        try {
            return requestRepository
                    .findFirstByAssessmentIdAndQuestionIdAndRequestTypeAndStatusAndCreatedAtAfterOrderByCreatedAtAscIdAsc(
                            request.assessmentId(), request.questionId(), AssessmentReattemptRequest.TYPE_PROBLEM_REPORT,
                            AssessmentReattemptRequest.STATUS_PENDING,
                            new Date(System.currentTimeMillis() - REPORT_NOTICE_WINDOW_MS))
                    .map(first -> !request.requestId().equals(first.getId()))
                    .orElse(false);
        } catch (Exception e) {
            log.debug("[learner-request] grouping lookup failed, notifying anyway: {}", e.getMessage());
            return false;
        }
    }

    private QuestionInfo questionInfo(NewRequest request) {
        if (!StringUtils.hasText(request.questionId())) return null;
        try {
            List<QuestionAssessmentSectionMappingRepository.ReportedQuestionRow> rows = questionMappingRepository
                    .findReportedQuestions(List.of(request.assessmentId()), List.of(request.questionId()));
            if (rows.isEmpty()) return null;
            QuestionAssessmentSectionMappingRepository.ReportedQuestionRow row = rows.get(0);
            String label = (StringUtils.hasText(row.getSectionName()) ? row.getSectionName() + " \u00b7 " : "")
                    + "Question " + row.getQuestionNumber();
            return new QuestionInfo(label, QuestionTextPreview.of(row.getQuestionHtml()));
        } catch (Exception e) {
            log.debug("[learner-request] question lookup failed: {}", e.getMessage());
            return null;
        }
    }

    /** Staff holding any of the roles, once each, never the learner who asked. */
    private List<UserWithRolesDTO> recipients(List<String> roles, NewRequest request) {
        List<UserWithRolesDTO> found = authService.getUsersByRoles(roles, request.instituteId());
        Map<String, UserWithRolesDTO> byId = new LinkedHashMap<>();
        if (found != null) {
            for (UserWithRolesDTO user : found) {
                if (user == null || !StringUtils.hasText(user.getId())) continue;
                if (user.getId().equals(request.learnerUserId())) continue;
                byId.putIfAbsent(user.getId(), user);
            }
        }
        return new ArrayList<>(byId.values());
    }

    private void sendEmail(NewRequest request, QuestionInfo question, List<UserWithRolesDTO> staff, String title) {
        List<NotificationToUserDTO> users = staff.stream()
                .filter(u -> StringUtils.hasText(u.getEmail()) && u.getEmail().contains("@"))
                .map(u -> NotificationToUserDTO.builder()
                        .userId(u.getId())
                        .channelId(u.getEmail())
                        .placeholders(Map.of("user_name", u.getFullName() == null ? "" : u.getFullName()))
                        .build())
                .toList();
        if (users.isEmpty()) return;
        String instituteName = null;
        try {
            instituteName = adminCoreServiceClient.getInstituteName(request.instituteId());
        } catch (Exception e) {
            log.debug("[learner-request] institute name unavailable: {}", e.getMessage());
        }
        notificationService.sendEmailToUsers(NotificationDTO.builder()
                .subject(title)
                .body(StaffNoticeEmails.learnerRequest(heading(request.requestType()), sentence(request),
                        question == null ? null : question.label(), question == null ? null : question.text(),
                        request.reason(), instituteName))
                .source(NotificationSourceEnum.ASSESSMENT.name())
                .sourceId(request.assessmentId())
                .notificationType(NotificationType.EMAIL.name())
                .users(users)
                .build(), request.instituteId());
    }

    // ------------------------------------------------------------------ wording

    static String heading(String requestType) {
        if ("PROBLEM_REPORT".equals(requestType)) return "Problem reported";
        if ("TIME_INCREASE".equals(requestType)) return "More time requested";
        return "Reattempt requested";
    }

    static String title(NewRequest r) {
        String test = StringUtils.hasText(r.assessmentName()) ? r.assessmentName() : "a test";
        return heading(r.requestType()) + ": " + test;
    }

    static String sentence(NewRequest r) {
        String who = learner(r);
        String test = StringUtils.hasText(r.assessmentName()) ? r.assessmentName() : "a test";
        if ("PROBLEM_REPORT".equals(r.requestType())) return who + " reported a problem with a question in " + test + ".";
        if ("TIME_INCREASE".equals(r.requestType())) return who + " asked for more time in " + test + ".";
        return who + " asked for another attempt at " + test + ".";
    }

    /** "Riya Sharma · Physics · Question 2: “the diagram is not loading”", cut to fit a bell. */
    static String shortBody(NewRequest r, QuestionInfo question) {
        StringBuilder body = new StringBuilder(learner(r));
        if (question != null && StringUtils.hasText(question.label())) body.append(" · ").append(question.label());
        if (StringUtils.hasText(r.reason())) {
            String reason = r.reason().trim();
            if (reason.length() > SHORT_REASON_CHARS) reason = reason.substring(0, SHORT_REASON_CHARS).trim() + "…";
            body.append(": “").append(reason).append('”');
        }
        return body.toString();
    }

    private static String learner(NewRequest r) {
        return StringUtils.hasText(r.learnerName()) ? r.learnerName().trim() : "A learner";
    }
}
