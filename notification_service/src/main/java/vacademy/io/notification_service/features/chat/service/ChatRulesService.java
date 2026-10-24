package vacademy.io.notification_service.features.chat.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.web.server.ResponseStatusException;
import vacademy.io.notification_service.features.chat.dto.ChatRulesDto;
import vacademy.io.notification_service.features.chat.dto.ChatSettings;
import vacademy.io.notification_service.features.chat.entity.ChatConversation;
import vacademy.io.notification_service.features.chat.entity.ChatConversationMember;
import vacademy.io.notification_service.features.chat.entity.ChatMessage;
import vacademy.io.notification_service.features.chat.enums.ChatConversationType;
import vacademy.io.notification_service.features.chat.repository.ChatMessageRepository;

import java.time.LocalDateTime;
import java.util.List;
import java.util.Optional;
import java.util.regex.Pattern;

/**
 * Resolves the effective community rules (in-channel override ?? institute defaults) and enforces them
 * at send-time: acknowledgement, new-member read-only window, slow-mode, link/attachment restrictions,
 * and banned-keyword auto-moderation (BLOCK rejects; FLAG delivers but marks the message).
 */
@Service
@RequiredArgsConstructor
@Slf4j
public class ChatRulesService {

    private final ChatPermissionService permissionService;
    private final ChatMessageRepository messageRepository;
    private final ObjectMapper objectMapper;

    private static final Pattern URL_PATTERN = Pattern.compile("(https?://|www\\.)", Pattern.CASE_INSENSITIVE);

    public record ModerationResult(boolean flagged, String reason) {
        public static ModerationResult clean() { return new ModerationResult(false, null); }
    }

    /**
     * Effective rules for a conversation. Only COMMUNITY channels are rule-governed in v1.
     * Returns null when there are no applicable rules.
     */
    public ChatRulesDto getEffectiveRules(ChatConversation conv) {
        if (conv == null || !ChatConversationType.COMMUNITY.name().equals(conv.getType())) {
            return null;
        }
        if (conv.getRules() != null && !conv.getRules().isEmpty()) {
            try {
                return objectMapper.convertValue(conv.getRules(), ChatRulesDto.class);
            } catch (Exception e) {
                log.warn("Failed to parse in-channel rules override for conversation {}: {}", conv.getId(), e.getMessage());
            }
        }
        ChatSettings chat = permissionService.getChatSettings(conv.getInstituteId());
        if (chat != null && chat.getCommunity() != null && chat.getCommunity().getRules() != null) {
            return chat.getCommunity().getRules();
        }
        return null;
    }

    public boolean isOverride(ChatConversation conv) {
        return conv != null && conv.getRules() != null && !conv.getRules().isEmpty();
    }

    public boolean hasAcknowledged(ChatConversation conv, ChatConversationMember member) {
        if (member == null) return false;
        Integer acked = member.getRulesAcknowledgedVersion();
        return acked != null && acked >= (conv.getRulesVersion() == null ? 0 : conv.getRulesVersion());
    }

