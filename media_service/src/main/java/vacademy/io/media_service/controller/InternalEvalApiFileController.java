package vacademy.io.media_service.controller;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpHeaders;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.multipart.MultipartFile;
import vacademy.io.media_service.dto.eval_api.EvalApiFileHeadResponse;
import vacademy.io.media_service.dto.eval_api.EvalApiPresignUploadRequest;
import vacademy.io.media_service.dto.eval_api.EvalApiPresignUploadResponse;
import vacademy.io.media_service.dto.eval_api.EvalApiSignedUrlResponse;
import vacademy.io.media_service.dto.eval_api.EvalApiStoredFileResponse;
import vacademy.io.media_service.service.EvalApiFileException;
import vacademy.io.media_service.service.EvalApiFileService;

import java.io.IOException;
import java.util.LinkedHashMap;
import java.util.Map;

/**
 * Storage endpoints for the AI Evaluation partner API. Service-to-service only:
 * every path has an {@code internal} segment, so the common InternalAuthFilter
 * requires the HMAC client headers (clientName + Signature) before a request
 * reaches this controller, like every other /media-service/internal route.
 *
 * <p>Responses carry signed URLs, so nothing here may be cached.
 */
@RestController
@RequestMapping("/media-service/internal/eval-api/v1")
public class InternalEvalApiFileController {

    @Autowired
    private EvalApiFileService evalApiFileService;

    @PostMapping("/presign-upload")
    public ResponseEntity<EvalApiPresignUploadResponse> presignUpload(
            @RequestBody EvalApiPresignUploadRequest request) {
        return noStore(evalApiFileService.presignUpload(request));
    }

    @GetMapping("/files/{fileId}/head")
    public ResponseEntity<EvalApiFileHeadResponse> head(@PathVariable String fileId) {
        return noStore(evalApiFileService.head(fileId));
    }

    @GetMapping("/files/{fileId}/signed-url")
    public ResponseEntity<EvalApiSignedUrlResponse> signedUrl(@PathVariable String fileId,
            @RequestParam(value = "expirySeconds", required = false) Integer expirySeconds) {
        return noStore(evalApiFileService.signedUrl(fileId, expirySeconds));
    }

    /**
     * Server-side PDF upload into the private prefix (checked copies; Phase 2
     * stitched answer sheets). Multipart: {@code file}, {@code institute_id},
     * optional {@code kind} = checked_copy (default) | answer_sheet.
     */
    @PostMapping("/upload")
    public ResponseEntity<EvalApiStoredFileResponse> upload(@RequestParam("file") MultipartFile file,
            @RequestParam("institute_id") String instituteId,
            @RequestParam(value = "kind", required = false) String kind) throws IOException {
        return noStore(evalApiFileService.storeServerFile(file, instituteId, kind));
    }

    @ExceptionHandler(EvalApiFileException.class)
    public ResponseEntity<Map<String, String>> handleRefusal(EvalApiFileException e) {
        Map<String, String> body = new LinkedHashMap<>();
        body.put("error", e.getCode());
        body.put("message", e.getMessage());
        return ResponseEntity.status(e.getStatus()).header(HttpHeaders.CACHE_CONTROL, "no-store").body(body);
    }

    private static <T> ResponseEntity<T> noStore(T body) {
        return ResponseEntity.ok().header(HttpHeaders.CACHE_CONTROL, "no-store").body(body);
    }
}
