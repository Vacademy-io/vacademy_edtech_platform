package vacademy.io.assessment_service.features.assessment.service;

import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;
import vacademy.io.common.exceptions.VacademyException;
import vacademy.io.common.media.service.FileService;

import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Map;

/**
 * Uploads a report PDF via a presigned S3 URL and returns the resulting
 * file id. Extracted (PR2) from the inline block in
 * AssessmentParticipantsManager's release flow so the release path and the
 * PR4 bulk-export worker share one upload path instead of two copies.
 *
 * <p><b>Contract change from the code this was extracted from:</b> the
 * original release-flow block logged a non-2xx response and silently
 * continued, leaving {@code attempt.reportPdfFileId} unset with no signal to
 * the caller. That is exactly the failure mode the bulk-export item state
 * machine cannot tolerate — an item marked {@code DONE} with a null
 * {@code file_id} would be silently dropped by ZIP assembly (see
 * ARCHITECTURE.md §11). This method therefore <b>throws</b> on any non-2xx
 * response or I/O failure; callers must catch and handle per their own
 * semantics (the release flow logs-and-continues per attempt; the export
 * worker marks the item FAILED and retries on continue).
 */
@Slf4j
@Service
public class ReportPdfUploadService {

    @Autowired
    private FileService fileService;

    public String upload(byte[] bytes, String fileName, String source, String sourceId) {
        Map<String, String> presignedData = fileService.getPresignedUploadUrl(fileName, "application/pdf", source, sourceId);
        String fileId = presignedData.get("id");
        String uploadUrl = presignedData.get("url");
        if (fileId == null || uploadUrl == null) {
            throw new VacademyException("Failed to obtain presigned upload URL for " + fileName);
        }

        try {
            URL url = new URL(uploadUrl);
            HttpURLConnection conn = (HttpURLConnection) url.openConnection();
            conn.setRequestMethod("PUT");
            conn.setDoOutput(true);
            conn.setRequestProperty("Content-Type", "application/pdf");
            conn.setFixedLengthStreamingMode(bytes.length);
            try (OutputStream os = conn.getOutputStream()) {
                os.write(bytes);
                os.flush();
            }
            int responseCode = conn.getResponseCode();
            if (responseCode != 200 && responseCode != 201) {
                String errorBody = "";
                try (InputStream errStream = conn.getErrorStream()) {
                    if (errStream != null) errorBody = new String(errStream.readAllBytes());
                } catch (Exception ignored) {
                    // best-effort diagnostics only
                }
                conn.disconnect();
                throw new VacademyException("PDF upload returned " + responseCode + " for " + fileName + ": " + errorBody);
            }
            conn.disconnect();
            return fileId;
        } catch (VacademyException e) {
            throw e;
        } catch (Exception e) {
            throw new VacademyException("Failed to upload PDF " + fileName + ": " + e.getMessage());
        }
    }

    /**
     * Streams a file from disk to a presigned S3 URL with
     * {@code setFixedLengthStreamingMode}, never {@code setChunkedStreamingMode}
     * (S3 presigned PUTs reject chunked transfer without SigV4 streaming
     * headers) and never a {@code byte[]} buffer (that is plan C9 at ZIP
     * scale — a 150-student ZIP can be tens of MB). Used by
     * {@code ReportZipAssemblyService} for the final ZIP upload.
     */
    public String uploadStream(Path filePath, String fileName, String contentType, String source, String sourceId) {
        long length;
        try {
            length = Files.size(filePath);
        } catch (Exception e) {
            throw new VacademyException("Failed to read temp file size for " + fileName + ": " + e.getMessage());
        }

        Map<String, String> presignedData = fileService.getPresignedUploadUrl(fileName, contentType, source, sourceId);
        String fileId = presignedData.get("id");
        String uploadUrl = presignedData.get("url");
        if (fileId == null || uploadUrl == null) {
            throw new VacademyException("Failed to obtain presigned upload URL for " + fileName);
        }

        try {
            URL url = new URL(uploadUrl);
            HttpURLConnection conn = (HttpURLConnection) url.openConnection();
            conn.setRequestMethod("PUT");
            conn.setDoOutput(true);
            conn.setRequestProperty("Content-Type", contentType);
            conn.setFixedLengthStreamingMode(length);
            try (OutputStream os = conn.getOutputStream()) {
                Files.copy(filePath, os);
            }
            int responseCode = conn.getResponseCode();
            if (responseCode != 200 && responseCode != 201) {
                String errorBody = "";
                try (InputStream errStream = conn.getErrorStream()) {
                    if (errStream != null) errorBody = new String(errStream.readAllBytes());
                } catch (Exception ignored) {
                }
                conn.disconnect();
                throw new VacademyException("Stream upload returned " + responseCode + " for " + fileName + ": " + errorBody);
            }
            conn.disconnect();
            return fileId;
        } catch (VacademyException e) {
            throw e;
        } catch (Exception e) {
            throw new VacademyException("Failed to stream-upload " + fileName + ": " + e.getMessage());
        }
    }

    /** Opens a direct read stream for an existing file id — for streaming into a ZIP entry without buffering the whole PDF. */
    public InputStream openReadStream(String fileId) {
        try {
            String publicUrl = fileService.getPublicUrlForFileId(fileId);
            URL url = new URL(publicUrl);
            HttpURLConnection conn = (HttpURLConnection) url.openConnection();
            conn.setRequestMethod("GET");
            return conn.getInputStream();
        } catch (Exception e) {
            throw new VacademyException("Failed to open read stream for file " + fileId + ": " + e.getMessage());
        }
    }
}
