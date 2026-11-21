package vacademy.io.admin_core_service.features.commerce.pos.controller;

import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestAttribute;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import vacademy.io.admin_core_service.features.commerce.pos.dto.PosDtos;
import vacademy.io.admin_core_service.features.commerce.pos.service.PosSettingsService;
import vacademy.io.common.auth.model.CustomUserDetails;

/** The counter's limits: anyone at a till reads them, an institute ADMIN changes them. */
@RestController
@RequestMapping("/admin-core-service/commerce/v1/pos")
public class PosSettingsController {

    private final PosSettingsService settingsService;

    public PosSettingsController(PosSettingsService settingsService) {
        this.settingsService = settingsService;
    }

    @GetMapping("/settings")
    public ResponseEntity<PosDtos.SettingsView> get(
            @RequestParam("instituteId") String instituteId,
            @RequestAttribute("user") CustomUserDetails user) {
        return ResponseEntity.ok(settingsService.get(user, instituteId));
    }

    @PutMapping("/settings")
    public ResponseEntity<PosDtos.SettingsView> update(
            @RequestParam("instituteId") String instituteId,
            @RequestBody(required = false) PosDtos.SettingsRequest request,
            @RequestAttribute("user") CustomUserDetails user) {
        return ResponseEntity.ok(settingsService.update(user, instituteId, request));
    }
}
