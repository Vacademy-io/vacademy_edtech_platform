package vacademy.io.assessment_service.features.assessment.copy_intake.scan.service;

import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.stereotype.Component;
import org.springframework.util.StringUtils;
import org.springframework.web.reactive.function.client.WebClient;

/**
 * A readable URL for a media file id, so ai_service can download the pass scans.
 * The same media call CopyIntakeService.fileUrl makes, asking for a one-day link.
 */
@Component
@Slf4j
public class ScanMediaUrls {

    private final String mediaServiceUrl;

    public ScanMediaUrls(@Value("${media.service.baseurl}") String mediaServiceUrl) {
        this.mediaServiceUrl = mediaServiceUrl;
    }

    /** The URL, or null when media could not give one (the caller retries later). */
    public String url(String fileId) {
        try {
            String url = WebClient.builder()
                    .baseUrl(mediaServiceUrl)
                    .defaultHeader(HttpHeaders.CONTENT_TYPE, MediaType.APPLICATION_JSON_VALUE)
                    .build()
                    .get()
                    .uri(b -> b.path("/media-service/public/get-public-url")
                            .queryParam("fileId", fileId)
                            .queryParam("expiryDays", 1)
                            .build())
                    .retrieve()
                    .bodyToMono(String.class)
                    .block();
            return StringUtils.hasText(url) ? url.replace("\"", "") : null;
        } catch (Exception e) {
            log.error("[scan-station] media-service failed for fileId={}: {}", fileId, e.getMessage());
            return null;
        }
    }
}
