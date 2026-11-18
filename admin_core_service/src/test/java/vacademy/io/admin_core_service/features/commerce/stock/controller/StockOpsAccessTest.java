package vacademy.io.admin_core_service.features.commerce.stock.controller;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.function.Executable;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.web.context.request.RequestContextHolder;
import org.springframework.web.context.request.ServletRequestAttributes;
import vacademy.io.admin_core_service.features.capabilities.service.CapabilityResolver;
import vacademy.io.admin_core_service.features.commerce.audit.CommerceAuditService;
import vacademy.io.admin_core_service.features.commerce.catalogue.controller.CommerceQuickAddController;
import vacademy.io.admin_core_service.features.commerce.catalogue.service.CommerceQuickAddService;
import vacademy.io.admin_core_service.features.commerce.common.request.CommerceRequestGuard;
import vacademy.io.admin_core_service.features.commerce.label.controller.LabelController;
import vacademy.io.admin_core_service.features.commerce.label.dto.LabelDtos;
import vacademy.io.admin_core_service.features.commerce.label.service.LabelQueueService;
import vacademy.io.admin_core_service.features.commerce.security.CommerceAccessDeniedException;
import vacademy.io.admin_core_service.features.commerce.security.CommerceAccessGuard;
import vacademy.io.admin_core_service.features.commerce.security.CommerceApprovalService;
import vacademy.io.admin_core_service.features.commerce.security.entity.CommerceStaffLocation;
import vacademy.io.admin_core_service.features.commerce.security.repository.CommerceStaffLocationRepository;
import vacademy.io.admin_core_service.features.commerce.stock.dto.StockOpsDtos;
import vacademy.io.admin_core_service.features.commerce.stock.dto.StockOpsDtos.Caller;
import vacademy.io.admin_core_service.features.commerce.stock.entity.StockCount;
import vacademy.io.admin_core_service.features.commerce.stock.entity.StockTransfer;
import vacademy.io.admin_core_service.features.commerce.stock.repository.CommercePieceRepository;
import vacademy.io.admin_core_service.features.commerce.stock.repository.StockCountLineRepository;
import vacademy.io.admin_core_service.features.commerce.stock.repository.StockCountRepository;
import vacademy.io.admin_core_service.features.commerce.stock.repository.StockLevelRepository;
import vacademy.io.admin_core_service.features.commerce.stock.repository.StockLocationRepository;
import vacademy.io.admin_core_service.features.commerce.stock.repository.StockMovementRepository;
import vacademy.io.admin_core_service.features.commerce.stock.repository.StockOpsReadRepository;
import vacademy.io.admin_core_service.features.commerce.stock.service.CommerceCounterService;
import vacademy.io.admin_core_service.features.commerce.stock.service.CommerceStockSettings;
import vacademy.io.admin_core_service.features.commerce.stock.service.StockChallanPdfService;
import vacademy.io.admin_core_service.features.commerce.stock.service.StockCountService;
import vacademy.io.admin_core_service.features.commerce.stock.service.StockLedgerService;
import vacademy.io.admin_core_service.features.commerce.stock.service.StockOverviewService;
import vacademy.io.admin_core_service.features.commerce.stock.service.StockTransferService;
import vacademy.io.common.auth.dto.UserServiceDTO;
import vacademy.io.common.auth.model.CustomUserDetails;

import java.util.ArrayList;
import java.util.List;
import java.util.Optional;
import java.util.Set;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.lenient;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

/**
 * The role and place matrix of the stock-operation routes through the real
 * {@link CommerceAccessGuard}: cashier and accountant write nothing; warehouse staff act only at
 * their own place (the source of a dispatch, the destination of a receive, a count's place, a
 * label request's place) and read a transfer only from or to it; the feature off stops everyone;
 * a challan series is added by a manager at a place or by ADMIN; the person doing a blind
 * recount does not see the count it rechecks.
 */
class StockOpsAccessTest {

    private static final String INST = "inst-1";
    private static final String L1 = "loc-store";
    private static final String L2 = "loc-wh";
    private static final String L3 = "loc-other";

