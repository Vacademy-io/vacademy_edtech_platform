package vacademy.io.admin_core_service.features.audience.controller;

import jakarta.servlet.http.HttpServletRequest;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import vacademy.io.admin_core_service.features.audience.service.AdPlatformWebhookService;

import java.io.BufferedReader;
import java.io.IOException;
import java.io.InputStreamReader;
import java.util.Map;
import java.util.Optional;
import java.util.stream.Collectors;

/**
 * Public webhook endpoints for Meta Lead Ads and Google Lead Form Extensions.
 *
 * All paths are under /api/v1/webhook/ and are allowlisted in ApplicationSecurityConfig.
 *
 * ── Meta ──────────────────────────────────────────────────────────────────────
 *   GET  /admin-core-service/api/v1/webhook/meta  → hub.challenge verification
 *   POST /admin-core-service/api/v1/webhook/meta  → leadgen event processing
 *
 * ── Google ────────────────────────────────────────────────────────────────────
 *   POST /admin-core-service/api/v1/webhook/google/{googleKey}
 *        googleKey = connector.vendorId (static key shown in connector setup UI)
 */
@RestController
@RequestMapping("/admin-core-service/api/v1/webhook")
@RequiredArgsConstructor
@Slf4j
public class AdPlatformWebhookController {

    private final AdPlatformWebhookService adPlatformWebhookService;

    // ── Meta ──────────────────────────────────────────────────────────────────

    /**
     * Meta webhook verification (hub.challenge).
     * Meta sends a GET with hub.mode=subscribe, hub.verify_token, and hub.challenge.
     * We must echo back hub.challenge if verify_token matches.
     */
    @GetMapping("/meta")
    public ResponseEntity<String> verifyMetaWebhook(
            @RequestParam Map<String, String> queryParams) {
        Optional<String> challenge = adPlatformWebhookService.handleMetaVerificationChallenge(queryParams);
        if (challenge.isPresent()) {
            log.info("Meta webhook verification successful");
            return ResponseEntity.ok(challenge.get());
        }
        log.warn("Meta webhook verification failed: {}", queryParams);
        return ResponseEntity.status(403).body("Forbidden");
    }

    /**
     * Meta webhook event receiver.
     * Meta signs the payload with X-Hub-Signature-256.
     * We return 200 immediately and process async.
     */
    @PostMapping("/meta")
    public ResponseEntity<String> receiveMetaWebhook(HttpServletRequest request) {
        // Read body and signature header synchronously — before request is recycled
        String rawBody = readBody(request);
        String signatureHeader = request.getHeader("X-Hub-Signature-256");
        if (rawBody == null) {
            return ResponseEntity.badRequest().body("Empty body");
        }
        log.info("Received Meta webhook event, processing async");
        adPlatformWebhookService.handleMetaWebhookAsync(rawBody, signatureHeader);
        return ResponseEntity.ok("EVENT_RECEIVED");
    }

    // ── Google ────────────────────────────────────────────────────────────────

    /**
     * Google Lead Form Extensions webhook.
     * The googleKey in the URL path names the connector; the body's google_key must equal it.
     * Processed synchronously so the status tells Google the truth: 200 {} = saved,
     * 4XX {"message"} = misconfigured (not retried), 5XX = failed (Google retries).
     */
    @PostMapping("/google/{googleKey}")
    public ResponseEntity<Map<String, String>> receiveGoogleWebhook(
            @PathVariable String googleKey,
            HttpServletRequest request) {
        String rawBody = readBody(request);
        if (rawBody == null || rawBody.isBlank()) {
            return ResponseEntity.badRequest().body(Map.of("message", "Empty body"));
        }
        AdPlatformWebhookService.GoogleWebhookResult result =
                adPlatformWebhookService.handleGoogleWebhook(googleKey, rawBody);
        if (result.status() == 200) {
            return ResponseEntity.ok(Map.of());
        }
        return ResponseEntity.status(result.status()).body(Map.of("message", result.message()));
    }

    // ── Utilities ─────────────────────────────────────────────────────────────

    private String readBody(HttpServletRequest request) {
        try (BufferedReader reader = new BufferedReader(
                new InputStreamReader(request.getInputStream()))) {
            return reader.lines().collect(Collectors.joining("\n"));
        } catch (IOException e) {
            log.error("Failed to read request body", e);
            return null;
        }
    }
}
