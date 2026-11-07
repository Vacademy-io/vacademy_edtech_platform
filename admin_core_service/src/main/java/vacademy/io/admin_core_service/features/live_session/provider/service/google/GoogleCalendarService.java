package vacademy.io.admin_core_service.features.live_session.provider.service.google;

import com.fasterxml.jackson.databind.JsonNode;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.MediaType;
import org.springframework.stereotype.Service;
import org.springframework.web.reactive.function.client.WebClient;
import reactor.core.publisher.Mono;
import vacademy.io.admin_core_service.features.live_session.provider.dto.google.GoogleAccount;
import vacademy.io.common.exceptions.VacademyException;

import java.time.Duration;
import java.time.Instant;
import java.time.format.DateTimeFormatter;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;

/**
 * One-way push of bookings to Google Calendar (Phase 3). Reuses the same
 * per-institute connected Google account as Meet (via {@link GoogleAccountStore})
 * and its token service — no new dependency, raw Calendar REST v3 over WebClient,
 * exactly like {@code GoogleMeetManager} calls the Meet API.
 *
 * <p>The event is created on the connected account's {@code primary} calendar with
 * the host + invitee as attendees and {@code sendUpdates=all}, so Google emails
 * calendar invites and the meeting reflects on both people's calendars — no
 * per-user OAuth needed. Everything is best-effort and scope-gated: an account
 * that has not re-consented to the Calendar scope is skipped silently, so nothing
 * here can ever fail a booking.
 */
@Service
@RequiredArgsConstructor
@Slf4j
public class GoogleCalendarService {

    private static final String CALENDAR_API = "https://www.googleapis.com/calendar/v3";
    private static final String CALENDAR_SCOPE = "https://www.googleapis.com/auth/calendar.events";
    private static final String EVENTS_PATH = "/calendars/primary/events";

    private final GoogleAccountStore googleAccountStore;
    private final GoogleAccessTokenService accessTokenService;
    private final WebClient.Builder webClientBuilder;

    /** Create a calendar event; returns the Google event id, or empty when no calendar-capable account. */
    public Optional<String> createEvent(String instituteId, String accountId, String summary, String description,
                                        Instant startUtc, Instant endUtc, String timezone,
                                        List<String> attendeeEmails, String meetLink) {
        Optional<GoogleAccount> accountOpt = calendarAccount(instituteId, accountId);
        if (accountOpt.isEmpty()) return Optional.empty();
        GoogleAccount account = accountOpt.get();
        try {
            String token = accessTokenService.getAccessToken(account);
            Map<String, Object> body = buildEventBody(summary, description, startUtc, endUtc, timezone,
                    attendeeEmails, meetLink);
            JsonNode resp = webClientBuilder.build()
                    .post()
                    .uri(CALENDAR_API + EVENTS_PATH + "?sendUpdates=all")
                    .header("Authorization", "Bearer " + token)
                    .contentType(MediaType.APPLICATION_JSON)
                    .bodyValue(body)
                    .retrieve()
                    .onStatus(s -> s.is4xxClientError() || s.is5xxServerError(),
                            r -> r.bodyToMono(String.class).defaultIfEmpty("")
                                    .map(b -> new VacademyException(
                                            "Calendar create HTTP " + r.statusCode().value() + ": " + snippet(b))))
                    .bodyToMono(JsonNode.class)
                    .timeout(Duration.ofSeconds(15))
                    .block();
            if (resp != null && resp.hasNonNull("id")) {
                String id = resp.get("id").asText();
                log.info("google.calendar.create institute={} event={}", instituteId, id);
                return Optional.of(id);
            }
        } catch (Exception e) {
            if (e.getMessage() != null && e.getMessage().contains("HTTP 401")) {
                accessTokenService.evict(account.getId());
            }
            log.warn("google.calendar.create.fail institute={}: {}", instituteId, e.getMessage());
        }
        return Optional.empty();
    }

