package vacademy.io.admin_core_service.features.commerce.stock.controller;

import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestAttribute;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import vacademy.io.admin_core_service.features.commerce.stock.dto.StockOpsDtos.CancelRequest;
import vacademy.io.admin_core_service.features.commerce.stock.dto.StockOpsDtos.CountCreateRequest;
import vacademy.io.admin_core_service.features.commerce.stock.dto.StockOpsDtos.CountLinesAnswer;
import vacademy.io.admin_core_service.features.commerce.stock.dto.StockOpsDtos.CountLinesRequest;
import vacademy.io.admin_core_service.features.commerce.stock.dto.StockOpsDtos.CountPostRequest;
import vacademy.io.admin_core_service.features.commerce.stock.dto.StockOpsDtos.CountReview;
import vacademy.io.admin_core_service.features.commerce.stock.dto.StockOpsDtos.CountView;
import vacademy.io.admin_core_service.features.commerce.stock.dto.StockOpsDtos.CountsAnswer;
import vacademy.io.admin_core_service.features.commerce.stock.dto.StockOpsDtos.LineCountAnswer;
import vacademy.io.admin_core_service.features.commerce.stock.entity.StockCount;
import vacademy.io.admin_core_service.features.commerce.stock.service.StockCountService;
import vacademy.io.common.auth.model.CustomUserDetails;
import vacademy.io.common.exceptions.InvalidRequestException;

/**
 * Stock counts ({@code /commerce/v1/stock/counts}). Every count is read with the institute first
 * and guarded at its location; readers see a count but never its system quantities while it is
 * open, and the person doing a blind recount does not see the count it rechecks.
 */
@RestController
@RequestMapping("/admin-core-service/commerce/v1/stock/counts")
@RequiredArgsConstructor
public class StockCountController {

    private final StockOpsAccess access;
    private final StockCountService countService;

    @GetMapping
    public ResponseEntity<CountsAnswer> list(@RequestAttribute("user") CustomUserDetails user,
                                             @RequestParam("instituteId") String instituteId,
                                             @RequestParam(value = "locationId", required = false) String locationId,
                                             @RequestParam(value = "status", required = false) String status,
                                             @RequestParam(value = "kind", required = false) String kind,
                                             @RequestParam(value = "page", defaultValue = "0") int page,
                                             @RequestParam(value = "size", defaultValue = "50") int size) {
        if (locationId != null && !locationId.isBlank()) {
            access.requireAt(user, instituteId, StockOpsAccess.STOCK_READERS, locationId.trim());
        } else {
            access.require(user, instituteId, StockOpsAccess.STOCK_READERS);
        }
        return ResponseEntity.ok(countService.list(instituteId, access.caller(user, instituteId), locationId, status,
                kind, page, size));
    }

    @PostMapping
    public ResponseEntity<CountView> open(@RequestAttribute("user") CustomUserDetails user,
                                          @RequestParam("instituteId") String instituteId,
                                          @RequestBody CountCreateRequest request) {
        if (request == null) {
            throw new InvalidRequestException("VALIDATION: request body is required");
        }
        access.requireAt(user, instituteId, StockOpsAccess.STOCK_STAFF, request.locationId());
        StockCountService.Created created = countService.open(instituteId, access.caller(user, instituteId), request);
        return ResponseEntity.status(created.created() ? HttpStatus.CREATED : HttpStatus.OK).body(created.view());
    }

    @GetMapping("/{countId}")
    public ResponseEntity<CountView> get(@RequestAttribute("user") CustomUserDetails user,
                                         @RequestParam("instituteId") String instituteId,
                                         @PathVariable("countId") String countId) {
        StockCount count = guarded(user, instituteId, countId, StockOpsAccess.STOCK_READERS);
        return ResponseEntity.ok(countService.view(instituteId, count.getId(), access.caller(user, instituteId)));
    }

    @PutMapping("/{countId}/lines")
    public ResponseEntity<CountLinesAnswer> lines(@RequestAttribute("user") CustomUserDetails user,
                                                  @RequestParam("instituteId") String instituteId,
                                                  @PathVariable("countId") String countId,
                                                  @RequestBody CountLinesRequest request) {
        StockCount count = guarded(user, instituteId, countId, StockOpsAccess.STOCK_STAFF);
        return ResponseEntity.ok(countService.saveLines(instituteId, access.caller(user, instituteId), count.getId(),
                request));
    }

    @DeleteMapping("/{countId}/lines/{lineId}")
    public ResponseEntity<LineCountAnswer> deleteLine(@RequestAttribute("user") CustomUserDetails user,
                                                      @RequestParam("instituteId") String instituteId,
                                                      @PathVariable("countId") String countId,
                                                      @PathVariable("lineId") String lineId) {
        StockCount count = guarded(user, instituteId, countId, StockOpsAccess.STOCK_STAFF);
        return ResponseEntity.ok(countService.deleteLine(instituteId, count.getId(), lineId));
    }

    @GetMapping("/{countId}/review")
    public ResponseEntity<CountReview> review(@RequestAttribute("user") CustomUserDetails user,
                                              @RequestParam("instituteId") String instituteId,
                                              @PathVariable("countId") String countId) {
        StockCount count = guarded(user, instituteId, countId, StockOpsAccess.STOCK_STAFF);
        return ResponseEntity.ok(countService.review(instituteId, access.caller(user, instituteId), count.getId()));
    }

    @PostMapping("/{countId}/post")
    public ResponseEntity<CountView> post(@RequestAttribute("user") CustomUserDetails user,
                                          @RequestParam("instituteId") String instituteId,
                                          @PathVariable("countId") String countId,
                                          @RequestBody CountPostRequest request) {
        StockCount count = guarded(user, instituteId, countId, StockOpsAccess.STOCK_STAFF);
        return ResponseEntity.ok(countService.post(instituteId, access.caller(user, instituteId), count.getId(),
                request));
    }

    @PostMapping("/{countId}/cancel")
    public ResponseEntity<CountView> cancel(@RequestAttribute("user") CustomUserDetails user,
                                            @RequestParam("instituteId") String instituteId,
                                            @PathVariable("countId") String countId,
                                            @RequestBody CancelRequest request) {
        StockCount count = guarded(user, instituteId, countId, StockOpsAccess.STOCK_STAFF);
        return ResponseEntity.ok(countService.cancel(instituteId, access.caller(user, instituteId), count.getId(),
                request));
    }

    private StockCount guarded(CustomUserDetails user, String instituteId, String countId,
                               java.util.Set<vacademy.io.admin_core_service.features.commerce.security.CommerceRole> roles) {
        access.require(user, instituteId, roles);
        StockCount count = countService.get(instituteId, countId);
        access.requireAt(user, instituteId, roles, count.getLocationId());
        return count;
    }
}
