package vacademy.io.media_service.controller;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import vacademy.io.common.auth.model.CustomUserDetails;
import vacademy.io.common.exceptions.VacademyException;
import vacademy.io.common.media.dto.FileDetailsDTO;
import vacademy.io.media_service.config.cache.CacheScope;
import vacademy.io.media_service.config.cache.ClientCacheable;
import vacademy.io.media_service.dto.AcknowledgeRequest;
import vacademy.io.media_service.dto.PreSignedUrlRequest;
import vacademy.io.media_service.dto.PreSignedUrlResponse;
import vacademy.io.media_service.exceptions.FileDownloadException;
import vacademy.io.media_service.service.EvalApiFileService;
import vacademy.io.media_service.service.FileService;

import java.util.List;
import java.util.stream.Collectors;

@RestController
@RequestMapping("/media-service")
public class FileController {
    @Autowired
    private FileService fileService;

    @PostMapping("/get-signed-url")
    public ResponseEntity<PreSignedUrlResponse> uploadFile(@RequestAttribute("user") CustomUserDetails userDetails,
            @RequestBody PreSignedUrlRequest preSignedUrlRequest) {
        if (EvalApiFileService.isReservedSource(preSignedUrlRequest.getSource())) {
            throw new VacademyException(HttpStatus.BAD_REQUEST, "This source is reserved");
        }
        PreSignedUrlResponse url = fileService.getPreSignedUrl(preSignedUrlRequest.getFileName(),
                preSignedUrlRequest.getFileType(), preSignedUrlRequest.getSource(), preSignedUrlRequest.getSourceId());
        return ResponseEntity.ok(url);
    }

    @GetMapping("/get-public-url")
    @ClientCacheable(maxAgeSeconds = 60, scope = CacheScope.PRIVATE)
    public ResponseEntity<String> getFileUrl(@RequestAttribute("user") CustomUserDetails userDetails,
            @RequestParam String fileId,
            @RequestParam(required = false) Integer expiryDays,
            @RequestHeader(value = "If-None-Match", required = false) String ifNoneMatch) throws FileDownloadException {

        // Generate permanent public URL without expiry
        String url = fileService.getPublicUrl(fileId);

        return ResponseEntity.ok(url);
    }

    @PostMapping("/acknowledge")
    public ResponseEntity<Boolean> acknowledgeUpload(@RequestAttribute("user") CustomUserDetails userDetails,
            @RequestBody AcknowledgeRequest acknowledgeRequest) {
        return ResponseEntity.ok(fileService.acknowledgeClientUpload(acknowledgeRequest));
    }

    @GetMapping("/get-details/ids")
    public ResponseEntity<List<FileDetailsDTO>> getFileDetailsByIds(
            @RequestAttribute("user") CustomUserDetails userDetails, @RequestParam String fileIds,
            @RequestParam Integer expiryDays) throws FileDownloadException {
        // AI Evaluation API files are reachable only through the HMAC eval-api endpoints.
        List<FileDetailsDTO> fileDetailsDTO = fileService.getMultipleFileDetailsWithExpiryAndId(fileIds, expiryDays)
                .stream()
                .filter(details -> details == null || !EvalApiFileService.isReservedSource(details.getSource()))
                .collect(Collectors.toList());

        HttpHeaders headers = new HttpHeaders();
        headers.set("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0");
        headers.setPragma("no-cache");
        headers.setExpires(0);
        return ResponseEntity.ok().headers(headers).body(fileDetailsDTO);
    }

    @PostMapping("/acknowledge-get-details")
    public ResponseEntity<FileDetailsDTO> acknowledgeUploadAndGetDetails(
            @RequestAttribute("user") CustomUserDetails userDetails,
            @RequestBody AcknowledgeRequest acknowledgeRequest) {
        return ResponseEntity.ok(fileService.acknowledgeClientUploadAndGetPublicUrl(acknowledgeRequest));
    }

}