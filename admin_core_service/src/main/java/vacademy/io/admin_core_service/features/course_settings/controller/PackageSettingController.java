package vacademy.io.admin_core_service.features.course_settings.controller;

import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import vacademy.io.admin_core_service.features.course_settings.service.LmsSettingService;
import vacademy.io.admin_core_service.features.course_settings.service.PackageSettingAccessGuard;
import vacademy.io.admin_core_service.features.course_settings.service.PackageSettingService;
import vacademy.io.admin_core_service.features.institute.dto.settings.GenericSettingRequest;
import vacademy.io.common.auth.model.CustomUserDetails;

import java.util.Map;

/**
 * Per-package settings API over the {@code package.course_setting} JSON column,
 * mirroring the institute-level {@code /institute/setting/v1} controller. Lets
 * admins read and write the open-ended settings JSON that workflows consume.
 */
@RestController
@RequestMapping("/admin-core-service/package/setting/v1")
@RequiredArgsConstructor
public class PackageSettingController {

    private final PackageSettingService packageSettingService;
    private final LmsSettingService lmsSettingService;
    // Every route checks the caller first: the course must belong to the clientId institute
    // and the caller be staff there or the course's creator (see the guard).
    private final PackageSettingAccessGuard packageSettingAccessGuard;

    // ========================= GET =========================

    /** Raw course_setting JSON string (defaults to an empty envelope). */
    @GetMapping("/raw")
    public ResponseEntity<String> getRaw(@RequestAttribute("user") CustomUserDetails userDetails,
                                         @RequestParam("packageId") String packageId) {
        packageSettingAccessGuard.requireCanAccess(userDetails, packageId);
        return ResponseEntity.ok(packageSettingService.getRaw(packageId));
    }

    /** Whole parsed envelope ({@code { setting: { ... } }}). */
    @GetMapping("/all")
    public ResponseEntity<Map<String, Object>> getAll(@RequestAttribute("user") CustomUserDetails userDetails,
                                                      @RequestParam("packageId") String packageId) {
        packageSettingAccessGuard.requireCanAccess(userDetails, packageId);
        return ResponseEntity.ok(packageSettingService.getAll(packageId));
    }

    /** A single setting entry ({@code { key, name, data }}). */
    @GetMapping("/get")
    public ResponseEntity<Object> getSpecificSetting(@RequestAttribute("user") CustomUserDetails userDetails,
                                                     @RequestParam("packageId") String packageId,
                                                     @RequestParam("settingKey") String settingKey) {
        packageSettingAccessGuard.requireCanAccess(userDetails, packageId);
        return ResponseEntity.ok(packageSettingService.getSpecificSetting(packageId, settingKey));
    }

    /** Only the data part of a single setting key. */
    @GetMapping("/data")
    public ResponseEntity<Object> getSettingData(@RequestAttribute("user") CustomUserDetails userDetails,
                                                 @RequestParam("packageId") String packageId,
                                                 @RequestParam("settingKey") String settingKey) {
        packageSettingAccessGuard.requireCanAccess(userDetails, packageId);
        return ResponseEntity.ok(packageSettingService.getSettingData(packageId, settingKey));
    }

    // ========================= SAVE =========================

    /** Upsert a single setting key, preserving every other key in the envelope. */
    @PostMapping("/save-setting")
    public ResponseEntity<String> saveSetting(@RequestAttribute("user") CustomUserDetails userDetails,
                                              @RequestParam("packageId") String packageId,
                                              @RequestParam("settingKey") String settingKey,
                                              @RequestBody GenericSettingRequest request) {
        packageSettingAccessGuard.requireCanAccess(userDetails, packageId);
        packageSettingService.saveGenericSetting(packageId, settingKey, request);
        return ResponseEntity.ok("Setting saved successfully");
    }

    /** Replace the whole course_setting JSON with admin-supplied JSON. */
    @PostMapping("/raw")
    public ResponseEntity<String> saveRaw(@RequestAttribute("user") CustomUserDetails userDetails,
                                          @RequestParam("packageId") String packageId,
                                          @RequestBody String rawJson) {
        packageSettingAccessGuard.requireCanAccess(userDetails, packageId);
        packageSettingService.saveRaw(packageId, rawJson);
        return ResponseEntity.ok("Course settings JSON saved successfully");
    }

    // ========================= LMS =========================

    /** Copy the institute's LMS config into this package's LMS keys. */
    @PostMapping("/apply-institute-lms")
    public ResponseEntity<String> applyInstituteLms(@RequestAttribute("user") CustomUserDetails userDetails,
                                                    @RequestParam("instituteId") String instituteId,
                                                    @RequestParam("packageId") String packageId) {
        packageSettingAccessGuard.requireCanApplyInstituteLms(userDetails, instituteId, packageId);
        lmsSettingService.applyInstituteLmsToPackage(instituteId, packageId);
        return ResponseEntity.ok("Institute LMS settings applied to course");
    }
}
