package vacademy.io.assessment_service.features.assessment.service;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;
import lombok.Getter;
import lombok.Setter;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.*;
import org.springframework.stereotype.Service;
import org.springframework.web.client.RestClientException;
import org.springframework.web.client.RestTemplate;

import java.io.IOException;
import java.util.HashMap;
import java.util.Map;

@Slf4j
@Service
public class DocConverterService {

    private static final String API_URL = "https://api.mathpix.com/v3/converter/";
    private static final String API_PDF_URL = "https://api.mathpix.com/v3/pdf/";
    private static final String APP_ID = "vacademy_8e6a90_950081";
    private static final String APP_KEY = "b27375705e35a88b52f041c5f8eba2dda6a23f36350300d39854c8301b1a9de4";

    private final RestTemplate restTemplate = new RestTemplate();

    public Boolean isConversionCompleted(String pdfId) {
        HttpHeaders headers = new HttpHeaders();
        headers.set("app_id", APP_ID);
        headers.set("app_key", APP_KEY);

        HttpEntity<String> entity = new HttpEntity<>(headers);

        try {
            ResponseEntity<String> response = restTemplate.exchange(
                    API_URL + pdfId,
                    HttpMethod.GET,
                    entity,
                    String.class
            );

            log.info("MathPix API conversion status check for PDF ID: {}, response status: {}, full body: {}", 
                     pdfId, response.getStatusCode(), response.getBody());

            if (response.getStatusCode() == HttpStatus.OK && response.getBody() != null) {
                ObjectMapper objectMapper = new ObjectMapper();
                ConversionStatusResponse statusResponse = objectMapper.readValue(response.getBody(), ConversionStatusResponse.class);
                String status = statusResponse.getStatus();
                if (status == null && statusResponse.getConversionStatus() instanceof String) {
                    status = (String) statusResponse.getConversionStatus();
                }
                log.info("MathPix conversion status for PDF ID: {} is '{}', error message: {}", pdfId, status, statusResponse.getErrorMessage());
                return "completed".equalsIgnoreCase(status);
            }
            return false;
        } catch (RestClientException e) {
            log.error("MathPix API status check failed for PDF ID: {}, error: {}", pdfId, e.getMessage());
            return false;
        } catch (IOException e) {
            log.error("Failed to parse MathPix status response for PDF ID: {}, error: {}", pdfId, e.getMessage());
            return false;
        }
    }

    public String getConvertedHtml(String pdfId) {
        try {
            HttpHeaders headers = new HttpHeaders();
            headers.set("app_id", APP_ID);
            headers.set("app_key", APP_KEY);

            HttpEntity<String> requestEntity = new HttpEntity<>(headers);

            ResponseEntity<String> response = restTemplate.exchange(
                    API_PDF_URL + pdfId + ".html",
                    HttpMethod.GET,
                    requestEntity,
                    String.class
            );

            if (response.getStatusCode() == HttpStatus.OK) {
                return response.getBody();
            }
            return null;
        } catch (RestClientException e) {
            return null;
        }
    }

    public String getConvertedMarkdown(String pdfId) {
        try {
            HttpHeaders headers = new HttpHeaders();
            headers.set("app_id", APP_ID);
            headers.set("app_key", APP_KEY);

            HttpEntity<String> requestEntity = new HttpEntity<>(headers);

            ResponseEntity<String> response = restTemplate.exchange(
                    API_PDF_URL + pdfId + ".md",
                    HttpMethod.GET,
                    requestEntity,
                    String.class
            );

            if (response.getStatusCode() == HttpStatus.OK) {
                return response.getBody();
            }
            return null;
        } catch (RestClientException e) {
            return null;
        }
    }

    public String startProcessing(String url) {
        // Create request body with fixed conversion formats
        PdfProcessingRequest requestBody = new PdfProcessingRequest(url);

        // Set headers
        HttpHeaders headers = new HttpHeaders();
        headers.setContentType(MediaType.APPLICATION_JSON);
        headers.set("app_id", APP_ID);
        headers.set("app_key", APP_KEY);

        HttpEntity<PdfProcessingRequest> requestEntity = new HttpEntity<>(requestBody, headers);

        log.info("Sending PDF processing request to MathPix for URL: {}", url);

        try {
            ResponseEntity<String> response = restTemplate.exchange(
                    API_PDF_URL,
                    HttpMethod.POST,
                    requestEntity,
                    String.class
            );

            log.info("MathPix API start processing response status: {}, body: {}", response.getStatusCode(), response.getBody());

            // Handle response
            ObjectMapper objectMapper = new ObjectMapper();

            if (response.getStatusCode() == HttpStatus.OK) {
                try {
                    PdfProcessingResponse pdfProcessingResponse = objectMapper.readValue(response.getBody(), PdfProcessingResponse.class);
                    String pdfId = pdfProcessingResponse.getPdfId();
                    log.info("MathPix PDF processing started successfully for URL: {}, PDF ID: {}", url, pdfId);
                    return pdfId;
                } catch (IOException e) {
                    log.error("Failed to parse MathPix response for URL: {}, error: {}", url, e.getMessage());
                }
            } else {
                log.error("MathPix API start processing failed for URL: {}, status: {}, body: {}", url, response.getStatusCode(), response.getBody());
            }
        } catch (RestClientException e) {
            log.error("MathPix API call failed for URL: {}, error: {}", url, e.getMessage());
        }

        return null;
    }

    // Inner class to map the response
    @Getter
    @Setter
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    @JsonIgnoreProperties(ignoreUnknown = true)
    private static class ConversionStatusResponse {
        private String status;
        private Object conversionStatus;
        private String errorMessage;

        // Getters and setters
        public String getStatus() {
            return status;
        }

        public void setStatus(String status) {
            this.status = status;
        }

        public Object getConversionStatus() {
            return conversionStatus;
        }

        public void setConversionStatus(Object conversionStatus) {
            this.conversionStatus = conversionStatus;
        }

        public String getErrorMessage() {
            return errorMessage;
        }

        public void setErrorMessage(String errorMessage) {
            this.errorMessage = errorMessage;
        }
    }

    // Request body class
    private static class PdfProcessingRequest {
        private String url;
        private Map<String, Boolean> conversion_formats;

        public PdfProcessingRequest(String url) {
            this.url = url;
            this.conversion_formats = new HashMap<>();
            this.conversion_formats.put("md", true);
            this.conversion_formats.put("html", true); // Keep HTML as backup
        }

        // Getters and setters
        public String getUrl() {
            return url;
        }

        public void setUrl(String url) {
            this.url = url;
        }

        public Map<String, Boolean> getConversion_formats() {
            return conversion_formats;
        }

        public void setConversion_formats(Map<String, Boolean> conversion_formats) {
            this.conversion_formats = conversion_formats;
        }
    }

    // Response class
    @Getter
    @Setter
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    @JsonIgnoreProperties(ignoreUnknown = true)
    private static class PdfProcessingResponse {
        private String pdfId;

        // Assuming the response contains the PDF ID field
        public String getPdfId() {
            return pdfId;
        }

        public void setPdfId(String pdfId) {
            this.pdfId = pdfId;
        }
    }

}