package vacademy.io.admin_core_service.features.slide.controller;

import lombok.RequiredArgsConstructor;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.multipart.MultipartFile;
import vacademy.io.admin_core_service.features.slide.dto.AddScormSlideDTO;
import vacademy.io.admin_core_service.features.slide.dto.ScormSlideDTO;
import vacademy.io.admin_core_service.features.slide.entity.ScormSlide;
import vacademy.io.admin_core_service.features.slide.service.ScormService;
import vacademy.io.admin_core_service.features.slide.service.SlideService;
import vacademy.io.common.auth.model.CustomUserDetails;
import vacademy.io.common.auth.util.SuperAdminAuthUtil;

import java.io.IOException;
import java.util.Map;

@RestController
@RequestMapping("/admin-core-service/scorm/v1")
@RequiredArgsConstructor
public class ScormController {

    private final ScormService scormService;
    private final SlideService slideService;

    @PostMapping(value = "/upload", consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
    public ResponseEntity<ScormSlideDTO> uploadScormPackage(@RequestParam("file") MultipartFile file,
            @RequestAttribute(value = "user", required = false) CustomUserDetails userDetails) throws IOException { // Auth
                                                                                                                    // optional
                                                                                                                    // for
                                                                                                                    // now
                                                                                                                    // or
                                                                                                                    // required?
        ScormSlide slide = scormService.uploadScormPackage(file);
        return ResponseEntity.ok(mapToDTO(slide));
    }

    /**
     * One-off: move existing SCORM slides onto the current player. Dry run by
     * default; call repeatedly with dryRun=false until legacyRemainingBefore
     * reaches 0.
     */
    @PostMapping("/upgrade-legacy-players")
    public ResponseEntity<Map<String, Object>> upgradeLegacyPlayers(
            @RequestAttribute("user") CustomUserDetails userDetails,
            @RequestParam(defaultValue = "true") boolean dryRun,
            @RequestParam(defaultValue = "50") int limit) {
        SuperAdminAuthUtil.requireSuperAdmin(userDetails);
        return ResponseEntity.ok(scormService.upgradeLegacyPlayers(dryRun, Math.min(limit, 200)));
    }

    @PostMapping("/add-or-update")
    public String addOrUpdateScormSlide(@RequestBody AddScormSlideDTO slideDTO,
            @RequestParam String chapterId,
            @RequestParam String instituteId,
            @RequestParam String packageSessionId,
            @RequestParam String moduleId,
            @RequestParam String subjectId,
            @RequestAttribute("user") CustomUserDetails userDetails) {
        return slideService.addOrUpdateScormSlide(slideDTO, chapterId, moduleId, subjectId, packageSessionId,
                instituteId);
    }

    private ScormSlideDTO mapToDTO(ScormSlide slide) {
        // Construct launch URL logic or leave empty for frontend to construct?
        // Ideally backend provides it.
        // For now, returning raw paths. DTO has launchPath and originalFileId.
        return ScormSlideDTO.builder()
                .id(slide.getId())
                .scormVersion(slide.getScormVersion())
                .originalFileId(slide.getOriginalFileId())
                .launchPath(slide.getLaunchPath())
                .launchUrl(slide.getLaunchUrl())
                .build();
    }
}
