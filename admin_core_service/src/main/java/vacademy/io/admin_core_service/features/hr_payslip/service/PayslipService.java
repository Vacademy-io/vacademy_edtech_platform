package vacademy.io.admin_core_service.features.hr_payslip.service;

import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.util.StringUtils;
import vacademy.io.admin_core_service.core.security.HrAccessGuard;
import vacademy.io.admin_core_service.features.hr_payroll.entity.PayrollEntry;
import vacademy.io.admin_core_service.features.hr_payroll.entity.PayrollEntryComponent;
import vacademy.io.admin_core_service.features.hr_payroll.entity.PayrollRun;
import vacademy.io.admin_core_service.features.hr_payroll.enums.PayrollEntryStatus;
import vacademy.io.admin_core_service.features.hr_payroll.enums.PayrollStatus;
import vacademy.io.admin_core_service.features.hr_payroll.repository.PayrollEntryRepository;
import vacademy.io.admin_core_service.features.hr_payroll.repository.PayrollRunRepository;
import vacademy.io.admin_core_service.features.hr_payslip.dto.FileDownloadDTO;
import vacademy.io.admin_core_service.features.hr_payslip.dto.PayslipDTO;
import vacademy.io.admin_core_service.features.hr_payslip.dto.PayslipEmailResultDTO;
import vacademy.io.admin_core_service.features.hr_payslip.entity.Payslip;
import vacademy.io.admin_core_service.features.hr_payslip.repository.PayslipRepository;
import vacademy.io.admin_core_service.features.notification_service.service.NotificationService;
import vacademy.io.common.auth.entity.User;
import vacademy.io.common.auth.model.CustomUserDetails;
import vacademy.io.common.auth.repository.UserRepository;
import vacademy.io.common.exceptions.VacademyException;
import vacademy.io.common.media.dto.FileDetailsDTO;
import vacademy.io.common.notification.dto.AttachmentNotificationDTO;
import vacademy.io.common.notification.dto.AttachmentUsersDTO;

import java.time.LocalDateTime;
import java.time.Month;
import java.time.format.TextStyle;
import java.util.ArrayList;
import java.util.Base64;
import java.util.HashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Optional;
import java.util.stream.Collectors;

@Slf4j
@Service
public class PayslipService {

    private static final String EMAIL_STATUS_NOT_SENT = "NOT_SENT";
    private static final String EMAIL_STATUS_SENT = "SENT";
    private static final String EMAIL_STATUS_FAILED = "FAILED";

    @Autowired
    private PayslipRepository payslipRepository;

    @Autowired
    private PayrollRunRepository payrollRunRepository;

    @Autowired
    private PayrollEntryRepository payrollEntryRepository;

    @Autowired
    private HrAccessGuard hrAccessGuard;

    @Autowired
    private HrFileStorageService fileStorageService;

    @Autowired
    private NotificationService notificationService;

    @Autowired
    private UserRepository userRepository;

