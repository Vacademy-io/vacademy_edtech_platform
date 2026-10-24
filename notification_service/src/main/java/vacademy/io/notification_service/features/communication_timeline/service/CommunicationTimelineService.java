package vacademy.io.notification_service.features.communication_timeline.service;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageImpl;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Pageable;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.util.StringUtils;
import vacademy.io.notification_service.features.chatbot_flow.service.WhatsAppMessageOriginResolver;
import vacademy.io.notification_service.features.chatbot_flow.service.WhatsAppTemplateRenderer;
import vacademy.io.notification_service.features.communication_timeline.dto.CommunicationTimelineRequest;
import vacademy.io.notification_service.features.communication_timeline.dto.UnifiedCommunicationDTO;
import vacademy.io.notification_service.features.notification_log.entity.NotificationLog;
import vacademy.io.notification_service.features.notification_log.repository.NotificationLogRepository;

import java.util.*;
import java.util.stream.Collectors;

@Service
@RequiredArgsConstructor
@Slf4j
public class CommunicationTimelineService {

    private final NotificationLogRepository notificationLogRepository;
    private final ObjectMapper objectMapper;
    private final WhatsAppTemplateRenderer templateRenderer;

    /**
     * Who sent each WhatsApp message (workflow / chatbot flow). Setter-injected and optional, so
     * the existing constructor keeps its shape; null simply means no origin is shown.
     */
    private WhatsAppMessageOriginResolver originResolver;

    @Autowired(required = false)
    public void setOriginResolver(WhatsAppMessageOriginResolver originResolver) {
        this.originResolver = originResolver;
    }

    private static final Map<String, String[]> TYPE_TO_CHANNEL_DIRECTION = Map.of(
            "EMAIL", new String[]{"EMAIL", "OUTBOUND"},
            "INBOUND_EMAIL", new String[]{"EMAIL", "INBOUND"},
            "EMAIL_EVENT", new String[]{"EMAIL", "OUTBOUND"},
            "WHATSAPP_MESSAGE_OUTGOING", new String[]{"WHATSAPP", "OUTBOUND"},
            "WHATSAPP_MESSAGE_INCOMING", new String[]{"WHATSAPP", "INBOUND"},
            "WHATSAPP_OUTGOING", new String[]{"WHATSAPP", "OUTBOUND"}
    );

    @Transactional(readOnly = true)
    public Page<UnifiedCommunicationDTO> getUserCommunications(CommunicationTimelineRequest request) {
        log.info("Fetching communication timeline for userId: {}", request.getUserId());

        if (request.getUserId() == null || request.getUserId().isBlank()) {
            throw new IllegalArgumentException("userId must be provided");
        }

        Pageable pageable = PageRequest.of(
                request.getPage() != null ? request.getPage() : 0,
                request.getSize() != null ? request.getSize() : 20
        );

        // Build list of notification types to query based on channel/direction filters
        List<String> notificationTypes = resolveNotificationTypes(request.getChannels(), request.getDirection());

        // Query notification_log
        Page<NotificationLog> logs;
        if (request.getFromDate() != null || request.getToDate() != null) {
            logs = notificationLogRepository.findByUserIdAndTypesAndDateRange(
                    request.getUserId(), notificationTypes,
                    request.getFromDate(), request.getToDate(),
                    pageable);
        } else {
            logs = notificationLogRepository.findByUserIdAndNotificationTypeInOrderByNotificationDateDesc(
                    request.getUserId(), notificationTypes, pageable);
        }

        // Collect EMAIL log IDs for batch enrichment with tracking events
        List<String> emailLogIds = logs.getContent().stream()
                .filter(nl -> "EMAIL".equals(nl.getNotificationType()))
                .map(NotificationLog::getId)
                .collect(Collectors.toList());

        // Batch fetch latest email events
        Map<String, NotificationLog> latestEmailEvents = new HashMap<>();
        Map<String, List<NotificationLog>> allEmailEvents = new HashMap<>();
        if (!emailLogIds.isEmpty()) {
            try {
                List<NotificationLog> latestEvents = notificationLogRepository
                        .findLatestEmailEventsBySourceIdsNative(emailLogIds.toArray(new String[0]));
                for (NotificationLog event : latestEvents) {
                    latestEmailEvents.put(event.getSource(), event);
                }

                List<NotificationLog> allEvents = notificationLogRepository
                        .findEmailEventsBySourceIds(emailLogIds);
                for (NotificationLog event : allEvents) {
                    allEmailEvents.computeIfAbsent(event.getSource(), k -> new ArrayList<>()).add(event);
                }
            } catch (Exception e) {
                log.warn("Error batch-fetching email events: {}", e.getMessage());
            }
        }

        // Map to DTOs
        Map<String, WhatsAppTemplateRenderer.InstituteTemplates> templateCache = templateRenderer.newCache();
        WhatsAppMessageOriginResolver.Cache originCache = originResolver != null ? originResolver.newCache() : null;
        List<UnifiedCommunicationDTO> dtos = logs.getContent().stream()
                .map(nl -> mapToDTO(nl, latestEmailEvents, allEmailEvents, templateCache, originCache))
                .collect(Collectors.toList());

        return new PageImpl<>(dtos, pageable, logs.getTotalElements());
    }

