package vacademy.io.admin_core_service.features.telephony.controller;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.server.ResponseStatusException;
import vacademy.io.admin_core_service.core.security.InstituteAccessValidator;
import vacademy.io.admin_core_service.features.media_service.service.MediaService;
import vacademy.io.admin_core_service.features.telephony.persistence.entity.TelephonyCallLog;
import vacademy.io.admin_core_service.features.telephony.persistence.repository.TelephonyCallLogRepository;
import vacademy.io.common.auth.model.CustomUserDetails;

import java.util.Map;

import static org.springframework.http.HttpStatus.FORBIDDEN;
import static org.springframework.http.HttpStatus.NOT_FOUND;

/**
 * Returns a short-lived presigned URL for the recording mp3 instead of
 * proxying the bytes — keeps admin_core_service out of the audio path.
 *
 * The supplied {@code instituteId} must match the row's institute; cross-
 * institute fetches return 403 even if the UUID is somehow leaked. The caller must
 * also be staff of that institute: the row check alone only proved the caller knew
 * which institute the call belonged to, not that they are part of it.
 */
@RestController
@RequestMapping("/admin-core-service/v1/telephony/calls")
public class RecordingPlaybackController {

    @Autowired private TelephonyCallLogRepository callLogRepo;
    @Autowired private MediaService mediaService;
    @Autowired private InstituteAccessValidator instituteAccessValidator;

    @GetMapping("/{callLogId}/recording")
    public ResponseEntity<Map<String, String>> recording(
            @PathVariable String callLogId,
            @RequestParam("instituteId") String instituteId,
            @RequestAttribute("user") CustomUserDetails user) {
        instituteAccessValidator.requireInstituteStaff(user, instituteId);
        TelephonyCallLog row = callLogRepo.findById(callLogId)
                .orElseThrow(() -> new ResponseStatusException(NOT_FOUND));
        if (instituteId == null || !instituteId.equals(row.getInstituteId())) {
            throw new ResponseStatusException(FORBIDDEN);
        }
        if (row.getRecordingStorageKey() == null) {
            return ResponseEntity.noContent().build();
        }
        // Bucket depends on where RecordingTxOps.persist stored it:
        //   - Vacademy Voice (Plivo) recordings live in the PRIVATE, SSE-encrypted
        //     bucket (recording_private = true) → presign via getFileUrlById.
        //   - Every other provider uploads via uploadFileV2 to the PUBLIC bucket
        //     (vacademy-media-storage-public) → getFilePublicUrlById (getFileUrlById
        //     would resolve the private bucket and return a NoSuchKey URL).
        String url = Boolean.TRUE.equals(row.getRecordingPrivate())
                ? mediaService.getFileUrlById(row.getRecordingStorageKey())
                : mediaService.getFilePublicUrlById(row.getRecordingStorageKey());
        return ResponseEntity.ok(Map.of("url", url == null ? "" : url));
    }
}