    @Transactional
    public String generatePayslips(String payrollRunId, String instituteId) {
        PayrollRun run = payrollRunRepository.findById(payrollRunId)
                .orElseThrow(() -> new VacademyException("Payroll run not found"));
        hrAccessGuard.requireInstituteMatch(run.getInstituteId(), instituteId, "Payroll run");

        // Payroll must be at least PROCESSED (and not cancelled) to generate payslips
        String status = run.getStatus();
        if (PayrollStatus.DRAFT.name().equals(status)
                || PayrollStatus.PROCESSING.name().equals(status)
                || PayrollStatus.CANCELLED.name().equals(status)) {
            throw new VacademyException("Payroll run must be PROCESSED or later to generate payslips. Current status: " + status);
        }

        // Get all payroll entries for this run
        List<PayrollEntry> entries = payrollEntryRepository.findByPayrollRunIdOrderByEmployeeEmployeeCodeAsc(payrollRunId);

        if (entries.isEmpty()) {
            throw new VacademyException("No payroll entries found for this run");
        }

        Map<String, User> userMap = buildUserMap(entries);

        int generated = 0;
        int regenerated = 0;
        for (PayrollEntry entry : entries) {
            // Skip entries with HELD status
            if (PayrollEntryStatus.HELD.name().equals(entry.getStatus())) {
                continue;
            }

            Optional<Payslip> existingPayslip = payslipRepository.findByPayrollEntryId(entry.getId());
            if (existingPayslip.isPresent()) {
                // Skip payslips that already have a real media file; regenerate legacy
                // rows that stored raw HTML in file_url (pre-PDF pipeline).
                Payslip existing = existingPayslip.get();
                if (!hasRealMediaFile(existing)) {
                    renderAndStorePdf(existing, entry, run, resolveUserName(userMap, entry));
                    payslipRepository.save(existing);
                    regenerated++;
                }
                continue;
            }

            Payslip payslip = new Payslip();
            payslip.setPayrollEntry(entry);
            payslip.setEmployee(entry.getEmployee());
            payslip.setInstituteId(run.getInstituteId());
            payslip.setMonth(run.getMonth());
            payslip.setYear(run.getYear());
            payslip.setGeneratedAt(LocalDateTime.now());
            payslip.setCurrency(entry.getCurrency() != null ? entry.getCurrency() : "INR");
            payslip.setEmailStatus(EMAIL_STATUS_NOT_SENT);
            renderAndStorePdf(payslip, entry, run, resolveUserName(userMap, entry));

            payslipRepository.save(payslip);
            generated++;
        }

        String result = "Generated " + generated + " payslips for payroll run " + payrollRunId;
        if (regenerated > 0) {
            result += " (regenerated " + regenerated + " legacy payslips as PDF)";
        }
        return result;
    }

    @Transactional(readOnly = true)
    public List<PayslipDTO> getPayslips(String employeeId, Integer year) {
        List<Payslip> payslips;
        if (year != null) {
            payslips = payslipRepository.findByEmployeeIdAndYear(employeeId, year);
        } else {
            payslips = payslipRepository.findByEmployeeIdOrderByYearDescMonthDesc(employeeId);
        }

        return payslips.stream().map(this::toDTO).collect(Collectors.toList());
    }

    @Transactional(readOnly = true)
    public PayslipDTO getPayslipById(String id, String instituteId, CustomUserDetails user) {
        Payslip payslip = payslipRepository.findById(id)
                .orElseThrow(() -> new VacademyException("Payslip not found"));
        hrAccessGuard.requireInstituteMatch(payslip.getInstituteId(), instituteId, "Payslip");
        // Only HR staff or the payslip's own employee may read it
        hrAccessGuard.requireSelfOrHrStaff(user, instituteId, payslip.getEmployee().getId());
        return toDTO(payslip);
    }

    /**
     * Streams the payslip PDF. Same self-or-staff rule as {@link #getPayslipById}.
     * Legacy rows (raw HTML in file_url) and expired media files are re-rendered
     * and persisted on the fly.
     */
    @Transactional
    public FileDownloadDTO downloadPayslipPdf(String id, String instituteId, CustomUserDetails user) {
        Payslip payslip = payslipRepository.findById(id)
                .orElseThrow(() -> new VacademyException("Payslip not found"));
        hrAccessGuard.requireInstituteMatch(payslip.getInstituteId(), instituteId, "Payslip");
        hrAccessGuard.requireSelfOrHrStaff(user, instituteId, payslip.getEmployee().getId());

        byte[] bytes = getOrRenderPdf(payslip);
        String employeeCode = payslip.getEmployee().getEmployeeCode() != null
                ? payslip.getEmployee().getEmployeeCode() : "employee";
        String fileName = "payslip_" + employeeCode + "_" + payslip.getMonth() + "_" + payslip.getYear() + ".pdf";
        return FileDownloadDTO.builder()
                .fileName(fileName)
                .contentType("application/pdf")
                .bytes(bytes)
                .build();
    }