    private final CapabilityResolver capabilities = mock(CapabilityResolver.class);
    private final CommerceStaffLocationRepository staffLocations = mock(CommerceStaffLocationRepository.class);
    private final StockTransferService transferService = mock(StockTransferService.class);
    private final StockOverviewService overviewService = mock(StockOverviewService.class);
    private final LabelQueueService labelService = mock(LabelQueueService.class);
    private final CommerceQuickAddService quickAddService = mock(CommerceQuickAddService.class);
    private final StockCountRepository countRepository = mock(StockCountRepository.class);
    private StockOpsAccess access;
    private StockTransferController transfers;
    private StockCountController counts;
    private LabelController labels;
    private StockOverviewController overview;
    private CommerceQuickAddController quickAdd;

    private final CustomUserDetails admin = user("admin-a", "ADMIN");
    private final CustomUserDetails manager = user("manager-m", "COMMERCE_STORE_MANAGER");
    private final CustomUserDetails w1 = user("wh-1", "COMMERCE_WAREHOUSE_STAFF");
    private final CustomUserDetails w2 = user("wh-2", "COMMERCE_WAREHOUSE_STAFF");
    private final CustomUserDetails cashier = user("cashier-c", "COMMERCE_POS_CASHIER");
    private final CustomUserDetails accountant = user("acct-a", "COMMERCE_ACCOUNTANT");

    @BeforeEach
    void setUp() {
        CommerceAccessGuard guard = new CommerceAccessGuard(capabilities, staffLocations);
        access = new StockOpsAccess(guard, new StockAccess(staffLocations));
        transfers = new StockTransferController(access, transferService, mock(StockChallanPdfService.class),
                overviewService);
        StockCountService countService = new StockCountService(countRepository, mock(StockCountLineRepository.class),
                mock(StockLocationRepository.class), mock(StockLevelRepository.class),
                mock(StockMovementRepository.class), mock(CommercePieceRepository.class),
                mock(StockOpsReadRepository.class), mock(StockLedgerService.class), mock(CommerceCounterService.class),
                mock(CommerceRequestGuard.class), mock(CommerceAuditService.class), mock(CommerceStockSettings.class),
                mock(CommerceApprovalService.class), noFlagger(), mock(PlatformTransactionManager.class));
        counts = new StockCountController(access, countService);
        labels = new LabelController(access, labelService);
        overview = new StockOverviewController(access, overviewService);
        quickAdd = new CommerceQuickAddController(guard, quickAddService);
        MockHttpServletRequest request = new MockHttpServletRequest();
        request.addHeader("clientId", INST);
        RequestContextHolder.setRequestAttributes(new ServletRequestAttributes(request));
        lenient().when(capabilities.isFeatureGranted(INST, "commerce.stock")).thenReturn(true);
        assign("manager-m", L1, L2, L3);
        assign("wh-1", L1);
        assign("wh-2", L2);
        assign("cashier-c", L1);
        assign("acct-a", L1, L2);
        // A transfer L1 → L2 and one L1 → L3; a count at L1.
        lenient().when(transferService.get(INST, "t-12")).thenReturn(transfer("t-12", L1, L2));
        lenient().when(transferService.get(INST, "t-13")).thenReturn(transfer("t-13", L1, L3));
        StockCount count = count("c-1", "COUNT", "wh-1", null, "OPEN");
        lenient().when(countRepository.findByInstituteIdAndId(INST, "c-1")).thenReturn(Optional.of(count));
        lenient().when(countRepository.findRecountsOf(anyString(), anyString())).thenReturn(List.of());
    }

    @AfterEach
    void clear() {
        RequestContextHolder.resetRequestAttributes();
    }

    @SuppressWarnings("unchecked")
    private static ObjectProvider<vacademy.io.admin_core_service.features.commerce.order.desk.CommerceStockShortFlagger>
    noFlagger() {
        return mock(ObjectProvider.class);
    }

