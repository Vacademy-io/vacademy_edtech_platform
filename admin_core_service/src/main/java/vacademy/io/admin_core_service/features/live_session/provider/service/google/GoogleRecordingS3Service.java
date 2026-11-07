package vacademy.io.admin_core_service.features.live_session.provider.service.google;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.util.StringUtils;
import vacademy.io.admin_core_service.features.live_session.entity.SessionSchedule;
import vacademy.io.admin_core_service.features.live_session.provider.dto.google.GoogleAccount;
import vacademy.io.admin_core_service.features.live_session.repository.SessionScheduleRepository;
import vacademy.io.common.exceptions.VacademyException;
import vacademy.io.common.media.service.FileService;
import vacademy.io.common.meeting.dto.MeetingRecordingDTO;

import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.Map;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * "Save to library" for Google Meet recordings: downloads the MP4 from the organizer's Drive
 * (Drive API {@code files.get?alt=media}) and stores it on Vacademy S3 via the same presigned-PUT
 * path Zoom/BBB recordings use — streamed through a temp file, never buffered in heap.
 *
 * Needs {@link GoogleOAuthService#DRIVE_MEET_READONLY_SCOPE}, which is opt-in per connected account
 * (restricted scope). Without it the call fails with 412 so the admin UI can offer "Allow Drive
 * access" or the manual upload fallback. The fileId is written through
 * {@link GoogleRecordingService#attachUploadedFile} — the exact path a manual upload takes.
 */
@Service
@RequiredArgsConstructor
@Slf4j
public class GoogleRecordingS3Service {

    static final String DRIVE_FILES_URL = "https://www.googleapis.com/drive/v3/files/";

    /** exportUri is https://drive.google.com/file/d/{id}/view?usp=drive_web; tolerate ?id= links too. */
    private static final Pattern DRIVE_FILE_ID = Pattern.compile("/file/d/([A-Za-z0-9_-]+)|[?&]id=([A-Za-z0-9_-]+)");

    private final GoogleAccountStore googleAccountStore;
    private final GoogleAccessTokenService accessTokenService;
    private final GoogleRecordingService googleRecordingService;
    private final SessionScheduleRepository scheduleRepository;
    private final FileService fileService;

    /**
     * Mirrors every Drive-only recording on the schedule to S3. Idempotent — recordings that
     * already carry a fileId are skipped. A per-recording failure leaves that recording on Drive;
     * if nothing could be saved, the last failure is surfaced to the caller.
     *
     * @return number of recordings newly saved to the library
     */
    public int mirrorToS3(SessionSchedule schedule) {
        GoogleAccount account = StringUtils.hasText(schedule.getProviderAccountId())
                ? googleAccountStore.findById(schedule.getProviderAccountId()).orElse(null)
                : null;
        if (account == null) {
            throw new VacademyException(HttpStatus.NOT_FOUND, "No Google account is connected for this session");
        }
        if (!hasDriveAccess(account)) {
            throw new VacademyException(HttpStatus.PRECONDITION_FAILED,
                    "Allow Google Drive access for " + account.getOrganizerEmail()
                            + " to save Meet recordings to the library");
        }

        String token = null;
        int mirrored = 0;
        String lastError = null;
        for (MeetingRecordingDTO rec : googleRecordingService.getStored(schedule)) {
            if (isOnS3(rec)) {
                continue;
            }
            String driveFileId = driveFileId(rec);
            if (driveFileId == null) {
                continue;
            }
            try {
                if (token == null) {
                    // A reconnect that just granted Drive leaves a pre-grant token in the cache.
                    accessTokenService.evict(account.getId());
                    token = accessTokenService.getAccessToken(account);
                }
                String fileId = downloadAndStoreToS3(schedule, rec, driveFileId, token);
                if (fileId == null) {
                    lastError = "the Drive file was empty";
                    continue;
                }
                // Re-read so a Google sync that ran during the download isn't overwritten.
                SessionSchedule fresh = scheduleRepository.findById(schedule.getId()).orElse(schedule);
                googleRecordingService.attachUploadedFile(fresh, rec.getRecordingId(), fileId);
                mirrored++;
                log.info("google.s3.mirror ok scheduleId={} recordingId={} fileId={}",
                        schedule.getId(), rec.getRecordingId(), fileId);
            } catch (Exception e) {
                lastError = e.getMessage();
                log.error("google.s3.mirror failed scheduleId={} recordingId={}: {}",
                        schedule.getId(), rec.getRecordingId(), e.getMessage());
            }
        }
        if (mirrored == 0 && lastError != null) {
            throw new VacademyException(HttpStatus.BAD_GATEWAY,
                    "Could not save the recording from Google Drive: " + lastError);
        }
        return mirrored;
    }

    static boolean hasDriveAccess(GoogleAccount account) {
        String scopes = account.getGrantedScopes();
        return scopes != null && scopes.contains(GoogleOAuthService.DRIVE_MEET_READONLY_SCOPE);
    }

    static String driveFileId(MeetingRecordingDTO rec) {
        for (String url : new String[] {rec.getDownloadUrl(), rec.getPlaybackUrl()}) {
            if (url == null) continue;
            Matcher m = DRIVE_FILE_ID.matcher(url);
            if (m.find()) {
                return m.group(1) != null ? m.group(1) : m.group(2);
            }
        }
        return null;
    }

    private static boolean isOnS3(MeetingRecordingDTO rec) {
        String fileId = rec.getFileId();
        return fileId != null && !fileId.isBlank() && !fileId.startsWith("http");
    }

    private String downloadAndStoreToS3(SessionSchedule schedule, MeetingRecordingDTO rec, String driveFileId,
            String token) throws Exception {
        File temp = File.createTempFile("meet-rec-", ".mp4");
        try {
            long size = downloadToFile(DRIVE_FILES_URL + driveFileId + "?alt=media&supportsAllDrives=true",
                    token, temp);
            if (size <= 0) {
                return null;
            }
            Map<String, String> presigned = fileService.getPresignedUploadUrl(
                    "google-meet-recording-" + driveFileId + ".mp4", "video/mp4",
                    "GOOGLE_MEET_RECORDING", schedule.getId());
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

    /**
     * Streams a Drive file to a local temp file (Bearer auth), returning the bytes written.
     * Package-visible so tests can stub it. A non-2xx (403 = no Drive access / not the owner's
     * file, 404 = deleted from Drive) throws with the HTTP code so the admin sees why.
     */
    long downloadToFile(String downloadUrl, String accessToken, File dest) throws Exception {
        HttpURLConnection connection = (HttpURLConnection) new URL(downloadUrl).openConnection();
        connection.setRequestMethod("GET");
        connection.setRequestProperty("Authorization", "Bearer " + accessToken);
        connection.setConnectTimeout(15_000);
        connection.setReadTimeout(300_000);
        connection.setInstanceFollowRedirects(true);
        int code = connection.getResponseCode();
        if (code < 200 || code >= 300) {
            throw new IllegalStateException("Google Drive returned HTTP " + code
                    + (code == 403 ? " (no access — reconnect Google with Drive access)" : "")
                    + (code == 404 ? " (file no longer in Drive)" : ""));
        }
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

    /** Streams a local file to S3 via a presigned PUT (fixed length, no heap buffering). Package-visible for tests. */
    void putFileToPresignedUrl(String presignedUrl, File file, String contentType) throws Exception {
        HttpURLConnection connection = (HttpURLConnection) new URL(presignedUrl).openConnection();
        connection.setRequestMethod("PUT");
        connection.setDoOutput(true);
        connection.setConnectTimeout(15_000);
        connection.setReadTimeout(300_000);
        connection.setRequestProperty("Content-Type", contentType);
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
