package vacademy.io.admin_core_service.features.institute.controller;

import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.ResponseEntity;
import org.springframework.cache.annotation.Cacheable;
import org.springframework.web.bind.annotation.*;
import vacademy.io.admin_core_service.features.institute.dto.InstituteInfoDTO;
import vacademy.io.admin_core_service.features.institute.service.InstituteService;
import vacademy.io.admin_core_service.features.institute.service.setting.InstituteSettingService;
import vacademy.io.admin_core_service.features.media_service.service.MediaService;
import vacademy.io.admin_core_service.config.cache.ClientCacheable;
import vacademy.io.admin_core_service.config.cache.CacheScope;
import vacademy.io.common.institute.entity.Institute;
import vacademy.io.admin_core_service.features.institute.repository.InstituteRepository;

import java.util.Map;
import java.util.Optional;

@Slf4j
@RestController
@RequestMapping("/admin-core-service/internal/institute/v1")
public class InsituteController {
    @Autowired
    private InstituteService service;

    @Autowired
    private InstituteSettingService instituteSettingService;

    @Autowired
    private InstituteRepository instituteRepository;

    @Autowired
    private MediaService mediaService;

    @GetMapping("/{instituteId}")
    @ClientCacheable(maxAgeSeconds = 600, scope = CacheScope.PUBLIC)
    @Cacheable(value = "instituteById", key = "#instituteId")
    public ResponseEntity<InstituteInfoDTO> getInstituteById(@PathVariable String instituteId) {
        InstituteInfoDTO institute = service.getInstituteById(instituteId);
        institute.setInstituteLogoUrl(logoUrl(institute.getInstituteLogoFileId(), instituteId));
        return ResponseEntity.ok(institute);
    }

    @GetMapping("/{instituteId}/setting")
    public ResponseEntity<Object> getSettingData(@PathVariable String instituteId,
                                                  @RequestParam String settingKey) {
        Optional<Institute> institute = instituteRepository.findById(instituteId);
        if (institute.isEmpty()) return ResponseEntity.notFound().build();
        Object data = instituteSettingService.getSettingData(institute.get(), settingKey);
        return ResponseEntity.ok(data);
    }

    /**
     * Internal rename hook for the onboarding/demo-management flow (community-service).
     * Body: {"instituteName": "..."}. Guarded by the internal HMAC auth filter ({@code /internal/**}).
     */
    @PutMapping("/{instituteId}/profile")
    public ResponseEntity<InstituteInfoDTO> updateInstituteProfile(@PathVariable String instituteId,
                                                                   @RequestBody Map<String, String> body) {
        return ResponseEntity.ok(service.updateInstituteProfile(instituteId, body.get("instituteName")));
    }

    /**
     * Internal lead-tag lookup for the dashboard-widget feature (community-service). community-service
     * needs an institute's lead tag to resolve LEAD_TAG-targeted widgets, but the tag lives here in
     * admin-core. Returns {@code {"leadTag": "PROD"}} (leadTag may be null). HMAC-guarded.
     */
    @GetMapping("/{instituteId}/lead-tag")
    public ResponseEntity<Map<String, String>> getInstituteLeadTag(@PathVariable String instituteId) {
        String leadTag = instituteRepository.findById(instituteId)
                .map(Institute::getLeadTag)
                .orElse(null);
        return ResponseEntity.ok(java.util.Collections.singletonMap("leadTag", leadTag));
    }

    /**
     * Permanent public URL of the logo, for callers without a media client (the OTP mail).
     * Best effort: a media-service failure must not fail the institute lookup that every
     * service's sender and branding hang off, so it only costs the logo.
     */
    private String logoUrl(String logoFileId, String instituteId) {
        if (logoFileId == null || logoFileId.isBlank()) return null;
        try {
            String url = mediaService.getFilePublicUrlByIdWithoutExpiry(logoFileId);
            return url != null && url.startsWith("http") ? url.trim() : null;
        } catch (Exception e) {
            log.warn("Logo URL for institute {} not resolved: {}", instituteId, e.getMessage());
            return null;
        }
    }
}
