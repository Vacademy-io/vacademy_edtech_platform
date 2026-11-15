package vacademy.io.admin_core_service.features.commerce.stock.service;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import vacademy.io.admin_core_service.features.commerce.audit.CommerceAuditService;
import vacademy.io.admin_core_service.features.commerce.security.CommerceAccessDeniedException;
import vacademy.io.admin_core_service.features.commerce.security.CommerceApprovalService;
import vacademy.io.admin_core_service.features.commerce.stock.dto.AdjustmentRequest;
import vacademy.io.admin_core_service.features.commerce.stock.entity.StockMovement;
import vacademy.io.admin_core_service.features.commerce.stock.enums.StockMovementType;
import vacademy.io.admin_core_service.features.commerce.stock.repository.CommercePieceRepository;
import vacademy.io.admin_core_service.features.commerce.stock.repository.StockVariantRepository;
import vacademy.io.admin_core_service.features.commerce.stock.repository.StockVariantRepository.VariantFacts;
import vacademy.io.admin_core_service.features.commerce.stock.service.CommerceStockSettings.AdjustmentLimits;
import vacademy.io.common.exceptions.InvalidRequestException;

import java.math.BigDecimal;
import java.util.Optional;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

/** A single adjustment needs a reason; above the limit it needs a manager. */
class StockAdjustmentServiceTest {

    private static final String INST = "inst-1";

    private StockLedgerService ledger;
    private StockVariantRepository variants;
    private CommerceStockSettings settings;
    private CommerceApprovalService approvals;
    private StockAdjustmentService service;

    @BeforeEach
    void setUp() {
        ledger = mock(StockLedgerService.class);
        variants = mock(StockVariantRepository.class);
        settings = mock(CommerceStockSettings.class);
        approvals = mock(CommerceApprovalService.class);
        service = new StockAdjustmentService(ledger, variants, mock(CommercePieceRepository.class), settings,
                approvals, mock(CommerceAuditService.class));

        VariantFacts facts = mock(VariantFacts.class);
        when(facts.getCostPrice()).thenReturn(new BigDecimal("100"));
        when(variants.findFacts(INST, "ps-1")).thenReturn(Optional.of(facts));
        when(ledger.findPosted(anyString(), anyString())).thenReturn(Optional.empty());
        when(ledger.post(any(StockPosting.class))).thenAnswer(inv -> {
            StockMovement movement = new StockMovement();
            movement.setId("mov-1");
            movement.setBalanceAfter(0);
            return new StockPostResult(movement, true, 0);
        });
        limits(5, "1000");
    }

    private void limits(Integer quantity, String value) {
        when(settings.adjustmentLimits(INST)).thenReturn(
                new AdjustmentLimits(quantity, value == null ? null : new BigDecimal(value)));
    }

    private static AdjustmentRequest request(int delta) {
        AdjustmentRequest request = new AdjustmentRequest();
        request.setLocationId("loc-1");
        request.setPackageSessionId("ps-1");
        request.setQuantityDelta(delta);
        request.setReason("COUNT_DIFFERENCE");
        request.setClientRequestId("req-1");
        return request;
    }

    private StockPosting posted() {
        ArgumentCaptor<StockPosting> captor = ArgumentCaptor.forClass(StockPosting.class);
        verify(ledger).post(captor.capture());
        return captor.getValue();
    }

    @Test
    void withinTheLimitWarehouseStaffAdjustWithNoApproval() {
        service.adjust(INST, "staff-1", false, request(-5));

        verifyNoInteractions(approvals);
        StockPosting posting = posted();
        assertEquals(StockMovementType.ADJUSTMENT, posting.getType());
        assertEquals(-5, posting.getQuantityDelta());
        assertEquals("ADJ:req-1", posting.getIdempotencyKey());
        assertEquals("COUNT_DIFFERENCE", posting.getReason());
    }

    @Test
    void aboveTheQuantityLimitWithNoManagerIsRefusedAndNothingIsPosted() {
        CommerceAccessDeniedException refused = assertThrows(CommerceAccessDeniedException.class,
                () -> service.adjust(INST, "staff-1", false, request(-6)));

        assertEquals(StockAdjustmentService.APPROVAL_REQUIRED, refused.getCode());
        verify(ledger, never()).post(any());
    }

    @Test
    void aboveTheValueLimitCountsEvenWhenTheQuantityIsSmall() {
        limits(50, "250"); // three units at 100 are worth 300
        assertThrows(CommerceAccessDeniedException.class, () -> service.adjust(INST, "staff-1", false, request(3)));
        verify(ledger, never()).post(any());
    }

    @Test
    void aboveTheLimitAManagersPinApprovesInTheSameCall() {
        AdjustmentRequest request = request(-6);
        request.setApproverUserId("manager-1");
        request.setApproverPin("482913");

        service.adjust(INST, "staff-1", false, request);

        verify(approvals).approve(INST, "loc-1", "staff-1", "manager-1", "482913",
                StockAdjustmentService.ACTION_ADJUSTMENT, StockAdjustmentService.REFERENCE_ADJUSTMENT, "req-1",
                new BigDecimal("600.00"), "COUNT_DIFFERENCE");
        verify(ledger).post(any());
    }

    @Test
    void aWrongPinStopsTheAdjustment() {
        AdjustmentRequest request = request(-6);
        request.setApproverUserId("manager-1");
        request.setApproverPin("000000");
        doThrow(new CommerceAccessDeniedException(CommerceAccessDeniedException.PIN_INVALID, "wrong PIN"))
                .when(approvals).approve(anyString(), anyString(), anyString(), anyString(), anyString(), anyString(),
                        anyString(), anyString(), any(), anyString());

        assertThrows(CommerceAccessDeniedException.class, () -> service.adjust(INST, "staff-1", false, request));
        verify(ledger, never()).post(any());
    }

