package vacademy.io.admin_core_service.features.media_service.service;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpMethod;
import org.springframework.http.ResponseEntity;
import org.springframework.stereotype.Service;
import org.springframework.web.multipart.MultipartFile;
import vacademy.io.admin_core_service.features.media_service.constants.MediaServiceConstants;
import vacademy.io.admin_core_service.features.notification.constants.NotificationConstant;
import vacademy.io.admin_core_service.features.notification.dto.NotificationDTO;
import vacademy.io.common.core.internal_api_wrapper.InternalClientUtils;
import vacademy.io.common.exceptions.VacademyException;
import vacademy.io.common.media.dto.FileDetailsDTO;
import vacademy.io.common.notification.dto.AttachmentNotificationDTO;
import vacademy.io.common.notification.dto.GenericEmailRequest;

import java.io.IOException;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.UUID;
import java.util.HashMap;

@Service
public class MediaService {
    @Autowired
    private InternalClientUtils internalClientUtils;

    @Value("${spring.application.name}")
    private String clientName;

    @Value("${media.server.baseurl}")
    private String mediaServerBaseUrl;

    @Autowired
    private ObjectMapper objectMapper;

    public String getFileUrlById(String fileId) {
        if (fileId == null || fileId.isEmpty()) {
            return null;
        }
        // Removed the redundant 'clientName' parameter, we can use the injected
        // clientName field here
        ResponseEntity<String> response = internalClientUtils.makeHmacRequest(
                clientName, // Directly use the injected 'clientName'
                HttpMethod.GET.name(),
                mediaServerBaseUrl,
                MediaServiceConstants.GET_FILE_URL_BY_ID_ROUTE + "?fileId=" + fileId + "&expiryDays=1",
                null);
        return response.getBody();
    }

    public String getFilePublicUrlById(String fileId) {
        if (fileId == null || fileId.isEmpty()) {
            return null;
        }
        // Removed the redundant 'clientName' parameter, we can use the injected
        // clientName field here
        ResponseEntity<String> response = internalClientUtils.makeHmacRequest(
                clientName, // Directly use the injected 'clientName'
                HttpMethod.GET.name(),
                mediaServerBaseUrl,
                MediaServiceConstants.GET_FILE_PUBLIC_URL_BY_ID_ROUTE + "?fileId=" + fileId + "&expiryDays=1",
                null);
        return response.getBody();
    }

    public String uploadFile(MultipartFile multipartFile) throws IOException {
        if (multipartFile == null) {
            return null;
        }
        // Removed the redundant 'clientName' parameter, we can use the injected
        // clientName field here
        ResponseEntity<String> response = internalClientUtils.makeHmacRequestForMultipartFile(
                clientName, // Directly use the injected 'clientName'
                HttpMethod.PUT.name(),
                mediaServerBaseUrl,
                MediaServiceConstants.GET_FILE_UPLOAD_ENDPOINT,
                multipartFile);
        return response.getBody();
    }

    public FileDetailsDTO uploadFileV2(MultipartFile multipartFile) throws IOException {
        if (multipartFile == null) {
            return null;
        }
        // Removed the redundant 'clientName' parameter, we can use the injected
        // clientName field here
        ResponseEntity<String> response = internalClientUtils.makeHmacRequestForMultipartFile(
                clientName, // Directly use the injected 'clientName'
                HttpMethod.POST.name(),
                mediaServerBaseUrl,
                MediaServiceConstants.GET_FILE_UPLOAD_ENDPOINT_V2,
                multipartFile);
        String body = response.getBody();
        return objectMapper.readValue(body, FileDetailsDTO.class);
    }

    /**
     * Upload to the PRIVATE bucket with server-side encryption (SSE-S3). For sensitive
     * media (Vacademy Voice call recordings of parents/minors). Retrieve the playback
     * URL via {@link #getFileUrlById(String)} (the private presigned getter) — NOT the
     * public getter.
     */
    public FileDetailsDTO uploadPrivateFileV2(MultipartFile multipartFile) throws IOException {
        if (multipartFile == null) {
            return null;
        }
        ResponseEntity<String> response = internalClientUtils.makeHmacRequestForMultipartFile(
                clientName,
                HttpMethod.POST.name(),
                mediaServerBaseUrl,
                MediaServiceConstants.GET_FILE_UPLOAD_ENDPOINT_PRIVATE,
                multipartFile);
        String body = response.getBody();
        return objectMapper.readValue(body, FileDetailsDTO.class);
    }

    public FileDetailsDTO uploadFileToKey(MultipartFile multipartFile, String key) throws IOException {
        if (multipartFile == null) {
            return null;
        }

        Map<String, Object> params = new HashMap<>();
        params.put("key", key);

        ResponseEntity<String> response = internalClientUtils.makeHmacRequestForMultipartFile(
                clientName,
                HttpMethod.POST.name(),
                mediaServerBaseUrl,
                "/media-service/internal/upload-file-custom-key",
                multipartFile,
                params);
        String body = response.getBody();
        return objectMapper.readValue(body, FileDetailsDTO.class);
    }

