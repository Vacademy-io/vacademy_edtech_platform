package vacademy.io.notification_service.features.hub.service;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import vacademy.io.notification_service.features.announcements.service.EmailConfigurationService;
import vacademy.io.notification_service.features.combot.entity.ChannelToInstituteMapping;
import vacademy.io.notification_service.features.combot.repository.ChannelToInstituteMappingRepository;
import vacademy.io.notification_service.features.hub.dto.HubEmailEventListDTO;
import vacademy.io.notification_service.features.hub.dto.HubOverviewDTO;
import vacademy.io.notification_service.features.hub.dto.HubRecentItemDTO;
import vacademy.io.notification_service.features.notification_log.entity.NotificationLog;
import vacademy.io.notification_service.features.notification_log.repository.EmailAddressMappingRepository;
import vacademy.io.notification_service.features.notification_log.repository.NotificationLogRepository;
import vacademy.io.notification_service.features.send.repository.SendBatchRepository;

import java.time.Instant;
import java.time.LocalDateTime;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.List;
import java.util.stream.Collectors;

@Slf4j
@Service
@RequiredArgsConstructor
public class NotificationHubService {

    private final NotificationLogRepository notificationLogRepository;
    private final EmailAddressMappingRepository emailAddressMappingRepository;
    private final EmailConfigurationService emailConfigurationService;
    private final ChannelToInstituteMappingRepository channelMappingRepository;
    private final SendBatchRepository sendBatchRepository;

    public HubOverviewDTO getOverview(String instituteId, int windowDays) {
        // notification_log.notification_date is stored as a UTC timestamp; build the cutoff as an
        // Instant so its ISO form (with trailing Z) round-trips cleanly through the count* queries.
        // SendBatch still uses LocalDateTime for its own column, so we keep that variable too.
        Instant sinceInstant = Instant.now().minus(java.time.Duration.ofDays(windowDays));
        String since = sinceInstant.toString();
        LocalDateTime sinceTs = LocalDateTime.ofInstant(sinceInstant, ZoneOffset.UTC);

        List<String> emailFromAddresses = getInstituteEmailAddresses(instituteId);
        List<String> waChannelIds = getInstituteWhatsAppChannelIds(instituteId);

        log.debug("Hub overview: instituteId={} window={}d emailSenders={} waChannels={}",
                instituteId, windowDays, emailFromAddresses.size(), waChannelIds.size());

        HubOverviewDTO.EmailStats emailStats = HubOverviewDTO.EmailStats.builder()
                .configured(!emailFromAddresses.isEmpty())
                .inboundConfigured(emailAddressMappingRepository.existsByInstituteIdAndIsActiveTrue(instituteId))
                .build();

        if (!emailFromAddresses.isEmpty()) {
            emailStats.setSent(notificationLogRepository.countEmailSent(emailFromAddresses, since));
            NotificationLogRepository.EmailEventCounts events =
                    notificationLogRepository.countEmailEventsByType(emailFromAddresses, since);
            emailStats.setDelivered(orZero(events.getDelivered()));
            emailStats.setOpened(orZero(events.getOpened()));
            emailStats.setClicked(orZero(events.getClicked()));
            emailStats.setBounced(orZero(events.getBounced()));
            emailStats.setComplained(orZero(events.getComplained()));
            emailStats.setInbound(notificationLogRepository.countInboundEmail(emailFromAddresses, since));
        }

        HubOverviewDTO.WhatsAppStats waStats = HubOverviewDTO.WhatsAppStats.builder()
                .configured(!waChannelIds.isEmpty())
                .build();

        if (!waChannelIds.isEmpty()) {
            waStats.setOutgoing(notificationLogRepository.countWhatsAppByType(waChannelIds, "WHATSAPP_MESSAGE_OUTGOING", since));
            waStats.setIncoming(notificationLogRepository.countWhatsAppByType(waChannelIds, "WHATSAPP_MESSAGE_INCOMING", since));
        }

        HubOverviewDTO.BatchStats batchStats = HubOverviewDTO.BatchStats.builder()
                .active(sendBatchRepository.countByInstituteIdAndStatusIn(instituteId, List.of("QUEUED", "PROCESSING")))
                .completedInWindow(sendBatchRepository.countByInstituteIdAndStatusSince(instituteId, "COMPLETED", sinceTs))
                .build();

        return HubOverviewDTO.builder()
                .windowDays(windowDays)
                .email(emailStats)
                .whatsapp(waStats)
                .batches(batchStats)
                .build();
    }

    public List<HubRecentItemDTO> getRecentIncoming(String instituteId, int limit, int offset) {
        List<String> channelIds = new ArrayList<>();
        channelIds.addAll(getInstituteWhatsAppChannelIds(instituteId));
        channelIds.addAll(getInstituteEmailAddresses(instituteId));

        if (channelIds.isEmpty()) {
            return List.of();
        }

        int safeLimit = Math.max(1, Math.min(limit, 100));
        int safeOffset = Math.max(0, offset);
        List<NotificationLog> rows = notificationLogRepository
                .findRecentIncomingForInstitute(channelIds, safeLimit, safeOffset);

        return rows.stream().map(this::toRecentItem).collect(Collectors.toList());
    }

