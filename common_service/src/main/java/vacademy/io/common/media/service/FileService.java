package vacademy.io.common.media.service;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.extern.slf4j.Slf4j;
import org.apache.tomcat.util.buf.StringUtils;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpMethod;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.stereotype.Service;
import org.springframework.util.LinkedMultiValueMap;
import org.springframework.util.MultiValueMap;
import org.springframework.web.multipart.MultipartFile;
import vacademy.io.common.core.internal_api_wrapper.InternalClientUtils;
import vacademy.io.common.exceptions.VacademyException;
import vacademy.io.common.media.constant.MediaConstant;
import vacademy.io.common.media.dto.FileDetailsDTO;

import java.io.IOException;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;

@Service
@Slf4j
public class FileService {

    @Autowired
    InternalClientUtils internalClientUtils;
    @Value(value = "${spring.application.name}")
    String clientName;

    @Value(value = "${media.service.baseurl:check_for_url}")
    String mediaServerBaseUrl;

    public List<Map<String, String>> getUrlsForFileIds(List<String> fileIds) {
        log.debug("Entering in getUrlsForFileIds Method...");

        ResponseEntity<String> response = internalClientUtils.makeHmacRequest(clientName, HttpMethod.GET.name(), mediaServerBaseUrl, MediaConstant.multiplePublicUrlGetRoute + "?fileIds=" + StringUtils.join(fileIds, ',') + "&expiryDays=1", null);

        ObjectMapper objectMapper = new ObjectMapper();
        try {
            List<Map<String, String>> allUrls = objectMapper.readValue(response.getBody(), new TypeReference<List<Map<String, String>>>() {
            });

            return allUrls;
        } catch (JsonProcessingException e) {
            throw new RuntimeException(e);
        }
    }

    public String getPublicUrlForFileId(String fileId) {
        log.debug("Entering in getPublicUrlForFileId Method...");

        ResponseEntity<String> response = internalClientUtils.makeHmacRequest(clientName, HttpMethod.GET.name(), mediaServerBaseUrl, MediaConstant.publicUrlGetRoute + "?fileId=" + fileId + "&expiryDays=1", null);

        try {
            return response.getBody();
        } catch (Exception e) {
            throw new VacademyException(e.getMessage());
        }
    }

    public byte[] getFileFromFileId(String fileId) {
        String publicFileUrl = getPublicUrlForFileId(fileId);

        try {
            // Step 1: Open connection to the URL
            URL url = new URL(publicFileUrl);
            HttpURLConnection connection = (HttpURLConnection) url.openConnection();
            connection.setRequestMethod("GET");

            // Step 2: Read bytes from input stream
            try (InputStream in = connection.getInputStream()) {
                return in.readAllBytes();
            }
        } catch (IOException e) {
            throw new VacademyException(e.getMessage());
        }
    }

    public String uploadDataToS3(MultipartFile file) {
        log.debug("Entering in uploadDataToS3 Method...");

        HttpHeaders headers = new HttpHeaders();
        headers.setContentType(MediaType.MULTIPART_FORM_DATA);

        MultiValueMap<String, Object> body = new LinkedMultiValueMap<>();
        body.add("file", file.getResource());
        ResponseEntity<String> response = internalClientUtils.makeHmacRequest(clientName, HttpMethod.PUT.name(), mediaServerBaseUrl, MediaConstant.uploadFilePutRoute, body, headers);

        try {
            return response.getBody();
        } catch (Exception e) {
            throw new VacademyException(e.getMessage());
        }
    }

    /**
     * Gets a presigned S3 upload URL and creates a FileMetadata entry via the media service.
     * @return Map with "id" (file metadata ID) and "url" (presigned PUT URL)
     */
    public Map<String, String> getPresignedUploadUrl(String fileName, String fileType, String source, String sourceId) {
        log.debug("Getting presigned upload URL for file: {}", fileName);

        String route = MediaConstant.presignedUrlPostRoute
                + "?fileName=" + fileName
                + "&fileType=" + fileType
                + "&source=" + source
                + "&sourceId=" + sourceId;

        ResponseEntity<String> response = internalClientUtils.makeHmacRequest(
                clientName, HttpMethod.POST.name(), mediaServerBaseUrl, route, null);

        ObjectMapper objectMapper = new ObjectMapper();
        try {
            return objectMapper.readValue(response.getBody(), new TypeReference<Map<String, String>>() {});
        } catch (JsonProcessingException e) {
            throw new VacademyException("Failed to get presigned URL: " + e.getMessage());
        }
    }

    public List<FileDetailsDTO> getFileDetailsForFileIds(List<String> fileIds) {
        if (fileIds == null || fileIds.isEmpty()) {
            return new ArrayList<>();
        }

        log.debug("Entering in getFileDetailsForFileIds Method...");

        ResponseEntity<String> response = internalClientUtils.makeHmacRequest(clientName, HttpMethod.GET.name(), mediaServerBaseUrl, MediaConstant.multipleFileDetailsGetRoute + "?fileIds=" + StringUtils.join(fileIds, ',') + "&expiryDays=1", null);

        ObjectMapper objectMapper = new ObjectMapper();
        try {
            List<FileDetailsDTO> allUrls = objectMapper.readValue(response.getBody(), new TypeReference<List<FileDetailsDTO>>() {
            });

            return allUrls;
        } catch (JsonProcessingException e) {
            throw new RuntimeException(e);
        }
    }

}
