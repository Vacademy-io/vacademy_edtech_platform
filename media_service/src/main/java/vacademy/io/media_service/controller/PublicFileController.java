package vacademy.io.media_service.controller;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.multipart.MultipartFile;

import vacademy.io.common.exceptions.DatabaseException;
import vacademy.io.common.exceptions.VacademyException;
import vacademy.io.common.media.dto.FileDetailsDTO;
import vacademy.io.media_service.config.cache.CacheScope;
import vacademy.io.media_service.config.cache.ClientCacheable;
import vacademy.io.media_service.dto.PreSignedUrlRequest;
import vacademy.io.media_service.dto.PreSignedUrlResponse;
import vacademy.io.media_service.exceptions.FileDownloadException;
import vacademy.io.media_service.service.EvalApiFileService;
import vacademy.io.media_service.service.FileService;

@RestController
@RequestMapping("/media-service/public")
public class PublicFileController {

    @Autowired
    private FileService fileService;

    @PostMapping("/get-signed-url")
    public ResponseEntity<PreSignedUrlResponse> uploadFile(@RequestBody PreSignedUrlRequest preSignedUrlRequest) {
        if (EvalApiFileService.isReservedSource(preSignedUrlRequest.getSource())) {
            throw new VacademyException(HttpStatus.BAD_REQUEST, "This source is reserved");
        }
        PreSignedUrlResponse url = fileService.getPublicPreSignedUrl(preSignedUrlRequest.getFileName(),
                preSignedUrlRequest.getFileType(), preSignedUrlRequest.getSource(), preSignedUrlRequest.getSourceId());
        return ResponseEntity.ok(url);
    }

    @GetMapping("/get-public-url")
    @ClientCacheable(maxAgeSeconds = 60, scope = CacheScope.PUBLIC)
    public ResponseEntity<String> getFileUrl(@RequestParam String fileId,
            @RequestParam(required = false) Integer expiryDays,
            @RequestHeader(value = "If-None-Match", required = false) String ifNoneMatch) throws FileDownloadException {

        // Generate permanent public URL without expiry
        String url = fileService.getPublicUrl(fileId);

        return ResponseEntity.ok(url);
    }

    // Anonymous callers must not mint long-lived links: with the private-CDN signer
    // on there is no S3 7-day ceiling. The only caller (learner /m/ page) sends 7.
    private static final int MAX_PUBLIC_EXPIRY_DAYS = 7;

    @GetMapping("/get-details/id")
    public ResponseEntity<FileDetailsDTO> getFileDetailsById(@RequestParam String fileId, @RequestParam Integer expiryDays) throws FileDownloadException {
        expiryDays = Math.max(1, Math.min(expiryDays, MAX_PUBLIC_EXPIRY_DAYS));
        FileDetailsDTO fileDetailsDTO = fileService.getFileDetailsWithExpiryAndId(fileId, expiryDays);
        // AI Evaluation API files are reachable only through the HMAC eval-api endpoints.
        if (EvalApiFileService.isReservedSource(fileDetailsDTO.getSource())) {
            throw new DatabaseException("File Not Found");
        }
        HttpHeaders headers = new HttpHeaders();
        // private: the body carries a signed URL, so shared caches must not keep it
        headers.set("Cache-Control", "private, max-age=300, stale-while-revalidate=60");
        String etag = "W/\"" + fileId + ":" + expiryDays + "\"";
        headers.setETag(etag);
        return ResponseEntity.ok().headers(headers).body(fileDetailsDTO);
    }


    @PutMapping("/upload-file")
    public ResponseEntity<String> uploadFile(@RequestParam("file") MultipartFile file) {
        try {
            return ResponseEntity.ok(fileService.uploadFile(file));
        } catch (Exception e) {
            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR)
                    .body("Error uploading file: " + e.getMessage());
        }
    }

}
