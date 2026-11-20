package vacademy.io.admin_core_service.features.commerce.stock.opening;

import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import vacademy.io.admin_core_service.features.commerce.security.CommerceAccessGuard;
import vacademy.io.admin_core_service.features.commerce.security.CommerceFeature;
import vacademy.io.admin_core_service.features.commerce.security.CommerceRole;
import vacademy.io.admin_core_service.features.commerce.stock.controller.StockAccess;
import vacademy.io.admin_core_service.features.commerce.stock.opening.OpeningReadinessMath.Items;
import vacademy.io.admin_core_service.features.commerce.stock.opening.OpeningReadinessMath.LaterCount;
import vacademy.io.admin_core_service.features.commerce.stock.opening.OpeningReadinessMath.Readiness;
import vacademy.io.admin_core_service.features.commerce.stock.opening.OpeningReadinessMath.Receipts;
import vacademy.io.admin_core_service.features.commerce.stock.opening.OpeningReadinessMath.Recount;
import vacademy.io.admin_core_service.features.commerce.stock.opening.OpeningReadinessMath.RecountVerdict;
import vacademy.io.admin_core_service.features.commerce.stock.opening.OpeningReadinessMath.UncostedReceipt;
import vacademy.io.admin_core_service.features.commerce.stock.repository.StockLocationRepository;
import vacademy.io.common.auth.model.CustomUserDetails;
import vacademy.io.common.exceptions.InvalidRequestException;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * The opening-stock readiness of one location (WP-53): needs the inventory feature and the
 * switch-over feature; manager, warehouse staff or accountant assigned to the location (an
 * institute ADMIN everywhere). Receipt value only for those who see cost.
 */
@Service
public class OpeningStockService {

    static final Set<CommerceRole> READERS = Set.of(CommerceRole.STORE_MANAGER, CommerceRole.WAREHOUSE_STAFF,
            CommerceRole.ACCOUNTANT);

    private final CommerceAccessGuard accessGuard;
    private final StockLocationRepository locationRepository;
    private final OpeningReadRepository readRepository;

    public OpeningStockService(CommerceAccessGuard accessGuard, StockLocationRepository locationRepository,
                               OpeningReadRepository readRepository) {
        this.accessGuard = accessGuard;
        this.locationRepository = locationRepository;
        this.readRepository = readRepository;
    }

    @Transactional(readOnly = true)
    public Map<String, Object> readiness(CustomUserDetails user, String instituteId, String locationId) {
        String location = locationId == null ? "" : locationId.trim();
        accessGuard.require(user, instituteId, CommerceFeature.INVENTORY, READERS, location);
        accessGuard.require(user, instituteId, CommerceFeature.MIGRATION, READERS, location);
        if (location.isEmpty()) {
            throw new InvalidRequestException("locationId is required");
        }
        if (locationRepository.findByInstituteIdAndId(instituteId, location).isEmpty()) {
            throw new InvalidRequestException("LOCATION_NOT_FOUND: location_id does not belong to this institute");
        }

        Items items = readRepository.items(instituteId);
        Receipts receipts = readRepository.receipts(instituteId, location);
        List<LaterCount> later = List.of();
        Recount recount = null;
        if (receipts.count() > 0 && receipts.lastPostedAt() != null) {
            later = readRepository.countsAfter(instituteId, location, receipts.lastPostedAt());
            recount = readRepository.latestRecount(instituteId, location, receipts.lastPostedAt());
        }
        Readiness readiness = OpeningReadinessMath.decide(items, receipts, later, recount);
        return view(location, items, receipts, readiness, StockAccess.seesCost(user));
    }

    static Map<String, Object> view(String locationId, Items items, Receipts receipts, Readiness readiness,
                                    boolean seesCost) {
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("location_id", locationId);
        out.put("status", readiness.status().name());
        out.put("ready", readiness.ready());
        out.put("blockers", readiness.blockers());

        Map<String, Object> itemView = new LinkedHashMap<>();
        itemView.put("tracked", items.tracked());
        itemView.put("with_cost", items.withCost());
        itemView.put("without_cost", items.withoutCost());
        itemView.put("without_cost_skus", items.withoutCostSkus());
        itemView.put("untracked", items.untracked());
        out.put("items", itemView);

        Map<String, Object> receiptView = new LinkedHashMap<>();
        receiptView.put("count", receipts.count());
        receiptView.put("lines", receipts.lines());
        receiptView.put("units", receipts.units());
        receiptView.put("units_costed", receipts.unitsCosted());
        if (seesCost) {
            receiptView.put("value", receipts.value());
        }
        List<Map<String, Object>> uncosted = new ArrayList<>();
        for (UncostedReceipt receipt : receipts.uncosted() == null ? List.<UncostedReceipt>of() : receipts.uncosted()) {
            Map<String, Object> row = new LinkedHashMap<>();
            row.put("id", receipt.id());
            row.put("receipt_number", receipt.receiptNumber());
            row.put("received_date", receipt.receivedDate());
            row.put("lines", receipt.lines());
            row.put("units", receipt.units());
            uncosted.add(row);
        }
        receiptView.put("uncosted_receipts", uncosted);
        out.put("receipts", receiptView);

        RecountVerdict verdict = readiness.recount();
        if (verdict == null) {
            out.put("recount", null);
        } else {
            Recount recount = verdict.recount();
            Map<String, Object> recountView = new LinkedHashMap<>();
            recountView.put("recount_id", recount.recountId());
            recountView.put("recount_number", recount.recountNumber());
            recountView.put("count_id", recount.mainCountId());
            recountView.put("count_number", recount.mainCountNumber());
            recountView.put("main_lines", recount.mainLines());
            recountView.put("compared", recount.compared());
            recountView.put("agreeing", recount.agreeing());
            recountView.put("percent", recount.percent());
            recountView.put("sample_percent", verdict.samplePercent());
            recountView.put("sample_needed", verdict.sampleNeeded());
            recountView.put("sample_ok", verdict.sampleOk());
            recountView.put("agreement_ok", verdict.agreementOk());
            recountView.put("passes", verdict.passes());
            out.put("recount", recountView);
        }
        out.put("sees_cost", seesCost);
        return out;
    }
}
