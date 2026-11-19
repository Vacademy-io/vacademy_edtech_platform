package vacademy.io.media_service.service;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.*;
import org.springframework.stereotype.Service;
import org.springframework.util.StringUtils;
import org.springframework.web.client.RestTemplate;
import org.springframework.web.multipart.MultipartFile;
import vacademy.io.common.exceptions.VacademyException;

import java.io.IOException;
import java.util.Map;

@Service
public class PptToPdfService {

    private static final Logger logger = LoggerFactory.getLogger(PptToPdfService.class);

    private static final String CLOUD_CONVERT_BASE_URL = "https://api.cloudconvert.com/v2";
    private static final int MAX_POLL_ATTEMPTS = 60;
    private static final long POLL_INTERVAL_MS = 3000;
    // Pre-signed GET URL lifetime handed to CloudConvert. A conversion completes in
    // seconds/minutes; 1 day is ample headroom while keeping the link short-lived.
    private static final int SOURCE_URL_EXPIRY_DAYS = 1;

    @Value("${CLOUD_CONVERT_KEY:}")
    private String cloudConvertApiKey;

    @Autowired
    private FileService fileService;

    private final RestTemplate restTemplate = new RestTemplate();
    private final ObjectMapper objectMapper = new ObjectMapper();

    public byte[] convertPptToPdf(MultipartFile file) {
        return convertUsingCloudConvert(file);
    }

    public byte[] convertPptToPdfHighQuality(MultipartFile file, double scaleFactor) {
        return convertUsingCloudConvert(file);
    }

    /**
     * Converts an already-uploaded presentation (identified by its media-service
     * fileId) to PDF. A pre-signed GET URL is generated for the S3 object and handed
     * to CloudConvert via an {@code import/url} task, so the presentation bytes are
     * pulled directly from S3 and never stream through this service.
     *
     * @param fileId   media-service file id of the uploaded presentation
     * @param fileName original file name, used to detect the input format
     * @return converted PDF bytes
     */
    public byte[] convertPptToPdfByFileId(String fileId, String fileName) {
        if (!StringUtils.hasText(fileId)) {
            throw new VacademyException("fileId is required for conversion");
        }

        String sourceUrl;
        try {
            sourceUrl = fileService.getUrlWithExpiryAndId(fileId, SOURCE_URL_EXPIRY_DAYS);
        } catch (Exception e) {
            throw new VacademyException("Could not resolve uploaded file for conversion: " + e.getMessage());
        }
        if (!StringUtils.hasText(sourceUrl)) {
            throw new VacademyException("Uploaded file not found for fileId: " + fileId);
        }

        return convertUsingCloudConvertFromUrl(sourceUrl, getInputFormat(fileName));
    }

    private byte[] convertUsingCloudConvert(MultipartFile file) {
        if (cloudConvertApiKey == null || cloudConvertApiKey.isBlank()) {
            throw new VacademyException("CloudConvert API key is not configured");
        }

        String originalFilename = file.getOriginalFilename();
        String inputFormat = getInputFormat(originalFilename);

        logger.info("Starting CloudConvert conversion: file={}, format={}, size={} bytes",
                originalFilename, inputFormat, file.getSize());

        try {
            // Step 1: Create a job with import/upload + convert + export/url tasks
            JsonNode jobData = createJob(inputFormat);
            String jobId = jobData.path("id").asText();

            // Extract the upload task details
            JsonNode tasks = jobData.path("tasks");
            JsonNode uploadTask = findTaskByName(tasks, "import-file");
            String uploadUrl = uploadTask.path("result").path("form").path("url").asText();
            JsonNode parameters = uploadTask.path("result").path("form").path("parameters");

            // Step 2: Upload the file
            uploadFile(uploadUrl, parameters, file);
            logger.info("File uploaded successfully for job {}", jobId);

            // Step 3: Poll for job completion
            JsonNode completedJob = pollForCompletion(jobId);

            // Step 4: Download the exported PDF
            JsonNode exportTask = findTaskByName(completedJob.path("tasks"), "export-file");
            String downloadUrl = exportTask.path("result").path("files").get(0).path("url").asText();

            byte[] pdfBytes = downloadFile(downloadUrl);
            logger.info("PDF conversion complete: {} bytes", pdfBytes.length);
            return pdfBytes;

        } catch (VacademyException e) {
            throw e;
        } catch (Exception e) {
            logger.error("CloudConvert conversion failed", e);
            throw new VacademyException("PPT to PDF conversion failed: " + e.getMessage());
        }
    }

