package vacademy.io.admin_core_service.features.commerce.stock.service;

import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;
import vacademy.io.admin_core_service.features.commerce.document.pdf.CommercePdfRenderer;
import vacademy.io.admin_core_service.features.commerce.stock.entity.StockLocation;
import vacademy.io.admin_core_service.features.commerce.stock.entity.StockTransfer;
import vacademy.io.admin_core_service.features.commerce.stock.entity.StockTransferLine;
import vacademy.io.admin_core_service.features.commerce.stock.enums.TransferDocumentType;
import vacademy.io.admin_core_service.features.commerce.stock.enums.TransferStatus;
import vacademy.io.admin_core_service.features.commerce.stock.pdf.StockChallanHtml;
import vacademy.io.admin_core_service.features.commerce.stock.repository.StockLocationRepository;
import vacademy.io.admin_core_service.features.commerce.stock.repository.StockOpsReadRepository;
import vacademy.io.admin_core_service.features.commerce.stock.repository.StockOpsReadRepository.ItemFacts;
import vacademy.io.admin_core_service.features.commerce.stock.repository.StockTransferLineRepository;
import vacademy.io.common.exceptions.ConflictException;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.StringJoiner;

/**
 * The delivery challan of a dispatched transfer, drawn on demand: read in a read-only transaction,
 * drawn outside any transaction. The values on it were copied at dispatch, so it reads the same
 * whenever it is printed.
 */
@Service
public class StockChallanPdfService {

    /** The PDF and the file name it is offered under. */
    public record ChallanPdf(byte[] pdf, String fileName) {
    }

    private final StockTransferService transferService;
    private final StockTransferLineRepository lineRepository;
    private final StockLocationRepository locationRepository;
    private final StockOpsReadRepository readRepository;
    private final CommercePdfRenderer renderer;
    private final TransactionTemplate readOnly;

    public StockChallanPdfService(StockTransferService transferService, StockTransferLineRepository lineRepository,
                                  StockLocationRepository locationRepository, StockOpsReadRepository readRepository,
                                  CommercePdfRenderer renderer, PlatformTransactionManager transactionManager) {
        this.transferService = transferService;
        this.lineRepository = lineRepository;
        this.locationRepository = locationRepository;
        this.readRepository = readRepository;
        this.renderer = renderer;
        this.readOnly = new TransactionTemplate(transactionManager);
        this.readOnly.setReadOnly(true);
    }

    /** @throws ConflictException 409 TRANSFER_NOT_DISPATCHED for a draft or a cancelled transfer */
    public ChallanPdf render(String instituteId, StockTransfer transfer) {
        if (!TransferStatus.DISPATCHED.name().equals(transfer.getStatus())
                && !TransferStatus.RECEIVED.name().equals(transfer.getStatus())) {
            throw new ConflictException("TRANSFER_NOT_DISPATCHED: a challan exists once the transfer is dispatched");
        }
        StockChallanHtml.Challan challan = readOnly.execute(status -> challan(instituteId, transfer));
        String number = transfer.getDocumentNumber() == null ? transfer.getTransferNumber() : transfer.getDocumentNumber();
        return new ChallanPdf(renderer.render(StockChallanHtml.build(challan)),
                number.replace('/', '-').replaceAll("[^A-Za-z0-9._ -]", "") + ".pdf");
    }

    public ChallanPdf render(String instituteId, String transferId) {
        return render(instituteId, transferService.get(instituteId, transferId));
    }

    StockChallanHtml.Challan challan(String instituteId, StockTransfer transfer) {
        List<StockTransferLine> lines = lineRepository
                .findByInstituteIdAndTransferIdOrderByCreatedAtAscIdAsc(instituteId, transfer.getId());
        Map<String, ItemFacts> facts = readRepository.itemFacts(instituteId,
                lines.stream().map(StockTransferLine::getPackageSessionId).toList());
        List<StockChallanHtml.Line> out = new ArrayList<>();
        for (StockTransferLine line : lines) {
            ItemFacts item = facts.get(line.getPackageSessionId());
            String sku = line.getSku() != null ? line.getSku() : item == null ? null : item.sku();
            out.add(new StockChallanHtml.Line(sku,
                    line.getItemName() != null ? line.getItemName() : item == null ? null : item.productName(),
                    item == null ? null : item.variantName(),
                    line.getHsnCode() != null ? line.getHsnCode() : item == null ? null : item.hsnCode(),
                    line.getQtySent(), item == null ? 1 : item.qtyScale(), item == null ? null : item.unit(),
                    line.getUnitValue()));
        }
        boolean external = TransferDocumentType.EXTERNAL_INVOICE.name().equals(transfer.getDocumentType());
        return new StockChallanHtml.Challan(transfer.getDocumentNumber(), transfer.getDocumentDate(),
                transfer.getTransferNumber(), external ? transfer.getDocumentNumber() : null,
                place(instituteId, transfer.getFromLocationId(), transfer.getFromGstin()),
                place(instituteId, transfer.getToLocationId(), transfer.getToGstin()), out, transfer.getEwayBillNo(),
                transfer.getNote());
    }

    private StockChallanHtml.Place place(String instituteId, String locationId, String gstin) {
        StockLocation location = locationRepository.findByInstituteIdAndId(instituteId, locationId).orElse(null);
        if (location == null) {
            return new StockChallanHtml.Place(null, locationId, null, null, gstin);
        }
        StringJoiner address = new StringJoiner(", ");
        for (String part : new String[]{location.getAddressLine1(), location.getAddressLine2(), location.getCity(),
                location.getPincode()}) {
            if (part != null && !part.isBlank()) {
                address.add(part.trim());
            }
        }
        String text = address.length() == 0 ? null : address.toString();
        if (StockChallanHtml.hasDevanagari(text)) {
            text = null;
        }
        String state = location.getStateCode() != null ? location.getStateCode()
                : gstin != null && gstin.length() >= 2 ? gstin.substring(0, 2) : null;
        return new StockChallanHtml.Place(location.getCode(), location.getName(), text, state, gstin);
    }
}
