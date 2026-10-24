package vacademy.io.admin_core_service.features.institute.controller;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import vacademy.io.admin_core_service.features.admin_activity_logs.annotation.Auditable;
import vacademy.io.admin_core_service.features.institute.dto.settings.SwitchWhatsAppProviderRequest;
import vacademy.io.admin_core_service.features.institute.dto.settings.WhatsAppProviderCredentialsRequest;
import vacademy.io.admin_core_service.features.institute.dto.settings.WhatsAppProviderStatusResponse;
import vacademy.io.admin_core_service.features.institute.service.setting.InstituteSettingAccessGuard;
import vacademy.io.admin_core_service.features.institute.service.setting.WhatsAppSettingService;
import vacademy.io.common.auth.model.CustomUserDetails;

@RestController
@RequestMapping("/admin-core-service/institute/whatsapp-config/v1")
@RequiredArgsConstructor
@Slf4j
public class InstituteWhatsAppSettingController {

    private final WhatsAppSettingService whatsappSettingService;

    // The status response carries the provider credentials unmasked, and the writes replace
    // them: institute staff of instituteId only (the same level the generic save-setting
    // applies to WHATSAPP_SETTING). Callers: admin dashboard WhatsApp settings, webhook setup
    // and template list, all with clientId == instituteId.
    private final InstituteSettingAccessGuard instituteSettingAccessGuard;

    private static final String WHATSAPP_SETTING_KEY = "WHATSAPP_SETTING";

    /**
     * Get configured providers and active provider status.
     */
    @GetMapping("/status")
    public ResponseEntity<WhatsAppProviderStatusResponse> getProviderStatus(
            @RequestAttribute("user") CustomUserDetails userDetails,
            @RequestParam("instituteId") String instituteId) {
        instituteSettingAccessGuard.requireCanReadKey(userDetails, instituteId, WHATSAPP_SETTING_KEY);
        log.info("Fetching WhatsApp status for instituteId: {}", instituteId);
        WhatsAppProviderStatusResponse status = whatsappSettingService.getProviderStatus(instituteId);
        return ResponseEntity.ok(status);
    }

    /**
     * Switch the active WhatsApp provider.
     */
    @PutMapping("/provider")
    @Auditable(
            entityType = "INSTITUTE_SETTING",
            action = "UPDATE",
            entityIdExpr = "#instituteId",
            descriptionExpr = "'switched WhatsApp provider to ' + #request?.newProvider",
            captureBefore = "@whatsAppSettingService.getProviderStatus(#instituteId)")
    public ResponseEntity<String> switchProvider(
            @RequestAttribute("user") CustomUserDetails userDetails,
            @RequestParam("instituteId") String instituteId,
            @RequestBody SwitchWhatsAppProviderRequest request) {
        instituteSettingAccessGuard.requireCanWrite(userDetails, instituteId, WHATSAPP_SETTING_KEY);
        log.info("Switching provider for instituteId: {} to new provider: {}", instituteId, request.getNewProvider());
        whatsappSettingService.switchProvider(instituteId, request);
        return ResponseEntity.ok("Successfully switched WhatsApp Provider");
    }

    /**
     * Add or Update credentials for a particular WhatsApp provider (e.g. 'combot',
     * 'wati', 'meta')
     */
    @PutMapping("/credentials")
    @Auditable(
            entityType = "INSTITUTE_SETTING",
            action = "UPDATE",
            entityIdExpr = "#instituteId",
            descriptionExpr = "'updated WhatsApp credentials for ' + #request?.providerName",
            captureBefore = "@whatsAppSettingService.getProviderStatus(#instituteId)")
    public ResponseEntity<String> updateCredentials(
            @RequestAttribute("user") CustomUserDetails userDetails,
            @RequestParam("instituteId") String instituteId,
            @RequestBody WhatsAppProviderCredentialsRequest request) {
        instituteSettingAccessGuard.requireCanWrite(userDetails, instituteId, WHATSAPP_SETTING_KEY);
        log.info("Updating credentials for provider '{}' in instituteId: {}", request.getProviderName(), instituteId);
        whatsappSettingService.updateCredentials(instituteId, request);
        return ResponseEntity.ok("Successfully updated WhatsApp Credentials");
    }

    /**
     * Remove credentials for a particular WhatsApp provider (and fall back if it
     * was active).
     */
    @DeleteMapping("/credentials/{providerName}")
    @Auditable(
            entityType = "INSTITUTE_SETTING",
            action = "DELETE",
            entityIdExpr = "#instituteId",
            descriptionExpr = "'removed WhatsApp credentials for ' + #providerName",
            captureBefore = "@whatsAppSettingService.getProviderStatus(#instituteId)")
    public ResponseEntity<String> removeCredentials(
            @RequestAttribute("user") CustomUserDetails userDetails,
            @RequestParam("instituteId") String instituteId,
            @PathVariable("providerName") String providerName) {
        instituteSettingAccessGuard.requireCanWrite(userDetails, instituteId, WHATSAPP_SETTING_KEY);
        log.info("Removing credentials for provider '{}' in instituteId: {}", providerName, instituteId);
        whatsappSettingService.removeCredentials(instituteId, providerName);
        return ResponseEntity.ok("Successfully removed WhatsApp Credentials");
    }
}
