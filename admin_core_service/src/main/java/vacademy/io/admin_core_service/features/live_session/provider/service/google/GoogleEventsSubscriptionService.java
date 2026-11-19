package vacademy.io.admin_core_service.features.live_session.provider.service.google;

import com.fasterxml.jackson.databind.JsonNode;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.MediaType;
import org.springframework.stereotype.Service;
import org.springframework.web.reactive.function.client.WebClient;
import vacademy.io.admin_core_service.features.live_session.provider.dto.google.GoogleAccount;
import vacademy.io.common.external.VendorCallLog;

import java.util.List;
import java.util.Map;

/**
 * Creates Google Workspace Events API subscriptions that push Meet events (conference ended,
 * recording file generated) for a space to a Cloud Pub/Sub topic. This is a LATENCY OPTIMIZATION
 * over the {@link GoogleRecordingService} polling job — when no Pub/Sub topic is configured
 * ({@code google.events.pubsub-topic} blank, the default for local dev) this is a no-op and the
 * hourly poll is the source of truth.
 *
 * Subscriptions are created per space at meeting-create time. Subscriptions that omit resource
 * data live up to 7 days, which comfortably covers a near-term scheduled occurrence; long-lead
 * recurring series may outlive the TTL and fall back to polling (renewal is future work).
 *
 * <b>Activation requires</b> a Cloud Pub/Sub topic in the same GCP project, with the Workspace
 * Events service agent granted Pub/Sub Publisher on it, plus a push subscription pointing at
 * {@code /…/meeting/google-meet-callback}. See docs/googlemeetintegration/google-meet-integration-plan.md §4.3.
 */
@Service
@RequiredArgsConstructor
@Slf4j
public class GoogleEventsSubscriptionService {

    private static final List<String> EVENT_TYPES = List.of(
            "google.workspace.meet.conference.v2.ended",
            "google.workspace.meet.recording.v2.fileGenerated");

    private final GoogleAccessTokenService accessTokenService;
    private final WebClient.Builder webClientBuilder;

    /** Full Pub/Sub topic name, e.g. projects/PROJECT/topics/meet-events. Blank ⇒ Events API off. */
    @Value("${google.events.pubsub-topic:}")
    private String pubsubTopic;

    public boolean isConfigured() {
        return pubsubTopic != null && !pubsubTopic.isBlank();
    }

    /**
     * Best-effort: subscribe to Meet events for a space. Never throws — a failure here must not
     * block meeting creation, and the polling job still captures recordings.
     */
    public void subscribeForSpace(GoogleAccount account, String spaceName) {
        if (!isConfigured()) {
            return;
        }
        try {
            String token = accessTokenService.getAccessToken(account);
            Map<String, Object> body = Map.of(
                    "targetResource", "//meet.googleapis.com/" + spaceName,
                    "eventTypes", EVENT_TYPES,
                    "payloadOptions", Map.of("includeResource", false),
                    "notificationEndpoint", Map.of("pubsubTopic", pubsubTopic));

            JsonNode resp = webClientBuilder.build()
                    .post()
                    .uri(GoogleMeetEndpoints.WORKSPACE_EVENTS_SUBSCRIPTIONS)
                    .header("Authorization", "Bearer " + token)
                    .contentType(MediaType.APPLICATION_JSON)
                    .bodyValue(body)
                    .retrieve()
                    .bodyToMono(JsonNode.class)
                    .timeout(java.time.Duration.ofSeconds(15))
                    .doOnError(e -> VendorCallLog.failed(GoogleMeetEndpoints.WORKSPACE_EVENTS_SUBSCRIPTIONS, "create events subscription", body, e))
                    .block();
            log.info("google.events.subscribe space={} op={}", spaceName,
                    resp != null ? resp.path("name").asText("") : "");
        } catch (Exception e) {
            log.warn("google.events.subscribe.fail space={} reason={} — polling will cover recordings",
                    spaceName, e.getClass().getSimpleName());
        }
    }
}