    /**
     * Emails each employee of a payroll run their payslip PDF as an attachment.
     * Processes resiliently: one employee's failure never stops the rest; each
     * payslip's email_status is updated to SENT/FAILED individually.
     */
    @Transactional
    public PayslipEmailResultDTO emailPayslips(String payrollRunId, String instituteId) {
        PayrollRun run = payrollRunRepository.findById(payrollRunId)
                .orElseThrow(() -> new VacademyException("Payroll run not found"));
        hrAccessGuard.requireInstituteMatch(run.getInstituteId(), instituteId, "Payroll run");

        List<Payslip> payslips = payslipRepository.findByPayrollEntryPayrollRunIdOrderByEmployeeEmployeeCodeAsc(payrollRunId);
        if (payslips.isEmpty()) {
            throw new VacademyException("No payslips generated for this payroll run yet");
        }

        List<String> userIds = payslips.stream()
                .map(p -> p.getEmployee().getUserId())
                .filter(StringUtils::hasText)
                .distinct()
                .collect(Collectors.toList());
        Map<String, User> userMap = userIds.isEmpty() ? Map.of()
                : userRepository.findByIdIn(userIds).stream()
                        .collect(Collectors.toMap(User::getId, u -> u, (a, b) -> a));

        String periodLabel = monthName(run.getMonth()) + " " + run.getYear();
        String subject = "Payslip " + periodLabel;

        int sent = 0;
        int failed = 0;
        List<PayslipEmailResultDTO.EmailOutcomeDTO> outcomes = new ArrayList<>();

        for (Payslip payslip : payslips) {
            String employeeCode = payslip.getEmployee().getEmployeeCode() != null
                    ? payslip.getEmployee().getEmployeeCode() : payslip.getEmployee().getId();
            String failureReason = null;
            try {
                User recipient = userMap.get(payslip.getEmployee().getUserId());
                String email = recipient != null ? recipient.getEmail() : null;
                if (!StringUtils.hasText(email)) {
                    failureReason = "No email on record for employee";
                } else {
                    byte[] pdfBytes = getOrRenderPdf(payslip);
                    String recipientName = recipient.getFullName() != null ? recipient.getFullName() : employeeCode;
                    var response = notificationService.sendAttachmentEmailViaUnified(
                            List.of(buildPayslipEmail(payslip, subject, periodLabel, recipientName, email,
                                    recipient.getId(), pdfBytes, employeeCode)),
                            instituteId);
                    if (response != null && response.getFailed() > 0) {
                        failureReason = "Notification service reported delivery failure";
                    }
                }
            } catch (Exception e) {
                failureReason = e.getMessage();
                log.error("[PAYSLIP-EMAIL] Failed to email payslip {} (employee {}): {}",
                        payslip.getId(), employeeCode, e.getMessage());
            }

            if (failureReason == null) {
                payslip.setEmailStatus(EMAIL_STATUS_SENT);
                payslip.setEmailedAt(LocalDateTime.now());
                sent++;
            } else {
                payslip.setEmailStatus(EMAIL_STATUS_FAILED);
                log.warn("[PAYSLIP-EMAIL] Payslip {} (employee {}) marked FAILED: {}",
                        payslip.getId(), employeeCode, failureReason);
                failed++;
            }
            payslipRepository.save(payslip);

            outcomes.add(PayslipEmailResultDTO.EmailOutcomeDTO.builder()
                    .payslipId(payslip.getId())
                    .employeeCode(employeeCode)
                    .status(failureReason == null ? EMAIL_STATUS_SENT : EMAIL_STATUS_FAILED)
                    .reason(failureReason)
                    .build());
        }

        return PayslipEmailResultDTO.builder()
                .total(payslips.size())
                .sent(sent)
                .failed(failed)
                .outcomes(outcomes)
                .build();
    }

    // -----------------------------------------------------------------------
    // PDF pipeline
    // -----------------------------------------------------------------------

    /** True when file_id points at a real media_service file (not the legacy fake-UUID + raw-HTML rows). */
    private boolean hasRealMediaFile(Payslip payslip) {
        if (!StringUtils.hasText(payslip.getFileId())) {
            return false;
        }
        // Legacy rows stored the full payslip HTML in file_url with a random UUID as file_id.
        String fileUrl = payslip.getFileUrl();
        return fileUrl == null || !fileUrl.trim().startsWith("<");
    }