    private void assign(String user, String... locations) {
        List<CommerceStaffLocation> rows = new ArrayList<>();
        for (String location : locations) {
            lenient().when(staffLocations.existsByInstituteIdAndUserIdAndLocationId(INST, user, location))
                    .thenReturn(true);
            CommerceStaffLocation row = new CommerceStaffLocation();
            row.setInstituteId(INST);
            row.setUserId(user);
            row.setLocationId(location);
            rows.add(row);
        }
        lenient().when(staffLocations.findByInstituteIdAndUserId(INST, user)).thenReturn(rows);
    }

    private static StockTransfer transfer(String id, String from, String to) {
        StockTransfer transfer = new StockTransfer();
        transfer.setId(id);
        transfer.setInstituteId(INST);
        transfer.setFromLocationId(from);
        transfer.setToLocationId(to);
        transfer.setStatus("DRAFT");
        return transfer;
    }

    private static StockCount count(String id, String kind, String startedBy, String recountOf, String status) {
        StockCount count = new StockCount();
        count.setId(id);
        count.setInstituteId(INST);
        count.setLocationId(L1);
        count.setKind(kind);
        count.setStartedBy(startedBy);
        count.setRecountOfCountId(recountOf);
        count.setStatus(status);
        return count;
    }

    private static CustomUserDetails user(String id, String... authorities) {
        UserServiceDTO dto = new UserServiceDTO();
        dto.setUserId(id);
        dto.setUsername(id);
        dto.setAuthorities(List.of(authorities));
        return new CustomUserDetails(dto);
    }

    private static String code(Executable call) {
        return assertThrows(CommerceAccessDeniedException.class, call).getCode();
    }

    private static StockOpsDtos.TransferCreateRequest create(String from, String to) {
        return new StockOpsDtos.TransferCreateRequest("key-12345678", from, to, null, List.of());
    }

    private static StockOpsDtos.TransferDispatchRequest send() {
        return new StockOpsDtos.TransferDispatchRequest("key-12345678", null, null, null, null);
    }

    private static StockOpsDtos.TransferReceiveRequest arrive() {
        return new StockOpsDtos.TransferReceiveRequest("key-12345678", List.of(), null, null);
    }

    private static LabelDtos.LabelRequestsRequest reprint(String location) {
        return new LabelDtos.LabelRequestsRequest("key-12345678", location, "REPRINT", "TORN", null,
                List.of(new LabelDtos.LabelLineInput("ps-1", 1, null, null)));
    }

    @Test
    void cashierAndAccountantWriteNothing() {
        for (CustomUserDetails who : List.of(cashier, accountant)) {
            assertEquals("ROLE_NOT_ALLOWED", code(() -> transfers.create(who, INST, create(L1, L2))));
            assertEquals("ROLE_NOT_ALLOWED", code(() -> transfers.dispatch(who, INST, "t-12", send())));
            assertEquals("ROLE_NOT_ALLOWED", code(() -> transfers.receive(who, INST, "t-12", arrive())));
            assertEquals("ROLE_NOT_ALLOWED", code(() -> counts.open(who, INST,
                    new StockOpsDtos.CountCreateRequest("key-12345678", L1, null, null, null, null))));
            assertEquals("ROLE_NOT_ALLOWED", code(() -> counts.lines(who, INST, "c-1",
                    new StockOpsDtos.CountLinesRequest("key-12345678", List.of()))));
            assertEquals("ROLE_NOT_ALLOWED", code(() -> labels.request(who, INST, reprint(L1))));
            assertEquals("ROLE_NOT_ALLOWED", code(() -> labels.printData(who, INST,
                    new LabelDtos.PrintDataRequest(List.of("r-1"), null, null))));
        }
        // The accountant reads (stock readers) and may quick-add an item; the cashier neither.
        transfers.get(accountant, INST, "t-12");
        overview.overview(accountant, INST, L1, null, null, null, 0, 50);
        quickAdd.quickAdd(accountant, INST, null);
        assertEquals("ROLE_NOT_ALLOWED", code(() -> transfers.get(cashier, INST, "t-12")));
        assertEquals("ROLE_NOT_ALLOWED", code(() -> quickAdd.quickAdd(cashier, INST, null)));
        verify(transferService, never()).create(any(), any(), any());
        verify(transferService, never()).dispatch(any(), any(), any(), any());
        verify(labelService, never()).request(any(), any(), any());
    }

