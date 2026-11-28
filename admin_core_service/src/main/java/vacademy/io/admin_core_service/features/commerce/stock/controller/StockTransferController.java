package vacademy.io.admin_core_service.features.commerce.stock.controller;

import lombok.RequiredArgsConstructor;
import org.springframework.http.CacheControl;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
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
import vacademy.io.admin_core_service.features.commerce.document.dto.DocumentSeriesDTO;
import vacademy.io.admin_core_service.features.commerce.security.CommerceAccessDeniedException;
import vacademy.io.admin_core_service.features.commerce.stock.dto.StockOpsDtos.CancelRequest;
import vacademy.io.admin_core_service.features.commerce.stock.dto.StockOpsDtos.ChallanSeriesRequest;
import vacademy.io.admin_core_service.features.commerce.stock.dto.StockOpsDtos.TransferCreateRequest;
import vacademy.io.admin_core_service.features.commerce.stock.dto.StockOpsDtos.TransferDispatchRequest;
import vacademy.io.admin_core_service.features.commerce.stock.dto.StockOpsDtos.TransferReceiveRequest;
import vacademy.io.admin_core_service.features.commerce.stock.dto.StockOpsDtos.TransferUpdateRequest;
import vacademy.io.admin_core_service.features.commerce.stock.dto.StockOpsDtos.TransferView;
import vacademy.io.admin_core_service.features.commerce.stock.dto.StockOpsDtos.TransfersAnswer;
import vacademy.io.admin_core_service.features.commerce.stock.entity.StockTransfer;
import vacademy.io.admin_core_service.features.commerce.stock.service.StockChallanPdfService;
import vacademy.io.admin_core_service.features.commerce.stock.service.StockOverviewService;
import vacademy.io.admin_core_service.features.commerce.stock.service.StockTransferService;
import vacademy.io.common.auth.model.CustomUserDetails;
import vacademy.io.common.exceptions.InvalidRequestException;

import java.util.List;

/**
 * Transfers between own locations and their delivery challan ({@code /commerce/v1/stock/transfers},
 * {@code /stock/challan-series}). Every transfer is read with the institute first; then the
 * action is guarded at the place it happens: the source for draft, cancel and dispatch, the
 * destination for receive, either for a read.
 */
@RestController
@RequestMapping("/admin-core-service/commerce/v1/stock")
@RequiredArgsConstructor
public class StockTransferController {

    private final StockOpsAccess access;
    private final StockTransferService transferService;
    private final StockChallanPdfService challanPdfService;
    private final StockOverviewService overviewService;

    @GetMapping("/transfers")
    public ResponseEntity<TransfersAnswer> list(@RequestAttribute("user") CustomUserDetails user,
                                                @RequestParam("instituteId") String instituteId,
                                                @RequestParam(value = "status", required = false) String status,
                                                @RequestParam(value = "direction", required = false) String direction,
                                                @RequestParam(value = "locationId", required = false) String locationId,
                                                @RequestParam(value = "overdueDays", required = false) Integer overdueDays,
                                                @RequestParam(value = "page", defaultValue = "0") int page,
                                                @RequestParam(value = "size", defaultValue = "50") int size) {
        if (locationId != null && !locationId.isBlank()) {
            access.requireAt(user, instituteId, StockOpsAccess.STOCK_READERS, locationId.trim());
        } else {
            access.require(user, instituteId, StockOpsAccess.STOCK_READERS);
        }
        return ResponseEntity.ok(transferService.list(instituteId, access.caller(user, instituteId), status, direction,
                locationId, overdueDays, page, size));
    }

    @GetMapping("/transfers/{transferId}")
    public ResponseEntity<TransferView> get(@RequestAttribute("user") CustomUserDetails user,
                                            @RequestParam("instituteId") String instituteId,
                                            @PathVariable("transferId") String transferId) {
        StockTransfer transfer = readable(user, instituteId, transferId);
        return ResponseEntity.ok(transferService.view(instituteId, transfer.getId(), access.caller(user, instituteId)));
    }

    @PostMapping("/transfers")
    public ResponseEntity<TransferView> create(@RequestAttribute("user") CustomUserDetails user,
                                               @RequestParam("instituteId") String instituteId,
                                               @RequestBody TransferCreateRequest request) {
        if (request == null) {
            throw new InvalidRequestException("VALIDATION: request body is required");
        }
        access.requireAt(user, instituteId, StockOpsAccess.STOCK_STAFF, request.fromLocationId());
        StockTransferService.Created created = transferService.create(instituteId, access.caller(user, instituteId),
                request);
        return ResponseEntity.status(created.created() ? HttpStatus.CREATED : HttpStatus.OK).body(created.view());
    }

    @PutMapping("/transfers/{transferId}")
    public ResponseEntity<TransferView> update(@RequestAttribute("user") CustomUserDetails user,
                                               @RequestParam("instituteId") String instituteId,
                                               @PathVariable("transferId") String transferId,
                                               @RequestBody TransferUpdateRequest request) {
        StockTransfer transfer = atSource(user, instituteId, transferId);
        return ResponseEntity.ok(transferService.update(instituteId, access.caller(user, instituteId),
                transfer.getId(), request));
    }