    private List<String> resolveNotificationTypes(List<String> channels, String direction) {
        // All possible non-event types
        Map<String, List<String>> channelToTypes = Map.of(
                "EMAIL", List.of("EMAIL", "INBOUND_EMAIL"),
                "WHATSAPP", List.of("WHATSAPP_MESSAGE_OUTGOING", "WHATSAPP_MESSAGE_INCOMING", "WHATSAPP_OUTGOING")
        );

        Set<String> types = new LinkedHashSet<>();

        List<String> targetChannels = (channels == null || channels.isEmpty())
                ? List.of("EMAIL", "WHATSAPP")
                : channels;

        for (String channel : targetChannels) {
            List<String> channelTypes = channelToTypes.getOrDefault(channel.toUpperCase(), List.of());
            if ("INBOUND".equalsIgnoreCase(direction)) {
                channelTypes.stream()
                        .filter(this::isInboundType)
                        .forEach(types::add);
            } else if ("OUTBOUND".equalsIgnoreCase(direction)) {
                channelTypes.stream()
                        .filter(t -> !isInboundType(t))
                        .forEach(types::add);
            } else {
                types.addAll(channelTypes);
            }
        }

        // Ensure we always have at least one type
        if (types.isEmpty()) {
            types.addAll(List.of("EMAIL", "INBOUND_EMAIL",
                    "WHATSAPP_MESSAGE_OUTGOING", "WHATSAPP_MESSAGE_INCOMING", "WHATSAPP_OUTGOING"));
        }

        return new ArrayList<>(types);
    }

    private boolean isInboundType(String type) {
        return type.contains("INCOMING") || "INBOUND_EMAIL".equals(type);
    }

    private UnifiedCommunicationDTO mapToDTO(
            NotificationLog nl,
            Map<String, NotificationLog> latestEmailEvents,
            Map<String, List<NotificationLog>> allEmailEvents,
            Map<String, WhatsAppTemplateRenderer.InstituteTemplates> templateCache,
            WhatsAppMessageOriginResolver.Cache originCache) {

        String[] channelDirection = TYPE_TO_CHANNEL_DIRECTION.getOrDefault(
                nl.getNotificationType(), new String[]{"UNKNOWN", "UNKNOWN"});

        String channel = channelDirection[0];
        String direction = channelDirection[1];

        UnifiedCommunicationDTO.UnifiedCommunicationDTOBuilder builder = UnifiedCommunicationDTO.builder()
                .id(nl.getId())
                .channel(channel)
                .direction(direction)
                .timestamp(nl.getNotificationDate())
                .source(nl.getSource())
                .sourceId(nl.getSourceId())
                .recipientInfo(nl.getChannelId())
                .senderInfo(nl.getSenderBusinessChannelId());

        // Channel-specific mapping
        if ("EMAIL_EVENT".equals(nl.getNotificationType())) {
            mapEmailEventFields(builder, nl);
        } else if ("EMAIL".equals(channel)) {
            mapEmailFields(builder, nl, latestEmailEvents, allEmailEvents);
        } else if ("WHATSAPP".equals(channel)) {
            mapWhatsAppFields(builder, nl, templateCache);
            if (originResolver != null) {
                builder.origin(originResolver.resolve(nl, nl.getInstituteId(), originCache));
            }
        }

        return builder.build();
    }

