package vacademy.io.admin_core_service.features.institute.controller;

import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import vacademy.io.admin_core_service.features.admin_activity_logs.annotation.Auditable;
import vacademy.io.admin_core_service.features.institute.dto.settings.custom_field.CustomFieldSettingRequest;
import vacademy.io.admin_core_service.features.institute.manager.InstituteSettingManager;
import vacademy.io.admin_core_service.features.institute.service.setting.InstituteSettingAccessGuard;
import vacademy.io.common.auth.model.CustomUserDetails;

@RestController
@RequestMapping("/admin-core-service/institute/v1/custom-field")
public class InstituteCustomFieldSettingController {

    private final InstituteSettingManager instituteSettingManager;
    private final InstituteSettingAccessGuard instituteSettingAccessGuard;

    public InstituteCustomFieldSettingController(InstituteSettingManager instituteSettingManager,
            InstituteSettingAccessGuard instituteSettingAccessGuard) {
        this.instituteSettingManager = instituteSettingManager;
        this.instituteSettingAccessGuard = instituteSettingAccessGuard;
    }

    @PostMapping("/create-or-update")
    @Auditable(
            entityType = "INSTITUTE_SETTING",
            action = "UPDATE",
            entityIdExpr = "#instituteId",
            descriptionExpr = "'updated custom field settings'",
            captureBefore = "@instituteSettingManager.getSettingData(#userDetails, #instituteId, 'CUSTOM_FIELD_SETTING').body")
    public ResponseEntity<String> updateCustomFieldSetting(@RequestAttribute("user") CustomUserDetails userDetails,
            @RequestParam("instituteId") String instituteId,
            @RequestBody CustomFieldSettingRequest request,
            @RequestParam(value = "isPresent", required = false) String isPresent) {
        // Staff, not ADMIN-only: non-admin roles can be given the Settings page (ui.showSettings).
        instituteSettingAccessGuard.requireCanWrite(userDetails, instituteId,
                InstituteSettingAccessGuard.CUSTOM_FIELD_SETTING_KEY);
        return instituteSettingManager.updateCustomFieldSetting(userDetails, instituteId, request, isPresent);

    }

    @GetMapping("/list-with-usage")
    public ResponseEntity<java.util.List<vacademy.io.admin_core_service.features.institute.dto.settings.custom_field.CustomFieldUsageDTO>> getCustomFieldsWithUsage(
            @RequestAttribute("user") CustomUserDetails userDetails,
            @RequestParam("instituteId") String instituteId) {
        return ResponseEntity.ok(instituteSettingManager.getCustomFieldsWithUsage(instituteId));
    }
}