    private HubRecentItemDTO toRecentItem(NotificationLog nl) {
        String channel = "INBOUND_EMAIL".equals(nl.getNotificationType()) ? "EMAIL" : "WHATSAPP";
        return HubRecentItemDTO.builder()
                .id(nl.getId())
                .channel(channel)
                .from(nl.getChannelId())
                .fromName(nl.getSenderName())
                .userId(nl.getUserId())
                .preview(truncate(nl.getBody(), 120))
                .timestamp(nl.getNotificationDate())
                .build();
    }

    /** Event names the drill-down accepts — the same set countEmailEvent is called with. */
    private static final java.util.Set<String> DRILLDOWN_EVENT_TYPES =
            java.util.Set.of("DELIVERY", "OPEN", "CLICK", "BOUNCE", "COMPLAINT");

    /**
     * Drill-down behind an overview email stat tile: the individual EMAIL_EVENT rows
     * (recipient + subject + event details) for one event type within the window.
     * Same scoping as the counts in {@link #getOverview}.
     */
    public HubEmailEventListDTO getEmailEvents(String instituteId, int windowDays,
                                               String eventType, int page, int size) {
        String normalized = eventType == null ? "" : eventType.trim().toUpperCase();
        if (!DRILLDOWN_EVENT_TYPES.contains(normalized)) {
            throw new IllegalArgumentException("Unsupported eventType: " + eventType
                    + " (expected one of " + DRILLDOWN_EVENT_TYPES + ")");
        }

        String since = Instant.now().minus(java.time.Duration.ofDays(windowDays)).toString();
        List<String> fromAddresses = getInstituteEmailAddresses(instituteId);

        if (fromAddresses.isEmpty()) {
            return HubEmailEventListDTO.builder()
                    .eventType(normalized).page(page).size(size)
                    .totalElements(0).totalPages(0).content(List.of())
                    .build();
        }

        long total = notificationLogRepository.countEmailEvent(fromAddresses, normalized, since);
        List<NotificationLog> rows = notificationLogRepository
                .findEmailEventsForInstitute(fromAddresses, normalized, since, size, page * size);

        return HubEmailEventListDTO.builder()
                .eventType(normalized)
                .page(page)
                .size(size)
                .totalElements(total)
                .totalPages((int) Math.ceil((double) total / size))
                .content(rows.stream().map(this::toEmailEventItem).collect(Collectors.toList()))
                .build();
    }

    /**
     * EMAIL_EVENT bodies are the line-oriented text written by
     * EmailEventService.createEventDetailsBody ("Email Event: OPEN\nSubject: ...\n..."),
     * so details are recovered by prefix parsing — same approach as EmailTrackingService.
     */
    private HubEmailEventListDTO.Item toEmailEventItem(NotificationLog ev) {
        String body = ev.getBody();
        return HubEmailEventListDTO.Item.builder()
                .id(ev.getId())
                .emailLogId(ev.getSource())
                .recipient(ev.getChannelId())
                .subject(cleanValue(extractLine(body, "Subject: ")))
                .timestamp(ev.getNotificationDate())
                .bounceType(cleanValue(extractLine(body, "Bounce Type: ")))
                .bounceSubType(cleanValue(extractLine(body, "Bounce SubType: ")))
                .clickedLink(cleanValue(extractLine(body, "Link: ")))
                .ipAddress(cleanValue(extractLine(body, "IP Address: ")))
                .userAgent(cleanValue(extractLine(body, "User Agent: ")))
                .complaintType(cleanValue(extractLine(body, "Complaint Type: ")))
                .build();
    }

    private String extractLine(String body, String prefix) {
        if (body == null) return null;
        int start = body.indexOf(prefix);
        if (start < 0) return null;
        start += prefix.length();
        int end = body.indexOf('\n', start);
        return (end > start ? body.substring(start, end) : body.substring(start)).trim();
    }

    /** SES omits some header/detail fields as the literal strings "null" / "N/A". */
    private String cleanValue(String value) {
        if (value == null || value.isBlank() || "null".equals(value) || "N/A".equals(value)) {
            return null;
        }
        return value;
    }

    /**
     * The institute's configured sender from-addresses (from institute.setting.EMAIL_SETTING.data).
     * NOT email_address_mapping — that table is only populated for inbound-enabled addresses
     * and would miss institutes that only send outbound. The platform default fallback is also
     * excluded so per-institute stat queries don't bleed across institutes.
     */
    private static long orZero(Long value) {
        return value == null ? 0L : value;
    }

    private List<String> getInstituteEmailAddresses(String instituteId) {
        return emailConfigurationService.getInstituteConfiguredFromAddresses(instituteId);
    }

    private List<String> getInstituteWhatsAppChannelIds(String instituteId) {
        return channelMappingRepository.findAllByInstituteId(instituteId).stream()
                .map(ChannelToInstituteMapping::getChannelId)
                .filter(s -> s != null && !s.isBlank())
                .distinct()
                .collect(Collectors.toList());
    }

    private String truncate(String s, int max) {
        if (s == null) return null;
        return s.length() <= max ? s : s.substring(0, max);
    }
}