    @PostMapping("/transfers/{transferId}/cancel")
    public ResponseEntity<TransferView> cancel(@RequestAttribute("user") CustomUserDetails user,
                                               @RequestParam("instituteId") String instituteId,
                                               @PathVariable("transferId") String transferId,
                                               @RequestBody CancelRequest request) {
        StockTransfer transfer = atSource(user, instituteId, transferId);
        return ResponseEntity.ok(transferService.cancel(instituteId, access.caller(user, instituteId),
                transfer.getId(), request));
    }

    @PostMapping("/transfers/{transferId}/dispatch")
    public ResponseEntity<TransferView> dispatch(@RequestAttribute("user") CustomUserDetails user,
                                                 @RequestParam("instituteId") String instituteId,
                                                 @PathVariable("transferId") String transferId,
                                                 @RequestBody TransferDispatchRequest request) {
        StockTransfer transfer = atSource(user, instituteId, transferId);
        return ResponseEntity.ok(transferService.dispatch(instituteId, access.caller(user, instituteId),
                transfer.getId(), request));
    }

    @PostMapping("/transfers/{transferId}/receive")
    public ResponseEntity<TransferView> receive(@RequestAttribute("user") CustomUserDetails user,
                                                @RequestParam("instituteId") String instituteId,
                                                @PathVariable("transferId") String transferId,
                                                @RequestBody TransferReceiveRequest request) {
        access.require(user, instituteId, StockOpsAccess.STOCK_STAFF);
        StockTransfer transfer = transferService.get(instituteId, transferId);
        access.requireAt(user, instituteId, StockOpsAccess.STOCK_STAFF, transfer.getToLocationId());
        return ResponseEntity.ok(transferService.receive(instituteId, access.caller(user, instituteId),
                transfer.getId(), request));
    }

    @GetMapping("/transfers/{transferId}/challan.pdf")
    public ResponseEntity<byte[]> challan(@RequestAttribute("user") CustomUserDetails user,
                                          @RequestParam("instituteId") String instituteId,
                                          @PathVariable("transferId") String transferId) {
        StockTransfer transfer = readable(user, instituteId, transferId);
        StockChallanPdfService.ChallanPdf pdf = challanPdfService.render(instituteId, transfer);
        return ResponseEntity.ok()
                .contentType(MediaType.APPLICATION_PDF)
                .header(HttpHeaders.CONTENT_DISPOSITION, "inline; filename=\"" + pdf.fileName() + "\"")
                .cacheControl(CacheControl.noStore())
                .body(pdf.pdf());
    }

    @GetMapping("/challan-series")
    public ResponseEntity<List<DocumentSeriesDTO>> challanSeries(@RequestAttribute("user") CustomUserDetails user,
                                                                 @RequestParam("instituteId") String instituteId) {
        access.require(user, instituteId, StockOpsAccess.STOCK_READERS);
        return ResponseEntity.ok(overviewService.challanSeries(instituteId));
    }

    /** A manager at the series' location; a series of every location only by an institute ADMIN. */
    @PostMapping("/challan-series")
    public ResponseEntity<DocumentSeriesDTO> createChallanSeries(@RequestAttribute("user") CustomUserDetails user,
                                                                 @RequestParam("instituteId") String instituteId,
                                                                 @RequestBody ChallanSeriesRequest request) {
        if (request == null) {
            throw new InvalidRequestException("VALIDATION: request body is required");
        }
        if (request.locationId() != null && !request.locationId().isBlank()) {
            access.requireAt(user, instituteId, StockOpsAccess.MANAGER, request.locationId().trim());
        } else {
            access.require(user, instituteId, StockOpsAccess.MANAGER);
            if (!StockAccess.isAdmin(user)) {
                throw new CommerceAccessDeniedException(CommerceAccessDeniedException.ROLE_NOT_ALLOWED,
                        "a series for every location is added by an institute admin; name a location");
            }
        }
        return ResponseEntity.ok(overviewService.createChallanSeries(instituteId, user.getUserId(), request));
    }

    private StockTransfer readable(CustomUserDetails user, String instituteId, String transferId) {
        access.require(user, instituteId, StockOpsAccess.STOCK_READERS);
        StockTransfer transfer = transferService.get(instituteId, transferId);
        access.requireAtEither(user, instituteId, StockOpsAccess.STOCK_READERS, transfer.getFromLocationId(),
                transfer.getToLocationId());
        return transfer;
    }

    private StockTransfer atSource(CustomUserDetails user, String instituteId, String transferId) {
        access.require(user, instituteId, StockOpsAccess.STOCK_STAFF);
        StockTransfer transfer = transferService.get(instituteId, transferId);
        access.requireAt(user, instituteId, StockOpsAccess.STOCK_STAFF, transfer.getFromLocationId());
        return transfer;
    }
}