    @Test
    void warehouseStaffActOnlyAtTheirOwnPlace() {
        // W1 works at L1 (the source), W2 at L2 (the destination).
        assertEquals("LOCATION_NOT_ALLOWED", code(() -> transfers.create(w2, INST, create(L1, L2))));
        assertEquals("LOCATION_NOT_ALLOWED", code(() -> transfers.dispatch(w2, INST, "t-12", send())),
                "dispatch is at the source");
        assertEquals("LOCATION_NOT_ALLOWED", code(() -> transfers.update(w2, INST, "t-12",
                new StockOpsDtos.TransferUpdateRequest("key-12345678", null, null, null))));
        assertEquals("LOCATION_NOT_ALLOWED", code(() -> transfers.cancel(w2, INST, "t-12",
                new StockOpsDtos.CancelRequest("key-12345678", null))));
        assertEquals("LOCATION_NOT_ALLOWED", code(() -> transfers.receive(w1, INST, "t-12", arrive())),
                "receive is at the destination");
        transfers.dispatch(w1, INST, "t-12", send());
        transfers.receive(w2, INST, "t-12", arrive());
        verify(transferService).dispatch(any(), any(), any(), any());
        verify(transferService).receive(any(), any(), any(), any());

        // Counts and labels at the count's / request's place.
        assertEquals("LOCATION_NOT_ALLOWED", code(() -> counts.open(w2, INST,
                new StockOpsDtos.CountCreateRequest("key-12345678", L1, null, null, null, null))));
        assertEquals("LOCATION_NOT_ALLOWED", code(() -> counts.lines(w2, INST, "c-1",
                new StockOpsDtos.CountLinesRequest("key-12345678", List.of()))));
        assertEquals("LOCATION_NOT_ALLOWED", code(() -> counts.post(w2, INST, "c-1",
                new StockOpsDtos.CountPostRequest("key-12345678", "SKIP", null))));
        assertEquals("LOCATION_NOT_ALLOWED", code(() -> counts.review(w2, INST, "c-1")));
        assertEquals("LOCATION_NOT_ALLOWED", code(() -> counts.get(w2, INST, "c-1")));
        assertEquals("LOCATION_NOT_ALLOWED", code(() -> labels.request(w2, INST, reprint(L1))));
        assertEquals("LOCATION_NOT_ALLOWED", code(() -> labels.toReplace(w2, INST, L1)));
        assertEquals("LOCATION_NOT_ALLOWED", code(() -> labels.list(w2, INST, L1, null, null, null, null, 0, 50)));
        assertEquals("LOCATION_NOT_ALLOWED", code(() -> overview.approvers(w2, INST, L1)));
        assertEquals("LOCATION_NOT_ALLOWED", code(() -> overview.overview(w1, INST, L1 + "," + L2, null, null, null,
                0, 50)));
        verify(labelService, never()).request(any(), any(), any());
    }

    @Test
    void aTransferIsReadOnlyFromOrToTheReadersPlace() {
        transfers.get(w1, INST, "t-12");
        transfers.get(w2, INST, "t-12");
        assertEquals("LOCATION_NOT_ALLOWED", code(() -> transfers.get(w2, INST, "t-13")),
                "W2 reads no L1 → L3 transfer");
        assertEquals("LOCATION_NOT_ALLOWED", code(() -> transfers.challan(w2, INST, "t-13")));
        transfers.get(manager, INST, "t-13");
    }

