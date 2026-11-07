package vacademy.io.notification_service.features.chatbot_flow.service;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Component;
import vacademy.io.notification_service.features.chatbot_flow.dto.MessageOriginDTO;
import vacademy.io.notification_service.features.chatbot_flow.entity.ChatbotFlow;
import vacademy.io.notification_service.features.chatbot_flow.entity.ChatbotFlowNode;
import vacademy.io.notification_service.features.chatbot_flow.entity.ChatbotFlowSession;
import vacademy.io.notification_service.features.chatbot_flow.enums.ChatbotNodeType;
import vacademy.io.notification_service.features.chatbot_flow.repository.ChatbotFlowNodeRepository;
import vacademy.io.notification_service.features.chatbot_flow.repository.ChatbotFlowRepository;
import vacademy.io.notification_service.features.chatbot_flow.repository.ChatbotFlowSessionRepository;
import vacademy.io.notification_service.features.notification_log.MessageOriginPayload;
import vacademy.io.notification_service.features.notification_log.entity.NotificationLog;

import java.time.Duration;
import java.time.Instant;
import java.util.*;
import java.util.stream.Collectors;

/**
 * Says who sent an outgoing WhatsApp message — "workflow X", "chatbot flow Y" — for the Inbox and
 * the student timeline.
 *
 * <p>New rows carry it on {@code message_payload} ({@link MessageOriginPayload}); a chatbot flow's
 * name is looked up here, so a renamed flow shows its current name. Chatbot rows logged before the
 * bot recorded its flow are matched back: a "Template: name" row by the one flow that sends that
 * template, anything else by the bot session that was open for that phone at that moment. When
 * neither is unambiguous the row still reads "chatbot flow", just without a name — never a guess.
 * Older workflow sends kept no trace of their workflow and get no origin.
 *
 * <p>Callers create a {@link #newCache()} per request, as with {@link WhatsAppTemplateRenderer}.
 */
@Component
@RequiredArgsConstructor
@Slf4j
public class WhatsAppMessageOriginResolver {

    private static final ObjectMapper objectMapper = new ObjectMapper();
    private static final String CHATBOT_FLOW_SOURCE = "CHATBOT_FLOW";
    /** Clock slack between a session's timestamps and the log row it produced. */
    private static final Duration SESSION_SLACK = Duration.ofSeconds(5);

    private final ChatbotFlowRepository flowRepository;
    private final ChatbotFlowNodeRepository nodeRepository;
    private final ChatbotFlowSessionRepository sessionRepository;

    /** Per-request lookups, so a page of messages costs a handful of queries, not one per row. */
    public static final class Cache {
        private final Map<String, Optional<String>> flowNames = new HashMap<>();
        private final Map<String, Map<String, Set<String>>> templateFlowsByInstitute = new HashMap<>();
        private final Map<String, List<ChatbotFlowSession>> sessionsByPhone = new HashMap<>();
    }

    public Cache newCache() {
        return new Cache();
    }

    /** Origin of an outgoing row, or null for incoming rows and senders we cannot name. */
    public MessageOriginDTO resolve(NotificationLog nl, String fallbackInstituteId, Cache cache) {
        if (nl == null || nl.getNotificationType() == null
                || !nl.getNotificationType().contains("OUTGOING")) {
            return null;
        }
        try {
            Map<String, Object> payload = parsePayload(nl.getMessagePayload());
            String type = asString(payload.get(MessageOriginPayload.TYPE_KEY));
            String id = asString(payload.get(MessageOriginPayload.ID_KEY));
            String name = asString(payload.get(MessageOriginPayload.NAME_KEY));
            String instituteId = (nl.getInstituteId() != null && !nl.getInstituteId().isBlank())
                    ? nl.getInstituteId() : fallbackInstituteId;

            if (type == null && CHATBOT_FLOW_SOURCE.equals(nl.getSource())) {
                type = MessageOriginPayload.TYPE_CHATBOT_FLOW;
                id = legacyFlowId(nl, instituteId, cache);
            }
            if (type == null) return null;

            if (MessageOriginPayload.TYPE_CHATBOT_FLOW.equals(type) && id != null) {
                String current = flowName(id, cache);
                if (current != null) name = current;
            }
            return MessageOriginDTO.builder().type(type).id(id).name(name).build();
        } catch (Exception e) {
            log.debug("Could not resolve origin of log {}: {}", nl.getId(), e.getMessage());
            return null;
        }
    }

