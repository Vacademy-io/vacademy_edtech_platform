package vacademy.io.admin_core_service.features.commerce.order.cod;

import org.springframework.format.annotation.DateTimeFormat;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestAttribute;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import vacademy.io.admin_core_service.features.commerce.order.cod.dto.CodRemittanceDtos;
import vacademy.io.common.auth.model.CustomUserDetails;

import java.time.LocalDate;

/**
 * Courier remittances of cash-on-delivery orders ({@code /commerce/v1/cod/remittances}): record
 * one (201; a repeat of the same request answers 200 with {@code replayed}), list them, read one.
 * Store manager or accountant; the service checks the role and each order's location.
 */
@RestController
@RequestMapping("/admin-core-service/commerce/v1/cod/remittances")
public class CommerceCodRemittanceController {

    private final CommerceCodRemittanceService service;

    public CommerceCodRemittanceController(CommerceCodRemittanceService service) {
        this.service = service;
    }

    @PostMapping
    public ResponseEntity<CodRemittanceDtos.RemittanceView> record(
            @RequestParam("instituteId") String instituteId,
            @RequestBody(required = false) CodRemittanceDtos.RemittanceRequest request,
            @RequestAttribute("user") CustomUserDetails user) {
        CommerceCodRemittanceService.Recorded recorded = service.record(user, instituteId, request);
        return ResponseEntity.status(recorded.created() ? HttpStatus.CREATED : HttpStatus.OK).body(recorded.view());
    }

    @GetMapping
    public ResponseEntity<CodRemittanceDtos.RemittancePage> list(
            @RequestParam("instituteId") String instituteId,
            @RequestParam(value = "from", required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate from,
            @RequestParam(value = "to", required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate to,
            @RequestParam(value = "page", required = false) Integer page,
            @RequestParam(value = "pageSize", required = false) Integer pageSize,
            @RequestAttribute("user") CustomUserDetails user) {
        return ResponseEntity.ok(service.list(user, instituteId, from, to, page, pageSize));
    }

    @GetMapping("/{remittanceId}")
    public ResponseEntity<CodRemittanceDtos.RemittanceView> get(
            @PathVariable("remittanceId") String remittanceId,
            @RequestParam("instituteId") String instituteId,
            @RequestAttribute("user") CustomUserDetails user) {
        return ResponseEntity.ok(service.get(user, instituteId, remittanceId));
    }
}
