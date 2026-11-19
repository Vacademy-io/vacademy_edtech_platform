package vacademy.io.admin_core_service.features.audience.scheduler;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.core.ParameterizedTypeReference;
import org.springframework.http.HttpEntity;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpMethod;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import net.javacrumbs.shedlock.spring.annotation.SchedulerLock;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;
import org.springframework.web.client.RestTemplate;
import vacademy.io.admin_core_service.features.audience.entity.AudienceResponse;
import vacademy.io.admin_core_service.features.audience.enums.OptOutReason;
import vacademy.io.admin_core_service.features.audience.repository.AudienceResponseRepository;
import vacademy.io.admin_core_service.features.audience.service.AudienceOptOutService;

import java.util.Collections;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import java.util.stream.Collectors;

/**
 * Daily scan that auto-opts-out leads who keep receiving WhatsApp messages but have gone
 * silent. Silence is detected <b>by phone</b> (lead.parent_mobile ⇄ inbound
 * notification_log.channel_id) via notification_service, so it does not depend on outgoing
 * user_id logging being present on the channel.
 *
 * <p>For each silent lead it calls {@link AudienceOptOutService#moveUserToOptOutAudience}
 * with {@link OptOutReason#INACTIVE}: the lead is marked OPTED_OUT (which removes them from
 * the challenge day-N audience queries, stopping further challenge sends) and parked in the
 * opt-out audience anchored to tomorrow, so the scheduled 9 AM workflow sends
 * opt_out_inactive_day_1 the next morning and opt_out_inactive_msg_2 two days after that.
 * Unlike an explicit opt-out, no immediate message is sent.</p>
 *
 * <p>Disabled unless {@code inactivity-scan.enabled=true} and at least one target is
 * configured (see {@link InactivityScanProperties}).</p>
 */
@Slf4j
@Component
@RequiredArgsConstructor
public class InactivityOptOutScanner {

    private static final ParameterizedTypeReference<List<String>> STRING_LIST =
            new ParameterizedTypeReference<>() {};

    private final InactivityScanProperties props;
    private final AudienceResponseRepository audienceResponseRepository;
    private final AudienceOptOutService audienceOptOutService;

    private final RestTemplate restTemplate = new RestTemplate();

    @Value("${notification.server.baseurl:http://localhost:8076}")
    private String notificationServiceUrl;

    /** Daily, server timezone. Runs before the 9 AM opt-out drip so newly-detected leads
     *  are anchored to tomorrow and picked up by the next morning's MSG1 workflow. */
    @Scheduled(cron = "${inactivity-scan.cron:0 0 7 * * ?}")
    @SchedulerLock(name = "InactivityOptOutScanner", lockAtMostFor = "PT30M", lockAtLeastFor = "PT1M")
    public void scan() {
        if (!props.isEnabled() || props.getTargets().isEmpty()) {
            return;
        }
        for (InactivityScanProperties.Target target : props.getTargets()) {
            try {
                scanTarget(target);
            } catch (Exception e) {
                log.warn("[InactivityScan] target institute={} failed: {}",
                        target.getInstituteId(), e.getMessage());
            }
        }
    }

    private void scanTarget(InactivityScanProperties.Target target) {
        if (target.getInstituteId() == null || target.getSenderBusinessChannelId() == null
                || target.getAudienceIds() == null || target.getAudienceIds().isEmpty()) {
            log.warn("[InactivityScan] skipping incomplete target: {}", target);
            return;
        }

        // 1. Phones we keep messaging on this channel that have not replied in the window.
        Set<String> inactivePhones = fetchInactivePhones(
                target.getSenderBusinessChannelId(), target.getInactivityDays());
        if (inactivePhones.isEmpty()) {
            return;
        }

        // 2. Active in-scope leads (Js Challenge participants).
        List<AudienceResponse> leads =
                audienceResponseRepository.findActiveLeadsByAudienceIds(target.getAudienceIds());

        int optedOut = 0;
        for (AudienceResponse lead : leads) {
            String normalized = normalizePhone(lead.getParentMobile());
            if (normalized == null || !inactivePhones.contains(normalized)) {
                continue;
            }
            try {
                audienceOptOutService.moveUserToOptOutAudience(
                        lead.getUserId(), target.getInstituteId(), "WHATSAPP", OptOutReason.INACTIVE);
                optedOut++;
            } catch (Exception e) {
                log.warn("[InactivityScan] opt-out failed for user {}: {}",
                        lead.getUserId(), e.getMessage());
            }
        }

        if (optedOut > 0) {
            log.info("[InactivityScan] institute={} channel={} opted out {} inactive lead(s) (>{}d silent)",
                    target.getInstituteId(), target.getSenderBusinessChannelId(),
                    optedOut, target.getInactivityDays());
        }
    }

    /** Ask notification_service which phones on this channel have gone silent; normalise to match. */
    private Set<String> fetchInactivePhones(String channelId, int days) {
        String url = notificationServiceUrl + "/notification-service/v1/combot/filter-inactive-phones";
        Map<String, Object> body = new HashMap<>();
        body.put("senderBusinessChannelId", channelId);
        body.put("days", days);

        HttpHeaders headers = new HttpHeaders();
        headers.setContentType(MediaType.APPLICATION_JSON);

        try {
            ResponseEntity<List<String>> resp = restTemplate.exchange(
                    url, HttpMethod.POST, new HttpEntity<>(body, headers), STRING_LIST);
            List<String> phones = resp.getBody();
            if (phones == null || phones.isEmpty()) {
                return Collections.emptySet();
            }
            return phones.stream()
                    .map(this::normalizePhone)
                    .filter(Objects::nonNull)
                    .collect(Collectors.toSet());
        } catch (Exception e) {
            log.warn("[InactivityScan] failed to fetch inactive phones for channel {}: {}", channelId, e.getMessage());
            return Collections.emptySet();
        }
    }

    /** Digits-only; prepend country code 91 for bare 10-digit Indian numbers (mirrors lead ingestion). */
    private String normalizePhone(String raw) {
        if (raw == null) {
            return null;
        }
        String digits = raw.replaceAll("[^0-9]", "");
        if (digits.isEmpty()) {
            return null;
        }
        if (digits.length() == 10) {
            digits = "91" + digits;
        }
        return digits;
    }
}
