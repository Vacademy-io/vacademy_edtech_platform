package vacademy.io.admin_core_service.features.youtube.service;

import com.google.api.client.googleapis.json.GoogleJsonResponseException;
import com.google.api.client.http.InputStreamContent;
import com.google.api.client.http.javanet.NetHttpTransport;
import com.google.api.client.json.gson.GsonFactory;
import com.google.api.services.youtube.YouTube;
import com.google.api.services.youtube.model.Video;
import com.google.api.services.youtube.model.VideoSnippet;
import com.google.api.services.youtube.model.VideoStatus;
import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import vacademy.io.admin_core_service.features.live_session.entity.LiveSession;
import vacademy.io.admin_core_service.features.live_session.entity.SessionSchedule;
import vacademy.io.admin_core_service.features.live_session.repository.LiveSessionRepository;
import vacademy.io.admin_core_service.features.live_session.repository.SessionScheduleRepository;
import vacademy.io.admin_core_service.features.live_session.service.RecordingAutoLinkService;
import vacademy.io.admin_core_service.features.youtube.entity.YoutubeUploadDefaults;
import vacademy.io.admin_core_service.features.youtube.entity.YoutubeUploadJob;
import vacademy.io.admin_core_service.features.youtube.repository.YoutubeUploadDefaultsRepository;
import vacademy.io.common.media.service.FileService;
import vacademy.io.common.meeting.dto.MeetingRecordingDTO;

import java.io.InputStream;
import java.net.URL;
import java.text.SimpleDateFormat;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collections;
import java.util.Date;
import java.util.List;
import java.util.Optional;

/**
 * Performs a single YouTube upload for a given {@link YoutubeUploadJob}.
 *
 * The worker picks one job at a time and calls {@link #upload(YoutubeUploadJob)}.
 * The result either contains a videoId (success) or an error reason
 * code (failure) that the worker maps to a retry decision.
 */
@Service
@RequiredArgsConstructor
@Slf4j
public class YoutubeUploadService {

    private static final String APPLICATION_NAME = "Vacademy";
    /** Default Education category; overridden by per-institute settings. */
    private static final String DEFAULT_CATEGORY_ID = "27";

    private final YoutubeOAuthService oauthService;
    private final YoutubeUploadDefaultsRepository defaultsRepository;
    private final SessionScheduleRepository scheduleRepository;
    private final LiveSessionRepository liveSessionRepository;
    private final FileService fileService;
    private final ObjectMapper objectMapper;
    private final RecordingAutoLinkService recordingAutoLinkService;

    public UploadResult upload(YoutubeUploadJob job) {
        try {
            // 1. Resolve context: schedule, session, recording metadata.
            SessionSchedule schedule = scheduleRepository.findById(job.getSessionScheduleId())
                    .orElseThrow(() -> new IllegalStateException(
                            "SessionSchedule not found: " + job.getSessionScheduleId()));
            LiveSession session = liveSessionRepository.findById(schedule.getSessionId())
                    .orElseThrow(() -> new IllegalStateException(
                            "LiveSession not found: " + schedule.getSessionId()));

            YoutubeUploadDefaults defaults = defaultsRepository.findById(job.getInstituteId())
                    .orElseGet(this::platformDefaults);

            MeetingRecordingDTO recording = findRecordingMetadata(schedule, job);

            // 2. Build title + description by applying template tokens.
            String title = applyTemplate(defaults.getTitleTemplate(), session, schedule, recording);
            String description = defaults.getDescriptionTemplate() == null ? ""
                    : applyTemplate(defaults.getDescriptionTemplate(), session, schedule, recording);

            // 3. Upload (token, S3 stream, videos.insert) through the shared path.
            UploadResult result = publishVideo(job.getInstituteId(), job.getRecordingFileId(), title, description,
                    orDefault(job.getPrivacyStatus(), defaults.getPrivacyStatus()),
                    parseTags(defaults.getTagsCsv()), defaults, "job=" + job.getId());

            // 4. Mirror the YouTube link back onto the recording entry so
            // the live-session UI can show it without an extra lookup.
            if (result.success()) {
                stampYoutubeUrlOnRecording(schedule, job.getRecordingId(), result.videoId(), result.videoUrl());
            }
            return result;
        } catch (Exception e) {
            log.warn("[YouTube Upload] Transient failure job={}: {}", job.getId(), e.getMessage());
            return UploadResult.failure("TRANSIENT", e.getMessage());
        }
    }