    private void mapEmailFields(
            UnifiedCommunicationDTO.UnifiedCommunicationDTOBuilder builder,
            NotificationLog nl,
            Map<String, NotificationLog> latestEmailEvents,
            Map<String, List<NotificationLog>> allEmailEvents) {

        if ("INBOUND_EMAIL".equals(nl.getNotificationType())) {
            mapInboundEmailFields(builder, nl);
            return;
        }

        // Extract subject from body (first line or truncated)
        String body = nl.getBody();
        String title = truncate(body, 100);
        builder.title(title);
        builder.bodyPreview(truncate(body, 150));
        builder.fullBody(body);

        // The real subject line, stored beside the row rather than in it: body holds the rendered
        // HTML, so EmailService parks the subject in message_payload ({"subject": ...}). Title above
        // is a truncation of that HTML and is no substitute — anything resending this message needs
        // the subject that actually went out.
        builder.subject(extractEmailSubject(nl));

        // Email status, in order of authority:
        //   1. an SES tracking event   — the provider's own outcome, always freshest
        //   2. the stored deliveryStatus — a send we ourselves refused/failed before SMTP
        //   3. SENT                     — the default
        // (3) is not optimism: an EMAIL row is written only AFTER the SMTP handoff succeeded
        // (EmailService.saveEmailNotificationLog is called on the line after mailSender.send),
        // so "no tracking event" means "we have no delivery confirmation", never "not sent".
        // Reporting that as PENDING made every successful send read as a failure the moment SES
        // event ingestion stopped — it has produced nothing since 2026-07-28, so ~113k emails
        // were sitting on an amber "Pending" chip while their own timeline said "Email sent".
        String failureStatus = storedFailureStatus(nl);
        String eventStatus = null;
        NotificationLog latestEvent = latestEmailEvents.get(nl.getId());
        if (latestEvent != null) {
            eventStatus = normalizeEmailStatus(extractEmailEventType(latestEvent.getBody()));
            // An unrecognised event body normalizes to PENDING; that is an unparseable event,
            // not evidence the mail is unsent, so let it fall through rather than surface it.
            if ("PENDING".equals(eventStatus)) {
                eventStatus = null;
            }
        }
        builder.status(eventStatus != null ? eventStatus
                : failureStatus != null ? failureStatus
                : "SENT");

        // Build status timeline from all events
        List<NotificationLog> events = allEmailEvents.getOrDefault(nl.getId(), List.of());
        List<UnifiedCommunicationDTO.StatusEvent> timeline = new ArrayList<>(events.stream()
                .sorted(Comparator.comparing(
                        e -> e.getUpdatedAt() != null ? e.getUpdatedAt() : e.getCreatedAt(),
                        Comparator.nullsLast(Comparator.naturalOrder())))
                .map(event -> UnifiedCommunicationDTO.StatusEvent.builder()
                        .status(normalizeEmailStatus(extractEmailEventType(event.getBody())))
                        .timestamp(event.getUpdatedAt() != null ? event.getUpdatedAt() : event.getCreatedAt())
                        .details(event.getBody())
                        .build())
                .toList());

        // Open the timeline with what happened at our end: the send, or the reason we never sent.
        if (failureStatus != null) {
            timeline.add(0, UnifiedCommunicationDTO.StatusEvent.builder()
                    .status(failureStatus)
                    .timestamp(nl.getNotificationDate())
                    .details(StringUtils.hasText(nl.getDeliveryErrorMessage())
                            ? nl.getDeliveryErrorMessage()
                            : "Email not sent")
                    .build());
        } else {
            timeline.add(0, UnifiedCommunicationDTO.StatusEvent.builder()
                    .status("SENT")
                    .timestamp(nl.getNotificationDate())
                    .details("Email sent")
                    .build());
        }

        builder.statusTimeline(timeline);
    }