    /**
     * Same conversion pipeline as {@link #convertUsingCloudConvert}, but the source
     * presentation is pulled by CloudConvert from a pre-signed S3 URL ({@code import/url})
     * instead of being uploaded from this service ({@code import/upload}).
     */
    private byte[] convertUsingCloudConvertFromUrl(String sourceUrl, String inputFormat) {
        if (cloudConvertApiKey == null || cloudConvertApiKey.isBlank()) {
            throw new VacademyException("CloudConvert API key is not configured");
        }

        logger.info("Starting CloudConvert conversion from URL: format={}", inputFormat);

        try {
            // Step 1: Create a job with import/url + convert + export/url tasks
            JsonNode jobData = createJobFromUrl(inputFormat, sourceUrl);
            String jobId = jobData.path("id").asText();

            // Step 2: Poll for job completion (CloudConvert fetches the file itself)
            JsonNode completedJob = pollForCompletion(jobId);

            // Step 3: Download the exported PDF
            JsonNode exportTask = findTaskByName(completedJob.path("tasks"), "export-file");
            String downloadUrl = exportTask.path("result").path("files").get(0).path("url").asText();

            byte[] pdfBytes = downloadFile(downloadUrl);
            logger.info("PDF conversion complete: {} bytes", pdfBytes.length);
            return pdfBytes;

        } catch (VacademyException e) {
            throw e;
        } catch (Exception e) {
            logger.error("CloudConvert conversion from URL failed", e);
            throw new VacademyException("PPT to PDF conversion failed: " + e.getMessage());
        }
    }

    /**
     * Creates a CloudConvert job that imports the source from a URL:
     * 1. import/url - CloudConvert downloads the file from the given URL
     * 2. convert - to convert PPT to PDF
     * 3. export/url - to get a download URL for the result
     */
    private JsonNode createJobFromUrl(String inputFormat, String sourceUrl) throws IOException {
        Map<String, Object> job = Map.of(
                "tasks", Map.of(
                        "import-file", Map.of(
                                "operation", "import/url",
                                "url", sourceUrl),
                        "convert-file", Map.of(
                                "operation", "convert",
                                "input", "import-file",
                                "input_format", inputFormat,
                                "output_format", "pdf",
                                "optimize_print", true),
                        "export-file", Map.of(
                                "operation", "export/url",
                                "input", "convert-file")));

        HttpHeaders headers = createHeaders();
        headers.setContentType(MediaType.APPLICATION_JSON);

        String requestBody = objectMapper.writeValueAsString(job);
        HttpEntity<String> request = new HttpEntity<>(requestBody, headers);

        ResponseEntity<String> response = restTemplate.exchange(
                CLOUD_CONVERT_BASE_URL + "/jobs",
                HttpMethod.POST,
                request,
                String.class);

        if (!response.getStatusCode().is2xxSuccessful()) {
            throw new VacademyException("Failed to create CloudConvert job: " + response.getBody());
        }

        return objectMapper.readTree(response.getBody()).path("data");
    }

    /**
     * Creates a CloudConvert job with 3 chained tasks:
     * 1. import/upload - to upload the file
     * 2. convert - to convert PPT to PDF
     * 3. export/url - to get a download URL for the result
     */
    private JsonNode createJob(String inputFormat) throws IOException {
        Map<String, Object> job = Map.of(
                "tasks", Map.of(
                        "import-file", Map.of(
                                "operation", "import/upload"),
                        "convert-file", Map.of(
                                "operation", "convert",
                                "input", "import-file",
                                "input_format", inputFormat,
                                "output_format", "pdf",
                                "optimize_print", true),
                        "export-file", Map.of(
                                "operation", "export/url",
                                "input", "convert-file")));

        HttpHeaders headers = createHeaders();
        headers.setContentType(MediaType.APPLICATION_JSON);

        String requestBody = objectMapper.writeValueAsString(job);
        HttpEntity<String> request = new HttpEntity<>(requestBody, headers);

        ResponseEntity<String> response = restTemplate.exchange(
                CLOUD_CONVERT_BASE_URL + "/jobs",
                HttpMethod.POST,
                request,
                String.class);

        if (!response.getStatusCode().is2xxSuccessful()) {
            throw new VacademyException("Failed to create CloudConvert job: " + response.getBody());
        }

        return objectMapper.readTree(response.getBody()).path("data");
    }