    /** Renders the payslip PDF, uploads it to media_service and sets the real fileId/fileUrl. Returns the bytes. */
    private byte[] renderAndStorePdf(Payslip payslip, PayrollEntry entry, PayrollRun run, String employeeName) {
        String html = buildPayslipHtml(entry, run, employeeName);
        byte[] pdfBytes = fileStorageService.htmlToPdf(html);
        String employeeCode = entry.getEmployee().getEmployeeCode() != null
                ? entry.getEmployee().getEmployeeCode() : "employee";
        String fileName = "payslip_" + employeeCode + "_" + run.getMonth() + "_" + run.getYear() + ".pdf";
        FileDetailsDTO details = fileStorageService.uploadBytes(fileName, "application/pdf", pdfBytes);
        payslip.setFileId(details.getId());
        payslip.setFileUrl(details.getUrl());
        payslip.setGeneratedAt(LocalDateTime.now());
        return pdfBytes;
    }

    /**
     * Returns the payslip's PDF bytes: from media_service when the stored file
     * resolves, otherwise re-rendered (and persisted) from the payroll entry.
     */
    private byte[] getOrRenderPdf(Payslip payslip) {
        if (hasRealMediaFile(payslip)) {
            byte[] cached = fileStorageService.downloadBytes(payslip.getFileId());
            if (cached != null && cached.length > 0) {
                return cached;
            }
            log.warn("[PAYSLIP] Stored file_id={} for payslip {} could not be resolved; re-rendering",
                    payslip.getFileId(), payslip.getId());
        }

        PayrollEntry entry = payslip.getPayrollEntry();
        PayrollRun run = entry.getPayrollRun();
        Map<String, User> userMap = buildUserMap(List.of(entry));
        byte[] pdfBytes = renderAndStorePdf(payslip, entry, run, resolveUserName(userMap, entry));
        payslipRepository.save(payslip);
        return pdfBytes;
    }

    private AttachmentNotificationDTO buildPayslipEmail(Payslip payslip, String subject, String periodLabel,
                                                        String recipientName, String email, String userId,
                                                        byte[] pdfBytes, String employeeCode) {
        String attachmentName = "payslip_" + employeeCode + "_" + payslip.getMonth() + "_" + payslip.getYear() + ".pdf";

        AttachmentUsersDTO.AttachmentDTO attachmentDTO = new AttachmentUsersDTO.AttachmentDTO();
        attachmentDTO.setAttachmentName(attachmentName);
        attachmentDTO.setAttachment(Base64.getEncoder().encodeToString(pdfBytes));

        AttachmentUsersDTO toUser = new AttachmentUsersDTO();
        toUser.setChannelId(email);
        toUser.setUserId(userId);
        toUser.setPlaceholders(Map.of("email", email));
        toUser.setAttachments(List.of(attachmentDTO));

        String body = "<html><body>"
                + "<p>Dear " + escHtml(recipientName) + ",</p>"
                + "<p>Please find attached your payslip for " + escHtml(periodLabel) + ".</p>"
                + "<p>This is an auto-generated email. Please contact HR for any discrepancies.</p>"
                + "<p>Regards,<br/>HR Department</p>"
                + "</body></html>";

        return AttachmentNotificationDTO.builder()
                .body(body)
                .subject(subject)
                .notificationType("EMAIL")
                .source("HR_PAYSLIP")
                .sourceId(payslip.getId())
                .users(List.of(toUser))
                .emailType("UTILITY_EMAIL")
                .build();
    }

    // -----------------------------------------------------------------------
    // HTML template
    // -----------------------------------------------------------------------

