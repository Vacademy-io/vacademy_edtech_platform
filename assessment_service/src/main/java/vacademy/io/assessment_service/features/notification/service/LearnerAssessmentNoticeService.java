package vacademy.io.assessment_service.features.notification.service;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.scheduling.annotation.Async;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;
import org.springframework.util.StringUtils;
import vacademy.io.assessment_service.features.assessment.entity.Assessment;
import vacademy.io.assessment_service.features.assessment.entity.AssessmentInstituteMapping;
import vacademy.io.assessment_service.features.assessment.entity.AssessmentNotificationMetadata;
import vacademy.io.assessment_service.features.assessment.entity.AssessmentUserRegistration;
import vacademy.io.assessment_service.features.assessment.enums.AssessmentModeEnum;
import vacademy.io.assessment_service.features.assessment.enums.AssessmentStatus;
import vacademy.io.assessment_service.features.assessment.enums.AssessmentTypeEnum;
import vacademy.io.assessment_service.features.assessment.repository.AssessmentInstituteMappingRepository;
import vacademy.io.assessment_service.features.assessment.repository.AssessmentNotificationMetadataRepository;
import vacademy.io.assessment_service.features.assessment.repository.AssessmentRepository;
import vacademy.io.assessment_service.features.assessment.repository.AssessmentUserRegistrationRepository;
import vacademy.io.assessment_service.features.assessment.service.AssessmentWorkflowEventPublisher;
import vacademy.io.assessment_service.features.client.AdminCoreServiceClient;
import vacademy.io.assessment_service.features.notification.dto.NotificationDTO;
import vacademy.io.assessment_service.features.notification.dto.NotificationToUserDTO;
import vacademy.io.assessment_service.features.notification.enums.NotificationSourceEnum;
import vacademy.io.assessment_service.features.notification.enums.NotificationType;
import vacademy.io.assessment_service.features.notification.service.LearnerAssessmentEmailBody.Kind;
import vacademy.io.assessment_service.features.open_evaluation.policy.ApiCandidatePolicy;
import vacademy.io.common.auth.enums.CompanyStatus;

import java.time.ZoneId;
import java.util.ArrayList;
import java.util.Date;
import java.util.List;
import java.util.Map;
import java.util.Optional;

/**
 * The emails a learner gets about an assessment, driven by the admin's Step 3 "Notify
 * Participants" settings:
 * <ul>
 *   <li>"When Assessment is created" — a confirmation when the learner registers through the
 *       open link, and an "added to a new assessment" email to learners the admin registered
 *       individually, sent once when the assessment is published;</li>
 *   <li>"Before Assessment goes live" — "starts in N minutes", N from the admin's dropdown;</li>
 *   <li>"When Assessment goes live" — "has started".</li>
 * </ul>
 * Recipients are the assessment's individual registrations (open-link registrants and learners
 * picked one by one). Learners assigned through a whole batch have no registration row and are
 * not emailed here.
 *
 * <p>Before this class the settings were saved but nothing read them: the reminder methods were
 * only reachable from two HTTP endpoints that no scheduler called.
 */
@Service
@RequiredArgsConstructor
@Slf4j
public class LearnerAssessmentNoticeService {

    /** Every other assessment date shown to people is formatted in this zone. */
    static final ZoneId ZONE = ZoneId.of("Asia/Kolkata");

    /** How late a "has started" email may still go out (covers a pod restart at start time). */
    static final long LIVE_GRACE_MS = 30L * 60 * 1000;

    /** Largest "notify before" honoured; the admin dropdown offers 1–15 minutes. */
    static final int MAX_REMINDER_MINUTES = 60;

    /** Recipients per call to the notification service. */
    static final int CHUNK = 200;

    private final AssessmentNotificationMetadataRepository notificationMetadataRepository;
    private final AssessmentUserRegistrationRepository userRegistrationRepository;
    private final AssessmentInstituteMappingRepository instituteMappingRepository;
    private final AssessmentRepository assessmentRepository;
    private final NotificationService notificationService;
    private final AdminCoreServiceClient adminCoreServiceClient;
    private final AssessmentWorkflowEventPublisher assessmentWorkflowEventPublisher;

    @Value("${assessment.learner-notices.enabled:true}")
    private boolean enabled;

