package vacademy.io.admin_core_service.features.live_session.provider.service.zoom;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import vacademy.io.admin_core_service.features.live_session.entity.SessionSchedule;
import vacademy.io.admin_core_service.features.live_session.provider.dto.zoom.ZoomAccount;
import vacademy.io.common.media.service.FileService;
import vacademy.io.common.meeting.dto.MeetingRecordingDTO;

import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.List;
import java.util.Map;

/**
 * Mirrors Zoom cloud recordings to Vacademy S3 so they survive Zoom's ~30-day
 * auto-delete. Reuses the SAME presigned-upload mechanism BBB recordings use
 * ({@link FileService#getPresignedUploadUrl} → media-service /get-signed-url →
 * presigned PUT to the private bucket): it STREAMS the file from Zoom (Bearer
 * auth) to a temp file, then to S3 via the presigned PUT — never buffering the
 * whole file in heap, so large recordings can't OOM the service. It then stores
 * the media-service {@code fileId}, marks {@code recordingStorage=S3}, clears
 * {@code expiresAt} and the Zoom {@code passcode}, and clears the Zoom
 * {@code downloadUrl}/{@code playbackUrl}. The recording then resolves its URL
 * from the fileId on demand (presigned GET) — exactly like a BBB recording, so
 * the UI/transcription worker always get a fresh, valid URL.
 *
 * Idempotent — recordings already on our S3 (real fileId) are skipped, so it's
 * safe to re-run (manual button + scheduled near-expiry rescue share this path).
 * Graceful — a per-recording failure leaves that recording on Zoom Cloud and the
 * others proceed.
 */
@Service
@RequiredArgsConstructor
@Slf4j
public class ZoomRecordingS3Service {

    private final ZoomAccountStore zoomAccountStore;
    private final ZoomAccessTokenService accessTokenService;
    private final ZoomRecordingService zoomRecordingService;
    private final FileService fileService;

    /**
     * @param onlyNearExpiry when true, only mirror recordings expiring within
     *                       {@code withinDays} (scheduled rescue); when false, mirror
     *                       every un-mirrored recording (manual "Sync to S3").
     * @return number of recordings newly mirrored to S3
     */
    public int mirrorToS3(SessionSchedule schedule, boolean onlyNearExpiry, int withinDays) {
        if (schedule.getProviderAccountId() == null || schedule.getProviderAccountId().isBlank()) {
            return 0;
        }
        ZoomAccount account = zoomAccountStore.findById(schedule.getProviderAccountId()).orElse(null);
        if (account == null) {
            return 0;
        }
        List<MeetingRecordingDTO> recordings = zoomRecordingService.getStoredRecordings(schedule);
        if (recordings.isEmpty()) {
            return 0;
        }

        String token = null;
        int mirrored = 0;
        long nearExpiryCutoff = Instant.now().plus(withinDays, ChronoUnit.DAYS).toEpochMilli();

        for (MeetingRecordingDTO rec : recordings) {
            if (isMirroredToS3(rec)) {
                continue; // already on our S3
            }
            if (rec.getDownloadUrl() == null || rec.getDownloadUrl().isBlank()) {
                continue; // nothing to download
            }
            if (onlyNearExpiry && !isExpiringWithin(rec, nearExpiryCutoff)) {
                continue; // not urgent yet
            }
            try {
                if (token == null) {
                    token = accessTokenService.getAccessToken(account);
                }
                String fileId = downloadAndStoreToS3(schedule, rec, token);
                if (fileId == null) {
                    continue; // empty download — already logged
                }
                rec.setFileId(fileId);
                rec.setRecordingStorage("S3");
                rec.setExpiresAt(null); // on our storage now — no provider auto-delete
                // Clear the Zoom cloud URLs + passcode. The recording now resolves its
                // URL from the fileId on demand (presigned GET), exactly like a BBB
                // recording — so the UI / transcription worker always get a fresh URL.
                rec.setDownloadUrl(null);
                rec.setPlaybackUrl(null);
                rec.setPasscode(null);
                mirrored++;
                log.info("zoom.s3.mirror ok scheduleId={} recordingId={} fileId={}",
                        schedule.getId(), rec.getRecordingId(), fileId);
            } catch (Exception e) {
                // Leave this recording on Zoom Cloud; others continue.
                log.error("zoom.s3.mirror failed scheduleId={} recordingId={}: {}",
                        schedule.getId(), rec.getRecordingId(), e.getMessage());
            }
        }

        if (mirrored > 0) {
            zoomRecordingService.replaceRecordings(schedule, recordings);
        }
        return mirrored;
    }