    /** Move an existing event (reschedule). Best-effort; no-op when the event/account is unavailable. */
    public void updateEventTime(String instituteId, String eventId, Instant startUtc, Instant endUtc,
                                String timezone) {
        if (eventId == null || eventId.isBlank()) return;
        calendarAccount(instituteId, null).ifPresent(account -> {
            try {
                String token = accessTokenService.getAccessToken(account);
                Map<String, Object> body = new HashMap<>();
                body.put("start", timePart(startUtc, timezone));
                body.put("end", timePart(endUtc, timezone));
                webClientBuilder.build()
                        .patch()
                        .uri(CALENDAR_API + EVENTS_PATH + "/" + eventId + "?sendUpdates=all")
                        .header("Authorization", "Bearer " + token)
                        .contentType(MediaType.APPLICATION_JSON)
                        .bodyValue(body)
                        .retrieve()
                        .bodyToMono(String.class)
                        .onErrorResume(ex -> Mono.empty())
                        .timeout(Duration.ofSeconds(15))
                        .block();
            } catch (Exception e) {
                log.warn("google.calendar.update.fail event={}: {}", eventId, e.getMessage());
            }
        });
    }

    /** Delete an event (cancel). Best-effort; swallows 404/410 (already gone). */
    public void deleteEvent(String instituteId, String accountId, String eventId) {
        if (eventId == null || eventId.isBlank()) return;
        calendarAccount(instituteId, accountId).ifPresent(account -> {
            try {
                String token = accessTokenService.getAccessToken(account);
                webClientBuilder.build()
                        .delete()
                        .uri(CALENDAR_API + EVENTS_PATH + "/" + eventId + "?sendUpdates=all")
                        .header("Authorization", "Bearer " + token)
                        .retrieve()
                        .bodyToMono(String.class)
                        .onErrorResume(ex -> Mono.empty())
                        .timeout(Duration.ofSeconds(15))
                        .block();
                log.info("google.calendar.delete institute={} event={}", instituteId, eventId);
            } catch (Exception e) {
                log.warn("google.calendar.delete.fail event={}: {}", eventId, e.getMessage());
            }
        });
    }

    // ---------------------------------------------------------------------

    /**
     * The Google account for this event, IF it granted the Calendar scope. When
     * {@code accountId} is set (the mentor's own account) it's used; otherwise the
     * institute default. Empty when unavailable/unconsented (skip silently).
     */
    private Optional<GoogleAccount> calendarAccount(String instituteId, String accountId) {
        Optional<GoogleAccount> account = (accountId != null && !accountId.isBlank())
                ? googleAccountStore.findByIdAndInstitute(accountId, instituteId)
                : googleAccountStore.findDefault(instituteId);
        return account
                .filter(a -> a.getGrantedScopes() != null && a.getGrantedScopes().contains(CALENDAR_SCOPE));
    }

    private Map<String, Object> buildEventBody(String summary, String description, Instant startUtc,
                                               Instant endUtc, String timezone, List<String> attendeeEmails,
                                               String meetLink) {
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("summary", summary != null ? summary : "Booked session");
        String desc = description != null ? description : "";
        if (meetLink != null && !meetLink.isBlank()) {
            desc = (desc.isBlank() ? "" : desc + "\n\n") + "Join: " + meetLink;
            body.put("location", meetLink);
        }
        if (!desc.isBlank()) body.put("description", desc);
        body.put("start", timePart(startUtc, timezone));
        body.put("end", timePart(endUtc, timezone));
        if (attendeeEmails != null && !attendeeEmails.isEmpty()) {
            List<Map<String, Object>> attendees = new ArrayList<>();
            attendeeEmails.stream()
                    .filter(e -> e != null && !e.isBlank())
                    .distinct()
                    .forEach(e -> {
                        Map<String, Object> a = new HashMap<>();
                        a.put("email", e);
                        attendees.add(a);
                    });
            if (!attendees.isEmpty()) body.put("attendees", attendees);
        }
        return body;
    }

    /**
     * RFC-3339 instant (UTC) + display timezone — Google honors the instant, timeZone drives rendering.
     * Must keep the seconds: OffsetDateTime.toString() drops ":00" ("10:30Z"), which Calendar rejects
     * with a bare 400 — and every booking slot starts on a whole minute.
     */
    static Map<String, Object> timePart(Instant instant, String timezone) {
        Map<String, Object> part = new HashMap<>();
        part.put("dateTime", DateTimeFormatter.ISO_INSTANT.format(instant.truncatedTo(ChronoUnit.SECONDS)));
        if (timezone != null && !timezone.isBlank()) part.put("timeZone", timezone);
        return part;
    }

    private static String snippet(String body) {
        if (body == null) return "";
        return body.length() > 300 ? body.substring(0, 300) : body;
    }
}
