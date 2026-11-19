package vacademy.io.admin_core_service.features.commerce.stock.service;

import org.junit.jupiter.api.Test;
import org.mockito.InOrder;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.transaction.PlatformTransactionManager;
import vacademy.io.admin_core_service.features.commerce.audit.CommerceAuditService;
import vacademy.io.admin_core_service.features.commerce.common.request.CommerceRequestGuard;
import vacademy.io.admin_core_service.features.commerce.order.desk.CommerceStockShortFlagger;
import vacademy.io.admin_core_service.features.commerce.security.CommerceApprovalService;
import vacademy.io.admin_core_service.features.commerce.stock.dto.StockOpsDtos.Caller;
import vacademy.io.admin_core_service.features.commerce.stock.entity.StockCount;
import vacademy.io.admin_core_service.features.commerce.stock.repository.CommercePieceRepository;
import vacademy.io.admin_core_service.features.commerce.stock.repository.StockCountLineRepository;
import vacademy.io.admin_core_service.features.commerce.stock.repository.StockCountRepository;
import vacademy.io.admin_core_service.features.commerce.stock.repository.StockLevelRepository;
import vacademy.io.admin_core_service.features.commerce.stock.repository.StockLocationRepository;
import vacademy.io.admin_core_service.features.commerce.stock.repository.StockMovementRepository;
import vacademy.io.admin_core_service.features.commerce.stock.repository.StockOpsReadRepository;

import java.time.LocalDateTime;
import java.util.Optional;
import java.util.Set;

import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyCollection;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.ArgumentMatchers.isNull;
import static org.mockito.Mockito.inOrder;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * The review a ZERO post binds to reads what came in BEFORE the stock levels. The database
 * runs read committed, so each statement sees its own moment: stock that comes in between the
 * two reads must look as if it came in after the review (the post is refused), never be hidden
 * in an on-hand figure the incoming figure does not know about.
 */
class StockCountReviewReadOrderTest {

    private static final String INST = "inst-1";
    private static final String LOC = "loc-store";

    @Test
    void theReviewReadsIncomingStockBeforeTheStockLevels() {
        StockCountRepository counts = mock(StockCountRepository.class);
        StockOpsReadRepository reads = mock(StockOpsReadRepository.class);
        StockCount count = new StockCount();
        count.setId("c-1");
        count.setKind("COUNT");
        count.setStatus("OPEN");
        count.setLocationId(LOC);
        count.setStartedBy("u-1");
        count.setStartedAt(LocalDateTime.of(2026, 11, 19, 9, 0));
        when(counts.findByInstituteIdAndId(INST, "c-1")).thenReturn(Optional.of(count));
        @SuppressWarnings("unchecked")
        ObjectProvider<CommerceStockShortFlagger> flagger = mock(ObjectProvider.class);
        StockCountService service = new StockCountService(counts, mock(StockCountLineRepository.class),
                mock(StockLocationRepository.class), mock(StockLevelRepository.class),
                mock(StockMovementRepository.class), mock(CommercePieceRepository.class), reads,
                mock(StockLedgerService.class), mock(CommerceCounterService.class), mock(CommerceRequestGuard.class),
                mock(CommerceAuditService.class), mock(CommerceStockSettings.class),
                mock(CommerceApprovalService.class), flagger, mock(PlatformTransactionManager.class));

        Caller staff = new Caller("u-2", false, false, true, false, Set.of(LOC));
        assertNotNull(service.review(INST, staff, "c-1", true).zeroWriteOff());

        InOrder order = inOrder(reads);
        order.verify(reads).incomingSince(eq(INST), eq(LOC), isNull(), eq(count.getStartedAt()));
        order.verify(reads).scopeLevels(eq(INST), eq(LOC), isNull(), anyCollection());
        // One read of what came in, the early one: the review binds exactly that figure.
        verify(reads, never()).incomingSince(eq(INST), eq(LOC), any(java.util.Collection.class), any());
    }
}
