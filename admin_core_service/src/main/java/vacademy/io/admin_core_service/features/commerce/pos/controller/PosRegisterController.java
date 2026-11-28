package vacademy.io.admin_core_service.features.commerce.pos.controller;

import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestAttribute;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import vacademy.io.admin_core_service.features.commerce.pos.dto.PosDtos;
import vacademy.io.admin_core_service.features.commerce.pos.service.PosRegisterService;
import vacademy.io.common.auth.model.CustomUserDetails;

/** Registers (tills) of the billing counter. Access is checked by the service (feature commerce.pos). */
@RestController
@RequestMapping("/admin-core-service/commerce/v1/pos")
public class PosRegisterController {

    private final PosRegisterService registerService;

    public PosRegisterController(PosRegisterService registerService) {
        this.registerService = registerService;
    }

    @GetMapping("/registers")
    public ResponseEntity<PosDtos.RegistersAnswer> list(
            @RequestParam("instituteId") String instituteId,
            @RequestParam(value = "locationId", required = false) String locationId,
            @RequestAttribute("user") CustomUserDetails user) {
        return ResponseEntity.ok(registerService.list(user, instituteId, locationId));
    }

    @PostMapping("/registers")
    public ResponseEntity<PosDtos.RegisterView> create(
            @RequestParam("instituteId") String instituteId,
            @RequestBody(required = false) PosDtos.RegisterCreateRequest request,
            @RequestAttribute("user") CustomUserDetails user) {
        PosRegisterService.Saved saved = registerService.create(user, instituteId, request);
        return ResponseEntity.status(saved.replayed() ? HttpStatus.OK : HttpStatus.CREATED).body(saved.register());
    }

    @PutMapping("/registers/{registerId}")
    public ResponseEntity<PosDtos.RegisterView> update(
            @PathVariable("registerId") String registerId,
            @RequestParam("instituteId") String instituteId,
            @RequestBody(required = false) PosDtos.RegisterUpdateRequest request,
            @RequestAttribute("user") CustomUserDetails user) {
        return ResponseEntity.ok(registerService.update(user, instituteId, registerId, request).register());
    }
}