    /**
     * The delivery outcome recorded by our own send path, for the rows where we know the mail
     * never reached SES at all — an unsubscribed recipient, a missing address, a send that threw.
     * Only failures are stored; a successful send leaves the column null and defers to SES.
     * Returns null when there is no recorded failure, so callers can fall through.
     */
    /**
     * Subject of an outbound EMAIL row, read from {@code message_payload} ({@code {"subject": ...}}
     * — the key EmailService writes). Null when the payload is absent or carries no subject, which
     * is every row written before the subject was stored there; callers fall back to the title.
     */
    private String extractEmailSubject(NotificationLog nl) {
        String payload = nl.getMessagePayload();
        if (!StringUtils.hasText(payload)) {
            return null;
        }
        try {
            Map<String, Object> parsed = objectMapper.readValue(
                    payload, new TypeReference<Map<String, Object>>() {});
            Object subject = parsed.get("subject");
            return (subject instanceof String s && StringUtils.hasText(s)) ? s : null;
        } catch (Exception e) {
            log.debug("Could not parse EMAIL messagePayload for log {}: {}", nl.getId(), e.getMessage());
            return null;
        }
    }

    private String storedFailureStatus(NotificationLog nl) {
        String stored = nl.getDeliveryStatus();
        if (!StringUtils.hasText(stored)) {
            return null;
        }
        String normalized = stored.trim().toUpperCase();
        return switch (normalized) {
            case "FAILED", "BOUNCED", "COMPLAINT" -> normalized;
            default -> null;
        };
    }

    private void mapInboundEmailFields(
            UnifiedCommunicationDTO.UnifiedCommunicationDTOBuilder builder,
            NotificationLog nl) {

        String subject = nl.getBody(); // we store subject in body for inbound emails
        String fullBody = subject;
        String toAddress = null;

        if (nl.getMessagePayload() != null && !nl.getMessagePayload().isBlank()) {
            try {
                Map<String, Object> payload = objectMapper.readValue(
                        nl.getMessagePayload(), new TypeReference<Map<String, Object>>() {});
                Object bodyObj = payload.get("body");
                if (bodyObj instanceof String s) fullBody = s;
                Object toObj = payload.get("to");
                if (toObj instanceof String s) toAddress = s;
            } catch (Exception e) {
                log.debug("Could not parse INBOUND_EMAIL messagePayload for log {}: {}", nl.getId(), e.getMessage());
            }
        }

        builder.title(truncate(subject, 100));
        builder.bodyPreview(truncate(fullBody, 150));
        builder.fullBody(fullBody);
        builder.senderInfo(nl.getChannelId());           // From address (sender of the inbound email)
        if (toAddress != null) {
            builder.recipientInfo(toAddress);            // To address (our institute mailbox)
        }
        builder.status("RECEIVED");
        builder.statusTimeline(List.of(
                UnifiedCommunicationDTO.StatusEvent.builder()
                        .status("RECEIVED")
                        .timestamp(nl.getNotificationDate())
                        .details("Email received")
                        .build()
        ));
    }

    private void mapEmailEventFields(
            UnifiedCommunicationDTO.UnifiedCommunicationDTOBuilder builder,
            NotificationLog nl) {

        String eventType = extractEmailEventType(nl.getBody());
        String status = normalizeEmailStatus(eventType);

        builder.title("Email Event: " + status);
        builder.bodyPreview(truncate(nl.getBody(), 150));
        builder.fullBody(nl.getBody());
        builder.status(status);
        builder.statusTimeline(List.of(
                UnifiedCommunicationDTO.StatusEvent.builder()
                        .status(status)
                        .timestamp(nl.getNotificationDate())
                        .details(nl.getBody())
                        .build()
        ));
    }

