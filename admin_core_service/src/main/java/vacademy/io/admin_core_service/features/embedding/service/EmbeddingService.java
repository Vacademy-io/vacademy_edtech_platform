package vacademy.io.admin_core_service.features.embedding.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.*;
import org.springframework.stereotype.Service;
import org.springframework.web.client.RestClientException;
import org.springframework.web.client.RestTemplate;
import vacademy.io.admin_core_service.features.embedding.dto.*;
import vacademy.io.common.external.VendorCallLog;

import java.io.*;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.time.LocalDateTime;
import java.time.format.DateTimeFormatter;
import java.util.List;
import java.util.UUID;
import vacademy.io.admin_core_service.features.ai_usage.enums.ApiProvider;
import vacademy.io.admin_core_service.features.ai_usage.enums.RequestType;
import vacademy.io.admin_core_service.features.ai_usage.service.AiTokenUsageService;

@Service
@RequiredArgsConstructor
@Slf4j
public class EmbeddingService {

    private static final String OPENROUTER_EMBEDDINGS_URL = "https://openrouter.ai/api/v1/embeddings";
    private static final String DEFAULT_MODEL = "qwen/qwen3-embedding-8b";
    private static final String DEFAULT_ENCODING_FORMAT = "float";

    @Value("${openrouter.api.key:#{null}}")
    private String openRouterApiKey;

    @Value("${embedding.storage.path:./embeddings}")
    private String embeddingStoragePath;

    private final RestTemplate restTemplate;
    private final ObjectMapper objectMapper;
    private final AiTokenUsageService aiTokenUsageService;

    /**
     * Generate embeddings for the given text using OpenRouter API
     */
    public EmbeddingResponse generateEmbedding(EmbeddingRequest request) {
        validateApiKey();

        String model = request.getModel() != null ? request.getModel() : DEFAULT_MODEL;
        String encodingFormat = request.getEncodingFormat() != null ? request.getEncodingFormat()
                : DEFAULT_ENCODING_FORMAT;

        log.info("[Embedding] Generating embedding for text of length: {} using model: {}",
                request.getText().length(), model);

        OpenRouterEmbeddingRequest openRouterRequest = OpenRouterEmbeddingRequest.builder()
                .model(model)
                .input(request.getText())
                .encodingFormat(encodingFormat)
                .build();

        HttpHeaders headers = new HttpHeaders();
        headers.setContentType(MediaType.APPLICATION_JSON);
        headers.setBearerAuth(openRouterApiKey);

        HttpEntity<OpenRouterEmbeddingRequest> entity = new HttpEntity<>(openRouterRequest, headers);

        try {
            ResponseEntity<OpenRouterEmbeddingResponse> response;
            try {
                response = restTemplate.exchange(
                        OPENROUTER_EMBEDDINGS_URL,
                        HttpMethod.POST,
                        entity,
                        OpenRouterEmbeddingResponse.class);
            } catch (RestClientException e) {
                VendorCallLog.failed(OPENROUTER_EMBEDDINGS_URL, "create embedding", openRouterRequest, e);
                throw e;
            }

            if (response.getBody() == null) {
                throw new RuntimeException("Empty response from OpenRouter API");
            }

            OpenRouterEmbeddingResponse openRouterResponse = response.getBody();

            log.info("[Embedding] Successfully generated embedding with {} dimensions",
                    openRouterResponse.getData().get(0).getEmbedding().size());

            // Log token usage
            logTokenUsage(openRouterResponse, model);

            return convertToEmbeddingResponse(openRouterResponse);

        } catch (Exception e) {
            log.error("[Embedding] Error generating embedding: {}", e.getMessage(), e);
            throw new RuntimeException("Failed to generate embedding: " + e.getMessage(), e);
        }
    }

    /**
     * Log token usage from embedding response
     */
    private void logTokenUsage(OpenRouterEmbeddingResponse response, String model) {
        try {
            if (response.getUsage() != null) {
                int promptTokens = response.getUsage().getPromptTokens();

                aiTokenUsageService.recordUsageAsync(
                        ApiProvider.OPENAI,
                        RequestType.EMBEDDING,
                        model,
                        promptTokens,
                        0, // Embeddings don't have completion tokens
                        null,
                        null);
            }
        } catch (Exception e) {
            log.warn("[Embedding] Failed to log token usage: {}", e.getMessage());
        }
    }