    /** Confirmation to a learner who just registered through the open link. */
    @Async
    public void sendRegistrationConfirmation(String assessmentId, String registrationId) {
        try {
            if (!enabled) return;
            Optional<Assessment> assessment = assessmentRepository.findById(assessmentId);
            Optional<AssessmentUserRegistration> registration = userRegistrationRepository.findById(registrationId);
            if (assessment.isEmpty() || registration.isEmpty() || !emailsLearners(assessment.get())) return;
            Optional<AssessmentNotificationMetadata> settings =
                    notificationMetadataRepository.findTopByAssessmentId(assessmentId);
            if (settings.isEmpty() || !settings.get().isParticipantWhenAssessmentCreated()) return;
            send(Kind.REGISTERED, assessment.get(), List.of(registration.get()), null);
        } catch (Exception e) {
            log.error("Registration confirmation failed for assessment {} registration {}",
                    assessmentId, registrationId, e);
        }
    }

    /**
     * "You have a new assessment" to learners already registered when the assessment is
     * published. The caller invokes this only on a real DRAFT -> PUBLISHED change.
     */
    @Async
    public void sendAssignedOnPublish(String assessmentId) {
        try {
            if (!enabled) return;
            Optional<Assessment> assessment = assessmentRepository.findById(assessmentId);
            if (assessment.isEmpty() || !emailsLearners(assessment.get())) return;
            Optional<AssessmentNotificationMetadata> settings =
                    notificationMetadataRepository.findTopByAssessmentId(assessmentId);
            if (settings.isEmpty() || !settings.get().isParticipantWhenAssessmentCreated()) return;
            send(Kind.ASSIGNED, assessment.get(), activeRegistrations(assessmentId), null);
        } catch (Exception e) {
            log.error("Assigned-assessment email failed for assessment {}", assessmentId, e);
        }
    }

    /** Every minute: send the reminder and "has started" emails that are due. */
    @Scheduled(fixedDelayString = "${assessment.learner-notices.interval-ms:60000}",
            initialDelayString = "${assessment.learner-notices.initial-delay-ms:90000}")
    public void sendDueNotices() {
        if (!enabled) return;
        Date now = new Date();
        List<AssessmentNotificationMetadata> candidates;
        try {
            candidates = notificationMetadataRepository.findLearnerNoticeCandidates(
                    AssessmentStatus.PUBLISHED.name(),
                    new Date(now.getTime() - LIVE_GRACE_MS),
                    new Date(now.getTime() + MAX_REMINDER_MINUTES * 60_000L));
        } catch (Exception e) {
            log.error("Learner notice scan failed", e);
            return;
        }
        for (AssessmentNotificationMetadata settings : candidates) {
            try {
                sendDue(settings, now);
            } catch (Exception e) {
                log.error("Learner notice failed for assessment {}",
                        settings.getAssessment() != null ? settings.getAssessment().getId() : null, e);
            }
        }
    }

    void sendDue(AssessmentNotificationMetadata settings, Date now) {
        Assessment assessment = settings.getAssessment();
        if (assessment == null || assessment.getBoundStartTime() == null
                || !emailsLearners(assessment) || !hasFixedStart(assessment)) return;
        Date start = assessment.getBoundStartTime();
        long msToStart = start.getTime() - now.getTime();

        Integer before = settings.getParticipantBeforeAssessmentGoesLive();
        if (before != null && before > 0 && before <= MAX_REMINDER_MINUTES
                && msToStart > 0 && msToStart <= before * 60_000L
                && notificationMetadataRepository.claimReminder(settings.getId(), start) == 1) {
            List<AssessmentUserRegistration> recipients = activeRegistrations(assessment.getId());
            send(Kind.REMINDER, assessment, recipients, before);
            // Lets an institute add its own reminder (WhatsApp, a parent nudge) off the same moment.
            assessmentWorkflowEventPublisher.publishReminderBeforeStart(assessment, recipients, before);
        }

        if (settings.isParticipantWhenAssessmentLive()
                && msToStart <= 0 && -msToStart < LIVE_GRACE_MS
                && notificationMetadataRepository.claimLive(settings.getId(), start) == 1) {
            send(Kind.LIVE, assessment, activeRegistrations(assessment.getId()), null);
        }
    }

    /** play_mode an offline paper is stored with in production (alongside the enum's MANUAL_UPLOAD). */
    static final String PLAY_MODE_MANUAL_UPLOAD_EXAM = "MANUAL_UPLOAD_EXAM";
    static final String TYPE_HOMEWORK = "HOMEWORK";