    /**
     * Uploads the file to the CloudConvert import task using multipart form upload.
     */
    private void uploadFile(String uploadUrl, JsonNode parameters, MultipartFile file) throws IOException {
        org.springframework.util.LinkedMultiValueMap<String, Object> body = new org.springframework.util.LinkedMultiValueMap<>();

        // Add all form parameters from the upload task
        parameters.fields().forEachRemaining(entry -> body.add(entry.getKey(), entry.getValue().asText()));

        // Add the file
        org.springframework.core.io.ByteArrayResource fileResource = new org.springframework.core.io.ByteArrayResource(
                file.getBytes()) {
            @Override
            public String getFilename() {
                return file.getOriginalFilename();
            }
        };
        body.add("file", fileResource);

        HttpHeaders headers = new HttpHeaders();
        headers.setContentType(MediaType.MULTIPART_FORM_DATA);

        HttpEntity<org.springframework.util.LinkedMultiValueMap<String, Object>> request = new HttpEntity<>(body,
                headers);

        restTemplate.exchange(uploadUrl, HttpMethod.POST, request, String.class);
    }

    /**
     * Polls the job status until it completes or fails.
     */
    private JsonNode pollForCompletion(String jobId) throws IOException, InterruptedException {
        for (int attempt = 0; attempt < MAX_POLL_ATTEMPTS; attempt++) {
            Thread.sleep(POLL_INTERVAL_MS);

            HttpEntity<Void> request = new HttpEntity<>(createHeaders());
            ResponseEntity<String> response = restTemplate.exchange(
                    CLOUD_CONVERT_BASE_URL + "/jobs/" + jobId,
                    HttpMethod.GET,
                    request,
                    String.class);

            JsonNode jobData = objectMapper.readTree(response.getBody()).path("data");
            String status = jobData.path("status").asText();

            logger.debug("Job {} status: {} (attempt {}/{})", jobId, status, attempt + 1, MAX_POLL_ATTEMPTS);

            if ("finished".equals(status)) {
                return jobData;
            } else if ("error".equals(status)) {
                String errorMessage = jobData.path("tasks").toString();
                throw new VacademyException("CloudConvert conversion error: " + errorMessage);
            }
            // status is "processing" or "waiting" — continue polling
        }

        throw new VacademyException("CloudConvert conversion timed out after "
                + (MAX_POLL_ATTEMPTS * POLL_INTERVAL_MS / 1000) + " seconds");
    }

    /**
     * Downloads the converted PDF file from the export URL.
     */
    private byte[] downloadFile(String downloadUrl) {
        try {
            logger.info("Downloading PDF from CloudConvert export URL");

            // Use URI directly to prevent RestTemplate from double-encoding query
            // parameters of the presigned S3 URL
            java.net.URI uri = java.net.URI.create(downloadUrl);

            // We use a new HttpEntity without headers (no Bearer token) because S3 signed
            // URLs
            // will reject the request if the Authorization header is present but not part
            // of the signature.
            HttpHeaders headers = new HttpHeaders();
            HttpEntity<Void> request = new HttpEntity<>(headers);

            ResponseEntity<byte[]> response = restTemplate.exchange(
                    uri,
                    HttpMethod.GET,
                    request,
                    byte[].class);

            if (!response.getStatusCode().is2xxSuccessful() || response.getBody() == null) {
                throw new VacademyException("Failed to download PDF. Status: " + response.getStatusCode());
            }

            return response.getBody();
        } catch (Exception e) {
            logger.error("Failed to download PDF from CloudConvert", e);
            throw new VacademyException("Failed to download converted PDF: " + e.getMessage());
        }
    }

    private HttpHeaders createHeaders() {
        HttpHeaders headers = new HttpHeaders();
        headers.setBearerAuth(cloudConvertApiKey);
        return headers;
    }

    private String getInputFormat(String filename) {
        if (filename == null)
            return "pptx";
        String lower = filename.toLowerCase();
        if (lower.endsWith(".ppt"))
            return "ppt";
        if (lower.endsWith(".pptx"))
            return "pptx";
        if (lower.endsWith(".odp"))
            return "odp";
        if (lower.endsWith(".key"))
            return "key";
        return "pptx";
    }

    private JsonNode findTaskByName(JsonNode tasks, String taskName) {
        if (tasks.isArray()) {
            for (JsonNode task : tasks) {
                if (taskName.equals(task.path("name").asText())) {
                    return task;
                }
            }
        }
        throw new VacademyException("Task '" + taskName + "' not found in CloudConvert response");
    }
}