    @Test
    void aManagerAdjustsAboveTheLimitWithoutAPin() {
        service.adjust(INST, "manager-1", true, request(-60));

        verifyNoInteractions(approvals);
        verify(ledger).post(any());
    }

    @Test
    void noLimitSetMeansNoLimit() {
        limits(null, null);
        service.adjust(INST, "staff-1", false, request(-5000));
        verifyNoInteractions(approvals);
    }

    @Test
    void damageIsAlwaysALoss() {
        AdjustmentRequest request = request(2);
        request.setKind("DAMAGE");
        request.setReason("damaged_in_store");

        service.adjust(INST, "staff-1", false, request);

        StockPosting posting = posted();
        assertEquals(StockMovementType.DAMAGE, posting.getType());
        assertEquals(-2, posting.getQuantityDelta());
        assertEquals("DAMAGED_IN_STORE", posting.getReason());
    }

    @Test
    void aReasonAndARequestIdAreRequired() {
        AdjustmentRequest noReason = request(-1);
        noReason.setReason(" ");
        assertThrows(InvalidRequestException.class, () -> service.adjust(INST, "staff-1", false, noReason));

        AdjustmentRequest noKey = request(-1);
        noKey.setClientRequestId(null);
        assertThrows(InvalidRequestException.class, () -> service.adjust(INST, "staff-1", false, noKey));

        AdjustmentRequest zero = request(0);
        assertThrows(InvalidRequestException.class, () -> service.adjust(INST, "staff-1", false, zero));
        verify(ledger, never()).post(any());
    }

    @Test
    void aSecondDeliveryOfTheSameRequestNeitherApprovesNorPostsAgain() {
        StockMovement earlier = new StockMovement();
        when(ledger.findPosted(INST, "ADJ:req-1")).thenReturn(Optional.of(earlier));
        AdjustmentRequest request = request(-6);
        request.setApproverUserId("manager-1");
        request.setApproverPin("482913");

        StockPostResult result = service.adjust(INST, "staff-1", false, request);

        assertFalse(result.created());
        verifyNoInteractions(approvals);
        verify(ledger, never()).post(any());
    }

    @Test
    void anItemOfAnotherInstituteIsRefused() {
        AdjustmentRequest request = request(-1);
        request.setPackageSessionId("ps-foreign");
        when(variants.findFacts(INST, "ps-foreign")).thenReturn(Optional.empty());
        assertThrows(InvalidRequestException.class, () -> service.adjust(INST, "staff-1", false, request));
        verify(ledger, never()).post(any());
    }

    @Test
    void anItemWithNoCostYetIsOverAValueLimitBecauseItsValueCannotBeShownToBeUnderIt() {
        VariantFacts noCost = mock(VariantFacts.class);
        when(noCost.getCostPrice()).thenReturn(null);
        when(variants.findFacts(INST, "ps-1")).thenReturn(Optional.of(noCost));
        limits(null, "250"); // a value limit only

        CommerceAccessDeniedException refused = assertThrows(CommerceAccessDeniedException.class,
                () -> service.adjust(INST, "staff-1", false, request(-1)));

        assertEquals(StockAdjustmentService.APPROVAL_REQUIRED, refused.getCode());
        verify(ledger, never()).post(any());
    }

    /**
     * As shipped no institute has limits saved and no screen sets them. That must mean "ask a
     * manager", not "no limit": with the real settings reader, one unit by warehouse staff
     * needs approval, and a manager posts without one.
     */
    @Test
    void withNoLimitsConfiguredEveryAdjustmentByANonManagerNeedsAManager() {
        vacademy.io.admin_core_service.features.institute.service.setting.InstituteSettingService settingService =
                mock(vacademy.io.admin_core_service.features.institute.service.setting.InstituteSettingService.class);
        when(settingService.getSettingByInstituteIdAndKey(INST, CommerceStockSettings.SETTING_KEY)).thenReturn(null);
        CommerceStockSettings realSettings = new CommerceStockSettings(settingService,
                new com.fasterxml.jackson.databind.ObjectMapper());
        assertEquals(new AdjustmentLimits(0, BigDecimal.ZERO), realSettings.adjustmentLimits(INST));
        StockAdjustmentService unconfigured = new StockAdjustmentService(ledger, variants,
                mock(CommercePieceRepository.class), realSettings, approvals, mock(CommerceAuditService.class));

        CommerceAccessDeniedException refused = assertThrows(CommerceAccessDeniedException.class,
                () -> unconfigured.adjust(INST, "staff-1", false, request(-1)));
        assertEquals(StockAdjustmentService.APPROVAL_REQUIRED, refused.getCode());
        verify(ledger, never()).post(any());

        unconfigured.adjust(INST, "manager-1", true, request(-1));
        verify(ledger).post(any());
        verifyNoInteractions(approvals);
    }

    @Test
    void oneConfiguredLimitLeavesTheOtherKindUnlimited() {
        vacademy.io.admin_core_service.features.institute.service.setting.InstituteSettingService settingService =
                mock(vacademy.io.admin_core_service.features.institute.service.setting.InstituteSettingService.class);
        when(settingService.getSettingByInstituteIdAndKey(INST, CommerceStockSettings.SETTING_KEY))
                .thenReturn(java.util.Map.of("limits", java.util.Map.of("adjustmentQuantity", 20)));
        CommerceStockSettings realSettings = new CommerceStockSettings(settingService,
                new com.fasterxml.jackson.databind.ObjectMapper());

        assertEquals(new AdjustmentLimits(20, null), realSettings.adjustmentLimits(INST));
    }
}
