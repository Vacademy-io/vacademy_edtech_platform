package vacademy.io.admin_core_service.features.student_analysis.service;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;
import org.springframework.util.StringUtils;
import vacademy.io.admin_core_service.features.domain_routing.entity.InstituteDomainRouting;
import vacademy.io.admin_core_service.features.domain_routing.repository.InstituteDomainRoutingRepository;
import vacademy.io.admin_core_service.features.institute.repository.InstituteRepository;
import vacademy.io.admin_core_service.features.institute_learner.entity.Student;
import vacademy.io.admin_core_service.features.institute_learner.repository.InstituteStudentRepository;
import vacademy.io.admin_core_service.features.notification.dto.UnifiedSendRequest;
import vacademy.io.admin_core_service.features.notification_service.service.NotificationService;
import vacademy.io.admin_core_service.features.student_analysis.entity.StudentAnalysisProcess;
import vacademy.io.admin_core_service.features.student_analysis.notification.StudentReportEmailBody;
import vacademy.io.common.institute.entity.Institute;

import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;

/**
 * Notifies the learner when their Student Report is COMPLETED.
 *
 * <p><b>Channels:</b> push + in-app system alert are ALWAYS sent; email is opt-out (default ON,
 * skipped only when {@code process.sendEmail == FALSE}). Every channel is best-effort — a failure
 * is logged and never propagated, so report generation is never affected.
 *
 * <p>All three carry a deep link to <code>/my-reports/&lt;processId&gt;</code> on the
 * institute's (white-label) learner portal, so clicking opens the exact report.
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class StudentReportNotificationService {

    private static final String DEFAULT_THEME = "#333333";
    private static final String REPORT_PATH = "/my-reports/";
    private static final String SOURCE = "STUDENT_REPORT_READY";

    private final NotificationService notificationService;
    private final InstituteStudentRepository studentRepository;
    private final InstituteRepository instituteRepository;
    private final InstituteDomainRoutingRepository domainRoutingRepository;

    @Value("${default.learner.portal.url:https://learner.vacademy.io}")
    private String defaultLearnerPortalUrl;

    public void notifyLearner(StudentAnalysisProcess process) {
        if (process == null || !StringUtils.hasText(process.getUserId())) {
            return;
        }
        String userId = process.getUserId();
        String instituteId = process.getInstituteId();
        String processId = process.getId();
        String reportName = StringUtils.hasText(process.getName()) ? process.getName() : "Your student report";

        // Resolve student (email + name) — best-effort
        Student student = null;
        try {
            List<Student> students = studentRepository.findByUserId(userId);
            if (students != null && !students.isEmpty()) {
                student = students.get(0);
            }
        } catch (Exception e) {
            log.warn("[ReportNotify] Could not load student for userId={}: {}", userId, e.getMessage());
        }
        String studentName = (student != null && StringUtils.hasText(student.getFullName()))
                ? student.getFullName() : "Learner";
        String email = student != null ? student.getEmail() : null;

        // Resolve institute (name + theme) — best-effort
        Institute institute = null;
        try {
            if (StringUtils.hasText(instituteId)) {
                institute = instituteRepository.findById(instituteId).orElse(null);
            }
        } catch (Exception e) {
            log.warn("[ReportNotify] Could not load institute {}: {}", instituteId, e.getMessage());
        }
        String instituteName = (institute != null && StringUtils.hasText(institute.getInstituteName()))
                ? institute.getInstituteName() : "Your Institute";
        String themeColor = (institute != null && StringUtils.hasText(institute.getInstituteThemeCode()))
                ? institute.getInstituteThemeCode() : DEFAULT_THEME;

        String reportUrl = buildReportUrl(institute, instituteId, processId);

        // Deep-link data consumed by the learner app's notification click handler
        Map<String, String> data = new HashMap<>();
        data.put("type", "student_report");
        data.put("action", "view_report");
        data.put("reportId", processId);
        data.put("actionUrl", reportUrl);
        data.put("path", REPORT_PATH + processId);

        String title = "Your report is ready";
        String body = reportName;

        // 1) PUSH — always
        try {
            notificationService.sendPushViaUnified(instituteId, List.of(userId), title, body, data);
        } catch (Exception e) {
            log.warn("[ReportNotify] Push failed for userId={} process={}: {}", userId, processId, e.getMessage());
        }

        // 2) IN-APP SYSTEM ALERT — always (sendUnified to carry the deep-link data)
        try {
            notificationService.sendUnified(UnifiedSendRequest.builder()
                    .instituteId(instituteId)
                    .channel("SYSTEM_ALERT")
                    .recipients(List.of(UnifiedSendRequest.Recipient.builder().userId(userId).build()))
                    .options(UnifiedSendRequest.SendOptions.builder()
                            .pushTitle(title)
                            .pushBody(body)
                            .pushData(data)
                            .source(SOURCE)
                            .sourceId(processId)
                            .build())
                    .build());
        } catch (Exception e) {
            log.warn("[ReportNotify] System alert failed for userId={} process={}: {}", userId, processId, e.getMessage());
        }

        // 3) EMAIL — opt-out (default ON); skip only if explicitly false
        boolean sendEmail = !Boolean.FALSE.equals(process.getSendEmail());
        if (sendEmail) {
            if (!StringUtils.hasText(email)) {
                log.info("[ReportNotify] No email on file for userId={}, skipping email", userId);
            } else {
                try {
                    String subject = "Your report \"" + reportName + "\" is ready";
                    String emailBody = StudentReportEmailBody.build(themeColor, instituteName, studentName, reportName, reportUrl);
                    notificationService.sendHtmlEmailViaUnified(email, subject, emailBody, instituteId, null, null, "UTILITY_EMAIL");
                } catch (Exception e) {
                    log.warn("[ReportNotify] Email failed for userId={} process={}: {}", userId, processId, e.getMessage());
                }
            }
        }
    }

    /**
     * Builds the deep link respecting the institute's white-label domain.
     * Order: institute_domain_routing (role=LEARNER) → Institute.learnerPortalBaseUrl → config default.
     */
    private String buildReportUrl(Institute institute, String instituteId, String processId) {
        try {
            if (StringUtils.hasText(instituteId)) {
                Optional<InstituteDomainRouting> routingOpt =
                        domainRoutingRepository.findByInstituteIdAndRole(instituteId, "LEARNER");
                if (routingOpt.isPresent() && StringUtils.hasText(routingOpt.get().getDomain())) {
                    InstituteDomainRouting r = routingOpt.get();
                    String cleanDomain = r.getDomain().trim().replaceAll("^https?://", "").replaceAll("/$", "");
                    String sub = r.getSubdomain();
                    String host = (sub == null || sub.trim().isEmpty() || "*".equals(sub.trim()))
                            ? cleanDomain : sub.trim() + "." + cleanDomain;
                    return "https://" + host + REPORT_PATH + processId;
                }
            }
        } catch (Exception e) {
            log.warn("[ReportNotify] Domain routing lookup failed for institute {}: {}", instituteId, e.getMessage());
        }

        if (institute != null && StringUtils.hasText(institute.getLearnerPortalBaseUrl())) {
            String base = institute.getLearnerPortalBaseUrl().trim();
            if (!base.startsWith("http://") && !base.startsWith("https://")) {
                base = "https://" + base;
            }
            if (base.endsWith("/")) {
                base = base.substring(0, base.length() - 1);
            }
            return base + REPORT_PATH + processId;
        }

        String base = defaultLearnerPortalUrl.endsWith("/")
                ? defaultLearnerPortalUrl.substring(0, defaultLearnerPortalUrl.length() - 1)
                : defaultLearnerPortalUrl;
        return base + REPORT_PATH + processId;
    }
}
