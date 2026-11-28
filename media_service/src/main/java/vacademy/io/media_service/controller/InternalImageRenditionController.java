package vacademy.io.media_service.controller;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import vacademy.io.media_service.rendition.ImageRenditionService;
import vacademy.io.media_service.rendition.RenditionError;
import vacademy.io.media_service.rendition.RenditionException;

import java.util.ArrayList;
import java.util.Collection;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * Service-to-service only (admin_core commerce rendition job). Takes a file id and the ids the
 * file must have been uploaded for ({@code owner_ids}: the institute and the product of the
 * gallery row); a URL or a storage key in the body is ignored.
 */
@Slf4j
@RestController
@RequestMapping("/media-service/internal/image-renditions")
@RequiredArgsConstructor
public class InternalImageRenditionController {

    private final ImageRenditionService renditionService;

    @PostMapping
    public ResponseEntity<Object> generate(@RequestBody(required = false) Map<String, Object> body) {
        Object fileId = body == null ? null : body.get("file_id");
        List<String> owners = new ArrayList<>();
        if (body != null && body.get("owner_ids") instanceof Collection<?> sent) {
            for (Object owner : sent) {
                if (owner instanceof String id && owners.size() < 4) {
                    owners.add(id);
                }
            }
        }
        try {
            return ResponseEntity.ok(renditionService.generate(fileId instanceof String s ? s.trim() : null, owners));
        } catch (RenditionException e) {
            RenditionError error = e.getError();
            if (error.isRetryable()) {
                log.warn("Renditions for file {} not made ({}): {}", fileId, error, e.getMessage());
            } else {
                log.info("Renditions for file {} refused ({}): {}", fileId, error, e.getMessage());
            }
            Map<String, Object> answer = new LinkedHashMap<>();
            answer.put("code", error.name());
            answer.put("retryable", error.isRetryable());
            answer.put("message", e.getMessage());
            return ResponseEntity.status(statusOf(error)).body(answer);
        }
    }

    static HttpStatus statusOf(RenditionError error) {
        if (!error.isRetryable()) {
            return HttpStatus.UNPROCESSABLE_ENTITY;
        }
        return error == RenditionError.BUSY ? HttpStatus.TOO_MANY_REQUESTS : HttpStatus.SERVICE_UNAVAILABLE;
    }
}
