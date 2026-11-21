package vacademy.io.admin_core_service.features.commerce.label.controller;

import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestAttribute;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import vacademy.io.admin_core_service.features.commerce.label.dto.LabelDtos.CancelAnswer;
import vacademy.io.admin_core_service.features.commerce.label.dto.LabelDtos.LabelIdsRequest;
import vacademy.io.admin_core_service.features.commerce.label.dto.LabelDtos.LabelRequestsRequest;
import vacademy.io.admin_core_service.features.commerce.label.dto.LabelDtos.LabelsAnswer;
import vacademy.io.admin_core_service.features.commerce.label.dto.LabelDtos.PrintDataAnswer;
import vacademy.io.admin_core_service.features.commerce.label.dto.LabelDtos.PrintDataRequest;
import vacademy.io.admin_core_service.features.commerce.label.dto.LabelDtos.PrintedAnswer;
import vacademy.io.admin_core_service.features.commerce.label.dto.LabelDtos.ReplaceAnswer;
import vacademy.io.admin_core_service.features.commerce.label.service.LabelQueueService;
import vacademy.io.admin_core_service.features.commerce.stock.controller.StockOpsAccess;
import vacademy.io.common.auth.model.CustomUserDetails;
import vacademy.io.common.exceptions.InvalidRequestException;

/**
 * The label queue ({@code /commerce/v1/labels}): manager and warehouse staff, each row guarded at
 * its own location, lists limited to the caller's locations. The labels are drawn by the browser
 * from {@code POST /labels/print-data}; the screen marks them printed after the print dialog.
 */
@RestController
@RequestMapping("/admin-core-service/commerce/v1/labels")
@RequiredArgsConstructor
public class LabelController {

    private final StockOpsAccess access;
    private final LabelQueueService labelService;

    @GetMapping
    public ResponseEntity<LabelsAnswer> list(@RequestAttribute("user") CustomUserDetails user,
                                             @RequestParam("instituteId") String instituteId,
                                             @RequestParam(value = "locationId", required = false) String locationId,
                                             @RequestParam(value = "status", required = false) String status,
                                             @RequestParam(value = "reason", required = false) String reason,
                                             @RequestParam(value = "sourceType", required = false) String sourceType,
                                             @RequestParam(value = "sourceId", required = false) String sourceId,
                                             @RequestParam(value = "page", defaultValue = "0") int page,
                                             @RequestParam(value = "size", defaultValue = "50") int size) {
        if (locationId != null && !locationId.isBlank()) {
            access.requireAt(user, instituteId, StockOpsAccess.STOCK_STAFF, locationId.trim());
        } else {
            access.require(user, instituteId, StockOpsAccess.STOCK_STAFF);
        }
        return ResponseEntity.ok(labelService.list(instituteId, access.caller(user, instituteId), locationId, status,
                reason, sourceType, sourceId, page, size));
    }

    @PostMapping("/requests")
    public ResponseEntity<LabelsAnswer> request(@RequestAttribute("user") CustomUserDetails user,
                                                @RequestParam("instituteId") String instituteId,
                                                @RequestBody LabelRequestsRequest request) {
        if (request == null) {
            throw new InvalidRequestException("VALIDATION: request body is required");
        }
        access.requireAt(user, instituteId, StockOpsAccess.STOCK_STAFF, request.locationId());
        return ResponseEntity.ok(labelService.request(instituteId, access.caller(user, instituteId), request));
    }

    @PostMapping("/cancel")
    public ResponseEntity<CancelAnswer> cancel(@RequestAttribute("user") CustomUserDetails user,
                                               @RequestParam("instituteId") String instituteId,
                                               @RequestBody LabelIdsRequest request) {
        access.require(user, instituteId, StockOpsAccess.STOCK_STAFF);
        return ResponseEntity.ok(labelService.cancel(instituteId, access.caller(user, instituteId), request));
    }

    /** What the browser draws for the chosen PENDING rows (or a receipt's PENDING rows). Changes nothing. */
    @PostMapping("/print-data")
    public ResponseEntity<PrintDataAnswer> printData(@RequestAttribute("user") CustomUserDetails user,
                                                     @RequestParam("instituteId") String instituteId,
                                                     @RequestBody PrintDataRequest request) {
        access.require(user, instituteId, StockOpsAccess.STOCK_STAFF);
        return ResponseEntity.ok(labelService.printData(instituteId, access.caller(user, instituteId), request));
    }

    @PostMapping("/mark-printed")
    public ResponseEntity<PrintedAnswer> markPrinted(@RequestAttribute("user") CustomUserDetails user,
                                                     @RequestParam("instituteId") String instituteId,
                                                     @RequestBody LabelIdsRequest request) {
        access.require(user, instituteId, StockOpsAccess.STOCK_STAFF);
        return ResponseEntity.ok(labelService.markPrinted(instituteId, access.caller(user, instituteId), request));
    }

    @GetMapping("/to-replace")
    public ResponseEntity<ReplaceAnswer> toReplace(@RequestAttribute("user") CustomUserDetails user,
                                                   @RequestParam("instituteId") String instituteId,
                                                   @RequestParam("locationId") String locationId) {
        access.requireAt(user, instituteId, StockOpsAccess.STOCK_STAFF, locationId);
        return ResponseEntity.ok(labelService.toReplace(instituteId, locationId.trim()));
    }
}
