package vacademy.io.admin_core_service.features.commerce.notify.controller;

import com.fasterxml.jackson.databind.JsonNode;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestAttribute;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import vacademy.io.admin_core_service.features.commerce.notify.CommerceNotificationSettingsService;
import vacademy.io.admin_core_service.features.commerce.notify.CommerceNotificationTemplateSubmitService;
import vacademy.io.admin_core_service.features.commerce.notify.CommerceNotificationTestSendService;
import vacademy.io.admin_core_service.features.commerce.notify.CommerceNotifyRateLimitedException;
import vacademy.io.admin_core_service.features.commerce.notify.dto.NotificationSettingsDtos;
import vacademy.io.common.auth.model.CustomUserDetails;
import vacademy.io.common.core.exception.ErrorInfo;

import java.util.Date;

/**
 * The buyer-message settings of a shop ({@code /commerce/v1/notification-settings}): read by a
 * store manager, an accountant or an institute admin; changed, tested and templates requested by
 * a store manager or an admin. Commerce off: 403 {@code FEATURE_DISABLED} on every route.
 */
@RestController
@RequestMapping("/admin-core-service/commerce/v1/notification-settings")
public class CommerceNotificationSettingsController {

    private final CommerceNotificationSettingsService settingsService;
    private final CommerceNotificationTestSendService testSendService;
    private final CommerceNotificationTemplateSubmitService templateSubmitService;

    public CommerceNotificationSettingsController(CommerceNotificationSettingsService settingsService,
                                                  CommerceNotificationTestSendService testSendService,
                                                  CommerceNotificationTemplateSubmitService templateSubmitService) {
        this.settingsService = settingsService;
        this.testSendService = testSendService;
        this.templateSubmitService = templateSubmitService;
    }

    @GetMapping
    public ResponseEntity<NotificationSettingsDtos.SettingsView> get(
            @RequestParam("instituteId") String instituteId,
            @RequestAttribute("user") CustomUserDetails user) {
        return ResponseEntity.ok(settingsService.get(user, instituteId));
    }

    @PutMapping("/triggers/{trigger}")
    public ResponseEntity<NotificationSettingsDtos.TriggerView> updateTrigger(
            @PathVariable("trigger") String trigger,
            @RequestParam("instituteId") String instituteId,
            @RequestBody(required = false) JsonNode body,
            @RequestAttribute("user") CustomUserDetails user) {
        return ResponseEntity.ok(settingsService.updateTrigger(user, instituteId, trigger, body));
    }

    @PutMapping("/shop")
    public ResponseEntity<NotificationSettingsDtos.ShopView> updateShop(
            @RequestParam("instituteId") String instituteId,
            @RequestBody(required = false) JsonNode body,
            @RequestAttribute("user") CustomUserDetails user) {
        return ResponseEntity.ok(settingsService.updateShop(user, instituteId, body));
    }

    @PostMapping("/test-send")
    public ResponseEntity<NotificationSettingsDtos.TestSendAnswer> testSend(
            @RequestParam("instituteId") String instituteId,
            @RequestBody(required = false) JsonNode body,
            @RequestAttribute("user") CustomUserDetails user) {
        return ResponseEntity.ok(testSendService.send(user, instituteId, body));
    }

    @PostMapping("/whatsapp-templates")
    public ResponseEntity<NotificationSettingsDtos.TemplateSubmitAnswer> whatsappTemplates(
            @RequestParam("instituteId") String instituteId,
            @RequestBody(required = false) JsonNode body,
            @RequestAttribute("user") CustomUserDetails user) {
        return ResponseEntity.ok(templateSubmitService.submit(user, instituteId, body));
    }

    /** 429 {@code rate_limited} with {@code Retry-After}. */
    @ExceptionHandler(CommerceNotifyRateLimitedException.class)
    public ResponseEntity<ErrorInfo> rateLimited(HttpServletRequest request, CommerceNotifyRateLimitedException e) {
        return ResponseEntity.status(HttpStatus.TOO_MANY_REQUESTS)
                .header("Retry-After", String.valueOf(e.getRetryAfterSeconds()))
                .body(new ErrorInfo(request.getRequestURL().toString(), e.getMessage(),
                        String.valueOf(HttpStatus.TOO_MANY_REQUESTS), new Date()));
    }
}