    private void mapWhatsAppFields(
            UnifiedCommunicationDTO.UnifiedCommunicationDTOBuilder builder,
            NotificationLog nl,
            Map<String, WhatsAppTemplateRenderer.InstituteTemplates> templateCache) {

        String direction = TYPE_TO_CHANNEL_DIRECTION.getOrDefault(
                nl.getNotificationType(), new String[]{"UNKNOWN", "UNKNOWN"})[1];

        String body = nl.getBody();
        String messagePayload = nl.getMessagePayload();

        // Try to parse messagePayload for template info
        String templateName = null;
        String messageBody = body;
        Map<String, Object> metadata = new HashMap<>();

        if (messagePayload != null && !messagePayload.isBlank()) {
            try {
                Map<String, Object> payload = objectMapper.readValue(
                        messagePayload, new TypeReference<Map<String, Object>>() {});
                metadata = payload;

                // Extract template name from various payload structures
                if (payload.containsKey("template")) {
                    Object tmpl = payload.get("template");
                    if (tmpl instanceof Map) {
                        @SuppressWarnings("unchecked")
                        Map<String, Object> tmplMap = (Map<String, Object>) tmpl;
                        templateName = (String) tmplMap.get("name");
                    }
                }
                if (templateName == null && payload.containsKey("templateName")) {
                    templateName = (String) payload.get("templateName");
                }

                // Extract message body from payload
                if (payload.containsKey("text")) {
                    Object text = payload.get("text");
                    if (text instanceof Map) {
                        @SuppressWarnings("unchecked")
                        Map<String, Object> textMap = (Map<String, Object>) text;
                        messageBody = (String) textMap.get("body");
                    } else if (text instanceof String) {
                        messageBody = (String) text;
                    }
                }
            } catch (Exception e) {
                log.debug("Could not parse WA messagePayload for log {}: {}", nl.getId(), e.getMessage());
            }
        }

        // Rebuild the actual template message (real text with params substituted) from the stored
        // send payload + template — same renderer the WhatsApp Inbox uses. Only overrides the body
        // for structured template sends; other payload shapes keep the legacy parse above, and the
        // send-failure surfaces as a FAILED status instead of the misleading default DELIVERED.
        String status = "DELIVERED"; // WA messages in log are typically already delivered
        // Whether the SEND itself was refused (no message ever left), as opposed to a message the
        // provider took and later rejected. Only the former makes the send entry of the timeline a
        // failure; the latter is a second event after a real handover.
        boolean sendRefusedAtHandover = false;
        WhatsAppTemplateRenderer.Rendered rendered =
                templateRenderer.render(nl, nl.getInstituteId(), templateCache);
        if (rendered != null) {
            if (rendered.templateName != null) templateName = rendered.templateName;
            if (rendered.body != null) messageBody = rendered.body;
            if ("FAILED".equals(rendered.deliveryStatus)) {
                status = "FAILED";
                sendRefusedAtHandover = true;
            }
            // Surface the header media (image/video/document) so the UI can display the attachment.
            builder.headerType(rendered.headerType);
            builder.headerMediaUrl(rendered.headerMediaUrl);
            builder.buttons(rendered.buttons);
        }

        // The optimistic default above assumes acceptance equals arrival. It does not: a provider
        // 2xx is a queue receipt, and the outcome lands later on the status webhook — which now
        // stamps it here. When the provider has actually spoken, say what it said; when it hasn't
        // (null), keep the historical assumption so nothing that reads this API shifts underneath it.
        String failureDetail = null;
        if (nl.getDeliveryStatus() != null) {
            status = nl.getDeliveryStatus();
            if ("FAILED".equals(status)) {
                failureDetail = nl.getDeliveryErrorMessage() != null
                        ? nl.getDeliveryErrorMessage() : "Not delivered";
                if (nl.getDeliveryErrorCode() != null) {
                    failureDetail = failureDetail + " (" + nl.getDeliveryErrorCode() + ")";
                }
            }
        }

        String title = templateName != null ? templateName : truncate(body, 60);
        builder.title(title);
        builder.templateName(templateName);
        builder.bodyPreview(truncate(messageBody != null ? messageBody : body, 150));
        builder.fullBody(messageBody != null ? messageBody : body);
        builder.status(status);
        builder.metadata(metadata.isEmpty() ? null : metadata);

        // Simple status timeline for WA. This entry is the SEND, so it keeps its pre-existing
        // meaning: FAILED only when the provider refused to take the message at all. A message that
        // was handed over and rejected afterwards still genuinely left at this timestamp, and its
        // rejection is the separate entry below — collapsing the two would lose the handover.
        String outboundStatus = sendRefusedAtHandover ? "FAILED" : "SENT";
        List<UnifiedCommunicationDTO.StatusEvent> timeline = new ArrayList<>();
        timeline.add(UnifiedCommunicationDTO.StatusEvent.builder()
                .status("INBOUND".equals(direction) ? "RECEIVED" : outboundStatus)
                .timestamp(nl.getNotificationDate())
                .details(body)
                .build());

        // Second entry: what the provider reported afterwards. Kept separate from the send entry so
        // the timeline shows both facts — we handed it over at T, the provider rejected it at T+1s —
        // which is the whole story a support agent needs and could not previously see anywhere.
        if (nl.getDeliveryStatus() != null && !"INBOUND".equals(direction)) {
            timeline.add(UnifiedCommunicationDTO.StatusEvent.builder()
                    .status(nl.getDeliveryStatus())
                    .timestamp(nl.getDeliveryUpdatedAt() != null
                            ? nl.getDeliveryUpdatedAt() : nl.getNotificationDate())
                    .details(failureDetail != null ? failureDetail : "Reported by WhatsApp")
                    .build());
        }
        builder.statusTimeline(timeline);
    }