    /**
     * Enforce rules before persisting a message. Throws ResponseStatusException on a hard rejection;
     * returns a ModerationResult describing whether the message should be FLAGGED (soft) on the way in.
     */
    public ModerationResult enforceBeforeSend(ChatConversation conv, ChatConversationMember member,
                                              String contentType, String text, boolean hasAttachment) {
        ChatRulesDto rules = getEffectiveRules(conv);
        if (rules == null) {
            return ModerationResult.clean();
        }

        // 1. Acknowledgement
        if (Boolean.TRUE.equals(rules.getAcknowledgementRequired()) && !hasAcknowledged(conv, member)) {
            throw new ResponseStatusException(HttpStatus.FORBIDDEN, "RULES_NOT_ACKNOWLEDGED");
        }

        ChatRulesDto.Posting posting = rules.getPosting();
        if (posting != null) {
            // 2. New-member read-only window
            if (posting.getNewMemberReadonlyMinutes() != null && posting.getNewMemberReadonlyMinutes() > 0
                    && member.getJoinedAt() != null
                    && LocalDateTime.now().isBefore(member.getJoinedAt().plusMinutes(posting.getNewMemberReadonlyMinutes()))) {
                throw new ResponseStatusException(HttpStatus.FORBIDDEN, "NEW_MEMBER_READONLY");
            }

            // 3. Slow mode
            if (posting.getSlowModeSeconds() != null && posting.getSlowModeSeconds() > 0) {
                Optional<ChatMessage> last = messageRepository
                        .findFirstByConversationIdAndSenderIdAndIsDeletedFalseOrderBySeqDesc(conv.getId(), member.getUserId());
                if (last.isPresent() && last.get().getCreatedAt() != null
                        && last.get().getCreatedAt().isAfter(LocalDateTime.now().minusSeconds(posting.getSlowModeSeconds()))) {
                    throw new ResponseStatusException(HttpStatus.TOO_MANY_REQUESTS, "SLOW_MODE");
                }
            }

            // 4. Link / attachment restrictions
            if (Boolean.FALSE.equals(posting.getAllowLinks()) && text != null && URL_PATTERN.matcher(text).find()) {
                throw new ResponseStatusException(HttpStatus.FORBIDDEN, "LINKS_NOT_ALLOWED");
            }
            if (Boolean.FALSE.equals(posting.getAllowAttachments()) && hasAttachment) {
                throw new ResponseStatusException(HttpStatus.FORBIDDEN, "ATTACHMENTS_NOT_ALLOWED");
            }
        }

        // 5. Auto-moderation keywords
        ChatRulesDto.AutoModeration mod = rules.getAutoModeration();
        if (mod != null && mod.getBannedKeywords() != null && !mod.getBannedKeywords().isEmpty() && text != null) {
            String lower = text.toLowerCase();
            String hit = matchBannedKeyword(lower, mod.getBannedKeywords());
            if (hit != null) {
                if ("BLOCK".equalsIgnoreCase(mod.getAction())) {
                    throw new ResponseStatusException(HttpStatus.UNPROCESSABLE_ENTITY, "BLOCKED_BY_MODERATION");
                }
                return new ModerationResult(true, "Matched banned keyword: " + hit);
            }
        }

        return ModerationResult.clean();
    }

    /**
     * Enforce the CONTENT rules on an edited body. Deliberately a subset of
     * {@link #enforceBeforeSend}: acknowledgement, the new-member read-only window and slow mode all
     * govern the RATE at which someone may post, and re-applying them would block an edit for reasons
     * that have nothing to do with the text. The content rules must still run — otherwise editing is a
     * trivial bypass for the link ban and the banned-keyword filter (send "ok", then edit it to
     * anything you like).
     */
    public ModerationResult enforceBeforeEdit(ChatConversation conv, String text) {
        ChatRulesDto rules = getEffectiveRules(conv);
        if (rules == null) {
            return ModerationResult.clean();
        }

        ChatRulesDto.Posting posting = rules.getPosting();
        if (posting != null && Boolean.FALSE.equals(posting.getAllowLinks())
                && text != null && URL_PATTERN.matcher(text).find()) {
            throw new ResponseStatusException(HttpStatus.FORBIDDEN, "LINKS_NOT_ALLOWED");
        }

        ChatRulesDto.AutoModeration mod = rules.getAutoModeration();
        if (mod != null && mod.getBannedKeywords() != null && !mod.getBannedKeywords().isEmpty() && text != null) {
            String hit = matchBannedKeyword(text.toLowerCase(), mod.getBannedKeywords());
            if (hit != null) {
                if ("BLOCK".equalsIgnoreCase(mod.getAction())) {
                    throw new ResponseStatusException(HttpStatus.UNPROCESSABLE_ENTITY, "BLOCKED_BY_MODERATION");
                }
                return new ModerationResult(true, "Matched banned keyword: " + hit);
            }
        }

        return ModerationResult.clean();
    }

    private String matchBannedKeyword(String lowerText, List<String> bannedKeywords) {
        for (String kw : bannedKeywords) {
            if (kw == null || kw.isBlank()) continue;
            if (lowerText.contains(kw.toLowerCase())) {
                return kw;
            }
        }
        return null;
    }
}
