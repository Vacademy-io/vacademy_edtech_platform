package vacademy.io.admin_core_service.features.commerce.order.desk;

import vacademy.io.admin_core_service.features.commerce.audit.CommerceAuditService;
import vacademy.io.admin_core_service.features.commerce.common.request.CommerceRequestGuard;
import vacademy.io.admin_core_service.features.commerce.document.service.CommerceCreditNoteService;
import vacademy.io.admin_core_service.features.commerce.document.service.CommerceInvoiceService;
import vacademy.io.admin_core_service.features.commerce.order.checkout.CommerceRefundHook;
import vacademy.io.admin_core_service.features.commerce.order.entity.CommerceOrder;
import vacademy.io.admin_core_service.features.commerce.order.entity.CommerceOrderLine;
import vacademy.io.admin_core_service.features.commerce.order.entity.CommerceOrderTender;
import vacademy.io.admin_core_service.features.commerce.order.repository.CommerceOrderLegacyRepository;
import vacademy.io.admin_core_service.features.commerce.order.repository.CommerceOrderRepository;
import vacademy.io.admin_core_service.features.commerce.shipment.entity.CommerceShipment;
import vacademy.io.admin_core_service.features.commerce.shipment.entity.CommerceShipmentLine;
import vacademy.io.admin_core_service.features.commerce.shipment.service.CommerceShipmentService;
import vacademy.io.admin_core_service.features.commerce.stock.entity.StockLocation;
import vacademy.io.admin_core_service.features.commerce.stock.repository.CommercePieceRepository;
import vacademy.io.admin_core_service.features.commerce.stock.repository.StockMovementRepository;
import vacademy.io.admin_core_service.features.commerce.stock.service.StockLedgerService;
import vacademy.io.admin_core_service.features.commerce.stock.service.StockPosting;
import vacademy.io.admin_core_service.features.commerce.storefront.model.StorefrontSettings;
import vacademy.io.admin_core_service.features.commerce.storefront.service.CommerceStorefrontSettings;
import vacademy.io.admin_core_service.features.stock_hold.service.StockHoldService;
import vacademy.io.common.auth.model.CustomUserDetails;

import java.time.LocalDate;
import java.util.List;

/** {@link DeskFixture} for tests outside its package (the shipment service). */
public class DeskFixtureAccess {

    private final DeskFixture f = new DeskFixture();

    public static CustomUserDetails manager() {
        return DeskFixture.manager();
    }

    public static StorefrontSettings settings(boolean refundShippingOnRto) {
        return DeskFixture.settings(refundShippingOnRto);
    }

    public CommerceShipmentService shipments() {
        return f.shipments;
    }

    public CommerceOrderDeskService desk() {
        return f.desk;
    }

    public CommerceOrder order() {
        return f.order;
    }

    public List<CommerceOrderLine> lines() {
        return f.lines;
    }

    public CommerceOrderLine line(String id, int quantity, String lineTotal) {
        return f.line(id, quantity, lineTotal);
    }

    public void snapshot() {
        f.snapshot();
    }

    public void facts(String packageSessionId, String policy, String mode) {
        f.facts(packageSessionId, policy, mode);
    }

    public void soldHold(CommerceOrderLine line, int quantity) {
        f.soldHold(line, quantity);
    }

    public CommerceOrderTender tender(String mode, String status, String amount) {
        return f.tender(mode, status, amount);
    }

    public CommerceShipment shipment() {
        return f.shipment;
    }

    public CommerceShipment shipment(String status) {
        return f.shipment(status);
    }

    public List<CommerceShipmentLine> shipmentLines() {
        return f.shipmentLines;
    }

    public CommerceShipmentLine shipmentLine(CommerceOrderLine line, int quantity) {
        return f.shipmentLine(line, quantity);
    }

    public List<StockPosting> posted() {
        return f.posted;
    }

    public LocalDate today() {
        return f.today;
    }

    public StockLocation location() {
        return f.location;
    }

    public CommerceInvoiceService invoiceService() {
        return f.invoiceService;
    }

    public CommerceCreditNoteService creditNoteService() {
        return f.creditNoteService;
    }

    public CommercePieceRepository pieceRepository() {
        return f.pieceRepository;
    }

    public StockHoldService stockHoldService() {
        return f.stockHoldService;
    }

    public CommerceOrderEvents events() {
        return f.events;
    }

    public StockLedgerService ledger() {
        return f.ledger;
    }

    public CommerceStockShortFlagger stockShortFlagger() {
        return f.stockShortFlagger;
    }

    public CommerceRequestGuard requestGuard() {
        return f.requestGuard;
    }

    public CommerceOrderLegacyRepository legacyRepository() {
        return f.legacyRepository;
    }

    public CommerceOrderRepository orderRepository() {
        return f.orderRepository;
    }

    public CommerceRefundHook refundHook() {
        return f.refundHook;
    }

    public CommerceAuditService auditService() {
        return f.auditService;
    }

    public CommerceStorefrontSettings storefrontSettings() {
        return f.storefrontSettings;
    }

    public StockMovementRepository movementRepository() {
        return f.movementRepository;
    }
}
