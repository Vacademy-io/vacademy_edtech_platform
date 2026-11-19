package vacademy.io.admin_core_service.features.live_session.provider.service.google;

import com.fasterxml.jackson.databind.JsonNode;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.web.reactive.function.client.WebClient;
import vacademy.io.admin_core_service.features.live_session.provider.dto.google.GoogleAccount;
import vacademy.io.common.meeting.dto.MeetingAttendeeDTO;
import vacademy.io.common.meeting.dto.MeetingRecordingDTO;
import vacademy.io.common.external.VendorCallLog;

import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.time.OffsetDateTime;
import java.util.ArrayList;
import java.util.List;

/**
 * Low-level reader for the Meet REST API {@code conferenceRecords} sub-resources — the
 * post-meeting recordings, transcripts and participant data for a space. All calls use the
 * connected organizer's access token (scope {@code meetings.space.readonly}); no Drive scope is
 * needed for metadata (recording files are linked via {@code driveDestination.exportUri}).
 *
 * A space accumulates one {@code conferenceRecords/{record}} per occurrence; because Vacademy
 * creates one space per schedule occurrence, filtering by space returns exactly that occurrence's
 * records.
 */
@Service
@RequiredArgsConstructor
@Slf4j
public class GoogleConferenceService {

    private final GoogleAccessTokenService accessTokenService;
    private final WebClient.Builder webClientBuilder;

    /** Recordings (FILE_GENERATED, Drive-backed) across every conferenceRecord of a space. */
    public List<MeetingRecordingDTO> fetchRecordings(GoogleAccount account, String spaceName) {
        String token = accessTokenService.getAccessToken(account);
        List<MeetingRecordingDTO> out = new ArrayList<>();
        for (String conferenceRecord : listConferenceRecords(account, spaceName, token)) {
            String pageToken = "";
            do {
                String url = GoogleMeetEndpoints.MEET_API_BASE_URL + "/" + conferenceRecord
                        + "/recordings?pageSize=50"
                        + (pageToken.isBlank() ? "" : "&pageToken=" + enc(pageToken));
                JsonNode resp = get(url, token);
                if (resp == null) break;
                for (JsonNode rec : resp.path("recordings")) {
                    // Only surface recordings whose Drive file is ready.
                    if (!"FILE_GENERATED".equals(rec.path("state").asText(""))) {
                        continue;
                    }
                    JsonNode drive = rec.path("driveDestination");
                    String exportUri = drive.path("exportUri").asText(null);
                    String start = rec.path("startTime").asText(null);
                    String end = rec.path("endTime").asText(null);
                    out.add(MeetingRecordingDTO.builder()
                            .recordingId(rec.path("name").asText(null)) // conferenceRecords/{cr}/recordings/{r}
                            .downloadUrl(exportUri)
                            .playbackUrl(exportUri)
                            .durationSeconds(durationBetween(start, end))
                            .startTime(start)
                            .providerMeetingId(spaceName)
                            .type("MP4")
                            .recordingStorage("GOOGLE_DRIVE")
                            .build());
                }
                pageToken = resp.path("nextPageToken").asText("");
            } while (!pageToken.isBlank());
        }
        return out;
    }

    /** Participant attendance across every conferenceRecord of a space. */
    public List<MeetingAttendeeDTO> fetchAttendance(GoogleAccount account, String spaceName) {
        String token = accessTokenService.getAccessToken(account);
        List<MeetingAttendeeDTO> out = new ArrayList<>();
        for (String conferenceRecord : listConferenceRecords(account, spaceName, token)) {
            String pageToken = "";
            do {
                String url = GoogleMeetEndpoints.MEET_API_BASE_URL + "/" + conferenceRecord
                        + "/participants?pageSize=100"
                        + (pageToken.isBlank() ? "" : "&pageToken=" + enc(pageToken));
                JsonNode resp = get(url, token);
                if (resp == null) break;
                for (JsonNode p : resp.path("participants")) {
                    String start = p.path("earliestStartTime").asText(null);
                    String end = p.path("latestEndTime").asText(null);
                    out.add(MeetingAttendeeDTO.builder()
                            .name(resolveDisplayName(p))
                            // Meet participants don't expose an email (signedinUser carries an
                            // opaque users/{id}, not an address), so enrolled-learner correlation
                            // relies on the authenticated join-time markPresent instead.
                            .email(null)
                            .joinTime(start)
                            .leaveTime(end)
                            .durationMinutes((int) (durationBetween(start, end) / 60))
                            .build());
                }
                pageToken = resp.path("nextPageToken").asText("");
            } while (!pageToken.isBlank());
        }
        return out;
    }

    // ── Helpers ───────────────────────────────────────────────────────────────

    /** All conferenceRecord resource names for a space (newest meetings included). */
    private List<String> listConferenceRecords(GoogleAccount account, String spaceName, String token) {
        List<String> names = new ArrayList<>();
        String filter = "space.name=\"" + spaceName + "\"";
        String pageToken = "";
        do {
            String url = GoogleMeetEndpoints.MEET_API_BASE_URL
                    + "/conferenceRecords?pageSize=50&filter=" + enc(filter)
                    + (pageToken.isBlank() ? "" : "&pageToken=" + enc(pageToken));
            JsonNode resp = get(url, token);
            if (resp == null) break;
            for (JsonNode cr : resp.path("conferenceRecords")) {
                String name = cr.path("name").asText(null);
                if (name != null) names.add(name);
            }
            pageToken = resp.path("nextPageToken").asText("");
        } while (!pageToken.isBlank());
        return names;
    }

    private JsonNode get(String url, String token) {
        try {
            return webClientBuilder.build()
                    .get()
                    // Pass a URI (not a String): our query params (filter/pageToken) are already
                    // percent-encoded, and WebClient's .uri(String) would re-encode them (turning
                    // %3D into %253D → Google 400 BadRequest). Same gotcha as ZoomOAuthService.
                    .uri(java.net.URI.create(url))
                    .header("Authorization", "Bearer " + token)
                    .retrieve()
                    .bodyToMono(JsonNode.class)
                    .timeout(java.time.Duration.ofSeconds(15))
                    .doOnError(e -> VendorCallLog.failed(url, "fetch conference data", null, e))
                    .block();
        } catch (Exception e) {
            log.warn("google.conference.fetch.fail url={} reason={}", url, e.getClass().getSimpleName());
            return null;
        }
    }

    private static String resolveDisplayName(JsonNode participant) {
        if (participant.hasNonNull("signedinUser")) {
            return participant.path("signedinUser").path("displayName").asText("Signed-in user");
        }
        if (participant.hasNonNull("anonymousUser")) {
            return participant.path("anonymousUser").path("displayName").asText("Guest");
        }
        if (participant.hasNonNull("phoneUser")) {
            return participant.path("phoneUser").path("displayName").asText("Phone user");
        }
        return "Participant";
    }

    private static long durationBetween(String startIso, String endIso) {
        if (startIso == null || endIso == null) return 0;
        try {
            return Duration.between(OffsetDateTime.parse(startIso), OffsetDateTime.parse(endIso)).getSeconds();
        } catch (Exception e) {
            return 0;
        }
    }

    private static String enc(String v) {
        return URLEncoder.encode(v == null ? "" : v, StandardCharsets.UTF_8);
    }
}