    private String extractEmailEventType(String body) {
        if (body == null || body.isEmpty()) return "unknown";
        if (body.startsWith("Email Event: ")) {
            int endIndex = body.indexOf("\n");
            if (endIndex > 0) {
                return body.substring("Email Event: ".length(), endIndex).trim().toLowerCase();
            }
            return body.substring("Email Event: ".length()).trim().toLowerCase();
        }
        return "unknown";
    }

    private String normalizeEmailStatus(String eventType) {
        if (eventType == null) return "PENDING";
        return switch (eventType.toLowerCase()) {
            case "delivery" -> "DELIVERED";
            case "open" -> "READ";
            case "click" -> "CLICKED";
            case "bounce" -> "BOUNCED";
            case "complaint" -> "COMPLAINT";
            case "send" -> "SENT";
            case "reject" -> "FAILED";
            default -> "PENDING";
        };
    }

    private String truncate(String text, int maxLen) {
        if (text == null) return null;
        if (text.length() <= maxLen) return text;
        return text.substring(0, maxLen) + "...";
    }

    // ==================== Channel-ID based timeline ====================

    @Transactional(readOnly = true)
    public Page<UnifiedCommunicationDTO> getUserCommunicationsByChannel(CommunicationTimelineRequest request) {
        String email = request.getEmail();
        String phone = request.getPhone();

        boolean hasEmail = email != null && !email.isBlank();
        boolean hasPhone = phone != null && !phone.isBlank();

        if (!hasEmail && !hasPhone) {
            throw new IllegalArgumentException("email or phone must be provided");
        }

        Pageable pageable = PageRequest.of(
                request.getPage() != null ? request.getPage() : 0,
                request.getSize() != null ? request.getSize() : 20);

        // Reuse existing logic to resolve which notification types to include per channel
        List<String> emailTypes = resolveNotificationTypes(List.of("EMAIL"), request.getDirection());
        List<String> waTypes = resolveNotificationTypes(List.of("WHATSAPP"), request.getDirection());

        boolean fetchEmail = hasEmail && !emailTypes.isEmpty();
        boolean fetchWa = hasPhone && !waTypes.isEmpty();

        // If the caller filtered to specific channels, honour that
        List<String> requestedChannels = request.getChannels();
        if (requestedChannels != null && !requestedChannels.isEmpty()) {
            boolean wantEmail = requestedChannels.stream().anyMatch(c -> "EMAIL".equalsIgnoreCase(c));
            boolean wantWhatsApp = requestedChannels.stream().anyMatch(c -> "WHATSAPP".equalsIgnoreCase(c));
            fetchEmail = fetchEmail && wantEmail;
            fetchWa = fetchWa && wantWhatsApp;
        }

        Page<NotificationLog> logs;
        boolean hasDateRange = request.getFromDate() != null || request.getToDate() != null;

        if (fetchEmail && fetchWa) {
            logs = hasDateRange
                    ? notificationLogRepository.findByEmailAndPhoneChannelsAndDateRange(
                            email, phone, emailTypes, waTypes,
                            request.getFromDate(), request.getToDate(), pageable)
                    : notificationLogRepository.findByEmailAndPhoneChannels(
                            email, phone, emailTypes, waTypes, pageable);
        } else if (fetchEmail) {
            logs = hasDateRange
                    ? notificationLogRepository.findByChannelIdAndTypesAndDateRange(
                            email, emailTypes, request.getFromDate(), request.getToDate(), pageable)
                    : notificationLogRepository.findByChannelIdAndNotificationTypeInOrderByNotificationDateDesc(
                            email, emailTypes, pageable);
        } else if (fetchWa) {
            logs = hasDateRange
                    ? notificationLogRepository.findByChannelIdAndTypesAndDateRange(
                            phone, waTypes, request.getFromDate(), request.getToDate(), pageable)
                    : notificationLogRepository.findByChannelIdAndNotificationTypeInOrderByNotificationDateDesc(
                            phone, waTypes, pageable);
        } else {
            return new PageImpl<>(List.of(), pageable, 0);
        }

        List<String> emailLogIds = logs.getContent().stream()
                .filter(nl -> "EMAIL".equals(nl.getNotificationType()))
                .map(NotificationLog::getId)
                .collect(Collectors.toList());

        Map<String, NotificationLog> latestEmailEvents = new HashMap<>();
        Map<String, List<NotificationLog>> allEmailEvents = new HashMap<>();
        if (!emailLogIds.isEmpty()) {
            try {
                List<NotificationLog> latestEvents = notificationLogRepository
                        .findLatestEmailEventsBySourceIdsNative(emailLogIds.toArray(new String[0]));
                for (NotificationLog event : latestEvents) {
                    latestEmailEvents.put(event.getSource(), event);
                }
                List<NotificationLog> allEvents = notificationLogRepository
                        .findEmailEventsBySourceIds(emailLogIds);
                for (NotificationLog event : allEvents) {
                    allEmailEvents.computeIfAbsent(event.getSource(), k -> new ArrayList<>()).add(event);
                }
            } catch (Exception e) {
                log.warn("Error batch-fetching email events: {}", e.getMessage());
            }
        }

        Map<String, WhatsAppTemplateRenderer.InstituteTemplates> templateCache = templateRenderer.newCache();
        WhatsAppMessageOriginResolver.Cache originCache = originResolver != null ? originResolver.newCache() : null;
        List<UnifiedCommunicationDTO> dtos = logs.getContent().stream()
                .map(nl -> mapToDTO(nl, latestEmailEvents, allEmailEvents, templateCache, originCache))
                .collect(Collectors.toList());

        return new PageImpl<>(dtos, pageable, logs.getTotalElements());
    }
}