    private String buildPayslipHtml(PayrollEntry entry, PayrollRun run, String employeeName) {
        String employeeCode = entry.getEmployee().getEmployeeCode() != null
                ? entry.getEmployee().getEmployeeCode() : "N/A";
        String monthYear = monthName(run.getMonth()) + " " + run.getYear();
        String currency = entry.getCurrency() != null ? entry.getCurrency() : "INR";

        StringBuilder html = new StringBuilder();
        html.append("<html><head><style>");
        html.append("body{font-family:Arial,sans-serif;margin:20px}");
        html.append("h2{text-align:center}");
        html.append("table{width:100%;border-collapse:collapse;margin-top:10px}");
        html.append("th,td{border:1px solid #ccc;padding:8px;text-align:left}");
        html.append("th{background:#f5f5f5}");
        html.append(".total{font-weight:bold;background:#e8f5e9}");
        html.append("</style></head><body>");
        html.append("<h2>Payslip - ").append(escHtml(monthYear)).append("</h2>");
        if (StringUtils.hasText(employeeName)) {
            html.append("<p><strong>Employee:</strong> ").append(escHtml(employeeName)).append("</p>");
        }
        html.append("<p><strong>Employee Code:</strong> ").append(escHtml(employeeCode)).append("</p>");
        html.append("<p><strong>Period:</strong> ").append(escHtml(monthYear)).append("</p>");
        html.append("<p><strong>Currency:</strong> ").append(escHtml(currency)).append("</p>");
        html.append("<hr/>");

        // Earnings and deductions table (amounts are in the entry's currency)
        html.append("<table><thead><tr><th>Component</th><th>Type</th><th>Amount (")
                .append(escHtml(currency)).append(")</th></tr></thead><tbody>");

        List<PayrollEntryComponent> components = entry.getEntryComponents();
        if (components != null) {
            for (PayrollEntryComponent comp : components) {
                String compName = comp.getComponent() != null && comp.getComponent().getName() != null
                        ? comp.getComponent().getName() : "Unknown";
                String compType = comp.getComponentType() != null ? comp.getComponentType() : "";
                html.append("<tr><td>").append(escHtml(compName)).append("</td>")
                        .append("<td>").append(escHtml(compType)).append("</td>")
                        .append("<td>").append(comp.getAmount()).append("</td></tr>");
            }
        }

        html.append("</tbody></table>");

        // Summary
        html.append("<table style='margin-top:20px'>");
        html.append("<tr><td><strong>Gross Salary</strong></td><td>").append(entry.getGrossSalary()).append("</td></tr>");
        if (entry.getTotalEarnings() != null) {
            html.append("<tr><td><strong>Total Earnings</strong></td><td>").append(entry.getTotalEarnings()).append("</td></tr>");
        }
        if (entry.getTotalDeductions() != null) {
            html.append("<tr><td><strong>Total Deductions</strong></td><td>").append(entry.getTotalDeductions()).append("</td></tr>");
        }
        html.append("<tr class='total'><td><strong>Net Pay</strong></td><td>").append(entry.getNetPay()).append("</td></tr>");
        html.append("</table>");

        html.append("</body></html>");
        return html.toString();
    }

    // -----------------------------------------------------------------------
    // Helpers
    // -----------------------------------------------------------------------

    private Map<String, User> buildUserMap(List<PayrollEntry> entries) {
        List<String> userIds = entries.stream()
                .map(e -> e.getEmployee().getUserId())
                .filter(StringUtils::hasText)
                .distinct()
                .collect(Collectors.toList());
        if (userIds.isEmpty()) {
            return new HashMap<>();
        }
        return userRepository.findByIdIn(userIds).stream()
                .collect(Collectors.toMap(User::getId, u -> u, (a, b) -> a));
    }

    private String resolveUserName(Map<String, User> userMap, PayrollEntry entry) {
        User user = userMap.get(entry.getEmployee().getUserId());
        if (user == null) {
            return null;
        }
        return user.getFullName() != null ? user.getFullName() : user.getUsername();
    }

    private static String monthName(Integer month) {
        if (month == null || month < 1 || month > 12) {
            return String.valueOf(month);
        }
        return Month.of(month).getDisplayName(TextStyle.FULL, Locale.ENGLISH);
    }

    private static String escHtml(String s) {
        if (s == null) return "";
        return s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;").replace("\"", "&quot;");
    }

    private PayslipDTO toDTO(Payslip p) {
        return PayslipDTO.builder()
                .id(p.getId())
                .payrollEntryId(p.getPayrollEntry().getId())
                .employeeId(p.getEmployee().getId())
                .employeeCode(p.getEmployee().getEmployeeCode())
                .instituteId(p.getInstituteId())
                .month(p.getMonth())
                .year(p.getYear())
                .fileId(p.getFileId())
                .fileUrl(p.getFileUrl())
                .generatedAt(p.getGeneratedAt())
                .emailedAt(p.getEmailedAt())
                .emailStatus(p.getEmailStatus())
                .currency(p.getCurrency() != null ? p.getCurrency() : "INR")
                .build();
    }
}
