package vacademy.io.admin_core_service.features.commerce.stock.service;

import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import vacademy.io.admin_core_service.features.commerce.stock.dto.StandardCostRequest;
import vacademy.io.admin_core_service.features.commerce.stock.repository.StockVariantRepository;
import vacademy.io.common.exceptions.InvalidRequestException;

import java.util.TreeMap;

/**
 * "Set standard cost", for one item or a sheet of them.
 * The cost columns themselves are written by {@link StockLedgerService}; this resolves the
 * items and calls it in package-session order, in one transaction.
 */
@Service
public class StockCostService {

    static final int MAX_ITEMS = 1000;

    private final StockLedgerService ledger;
    private final StockVariantRepository variantRepository;

    public StockCostService(StockLedgerService ledger, StockVariantRepository variantRepository) {
        this.ledger = ledger;
        this.variantRepository = variantRepository;
    }

    /** @return how many items were set */
    @Transactional
    public int setStandardCosts(String instituteId, String actorUserId, StandardCostRequest request) {
        if (request == null || request.getItems() == null || request.getItems().isEmpty()) {
            throw new InvalidRequestException("items is required");
        }
        if (request.getItems().size() > MAX_ITEMS) {
            throw new InvalidRequestException("At most " + MAX_ITEMS + " items at once");
        }
        String clientRequestId = StockReceiptService.requireClientRequestId(request.getClientRequestId());
        // Sorted by package session, so variant rows are locked in one order.
        TreeMap<String, StandardCostRequest.Item> byVariant = new TreeMap<>();
        for (StandardCostRequest.Item item : request.getItems()) {
            if (item == null || item.getStandardCost() == null) {
                throw new InvalidRequestException("standard_cost is required on every item");
            }
            String packageSessionId = item.getPackageSessionId() == null ? "" : item.getPackageSessionId().trim();
            if (packageSessionId.isEmpty()) {
                String sku = item.getSku() == null ? "" : item.getSku().trim();
                if (sku.isEmpty()) {
                    throw new InvalidRequestException("Each item needs package_session_id or sku");
                }
                packageSessionId = variantRepository.findFactsBySku(instituteId, sku)
                        .orElseThrow(() -> new InvalidRequestException("ITEM_NOT_FOUND: no item with SKU " + sku))
                        .getPackageSessionId();
            }
            if (byVariant.put(packageSessionId, item) != null) {
                throw new InvalidRequestException("An item appears twice");
            }
        }
        byVariant.forEach((packageSessionId, item) -> ledger.setStandardCost(instituteId, packageSessionId,
                item.getStandardCost(), actorUserId, "STANDARD:" + packageSessionId + ":" + clientRequestId));
        return byVariant.size();
    }
}