    /**
     * Uploads one media-service file to the institute's connected YouTube channel and returns
     * the video id/url, or a failure whose {@code errorCode} is the YouTube reason (e.g.
     * {@code quotaExceeded}, {@code invalid_grant}), {@code FILE_NOT_FOUND} or {@code TRANSIENT}.
     * Never throws. Category, language, embeddable/stats/kids flags, license and notify come from
     * the institute's YouTube upload defaults.
     *
     * <p>Slow (streams the whole file): call it from a background worker, never inside an HTTP
     * request.
     *
     * @param privacyStatus public | unlisted | private; null/blank = the institute default
     * @param tags          video tags; null = the institute's default tags
     */
    public UploadResult publishVideo(String instituteId, String fileId, String title, String description,
                                     String privacyStatus, List<String> tags) {
        YoutubeUploadDefaults defaults;
        try {
            defaults = defaultsRepository.findById(instituteId).orElseGet(this::platformDefaults);
        } catch (Exception e) {
            log.warn("[YouTube Upload] Transient failure institute={}: {}", instituteId, e.getMessage());
            return UploadResult.failure("TRANSIENT", e.getMessage());
        }
        return publishVideo(instituteId, fileId, title, description,
                orDefault(privacyStatus, defaults.getPrivacyStatus()),
                tags != null ? tags : parseTags(defaults.getTagsCsv()),
                defaults, "institute=" + instituteId);
    }

    /** Body of {@link #publishVideo(String, String, String, String, String, List)}; logRef tags the log lines. */
    private UploadResult publishVideo(String instituteId, String fileId, String title, String description,
                                      String privacyStatus, List<String> tags,
                                      YoutubeUploadDefaults defaults, String logRef) {
        try {
            // Mint access token + open S3 stream.
            String accessToken = oauthService.getValidAccessToken(instituteId);
            String fileUrl = fileService.getPublicUrlForFileId(fileId);
            if (fileUrl == null || fileUrl.isBlank()) {
                return UploadResult.failure("FILE_NOT_FOUND",
                        "Recording file not found in media service (fileId=" + fileId + ")");
            }

            try (InputStream stream = new URL(fileUrl).openStream()) {
                YouTube youtube = buildYoutubeClient(accessToken);

                Video videoMetadata = new Video();
                VideoSnippet snippet = new VideoSnippet();
                snippet.setTitle(truncate(title, 100));     // YouTube hard cap: 100 chars
                snippet.setDescription(truncate(description, 5000));
                snippet.setCategoryId(orDefault(defaults.getCategoryId(), DEFAULT_CATEGORY_ID));
                snippet.setTags(tags);
                if (defaults.getDefaultLanguage() != null && !defaults.getDefaultLanguage().isBlank()) {
                    snippet.setDefaultLanguage(defaults.getDefaultLanguage());
                    snippet.setDefaultAudioLanguage(defaults.getDefaultLanguage());
                }
                videoMetadata.setSnippet(snippet);

                VideoStatus status = new VideoStatus();
                status.setPrivacyStatus(privacyStatus);
                status.setEmbeddable(defaults.isEmbeddable());
                status.setPublicStatsViewable(defaults.isPublicStatsViewable());
                status.setSelfDeclaredMadeForKids(defaults.isMadeForKids());
                if (defaults.getLicense() != null) status.setLicense(defaults.getLicense());
                videoMetadata.setStatus(status);

                InputStreamContent mediaContent = new InputStreamContent("video/*", stream);

                YouTube.Videos.Insert request = youtube.videos()
                        .insert(Arrays.asList("snippet", "status"), videoMetadata, mediaContent);
                request.setNotifySubscribers(defaults.isNotifySubscribers());
                // Resumable upload (default). Disabling direct upload means
                // failures part-way through can resume rather than restart —
                // important for multi-GB recordings on flaky connections.
                if (request.getMediaHttpUploader() != null) {
                    request.getMediaHttpUploader().setDirectUploadEnabled(false);
                }

                Video result = request.execute();
                String videoId = result.getId();
                String videoUrl = "https://www.youtube.com/watch?v=" + videoId;
                log.info("[YouTube Upload] Success {} videoId={}", logRef, videoId);

                return UploadResult.success(videoId, videoUrl, title);
            }
        } catch (GoogleJsonResponseException e) {
            String reason = extractReason(e);
            log.warn("[YouTube Upload] Failure {} status={} reason={} msg={}",
                    logRef, e.getStatusCode(), reason, e.getMessage());
            return UploadResult.failure(reason == null ? "google_error_" + e.getStatusCode() : reason,
                    e.getDetails() != null ? e.getDetails().getMessage() : e.getMessage());
        } catch (Exception e) {
            log.warn("[YouTube Upload] Transient failure {}: {}", logRef, e.getMessage());
            return UploadResult.failure("TRANSIENT", e.getMessage());
        }
    }

    private YouTube buildYoutubeClient(String accessToken) {
        return new YouTube.Builder(
                new NetHttpTransport(),
                GsonFactory.getDefaultInstance(),
                request -> request.getHeaders().setAuthorization("Bearer " + accessToken))
                .setApplicationName(APPLICATION_NAME)
                .build();
    }

    private String applyTemplate(String template, LiveSession session, SessionSchedule schedule,
                                  MeetingRecordingDTO recording) {
        if (template == null) return "";
        String dateStr = formatDate(schedule.getMeetingDate(), recording);
        return template
                .replace("{session_title}", safe(session.getTitle()))
                .replace("{course_name}", safe(session.getSubject()))
                .replace("{subject}", safe(session.getSubject()))
                .replace("{date}", safe(dateStr))
                .replace("{teacher_name}", "")  // Resolved at upload time only if needed
                .replace("{institute_name}", "");
    }

