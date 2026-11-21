package vacademy.io.admin_core_service.features.institute.controller;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import vacademy.io.admin_core_service.features.admin_activity_logs.annotation.Auditable;
import vacademy.io.admin_core_service.features.institute.dto.settings.GenericSettingRequest;
import vacademy.io.admin_core_service.features.institute.dto.settings.InstituteSettingDto;
import vacademy.io.admin_core_service.features.institute.dto.settings.SettingDto;
import vacademy.io.admin_core_service.features.institute.dto.settings.naming.NameSettingRequest;
import vacademy.io.admin_core_service.features.institute.manager.InstituteSettingManager;
import vacademy.io.admin_core_service.features.institute.service.setting.InstituteSettingAccessGuard;
import vacademy.io.common.auth.model.CustomUserDetails;

@RestController
@RequestMapping("/admin-core-service/institute/setting/v1")
public class InstituteSettingController {

    @Autowired
    InstituteSettingManager instituteSettingManager;

    // Every write checks the caller against the institute and the key (see the guard for the
    // rule). The per-key reads (/get, /data) stay open for ordinary keys: learner surfaces and
    // ai_service read them with the caller's own token. Keys holding provider credentials
    // (WhatsApp, SMTP, LMS) need staff to read. The whole-blob reads (/all, /raw) need staff.
    @Autowired
    InstituteSettingAccessGuard instituteSettingAccessGuard;

    // ========================= SAVE/UPDATE ENDPOINTS =========================
    
    @PostMapping("/create-name-setting")
    @Auditable(
            entityType = "INSTITUTE_SETTING",
            action = "CREATE",
            entityIdExpr = "#instituteId",
            descriptionExpr = "'created naming settings'")
    public ResponseEntity<String> newNamingSetting(@RequestAttribute("user")CustomUserDetails userDetails,
                                                   @RequestParam("instituteId") String instituteId,
                                                   @RequestBody NameSettingRequest request){
        instituteSettingAccessGuard.requireCanWrite(userDetails, instituteId, InstituteSettingAccessGuard.NAMING_SETTING_KEY);
        return instituteSettingManager.createNewNamingSetting(userDetails, instituteId, request);
    }

    @PostMapping("/update-name-setting")
    @Auditable(
            entityType = "INSTITUTE_SETTING",
            action = "UPDATE",
            entityIdExpr = "#instituteId",
            descriptionExpr = "'updated naming settings'",
            captureBefore = "@instituteSettingManager.getSettingData(#userDetails, #instituteId, 'NAMING_SETTING').body")
    public ResponseEntity<String> updateNamingSetting(@RequestAttribute("user")CustomUserDetails userDetails,
                                                   @RequestParam("instituteId") String instituteId,
                                                   @RequestBody NameSettingRequest request){
        instituteSettingAccessGuard.requireCanWrite(userDetails, instituteId, InstituteSettingAccessGuard.NAMING_SETTING_KEY);
        return instituteSettingManager.updateNamingSetting(userDetails, instituteId, request);
    }

    // Unified API for any setting key - handles both create and update
    // Supports: NAME_SETTING, COURSE_SETTING, CERTIFICATE_SETTING, CHATBOT_SETTING, etc.
    @PostMapping("/save-setting")
    @Auditable(
            entityType = "INSTITUTE_SETTING",
            action = "UPDATE",
            entityIdExpr = "#instituteId",
            descriptionExpr = "'updated ' + #settingKey?.toLowerCase()?.replace('_', ' ')",
            captureBefore = "@instituteSettingManager.getSettingData(#userDetails, #instituteId, #settingKey).body")
    public ResponseEntity<String> saveSetting(@RequestAttribute("user")CustomUserDetails userDetails,
                                              @RequestParam("instituteId") String instituteId,
                                              @RequestParam("settingKey") String settingKey,
                                              @RequestBody GenericSettingRequest request){
        instituteSettingAccessGuard.requireCanWrite(userDetails, instituteId, settingKey);
        return instituteSettingManager.saveGenericSetting(userDetails, instituteId, settingKey, request);
    }

    // ========================= GET ENDPOINTS =========================

    // Get all settings for an institute
    @GetMapping("/all")
    public ResponseEntity<InstituteSettingDto> getAllSettings(@RequestAttribute("user")CustomUserDetails userDetails,
                                                             @RequestParam("instituteId") String instituteId){
        instituteSettingAccessGuard.requireCanReadAll(userDetails, instituteId);
        return instituteSettingManager.getAllSettings(userDetails, instituteId);
    }

    // Get a specific setting by key
    @GetMapping("/get")
    public ResponseEntity<SettingDto> getSpecificSetting(@RequestAttribute("user")CustomUserDetails userDetails,
                                                         @RequestParam("instituteId") String instituteId,
                                                         @RequestParam("settingKey") String settingKey){
        instituteSettingAccessGuard.requireCanReadKey(userDetails, instituteId, settingKey);
        return instituteSettingManager.getSpecificSetting(userDetails, instituteId, settingKey);
    }

    // Get only the data part of a specific setting
    @GetMapping("/data")
    public ResponseEntity<Object> getSettingData(@RequestAttribute("user")CustomUserDetails userDetails,
                                                 @RequestParam("instituteId") String instituteId,
                                                 @RequestParam("settingKey") String settingKey){
        instituteSettingAccessGuard.requireCanReadKey(userDetails, instituteId, settingKey);
        return instituteSettingManager.getSettingData(userDetails, instituteId, settingKey);
    }

    // Get raw JSON string (for backward compatibility)
    @GetMapping("/raw")
    public ResponseEntity<String> getSettingsAsRawJson(@RequestAttribute("user")CustomUserDetails userDetails,
                                                       @RequestParam("instituteId") String instituteId){
        instituteSettingAccessGuard.requireCanReadAll(userDetails, instituteId);
        return instituteSettingManager.getSettingsAsRawJson(userDetails, instituteId);
    }

}