    /**
     * Streams a Zoom recording to a temp file, then to S3 via a presigned PUT (the
     * same private-bucket presigned-upload path BBB recordings use). Returns the
     * media-service fileId, or null when the download is empty.
     */
    private String downloadAndStoreToS3(SessionSchedule schedule, MeetingRecordingDTO rec, String token)
            throws Exception {
        String filename = buildFilename(schedule, rec);
        File temp = File.createTempFile("zoom-rec-", ".mp4");
        try {
            long size = downloadToFile(rec.getDownloadUrl(), token, temp);
            if (size <= 0) {
                log.warn("zoom.s3.mirror empty download recordingId={} scheduleId={}",
                        rec.getRecordingId(), schedule.getId());
                return null;
            }
            // Presigned PUT — getPresignedUploadUrl creates the FileMetadata and returns
            // {id, url}; we stream the temp file straight to S3 (no heap buffering).
            Map<String, String> presigned = fileService.getPresignedUploadUrl(
                    filename, "video/mp4", "ZOOM_RECORDING", safeSourceId(rec));
            String fileId = presigned != null ? presigned.get("id") : null;
            String putUrl = presigned != null ? presigned.get("url") : null;
            if (fileId == null || fileId.isBlank() || putUrl == null || putUrl.isBlank()) {
                throw new IllegalStateException("presign response missing id/url");
            }
            putFileToPresignedUrl(putUrl, temp, "video/mp4");
            return fileId;
        } finally {
            if (!temp.delete()) {
                temp.deleteOnExit();
            }
        }
    }

    private static String safeSourceId(MeetingRecordingDTO rec) {
        return rec.getRecordingId() != null ? rec.getRecordingId() : "SERVICE_UPLOAD";
    }

    /**
     * A recording counts as "on our S3" only when it carries a real media-service
     * fileId. Guards against a legacy bug where the upload helper stored the S3
     * <em>URL</em> in the fileId field (an "http..." value that getPublicUrlForFileId
     * can't resolve): such rows are treated as un-mirrored so a re-run repairs them.
     */
    private static boolean isMirroredToS3(MeetingRecordingDTO rec) {
        String fileId = rec.getFileId();
        return fileId != null && !fileId.isBlank() && !fileId.startsWith("http");
    }

    private static boolean isExpiringWithin(MeetingRecordingDTO rec, long cutoffEpochMillis) {
        if (rec.getExpiresAt() == null || rec.getExpiresAt().isBlank()) {
            return false;
        }
        try {
            return Instant.parse(rec.getExpiresAt()).toEpochMilli() <= cutoffEpochMillis;
        } catch (Exception e) {
            return false;
        }
    }

    private static String buildFilename(SessionSchedule schedule, MeetingRecordingDTO rec) {
        String base = rec.getRecordingId() != null ? rec.getRecordingId() : schedule.getId();
        return "zoom-recording-" + base + ".mp4";
    }

    /**
     * Streams a Zoom recording to a local temp file (authenticated with the S2S
     * token), returning the bytes written. Package-visible so tests can stub it.
     * Streaming to disk avoids holding the whole file in heap.
     */
    long downloadToFile(String downloadUrl, String accessToken, File dest) throws Exception {
        URL url = new URL(downloadUrl);
        HttpURLConnection connection = (HttpURLConnection) url.openConnection();
        connection.setRequestMethod("GET");
        connection.setRequestProperty("Authorization", "Bearer " + accessToken);
        connection.setConnectTimeout(15_000);
        connection.setReadTimeout(300_000);
        connection.setInstanceFollowRedirects(true);
        long total = 0;
        try (InputStream in = connection.getInputStream();
             OutputStream out = new FileOutputStream(dest)) {
            byte[] buf = new byte[8192];
            int n;
            while ((n = in.read(buf)) != -1) {
                out.write(buf, 0, n);
                total += n;
            }
        }
        return total;
    }

    /**
     * Streams a local file to S3 via a pre-signed PUT URL with a fixed content length
     * (so nothing is buffered in heap). Package-visible so tests can stub it. Throws
     * on a non-2xx S3 response so the per-recording mirror is marked failed.
     */
    void putFileToPresignedUrl(String presignedUrl, File file, String contentType) throws Exception {
        URL url = new URL(presignedUrl);
        HttpURLConnection connection = (HttpURLConnection) url.openConnection();
        connection.setRequestMethod("PUT");
        connection.setDoOutput(true);
        connection.setConnectTimeout(15_000);
        connection.setReadTimeout(300_000);
        if (contentType != null) {
            connection.setRequestProperty("Content-Type", contentType);
        }
        connection.setFixedLengthStreamingMode(file.length());
        try (InputStream in = new FileInputStream(file);
             OutputStream out = connection.getOutputStream()) {
            byte[] buf = new byte[8192];
            int n;
            while ((n = in.read(buf)) != -1) {
                out.write(buf, 0, n);
            }
        }
        int code = connection.getResponseCode();
        if (code < 200 || code >= 300) {
            throw new IllegalStateException("S3 presigned PUT returned HTTP " + code);
        }
    }
}