    // ==================== Chatbot rows logged before the flow was recorded ====================

    private String legacyFlowId(NotificationLog nl, String instituteId, Cache cache) {
        if (instituteId == null || instituteId.isBlank()) return null;

        Set<String> templateFlows = null;
        String templateName = WhatsAppTemplateRenderer.legacyChatbotTemplateName(nl);
        if (templateName != null) {
            templateFlows = templateFlows(instituteId, cache).getOrDefault(templateName.toLowerCase(), Set.of());
            if (templateFlows.size() == 1) return templateFlows.iterator().next();
        }

        if (nl.getChannelId() == null || nl.getNotificationDate() == null) return null;
        Instant at = nl.getNotificationDate();
        Set<String> openFlows = sessions(instituteId, nl.getChannelId(), cache).stream()
                .filter(s -> wasOpenAt(s, at))
                .map(ChatbotFlowSession::getFlowId)
                .filter(Objects::nonNull)
                .collect(Collectors.toSet());
        if (templateFlows != null && !templateFlows.isEmpty()) openFlows.retainAll(templateFlows);
        return openFlows.size() == 1 ? openFlows.iterator().next() : null;
    }

    private boolean wasOpenAt(ChatbotFlowSession s, Instant at) {
        if (s.getStartedAt() == null) return false;
        Instant start = s.getStartedAt().toInstant().minus(SESSION_SLACK);
        Instant end = s.getCompletedAt() != null ? s.getCompletedAt().toInstant()
                : s.getLastActivityAt() != null ? s.getLastActivityAt().toInstant() : Instant.now();
        return !at.isBefore(start) && !at.isAfter(end.plus(SESSION_SLACK));
    }

    /** Template name (lower case) → the institute's flows with a SEND_TEMPLATE node sending it. */
    private Map<String, Set<String>> templateFlows(String instituteId, Cache cache) {
        return cache.templateFlowsByInstitute.computeIfAbsent(instituteId, inst -> {
            Map<String, Set<String>> byTemplate = new HashMap<>();
            for (ChatbotFlowNode node : nodeRepository.findByInstituteIdAndNodeType(
                    inst, ChatbotNodeType.SEND_TEMPLATE.name())) {
                String name = asString(parsePayload(node.getConfig()).get("templateName"));
                if (name != null && node.getFlowId() != null) {
                    byTemplate.computeIfAbsent(name.toLowerCase(), k -> new HashSet<>()).add(node.getFlowId());
                }
            }
            return byTemplate;
        });
    }

    private List<ChatbotFlowSession> sessions(String instituteId, String phone, Cache cache) {
        return cache.sessionsByPhone.computeIfAbsent(instituteId + "|" + phone,
                k -> sessionRepository.findByInstituteIdAndUserPhone(instituteId, phone));
    }

    private String flowName(String flowId, Cache cache) {
        return cache.flowNames.computeIfAbsent(flowId,
                id -> flowRepository.findById(id).map(ChatbotFlow::getName)).orElse(null);
    }

    // ==================== Helpers ====================

    private Map<String, Object> parsePayload(String json) {
        if (json == null || json.isBlank()) return Map.of();
        try {
            return objectMapper.readValue(json, new TypeReference<Map<String, Object>>() {});
        } catch (Exception e) {
            return Map.of();
        }
    }

    private String asString(Object o) {
        if (o == null) return null;
        String s = o.toString();
        return s.isBlank() ? null : s;
    }
}