    /**
     * Generate embeddings and store them in a file
     */
    public StoredEmbeddingResult generateAndStoreEmbedding(EmbeddingRequest request, String filename) {
        EmbeddingResponse embeddingResponse = generateEmbedding(request);

        String storedFilePath = storeEmbedding(embeddingResponse, request.getText(), filename);

        return StoredEmbeddingResult.builder()
                .embeddingResponse(embeddingResponse)
                .filePath(storedFilePath)
                .timestamp(LocalDateTime.now())
                .build();
    }

    /**
     * Store embedding to a file
     */
    public String storeEmbedding(EmbeddingResponse embedding, String originalText, String filename) {
        try {
            // Create storage directory if it doesn't exist
            Path storagePath = Paths.get(embeddingStoragePath);
            if (!Files.exists(storagePath)) {
                Files.createDirectories(storagePath);
                log.info("[Embedding] Created storage directory: {}", storagePath);
            }

            // Generate filename if not provided
            if (filename == null || filename.isBlank()) {
                String timestamp = LocalDateTime.now().format(DateTimeFormatter.ofPattern("yyyyMMdd_HHmmss"));
                filename = "embedding_" + timestamp + "_" + UUID.randomUUID().toString().substring(0, 8) + ".json";
            } else if (!filename.endsWith(".json")) {
                filename = filename + ".json";
            }

            Path filePath = storagePath.resolve(filename);

            // Create embedding file content
            EmbeddingFileContent fileContent = EmbeddingFileContent.builder()
                    .id(embedding.getId())
                    .model(embedding.getModel())
                    .originalText(originalText)
                    .embedding(embedding.getData().get(0).getEmbedding())
                    .dimensions(embedding.getData().get(0).getEmbedding().size())
                    .createdAt(LocalDateTime.now().toString())
                    .usage(embedding.getUsage())
                    .build();

            // Write to file
            String jsonContent = objectMapper.writerWithDefaultPrettyPrinter().writeValueAsString(fileContent);
            Files.writeString(filePath, jsonContent);

            log.info("[Embedding] Stored embedding to file: {}", filePath);

            return filePath.toAbsolutePath().toString();

        } catch (IOException e) {
            log.error("[Embedding] Error storing embedding: {}", e.getMessage(), e);
            throw new RuntimeException("Failed to store embedding: " + e.getMessage(), e);
        }
    }

    /**
     * Load embedding from a file
     */
    public EmbeddingFileContent loadEmbedding(String filename) {
        try {
            Path filePath = Paths.get(embeddingStoragePath).resolve(filename);

            if (!Files.exists(filePath)) {
                throw new RuntimeException("Embedding file not found: " + filePath);
            }

            String content = Files.readString(filePath);
            return objectMapper.readValue(content, EmbeddingFileContent.class);

        } catch (IOException e) {
            log.error("[Embedding] Error loading embedding: {}", e.getMessage(), e);
            throw new RuntimeException("Failed to load embedding: " + e.getMessage(), e);
        }
    }

    /**
     * List all stored embeddings
     */
    public List<String> listStoredEmbeddings() {
        try {
            Path storagePath = Paths.get(embeddingStoragePath);
            if (!Files.exists(storagePath)) {
                return List.of();
            }

            return Files.list(storagePath)
                    .filter(p -> p.toString().endsWith(".json"))
                    .map(p -> p.getFileName().toString())
                    .toList();

        } catch (IOException e) {
            log.error("[Embedding] Error listing embeddings: {}", e.getMessage(), e);
            throw new RuntimeException("Failed to list embeddings: " + e.getMessage(), e);
        }
    }

    private void validateApiKey() {
        if (openRouterApiKey == null || openRouterApiKey.isBlank()) {
            throw new RuntimeException("OPENROUTER_API_KEY is not configured");
        }
    }

    private EmbeddingResponse convertToEmbeddingResponse(OpenRouterEmbeddingResponse openRouterResponse) {
        return EmbeddingResponse.builder()
                .id(openRouterResponse.getId())
                .model(openRouterResponse.getModel())
                .data(openRouterResponse.getData().stream()
                        .map(d -> EmbeddingResponse.EmbeddingData.builder()
                                .index(d.getIndex())
                                .object(d.getObject())
                                .embedding(d.getEmbedding())
                                .build())
                        .toList())
                .usage(EmbeddingResponse.Usage.builder()
                        .promptTokens(openRouterResponse.getUsage().getPromptTokens())
                        .totalTokens(openRouterResponse.getUsage().getTotalTokens())
                        .build())
                .build();
    }
}
