package vacademy.io.assessment_service.features.assessment.notification;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.util.StringUtils;
import vacademy.io.assessment_service.features.assessment.entity.StudentAttempt;
import vacademy.io.assessment_service.features.client.AdminCoreServiceClient;
import vacademy.io.assessment_service.features.notification.dto.unified.UnifiedSendRequest;
import vacademy.io.assessment_service.features.notification.service.NotificationService;
import vacademy.io.assessment_service.features.open_evaluation.policy.ApiCandidatePolicy;
import vacademy.io.common.media.service.FileService;
import vacademy.io.common.notification.dto.AttachmentNotificationDTO;
import vacademy.io.common.notification.dto.AttachmentUsersDTO;

import java.util.*;

/**
 * The learner's result notification when results are released: an email with the report PDF
 * attached, and a WhatsApp template with the PDF as its document when one is bound.
 *
 * <p>Templates come from admin_core (event ASSESSMENT_RESULT_RELEASED): the assessment's own
 * binding, else the institute's, else the seeded DEFAULT email. Every per-learner value the
 * report shows (student_name, score, rank, scholarship_percent, ...) can be used as
 * {{placeholder}} in the email, or by name as a WhatsApp template variable.
 */
@Slf4j
@Service
public class ResultNotificationService {

    public static final String SOURCE = "ASSESSMENT_REPORT";

    private final AdminCoreServiceClient adminCore;
    private final NotificationService notificationService;
    private final FileService fileService;
    private final ObjectMapper objectMapper = new ObjectMapper();

    public ResultNotificationService(AdminCoreServiceClient adminCore, NotificationService notificationService,
                                     FileService fileService) {
        this.adminCore = adminCore;
        this.notificationService = notificationService;
        this.fileService = fileService;
    }

    /** One learner's report and the values their messages use. */
    public record Item(StudentAttempt attempt, byte[] pdf, Map<String, String> variables) {
    }

    /** The templates for one release, looked up once. */
    public record Templates(Map<String, Object> email, Map<String, Object> whatsapp) {
    }

    public Templates resolve(String instituteId, String assessmentId) {
        return new Templates(adminCore.resolveResultTemplate(instituteId, assessmentId, "EMAIL"),
                adminCore.resolveResultTemplate(instituteId, assessmentId, "WHATSAPP"));
    }

    // ── Email ──

    /** Sends the result email with the PDF attached. Falls back to the built-in body if no template resolves. */
    public void sendEmails(List<Item> items, String assessmentId, String instituteId, Templates templates) {
        List<AttachmentUsersDTO> users = new ArrayList<>();
        for (Item item : items) {
            var reg = item.attempt().getRegistration();
            if (reg == null || !ApiCandidatePolicy.mayMessage(reg) || !StringUtils.hasText(reg.getUserEmail()) || item.pdf() == null) continue;
            Map<String, String> placeholders = new HashMap<>(item.variables() == null ? Map.of() : item.variables());
            placeholders.putIfAbsent("learner_name", Objects.toString(reg.getParticipantName(), ""));
            placeholders.putIfAbsent("student_name", Objects.toString(reg.getParticipantName(), ""));
            AttachmentUsersDTO user = new AttachmentUsersDTO();
            user.setChannelId(reg.getUserEmail());
            user.setUserId(reg.getUserId());
            user.setPlaceholders(placeholders);
            AttachmentUsersDTO.AttachmentDTO att = new AttachmentUsersDTO.AttachmentDTO();
            att.setAttachmentName(fileName(item));
            att.setAttachment(Base64.getEncoder().encodeToString(item.pdf()));
            user.setAttachments(List.of(att));
            users.add(user);
        }
        if (users.isEmpty()) return;

        Map<String, Object> t = templates == null ? null : templates.email();
        AttachmentNotificationDTO dto = AttachmentNotificationDTO.builder().build();
        if (t != null && StringUtils.hasText((String) t.get("content"))) {
            dto.setSubject(StringUtils.hasText((String) t.get("subject")) ? (String) t.get("subject") : "Your result for {{assessment_name}} is ready");
            dto.setBody((String) t.get("content"));
        } else {
            dto.setSubject("Your result for {{assessment_name}} is ready");
            dto.setBody(AssessmentNotificationEmailBody.getAssessmentReportBody());
        }
        dto.setSource(SOURCE);
        dto.setSourceId(assessmentId);
        dto.setNotificationType("EMAIL");
        dto.setUsers(users);
        notificationService.sendAttachmentEmailToUsers(dto, instituteId);
    }

    // ── WhatsApp ──

    /**
     * Sends the bound WhatsApp template with each learner's report as the document header.
     * Learners whose report was not uploaded (no file id) or who have no phone are skipped.
     *
     * @return how many learners were handed to the notification service
     */
    public int sendWhatsApps(List<Item> items, String assessmentId, String instituteId, Templates templates) {
        Map<String, Object> t = templates == null ? null : templates.whatsapp();
        if (t == null || !StringUtils.hasText((String) t.get("name"))) return 0;
        List<UnifiedSendRequest.Recipient> recipients = new ArrayList<>();
        for (Item item : items) {
            var reg = item.attempt().getRegistration();
            if (reg == null || ApiCandidatePolicy.isApi(reg) || !StringUtils.hasText(reg.getPhoneNumber())) continue;
            String fileId = item.attempt().getReportPdfFileId();
            if (!StringUtils.hasText(fileId)) continue;
            String url;
            try {
                url = fileService.getPublicUrlForFileId(fileId);
            } catch (Exception e) {
                log.warn("[result-notify] no link for report of attempt {}: {}", item.attempt().getId(), e.getMessage());
                continue;
            }
            if (!StringUtils.hasText(url)) continue;
            Map<String, String> vars = new HashMap<>(item.variables() == null ? Map.of() : item.variables());
            vars.put("_headerUrl", url);
            recipients.add(UnifiedSendRequest.Recipient.builder()
                    .phone(reg.getPhoneNumber())
                    .name(reg.getParticipantName())
                    .userId(reg.getUserId())
                    .variables(vars)
                    .build());
        }
        if (recipients.isEmpty()) return 0;
        boolean ok = notificationService.sendWhatsAppTemplate(instituteId, (String) t.get("name"), language(t),
                recipients, "document", SOURCE, assessmentId);
        if (!ok) log.warn("[result-notify] WhatsApp batch for assessment {} was not accepted", assessmentId);
        return ok ? recipients.size() : 0;
    }

    private String language(Map<String, Object> t) {
        try {
            String setting = (String) t.get("setting_json");
            if (StringUtils.hasText(setting)) {
                JsonNode n = objectMapper.readTree(setting);
                for (String key : new String[]{"language_code", "languageCode", "language"}) {
                    if (StringUtils.hasText(n.path(key).asText(""))) return n.path(key).asText();
                }
            }
        } catch (Exception ignored) {
            // fall through
        }
        return "en";
    }

    private static String fileName(Item item) {
        String name = item.variables() == null ? null : item.variables().get("assessment_name");
        String safe = (name == null ? "Result" : name).replaceAll("[^A-Za-z0-9 _.-]", "").trim();
        return (safe.isEmpty() ? "Result" : safe) + ".pdf";
    }
}
