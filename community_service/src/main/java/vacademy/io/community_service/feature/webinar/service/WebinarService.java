package vacademy.io.community_service.feature.webinar.service;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.util.StringUtils;
import org.springframework.web.server.ResponseStatusException;
import vacademy.io.community_service.feature.trainingvideo.entity.TrainingVideo;
import vacademy.io.community_service.feature.trainingvideo.repository.TrainingVideoRepository;
import vacademy.io.community_service.feature.webinar.dto.UpsertWebinarRequest;
import vacademy.io.community_service.feature.webinar.dto.WebinarDto;

import java.time.Duration;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.format.DateTimeParseException;
import java.util.List;
import java.util.Locale;
import java.util.stream.Collectors;

/**
 * Webinars for the admin dashboard's Assist Dock "Webinars" panel. Super admins add them from the
 * health-check dashboard; every logged-in admin reads the published ones.
 *
 * <p>Stored as {@code training_video} rows of kind WEBINAR (V80) rather than a table of their own:
 * {@code file_url}/{@code file_id} carry the recording and {@code module_path} is fixed to
 * ["Webinars"]. Whether a webinar is upcoming, live or past is not stored — clients derive it
 * from {@code startsAt}/{@code endsAt}, so nobody has to flip a status on Friday evening.
 */
@Service
public class WebinarService {

    static final Duration DEFAULT_DURATION = Duration.ofHours(1);
    /** A typo guard: a webinar that "runs" for days would sit in the LIVE state all that time. */
    static final Duration MAX_DURATION = Duration.ofHours(12);
    private static final int MAX_TITLE_LENGTH = 500;
    private static final int MAX_URL_LENGTH = 2048;
    private static final String MODULE_PATH = "[\"Webinars\"]";

    @Autowired
    private TrainingVideoRepository repository;

    /** Super-admin listing — includes hidden webinars so they can be shown again. */
    @Transactional(readOnly = true)
    public List<WebinarDto> listAll() {
        return repository.findByKindOrderByStartsAtDesc(TrainingVideo.KIND_WEBINAR).stream()
                .map(this::toDto)
                .collect(Collectors.toList());
    }

    /** Institute-facing listing — published webinars only. */
    @Transactional(readOnly = true)
    public List<WebinarDto> listPublished() {
        return repository.findByKindAndActiveTrueOrderByStartsAtDesc(TrainingVideo.KIND_WEBINAR).stream()
                .map(this::toDto)
                .collect(Collectors.toList());
    }

    @Transactional
    public WebinarDto create(UpsertWebinarRequest request) {
        if (request == null || !StringUtils.hasText(request.getTitle())) {
            throw badRequest("title is required");
        }
        if (!StringUtils.hasText(request.getStartsAt())) {
            throw badRequest("startsAt is required");
        }
        Instant startsAt = parseInstant(request.getStartsAt(), "startsAt");
        Instant endsAt = StringUtils.hasText(request.getEndsAt())
                ? parseInstant(request.getEndsAt(), "endsAt")
                : startsAt.plus(DEFAULT_DURATION);
        checkWindow(startsAt, endsAt);

        String recordingUrl = normalizeUrl(request.getRecordingUrl(), "recordingUrl");
        TrainingVideo webinar = TrainingVideo.builder()
                .kind(TrainingVideo.KIND_WEBINAR)
                .title(normalizeTitle(request.getTitle()))
                .description(trimToNull(request.getDescription()))
                .startsAt(startsAt)
                .endsAt(endsAt)
                .joinUrl(normalizeUrl(request.getJoinUrl(), "joinUrl"))
                .fileUrl(recordingUrl)
                .fileId(recordingUrl == null ? null : trimToNull(request.getRecordingFileId()))
                .modulePath(MODULE_PATH)
                .active(request.getActive() == null || request.getActive())
                .build();
        return toDto(repository.save(webinar));
    }