    public List<FileDetailsDTO> getFilesByIds(List<String> fileIds) {
        if (fileIds == null || fileIds.isEmpty()) {
            return List.of();
        }

        String commaSeparatedFileIds = String.join(",", fileIds);

        try {
            ResponseEntity<String> response = internalClientUtils.makeHmacRequest(
                    clientName,
                    HttpMethod.GET.name(),
                    mediaServerBaseUrl,
                    MediaServiceConstants.GET_MULTIPLE_FILES_BY_ID_ROUTE + "?fileIds=" + commaSeparatedFileIds
                            + "&expiryDays=1",
                    null);

            String body = response.getBody();
            if (body == null || body.isBlank()) {
                return List.of();
            }

            return objectMapper.readValue(body,
                    new com.fasterxml.jackson.core.type.TypeReference<List<FileDetailsDTO>>() {
                    });
        } catch (Exception e) {
            e.printStackTrace();
            return List.of();
        }
    }

    /**
     * Learner offline downloads (download-urls proxy): short-lived signed URLs
     * for a batch of fileIds via media_service's existing
     * GET /internal/get-url/id/many. Each map entry is {fileId: url}.
     */
    public List<Map<String, String>> getMultipleFileDownloadUrls(List<String> fileIds, int expiryDays) {
        if (fileIds == null || fileIds.isEmpty()) {
            return List.of();
        }
        String commaSeparatedFileIds = String.join(",", fileIds);
        ResponseEntity<String> response = internalClientUtils.makeHmacRequest(
                clientName,
                HttpMethod.GET.name(),
                mediaServerBaseUrl,
                MediaServiceConstants.GET_MULTIPLE_FILE_URLS_BY_ID_ROUTE + "?fileIds=" + commaSeparatedFileIds
                        + "&expiryDays=" + expiryDays,
                null);
        String body = response.getBody();
        if (body == null || body.isBlank()) {
            return List.of();
        }
        try {
            return objectMapper.readValue(body, new TypeReference<List<Map<String, String>>>() {
            });
        } catch (JsonProcessingException e) {
            throw new VacademyException("Failed to parse media_service download-url response: " + e.getMessage());
        }
    }

    /**
     * Permanent public (CDN) URLs for a batch of file ids, keyed by id, in one internal call
     * (GET /internal/get-public-url/id/many). media_service fails the WHOLE batch when any id
     * is unknown, so this throws then; callers that must not lose the rest fall back to
     * {@link #getFilePublicUrlByIdWithoutExpiry(String)} per id.
     */
    public Map<String, String> getPublicUrlsWithoutExpiry(java.util.Collection<String> fileIds) {
        Map<String, String> out = new HashMap<>();
        if (fileIds == null || fileIds.isEmpty()) {
            return out;
        }
        String commaSeparatedFileIds = String.join(",", fileIds);
        ResponseEntity<String> response = internalClientUtils.makeHmacRequest(
                clientName,
                HttpMethod.GET.name(),
                mediaServerBaseUrl,
                MediaServiceConstants.GET_MULTIPLE_PUBLIC_URLS_BY_ID_ROUTE + "?fileIds=" + commaSeparatedFileIds,
                null);
        String body = response.getBody();
        if (body == null || body.isBlank()) {
            return out;
        }
        try {
            List<Map<String, String>> entries = objectMapper.readValue(body,
                    new TypeReference<List<Map<String, String>>>() {
                    });
            for (Map<String, String> entry : entries) {
                if (entry != null) out.putAll(entry);
            }
            return out;
        } catch (JsonProcessingException e) {
            throw new VacademyException("Failed to parse media_service public-url response: " + e.getMessage());
        }
    }

    /**
     * Learner offline downloads (manifest builder): size/type/checksum for a
     * batch of fileIds, via the new offline-asset-details internal endpoint.
     */
    public List<vacademy.io.admin_core_service.features.learner_offline.dto.OfflineAssetDetailsResponseDTO> getOfflineAssetDetails(
            List<String> fileIds) {
        if (fileIds == null || fileIds.isEmpty()) {
            return List.of();
        }
        try {
            Map<String, Object> requestBody = Map.of("fileIds", fileIds);
            ResponseEntity<String> response = internalClientUtils.makeHmacRequest(
                    clientName,
                    HttpMethod.POST.name(),
                    mediaServerBaseUrl,
                    MediaServiceConstants.GET_OFFLINE_ASSET_DETAILS_ROUTE,
                    requestBody);
            String body = response.getBody();
            if (body == null || body.isBlank()) {
                return List.of();
            }
            return objectMapper.readValue(body, new TypeReference<List<vacademy.io.admin_core_service.features.learner_offline.dto.OfflineAssetDetailsResponseDTO>>() {
            });
        } catch (Exception e) {
            // Best-effort: manifest still returns the tree with fileIds and no
            // size/checksum rather than failing the whole request.
            return List.of();
        }
    }

    /**
     * Get public URL without expiry (permanent public URL)
     * Uses the public endpoint that returns direct S3 URLs
     */
    public String getFilePublicUrlByIdWithoutExpiry(String fileId) {
        if (fileId == null || fileId.isEmpty()) {
            return null;
        }
        // Use public endpoint that returns permanent URL without expiry
        ResponseEntity<String> response = internalClientUtils.makeHmacRequest(
                clientName,
                HttpMethod.GET.name(),
                mediaServerBaseUrl,
                "/media-service/public/get-public-url?fileId=" + fileId,
                null
        );
        return response.getBody();
    }

}
