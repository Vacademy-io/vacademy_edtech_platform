package vacademy.io.notification_service.features.chat.service;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import vacademy.io.notification_service.features.announcements.dto.InstituteAnnouncementSettingsResponse;
import vacademy.io.notification_service.features.announcements.service.InstituteAnnouncementSettingsService;
import vacademy.io.notification_service.features.chat.dto.ChatSettings;

import java.util.Map;

/**
 * Reads the {@code settings.chat} block and gates chat behaviour. Everything defaults to OPEN —
 * an absent chat block (or absent sub-field) means the action is permitted.
 */
@Service
@RequiredArgsConstructor
@Slf4j
public class ChatPermissionService {

    private final InstituteAnnouncementSettingsService settingsService;

    public ChatSettings getChatSettings(String instituteId) {
        try {
            InstituteAnnouncementSettingsResponse resp = settingsService.getSettingsByInstituteId(instituteId);
            if (resp == null || resp.getSettings() == null) {
                return null;
            }
            return resp.getSettings().getChat();
        } catch (Exception e) {
            log.warn("Failed to load chat settings for institute {}, defaulting to open. {}", instituteId, e.getMessage());
            return null;
        }
    }

    /**
     * Chat is OFF by default: an institute must explicitly set {@code settings.chat.enabled = true}.
     * Absent settings / absent chat block / absent enabled flag all mean disabled, so chat stays dark
     * for every institute until an admin opts in.
     */
    public boolean isChatEnabled(String instituteId) {
        ChatSettings chat = getChatSettings(instituteId);
        return chat != null && Boolean.TRUE.equals(chat.getEnabled());
    }

    /**
     * The community channel is ON by default (when chat is enabled) and can be flagged off per
     * institute via {@code settings.chat.community.enabled = false}. Chat off implies community off.
     */
    public boolean isCommunityEnabled(String instituteId) {
        ChatSettings chat = getChatSettings(instituteId);
        if (chat == null || !Boolean.TRUE.equals(chat.getEnabled())) {
            return false;
        }
        ChatSettings.CommunityChatSettings c = chat.getCommunity();
        return c == null || !Boolean.FALSE.equals(c.getEnabled());
    }

    public boolean canDirectMessage(String instituteId, String senderRole, String targetRole) {
        ChatSettings chat = getChatSettings(instituteId);
        if (chat == null) return true;
        ChatSettings.DirectSettings direct = chat.getDirect();
        if (direct == null) return true;
        if (Boolean.FALSE.equals(direct.getEnabled())) return false;
        Map<String, Map<String, Boolean>> matrix = direct.getMatrix();
        if (matrix == null || matrix.isEmpty()) return true;
        Map<String, Boolean> row = matrix.get(normalizeRole(senderRole));
        if (row == null || row.isEmpty()) return true;
        Boolean allowed = row.get(normalizeRole(targetRole));
        return allowed == null || allowed; // missing entry => open
    }

    public boolean canPostToCommunity(String instituteId, String role) {
        ChatSettings chat = getChatSettings(instituteId);
        if (chat == null || chat.getCommunity() == null) return true;
        ChatSettings.CommunityChatSettings c = chat.getCommunity();
        if (Boolean.FALSE.equals(c.getEnabled())) return false; // channel turned off for the institute
        return switch (normalizeRole(role)) {
            case "student" -> !Boolean.FALSE.equals(c.getStudentsCanPost());
            case "teacher" -> !Boolean.FALSE.equals(c.getTeachersCanPost());
            case "admin" -> !Boolean.FALSE.equals(c.getAdminsCanPost());
            default -> true;
        };
    }

    public boolean canPostToBatch(String instituteId, String role) {
        ChatSettings chat = getChatSettings(instituteId);
        if (chat == null || chat.getBatchGroup() == null) return true;
        ChatSettings.BatchGroupSettings b = chat.getBatchGroup();
        return switch (normalizeRole(role)) {
            case "student" -> !Boolean.FALSE.equals(b.getStudentsCanPost());
            case "teacher" -> !Boolean.FALSE.equals(b.getTeachersCanPost());
            default -> true; // admins always allowed
        };
    }

    /**
     * May this caller EDIT a message they sent themselves? Institute-configurable for students only;
     * teachers and admins always may. Absent settings mean allowed, like every other chat flag.
     */
    public boolean canEditOwnMessage(String instituteId, String role) {
        if (!"student".equals(normalizeRole(role))) return true;
        ChatSettings chat = getChatSettings(instituteId);
        if (chat == null || chat.getMessageActions() == null) return true;
        return !Boolean.FALSE.equals(chat.getMessageActions().getStudentsCanEditOwn());
    }

    /**
     * May this caller DELETE a message they sent themselves? Same shape as
     * {@link #canEditOwnMessage}. Note this governs the SENDER path only — a moderator taking down
     * someone else's message is a separate authority and is unaffected.
     */
    public boolean canDeleteOwnMessage(String instituteId, String role) {
        if (!"student".equals(normalizeRole(role))) return true;
        ChatSettings chat = getChatSettings(instituteId);
        if (chat == null || chat.getMessageActions() == null) return true;
        return !Boolean.FALSE.equals(chat.getMessageActions().getStudentsCanDeleteOwn());
    }

    /**
     * Validate an attachment against institute attachment rules. Returns null if allowed,
     * otherwise a short rejection code.
     */
    public String checkAttachment(String instituteId, String contentType, Long sizeBytes) {
        if (contentType == null || "TEXT".equalsIgnoreCase(contentType)) return null;
        ChatSettings chat = getChatSettings(instituteId);
        if (chat == null || chat.getAttachments() == null) return null;
        ChatSettings.AttachmentSettings a = chat.getAttachments();
        if ("IMAGE".equalsIgnoreCase(contentType) && Boolean.FALSE.equals(a.getImagesEnabled())) {
            return "IMAGES_DISABLED";
        }
        if ("FILE".equalsIgnoreCase(contentType) && Boolean.FALSE.equals(a.getFilesEnabled())) {
            return "FILES_DISABLED";
        }
        if (a.getMaxFileSizeMb() != null && sizeBytes != null
                && sizeBytes > (long) a.getMaxFileSizeMb() * 1024 * 1024) {
            return "FILE_TOO_LARGE";
        }
        return null;
    }

    /**
     * Normalize the many role spellings to one of: student | teacher | admin.
     */
    public static String normalizeRole(String role) {
        if (role == null) return "";
        String r = role.trim().toLowerCase();
        return switch (r) {
            case "learner", "student" -> "student";
            case "faculty", "teacher" -> "teacher";
            case "admin" -> "admin";
            default -> r;
        };
    }
}