    @Test
    void theCallerCarriesThePlacesAndTheRoleFacts() {
        Caller staff = access.caller(w1, INST);
        assertEquals(Set.of(L1), staff.visibleLocationIds());
        assertTrue(staff.actsAt(L1));
        assertFalse(staff.actsAt(L2));
        assertFalse(staff.manager());
        assertFalse(staff.seesCost());
        Caller reader = access.caller(accountant, INST);
        assertTrue(reader.reads(L2));
        assertFalse(reader.actsAt(L2), "an accountant reads but does not move stock");
        assertTrue(reader.seesCost());
        Caller boss = access.caller(admin, INST);
        assertNull(boss.visibleLocationIds());
        assertTrue(boss.actsAt("anywhere"));
        assertTrue(access.caller(manager, INST).manager());
    }

    @Test
    void featureOffStopsEveryone() {
        when(capabilities.isFeatureGranted(INST, "commerce.stock")).thenReturn(false);
        for (CustomUserDetails who : List.of(admin, manager, w1)) {
            assertEquals("FEATURE_DISABLED", code(() -> transfers.list(who, INST, null, null, null, null, 0, 50)));
            assertEquals("FEATURE_DISABLED", code(() -> counts.list(who, INST, null, null, null, 0, 50)));
            assertEquals("FEATURE_DISABLED", code(() -> labels.list(who, INST, null, null, null, null, null, 0, 50)));
            assertEquals("FEATURE_DISABLED", code(() -> overview.low(who, INST, null, null, 0, 50)));
            assertEquals("FEATURE_DISABLED", code(() -> quickAdd.quickAdd(who, INST, null)));
        }
        verifyNoInteractions(transferService, overviewService, labelService, quickAddService);
    }

    @Test
    void aChallanSeriesIsAddedByAManagerAtAPlaceOrByAdmin() {
        StockOpsDtos.ChallanSeriesRequest atL1 = new StockOpsDtos.ChallanSeriesRequest("DC/", L1, null, null);
        StockOpsDtos.ChallanSeriesRequest everywhere = new StockOpsDtos.ChallanSeriesRequest("DC/", null, null, null);
        assertEquals("ROLE_NOT_ALLOWED", code(() -> transfers.createChallanSeries(w1, INST, atL1)));
        assertEquals("ROLE_NOT_ALLOWED", code(() -> transfers.createChallanSeries(manager, INST, everywhere)));
        assertEquals("LOCATION_NOT_ALLOWED", code(() -> transfers.createChallanSeries(user("manager-x",
                "COMMERCE_STORE_MANAGER"), INST, atL1)));
        transfers.createChallanSeries(manager, INST, atL1);
        transfers.createChallanSeries(admin, INST, everywhere);
        verify(overviewService).createChallanSeries(INST, "manager-m", atL1);
        verify(overviewService).createChallanSeries(INST, "admin-a", everywhere);
        // Reading the series is for every stock reader.
        transfers.challanSeries(w1, INST);
        assertEquals("ROLE_NOT_ALLOWED", code(() -> transfers.challanSeries(cashier, INST)));
    }

    @Test
    void theBlindRecounterDoesNotSeeTheCountItRechecks() {
        StockCount recount = count("c-2", "RECOUNT", "manager-m", "c-1", "OPEN");
        when(countRepository.findRecountsOf(INST, "c-1")).thenReturn(List.of(recount));
        assertEquals("RECOUNT_BLIND", code(() -> counts.get(manager, INST, "c-1")));
        assertEquals("RECOUNT_BLIND", code(() -> counts.review(manager, INST, "c-1")));
        // Once the recount is finished, it is no longer blind.
        recount.setStatus("POSTED");
        Caller caller = access.caller(manager, INST);
        StockCountService service = new StockCountService(countRepository, mock(StockCountLineRepository.class),
                mock(StockLocationRepository.class), mock(StockLevelRepository.class),
                mock(StockMovementRepository.class), mock(CommercePieceRepository.class),
                mock(StockOpsReadRepository.class), mock(StockLedgerService.class), mock(CommerceCounterService.class),
                mock(CommerceRequestGuard.class), mock(CommerceAuditService.class), mock(CommerceStockSettings.class),
                mock(CommerceApprovalService.class), noFlagger(), mock(PlatformTransactionManager.class));
        service.requireNotBlind(INST, countRepository.findByInstituteIdAndId(INST, "c-1").orElseThrow(), caller);
    }
}
