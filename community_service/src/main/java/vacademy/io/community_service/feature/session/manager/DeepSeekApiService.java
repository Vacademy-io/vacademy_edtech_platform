package vacademy.io.community_service.feature.session.manager;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.*;
import org.springframework.stereotype.Service;
import org.springframework.web.client.RestTemplate;
import vacademy.io.community_service.feature.session.dto.admin.DeepSeekResponse;

import java.util.*;

@Service
public class DeepSeekApiService {

    private final RestTemplate restTemplate = new RestTemplate();
    private final ObjectMapper objectMapper = new ObjectMapper();
    private final String apiUrl = "https://openrouter.ai/api/v1/chat/completions";

    @Value("${OPENROUTER_API_KEY}")
    private String apiKey;

    public DeepSeekApiService() {

    }

    public DeepSeekResponse getChatCompletion(String modelName, String userInput, int maxTokens) {
        // Prepare headers
        HttpHeaders headers = new HttpHeaders();
        headers.setContentType(MediaType.APPLICATION_JSON);
        headers.setAccept(Collections.singletonList(MediaType.APPLICATION_JSON));
        headers.set("Authorization", "Bearer " + apiKey);

        // Prepare messages
        List<Map<String, String>> messages = new ArrayList<>();
        messages.add(createMessage("user", userInput));

        // Prepare request body
        Map<String, Object> requestBody = new HashMap<>();
        requestBody.put("messages", messages);
        requestBody.put("model", modelName);
        requestBody.put("max_tokens", maxTokens);
        requestBody.put("frequency_penalty", 0);
        requestBody.put("presence_penalty", 0);
        requestBody.put("temperature", 0.7);           // Less randomness for JSON
        requestBody.put("top_p", 0.9);                 // Slightly narrower sampling
        requestBody.put("stream", false);
        requestBody.put("transforms", List.of("middle-out"));

        // Create HTTP entity
        HttpEntity<Map<String, Object>> entity = new HttpEntity<>(requestBody, headers);

        // Make the API call and parse response
        ResponseEntity<String> response = restTemplate.exchange(
                apiUrl,
                HttpMethod.POST,
                entity,
                String.class
        );

        try {
            return objectMapper.readValue(response.getBody(), DeepSeekResponse.class);
        } catch (Exception e) {
            throw new RuntimeException("Failed to parse API response", e);
        }
    }

    private Map<String, String> createMessage(String role, String content) {
        Map<String, String> message = new HashMap<>();
        message.put("role", role);
        message.put("content", content);
        return message;
    }
}