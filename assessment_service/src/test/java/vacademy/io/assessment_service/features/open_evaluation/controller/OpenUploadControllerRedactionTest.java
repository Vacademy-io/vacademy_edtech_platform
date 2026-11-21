package vacademy.io.assessment_service.features.open_evaluation.controller;

import org.junit.jupiter.api.Test;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;

/** POST /uploads replays never carry the presigned PUT URLs (spec 7.0). */
class OpenUploadControllerRedactionTest {

    @Test
    @SuppressWarnings("unchecked")
    void the_stored_body_drops_upload_urls_and_keeps_the_upload_ids() {
        Map<String, Object> row = new LinkedHashMap<>();
        row.put("id", "up-1");
        row.put("filename", "a.pdf");
        row.put("upload_url", "https://bucket/eval-api/x?X-Amz-Signature=abc");
        row.put("method", "PUT");
        row.put("headers", Map.of("Content-Type", "application/pdf"));
        row.put("status", "pending");

        Map<String, Object> stored = (Map<String, Object>) OpenUploadController
                .withoutUploadUrls(Map.of("uploads", List.of(row)));

        Map<String, Object> out = ((List<Map<String, Object>>) stored.get("uploads")).get(0);
        assertThat(out).doesNotContainKey("upload_url").doesNotContainKey("headers")
                .containsEntry("id", "up-1").containsEntry("status", "pending")
                .containsEntry("upload_url_redacted", true);
        assertThat(row).containsKey("upload_url"); // the caller's own response is untouched
    }

    @Test
    void other_shapes_pass_through() {
        assertThat(OpenUploadController.withoutUploadUrls("x")).isEqualTo("x");
    }
}