    @Transactional
    public WebinarDto update(String id, UpsertWebinarRequest request) {
        if (request == null) {
            throw badRequest("body is required");
        }
        TrainingVideo webinar = getOrThrow(id);
        if (StringUtils.hasText(request.getTitle())) {
            webinar.setTitle(normalizeTitle(request.getTitle()));
        }
        if (request.getDescription() != null) {
            webinar.setDescription(trimToNull(request.getDescription()));
        }

        Instant oldStart = webinar.getStartsAt();
        Instant oldEnd = webinar.getEndsAt();
        Instant startsAt = StringUtils.hasText(request.getStartsAt())
                ? parseInstant(request.getStartsAt(), "startsAt")
                : oldStart;
        Instant endsAt;
        if (StringUtils.hasText(request.getEndsAt())) {
            endsAt = parseInstant(request.getEndsAt(), "endsAt");
        } else if (oldStart != null && oldEnd != null && startsAt != null) {
            // Moving only the start keeps the same length.
            endsAt = startsAt.plus(Duration.between(oldStart, oldEnd));
        } else {
            endsAt = startsAt == null ? null : startsAt.plus(DEFAULT_DURATION);
        }
        if (startsAt == null) {
            throw badRequest("startsAt is required");
        }
        checkWindow(startsAt, endsAt);
        webinar.setStartsAt(startsAt);
        webinar.setEndsAt(endsAt);

        if (request.getJoinUrl() != null) {
            webinar.setJoinUrl(normalizeUrl(request.getJoinUrl(), "joinUrl"));
        }
        if (request.getRecordingUrl() != null) {
            String recordingUrl = normalizeUrl(request.getRecordingUrl(), "recordingUrl");
            webinar.setFileUrl(recordingUrl);
            webinar.setFileId(recordingUrl == null ? null : trimToNull(request.getRecordingFileId()));
        }
        if (request.getActive() != null) {
            webinar.setActive(request.getActive());
        }
        return toDto(repository.save(webinar));
    }

    @Transactional
    public void delete(String id) {
        repository.delete(getOrThrow(id));
    }

    /** Webinar rows only — a training video id is "not found" here. */
    private TrainingVideo getOrThrow(String id) {
        return repository.findById(id)
                .filter(v -> TrainingVideo.KIND_WEBINAR.equals(v.getKind()))
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "Webinar not found: " + id));
    }

    private void checkWindow(Instant startsAt, Instant endsAt) {
        if (!endsAt.isAfter(startsAt)) {
            throw badRequest("endsAt must be after startsAt");
        }
        if (Duration.between(startsAt, endsAt).compareTo(MAX_DURATION) > 0) {
            throw badRequest("a webinar can run for at most " + MAX_DURATION.toHours() + " hours");
        }
    }

    /** Accepts "2026-12-04T11:30:00Z" as well as "2026-12-04T17:00:00+05:30". */
    static Instant parseInstant(String raw, String field) {
        String value = raw.trim();
        try {
            return Instant.parse(value);
        } catch (DateTimeParseException ignored) {
            try {
                return OffsetDateTime.parse(value).toInstant();
            } catch (DateTimeParseException e) {
                throw badRequest(field + " must be an ISO-8601 date-time with a zone, e.g. 2026-12-04T11:30:00Z");
            }
        }
    }

    /**
     * Blank = cleared (null). Anything else must be an absolute http(s) link with a host: admins
     * open it with one click, so a javascript: or data: link must never get stored.
     *
     * <p>Deliberately lenient past that (not java.net.URI): real meeting links carry characters
     * URI rejects but browsers open fine, e.g. a Teams link with a raw {"Tid":...} query, or a
     * host with an underscore. Whitespace and control characters are refused; the health-check
     * form percent-encodes spaces before it sends a link.
     */
    static String normalizeUrl(String raw, String field) {
        if (!StringUtils.hasText(raw)) {
            return null;
        }
        String value = raw.trim();
        if (value.length() > MAX_URL_LENGTH) {
            throw badRequest(field + " is too long");
        }
        String lower = value.toLowerCase(Locale.ROOT);
        int afterScheme = lower.startsWith("https://") ? 8 : lower.startsWith("http://") ? 7 : -1;
        boolean noSpaces = value.chars().noneMatch(c -> c <= 0x20 || c == 0x7f);
        if (afterScheme > 0 && noSpaces) {
            String authority = value.substring(afterScheme).split("[/?#]", 2)[0];
            String host = authority.substring(authority.lastIndexOf('@') + 1).replaceFirst(":\\d*$", "");
            if (!host.isEmpty()) {
                return value;
            }
        }
        throw badRequest(field + " must be a full http(s) link");
    }

    private static String normalizeTitle(String raw) {
        String title = raw.trim();
        return title.length() > MAX_TITLE_LENGTH ? title.substring(0, MAX_TITLE_LENGTH) : title;
    }

    private static String trimToNull(String value) {
        return StringUtils.hasText(value) ? value.trim() : null;
    }

    private static ResponseStatusException badRequest(String message) {
        return new ResponseStatusException(HttpStatus.BAD_REQUEST, message);
    }

    private WebinarDto toDto(TrainingVideo v) {
        return WebinarDto.builder()
                .id(v.getId())
                .title(v.getTitle())
                .description(v.getDescription())
                .startsAt(v.getStartsAt() == null ? null : v.getStartsAt().toString())
                .endsAt(v.getEndsAt() == null ? null : v.getEndsAt().toString())
                .joinUrl(v.getJoinUrl())
                .recordingUrl(v.getFileUrl())
                .recordingFileId(v.getFileId())
                .active(v.isActive())
                .createdAt(v.getCreatedAt())
                .updatedAt(v.getUpdatedAt())
                .build();
    }
}