    private String formatDate(Date meetingDate, MeetingRecordingDTO recording) {
        Date d = meetingDate;
        if (d == null && recording != null && recording.getStartTime() != null) {
            try {
                d = Date.from(java.time.Instant.parse(recording.getStartTime()));
            } catch (Exception ignored) { /* fall through */ }
        }
        if (d == null) d = new Date();
        return new SimpleDateFormat("dd MMM yyyy").format(d);
    }

    private MeetingRecordingDTO findRecordingMetadata(SessionSchedule schedule, YoutubeUploadJob job) {
        if (schedule.getProviderRecordingsJson() == null || schedule.getProviderRecordingsJson().isBlank()) {
            return null;
        }
        try {
            List<MeetingRecordingDTO> recordings = objectMapper.readValue(
                    schedule.getProviderRecordingsJson(),
                    new com.fasterxml.jackson.core.type.TypeReference<List<MeetingRecordingDTO>>() {});
            return recordings.stream()
                    .filter(r -> job.getRecordingFileId() != null
                            && job.getRecordingFileId().equals(r.getFileId()))
                    .findFirst()
                    .orElse(null);
        } catch (Exception e) {
            log.warn("[YouTube Upload] Could not parse providerRecordingsJson for schedule={}",
                    schedule.getId());
            return null;
        }
    }

    /**
     * Write the YouTube video URL back into the recording's JSON entry so the
     * frontend can deep-link without a separate join. Uses optimistic merge —
     * concurrent writers (e.g. BBB hook + upload finishing) compose cleanly
     * because we re-read inside the same transaction.
     */
    private void stampYoutubeUrlOnRecording(SessionSchedule schedule, String recordingId,
                                            String videoId, String videoUrl) {
        try {
            SessionSchedule fresh = scheduleRepository.findById(schedule.getId()).orElse(null);
            if (fresh == null || fresh.getProviderRecordingsJson() == null) return;
            List<MeetingRecordingDTO> recordings = new ArrayList<>(objectMapper.readValue(
                    fresh.getProviderRecordingsJson(),
                    new com.fasterxml.jackson.core.type.TypeReference<List<MeetingRecordingDTO>>() {}));
            boolean changed = false;
            for (MeetingRecordingDTO r : recordings) {
                if (recordingId != null && recordingId.equals(r.getRecordingId())) {
                    r.setYoutubeVideoId(videoId);
                    r.setYoutubeVideoUrl(videoUrl);
                    changed = true;
                    break;
                }
            }
            if (changed) {
                fresh.setProviderRecordingsJson(objectMapper.writeValueAsString(recordings));
                scheduleRepository.save(fresh);
                // The YouTube URL is what makes a non-mirrored recording linkable —
                // re-run auto-linking now that it is (never throws).
                recordingAutoLinkService.processSchedule(fresh);
            }
        } catch (Exception e) {
            log.warn("[YouTube Upload] Could not stamp video URL on recording: {}", e.getMessage());
        }
    }

    private String extractReason(GoogleJsonResponseException e) {
        if (e.getDetails() != null && e.getDetails().getErrors() != null
                && !e.getDetails().getErrors().isEmpty()) {
            return e.getDetails().getErrors().get(0).getReason();
        }
        return null;
    }

    private static String safe(String s) { return s == null ? "" : s; }

    private static String orDefault(String s, String d) {
        return (s == null || s.isBlank()) ? d : s;
    }

    private static String truncate(String s, int max) {
        if (s == null) return "";
        return s.length() <= max ? s : s.substring(0, max);
    }

    private List<String> parseTags(String csv) {
        if (csv == null || csv.isBlank()) return Collections.emptyList();
        return Arrays.stream(csv.split(","))
                .map(String::trim)
                .filter(s -> !s.isEmpty())
                .toList();
    }

    /**
     * Fallback defaults applied when an institute hasn't customised settings
     * yet. Matches the V250 migration's DEFAULTs so behaviour is consistent
     * whether or not a row exists.
     */
    private YoutubeUploadDefaults platformDefaults() {
        return YoutubeUploadDefaults.builder()
                .featureEnabled(false)
                .autoUploadEnabled(true)
                .privacyStatus("unlisted")
                .embeddable(true)
                .publicStatsViewable(false)
                .madeForKids(false)
                .categoryId(DEFAULT_CATEGORY_ID)
                .license("youtube")
                .titleTemplate("{session_title} | {date}")
                .notifySubscribers(false)
                .build();
    }

    public record UploadResult(boolean success, String videoId, String videoUrl, String title,
                               String errorCode, String errorMessage) {
        public static UploadResult success(String videoId, String videoUrl, String title) {
            return new UploadResult(true, videoId, videoUrl, title, null, null);
        }
        public static UploadResult failure(String errorCode, String errorMessage) {
            return new UploadResult(false, null, null, null, errorCode, errorMessage);
        }
    }
}