    /**
     * Offline papers (the learner writes on paper, the admin uploads it) and partner-API exams
     * have nothing for the learner to open, and homework has its own flow — none of them get
     * these emails.
     */
    static boolean emailsLearners(Assessment assessment) {
        if (ApiCandidatePolicy.isApiExam(assessment)) return false;
        String playMode = assessment.getPlayMode();
        if (AssessmentModeEnum.MANUAL_UPLOAD.name().equals(playMode)
                || PLAY_MODE_MANUAL_UPLOAD_EXAM.equals(playMode)
                || TYPE_HOMEWORK.equals(playMode)) {
            return false;
        }
        String type = assessment.getAssessmentType();
        return !AssessmentTypeEnum.MANUAL_UPLOAD_EXAM.name().equals(type) && !TYPE_HOMEWORK.equals(type);
    }

    /**
     * "Starts in N minutes" and "has started" only make sense for a test everyone takes at a set
     * time. Mock, practice and survey tests open "anytime" — their start is usually the moment
     * they were created — so they get neither.
     */
    static boolean hasFixedStart(Assessment assessment) {
        return AssessmentModeEnum.EXAM.name().equals(assessment.getPlayMode());
    }

    private List<AssessmentUserRegistration> activeRegistrations(String assessmentId) {
        return userRegistrationRepository.findByInstituteIdAndAssessmentIdAndStatusIn(
                assessmentId, List.of(CompanyStatus.ACTIVE.name()));
    }

    private void send(Kind kind, Assessment assessment, List<AssessmentUserRegistration> registrations,
                      Integer minutesBefore) {
        List<NotificationToUserDTO> users = new ArrayList<>();
        for (AssessmentUserRegistration registration : registrations) {
            if (registration == null || ApiCandidatePolicy.isApi(registration)
                    || !StringUtils.hasText(registration.getUserEmail())) {
                continue;
            }
            String name = StringUtils.hasText(registration.getParticipantName())
                    ? registration.getParticipantName().trim() : "there";
            users.add(NotificationToUserDTO.builder()
                    .userId(registration.getUserId())
                    .channelId(registration.getUserEmail().trim())
                    .placeholders(Map.of("learner_name", name))
                    .build());
        }
        if (users.isEmpty()) return;

        Optional<AssessmentInstituteMapping> mapping = instituteMappingRepository.findTopByAssessmentId(assessment.getId());
        String instituteId = mapping.map(AssessmentInstituteMapping::getInstituteId)
                .orElse(registrations.get(0).getInstituteId());
        AdminCoreServiceClient.LearnerMailInstitute institute = adminCoreServiceClient.getLearnerMailInstitute(instituteId);

        LearnerAssessmentEmailBody.Content content = LearnerAssessmentEmailBody.build(
                kind,
                institute == null ? null
                        : new LearnerAssessmentEmailBody.Institute(institute.name(), institute.themeCode(), institute.logoUrl()),
                new LearnerAssessmentEmailBody.Details(
                        assessment.getName(), assessment.getBoundStartTime(), assessment.getBoundEndTime(),
                        assessment.getDuration(), minutesBefore,
                        joinLink(institute, mapping.map(AssessmentInstituteMapping::getAssessmentUrl).orElse(null))),
                ZONE);

        for (int i = 0; i < users.size(); i += CHUNK) {
            NotificationDTO dto = NotificationDTO.builder()
                    .subject(content.subject())
                    .body(content.html())
                    .source(NotificationSourceEnum.ASSESSMENT.name())
                    .sourceId(assessment.getId())
                    .notificationType(NotificationType.EMAIL.name())
                    .users(users.subList(i, Math.min(i + CHUNK, users.size())))
                    .build();
            // instituteId picks the institute's own sender address and name.
            notificationService.sendEmailToUsers(dto, instituteId);
        }
        log.info("Sent {} {} email(s) for assessment {}", users.size(), kind, assessment.getId());
    }

    /**
     * The same link the admin shares: {@code <institute learner domain>/register?code=<code>}.
     * Opening it signed in goes straight to the start screen. Null when the institute has no
     * learner domain of its own — the email then has no button rather than a shared domain.
     */
    static String joinLink(AdminCoreServiceClient.LearnerMailInstitute institute, String code) {
        if (institute == null || !StringUtils.hasText(institute.learnerPortalUrl()) || !StringUtils.hasText(code)) {
            return null;
        }
        String base = institute.learnerPortalUrl().trim().replaceAll("/+$", "");
        if (!base.startsWith("http")) base = "https://" + base;
        return base + "/register?code=" + code.trim();
    }
}
