package vacademy.io.admin_core_service.features.hr_employee.service;

import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;
import vacademy.io.admin_core_service.features.hr_employee.entity.EmployeeProfile;
import vacademy.io.admin_core_service.features.hr_employee.repository.EmployeeProfileRepository;
import vacademy.io.admin_core_service.features.notification_service.service.NotificationService;
import vacademy.io.common.auth.entity.User;
import vacademy.io.common.auth.repository.UserRepository;

import java.util.ArrayList;
import java.util.List;
import java.util.Optional;

/**
 * Best-effort email dispatch for HR flows (leave/comp-off/regularization
 * decisions, loans, reimbursements, lifecycle reminders).
 *
 * Every send is wrapped so a notification-service blip can NEVER fail or roll
 * back the business operation that triggered it — callers just call, no
 * try/catch needed on their side.
 *
 * Employee emails are resolved through the same user-identity join the rest of
 * hr_attendance uses (EmployeeProfile.userId → common auth users table).
 *
 * "The institute's HR" recipients are the users holding an ACTIVE HR_ADMIN
 * role for the institute (falling back to ADMIN when no HR_ADMIN exists, and
 * finally to the employee's reporting manager) — resolved via the same
 * user_role join scheduled reporting already uses.
 */
@Slf4j
@Service
public class HrNotificationService {

    private static final String EMAIL_TYPE = "UTILITY_EMAIL";

    @Autowired
    private NotificationService notificationService;

    @Autowired
    private UserRepository userRepository;

    @Autowired
    private EmployeeProfileRepository employeeProfileRepository;

    /** Email the employee behind this profile. Silently no-ops when no email is on file. */
    public void emailEmployee(EmployeeProfile employee, String subject, String bodyHtml) {
        if (employee == null) {
            return;
        }
        emailUser(employee.getUserId(), employee.getInstituteId(), subject, bodyHtml);
    }

    /** Email a user by auth userId. Failures are logged, never thrown. */
    public void emailUser(String userId, String instituteId, String subject, String bodyHtml) {
        try {
            String email = resolveUserEmail(userId);
            if (email == null || email.isBlank()) {
                log.warn("[hr-notify] no email on file for user {} — '{}' not sent", userId, subject);
                return;
            }
            notificationService.sendHtmlEmailViaUnified(
                    email, subject, bodyHtml, instituteId, null, null, EMAIL_TYPE);
        } catch (Exception e) {
            log.warn("[hr-notify] failed to send '{}' to user {}: {}", subject, userId, e.getMessage());
        }
    }

    /**
     * Email the institute's HR: ACTIVE HR_ADMIN role holders, else ACTIVE
     * ADMINs, else the given employee's reporting manager (when provided).
     * Failures are logged, never thrown.
     */
    public void emailInstituteHr(String instituteId, String fallbackEmployeeId, String subject, String bodyHtml) {
        try {
            List<String> recipients = resolveHrEmails(instituteId, fallbackEmployeeId);
            if (recipients.isEmpty()) {
                log.warn("[hr-notify] no HR recipient resolvable for institute {} — '{}' not sent",
                        instituteId, subject);
                return;
            }
            for (String email : recipients) {
                try {
                    notificationService.sendHtmlEmailViaUnified(
                            email, subject, bodyHtml, instituteId, null, null, EMAIL_TYPE);
                } catch (Exception e) {
                    log.warn("[hr-notify] failed to send '{}' to {}: {}", subject, email, e.getMessage());
                }
            }
        } catch (Exception e) {
            log.warn("[hr-notify] failed to resolve HR recipients for institute {}: {}",
                    instituteId, e.getMessage());
        }
    }

    /** Display name for a user id ("Unknown" fallback) — for use in email bodies. */
    public String resolveUserName(String userId) {
        if (userId == null) {
            return "Unknown";
        }
        try {
            return userRepository.findById(userId)
                    .map(u -> u.getFullName() != null ? u.getFullName() : u.getUsername())
                    .orElse("Unknown");
        } catch (Exception e) {
            return "Unknown";
        }
    }

    /**
     * Renders a short, clean HTML mail body: a title line followed by
     * label/value rows. Values are HTML-escaped (they carry user-entered text
     * like rejection reasons).
     */
    public String buildEmailBody(String title, String... labelValuePairs) {
        StringBuilder rows = new StringBuilder();
        for (int i = 0; i + 1 < labelValuePairs.length; i += 2) {
            if (labelValuePairs[i + 1] == null) {
                continue;
            }
            rows.append("<tr><td style=\"padding:4px 12px 4px 0;color:#666;white-space:nowrap;\">")
                    .append(escapeHtml(labelValuePairs[i]))
                    .append("</td><td style=\"padding:4px 0;color:#222;\">")
                    .append(escapeHtml(labelValuePairs[i + 1]))
                    .append("</td></tr>");
        }
        return "<div style=\"font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#222;"
                + "max-width:560px;margin:0 auto;padding:16px;\">"
                + "<h2 style=\"font-size:17px;margin:0 0 12px;\">" + escapeHtml(title) + "</h2>"
                + "<table style=\"border-collapse:collapse;\">" + rows + "</table>"
                + "<p style=\"color:#999;font-size:12px;margin-top:16px;\">"
                + "This is an automated notification from your HR system.</p>"
                + "</div>";
    }

    private String resolveUserEmail(String userId) {
        if (userId == null) {
            return null;
        }
        return userRepository.findById(userId).map(User::getEmail).orElse(null);
    }

    private List<String> resolveHrEmails(String instituteId, String fallbackEmployeeId) {
        List<String> emails = emailsForRole(instituteId, "HR_ADMIN");
        if (emails.isEmpty()) {
            emails = emailsForRole(instituteId, "ADMIN");
        }
        if (emails.isEmpty() && fallbackEmployeeId != null) {
            Optional<String> managerUserId =
                    employeeProfileRepository.findReportingManagerUserId(fallbackEmployeeId);
            managerUserId.map(this::resolveUserEmail)
                    .filter(e -> e != null && !e.isBlank())
                    .ifPresent(emails::add);
        }
        return emails;
    }

    private List<String> emailsForRole(String instituteId, String roleName) {
        List<String> emails = new ArrayList<>();
        for (User user : userRepository.findByInstituteAndRoleNames(
                instituteId, List.of(roleName), List.of("ACTIVE"))) {
            if (user.getEmail() != null && !user.getEmail().isBlank()
                    && !emails.contains(user.getEmail())) {
                emails.add(user.getEmail());
            }
        }
        return emails;
    }

    private String escapeHtml(String value) {
        if (value == null) {
            return "";
        }
        return value.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
                .replace("\"", "&quot;");
    }
}
