package vacademy.io.admin_core_service.features.commerce.report.controller;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpHeaders;
import org.springframework.http.ResponseEntity;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.web.context.request.RequestContextHolder;
import org.springframework.web.context.request.ServletRequestAttributes;
import vacademy.io.admin_core_service.features.capabilities.service.CapabilityResolver;
import vacademy.io.admin_core_service.features.commerce.pos.service.PosUserNames;
import vacademy.io.admin_core_service.features.commerce.report.dto.ReportDtos.ReportAnswer;
import vacademy.io.admin_core_service.features.commerce.report.repository.ReportReadRepository;
import vacademy.io.admin_core_service.features.commerce.report.service.CodDuesReportService;
import vacademy.io.admin_core_service.features.commerce.report.service.CommerceAuditQueryService;
import vacademy.io.admin_core_service.features.commerce.report.service.DayBookService;
import vacademy.io.admin_core_service.features.commerce.report.service.GstReportService;
import vacademy.io.admin_core_service.features.commerce.report.service.PaymentModesService;
import vacademy.io.admin_core_service.features.commerce.report.service.PosSessionsReportService;
import vacademy.io.admin_core_service.features.commerce.report.service.ReportAccess;
import vacademy.io.admin_core_service.features.commerce.report.service.ReportQuery;
import vacademy.io.admin_core_service.features.commerce.report.service.ReportRange;
import vacademy.io.admin_core_service.features.commerce.report.service.ReportRunner;
import vacademy.io.admin_core_service.features.commerce.report.service.SalesReportService;
import vacademy.io.admin_core_service.features.commerce.security.CommerceAccessDeniedException;
import vacademy.io.admin_core_service.features.commerce.security.CommerceAccessGuard;
import vacademy.io.admin_core_service.features.commerce.security.repository.CommerceStaffLocationRepository;
import vacademy.io.admin_core_service.features.commerce.stock.controller.StockAccess;
import vacademy.io.admin_core_service.features.commerce.stock.service.StockClock;
import vacademy.io.common.auth.dto.UserServiceDTO;
import vacademy.io.common.auth.model.CustomUserDetails;
import vacademy.io.common.exceptions.InvalidRequestException;
import vacademy.io.common.exceptions.ResourceNotFoundException;

import java.io.ByteArrayOutputStream;
import java.io.OutputStream;
import java.time.LocalDate;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.function.Supplier;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertSame;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.argThat;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * The report endpoint (contract 6.2 B2.6): every name routed to its service, unknown names 404,
 * the file formats and their headers, the day book's 31 days, staff names read outside the
 * report, and the real access guard refusing cashiers and warehouse staff on every report and the
 * audit list.
 */
class CommerceReportControllerTest {

    private static final String INSTITUTE = "inst-1";
    private static final LocalDate TODAY = LocalDate.of(2026, 11, 19);

    private CapabilityResolver capabilities;
    private StockAccess stockAccess;
    private ReportRunner runner;
    private GstReportService gst;
    private DayBookService dayBook;
    private PaymentModesService paymentModes;
    private CodDuesReportService codDues;
    private PosSessionsReportService sessions;
    private SalesReportService sales;
    private PosUserNames userNames;
    private CommerceAuditQueryService audit;
    private CommerceReportController controller;
    private CommerceAuditController auditController;
    private final ReportAnswer answer = new ReportAnswer();

    @BeforeEach
    @SuppressWarnings("unchecked")
    void setUp() throws Exception {
        MockHttpServletRequest request = new MockHttpServletRequest();
        request.addHeader("clientId", INSTITUTE);
        RequestContextHolder.setRequestAttributes(new ServletRequestAttributes(request));
        capabilities = mock(CapabilityResolver.class);
        when(capabilities.isFeatureGranted(anyString(), anyString())).thenReturn(true);
        CommerceAccessGuard guard = new CommerceAccessGuard(capabilities, mock(CommerceStaffLocationRepository.class));
        stockAccess = mock(StockAccess.class);
        ReportReadRepository readRepository = mock(ReportReadRepository.class);
        when(readRepository.activeLocationIds(INSTITUTE)).thenReturn(List.of("L1", "L2"));
        ReportAccess access = new ReportAccess(guard, stockAccess, readRepository);

        runner = mock(ReportRunner.class);
        when(runner.screen(any())).thenAnswer(inv -> ((Supplier<Object>) inv.getArgument(0)).get());
        when(runner.export(any(), any())).thenAnswer(inv -> {
            ReportRunner.ExportBody body = inv.getArgument(1);
            ByteArrayOutputStream out = new ByteArrayOutputStream();
            int rows = body.write(out, 50000);
            return new ReportRunner.ExportResult(out.toByteArray(), rows);
        });
        StockClock clock = mock(StockClock.class);
        when(clock.today(INSTITUTE)).thenReturn(TODAY);
        gst = mock(GstReportService.class);
        dayBook = mock(DayBookService.class);
        paymentModes = mock(PaymentModesService.class);
        codDues = mock(CodDuesReportService.class);
        sessions = mock(PosSessionsReportService.class);
        sales = mock(SalesReportService.class);
        userNames = mock(PosUserNames.class);
        audit = mock(CommerceAuditQueryService.class);
        when(dayBook.dayBook(any())).thenReturn(answer);
        when(paymentModes.paymentModes(any())).thenReturn(answer);
        when(codDues.codOutstanding(any())).thenReturn(answer);
        when(codDues.customerDues(any())).thenReturn(answer);
        when(sessions.sessions(any())).thenReturn(answer);
        when(sales.sales(any())).thenReturn(answer);
        when(sales.products(any())).thenReturn(answer);
        when(gst.salesRegister(any())).thenReturn(answer);
        when(gst.creditNotes(any())).thenReturn(answer);
        when(gst.taxByRate(any())).thenReturn(answer);
        when(gst.hsnSummary(any())).thenReturn(answer);
        when(gst.gstr1(any())).thenReturn(answer);
        when(gst.documentsIssued(any())).thenReturn(answer);
        controller = new CommerceReportController(access, runner, clock, gst, dayBook, paymentModes, codDues,
                sessions, sales, userNames);
        auditController = new CommerceAuditController(access, runner, clock, audit, userNames);
    }

    @AfterEach
    void tearDown() {
        RequestContextHolder.resetRequestAttributes();
    }

    private static CustomUserDetails user(String authority) {
        UserServiceDTO dto = new UserServiceDTO();
        dto.setUserId("u-1");
        dto.setUsername("u-1");
        dto.setFullName("Test User");
        dto.setAuthorities(List.of(authority));
        return new CustomUserDetails(dto);
    }

    private ResponseEntity<?> call(CustomUserDetails user, String name, LocalDate from, LocalDate to, String format) {
        return controller.report(user, name, INSTITUTE, from, to, null, null, null, null, null, null, null, null,
                null, null, format, null, null);
    }

    private ResponseEntity<?> call(String name, String format) {
        return call(user("ADMIN"), name, null, null, format);
    }

    @Test
    void everyReportIsRoutedToItsService() {
        for (String name : ReportAccess.REPORT_KINDS.keySet()) {
            if (GstReportService.GST_PACK.equals(name)) {
                continue;
            }
            ResponseEntity<?> response = call(name, null);
            assertSame(answer, response.getBody(), name);
            assertEquals("no-store", response.getHeaders().getCacheControl(), name);
        }
        verify(dayBook).dayBook(any());
        verify(paymentModes).paymentModes(any());
        verify(codDues).codOutstanding(any());
        verify(codDues).customerDues(any());
        verify(sessions).sessions(any());
        verify(sales).sales(any());
        verify(sales).products(any());
        verify(gst).salesRegister(any());
        verify(gst).documentsIssued(any());
    }

    @Test
    void anUnknownNameIs404() {
        ResourceNotFoundException e = assertThrows(ResourceNotFoundException.class,
                () -> call("stock-valuation", null));
        assertTrue(e.getMessage().startsWith("REPORT_NOT_FOUND"));
    }

    @Test
    void filesCarryTheirTypeNameAndAreExportedByTheService() throws Exception {
        when(sales.exportSales(any(), eq("csv"), any(), anyInt())).thenAnswer(inv -> {
            OutputStream out = inv.getArgument(2);
            out.write("a,b".getBytes());
            return 1;
        });
        ResponseEntity<?> csv = call(user("ADMIN"), "sales", LocalDate.of(2026, 11, 1), LocalDate.of(2026, 11, 19),
                "csv");
        assertEquals("text/csv;charset=UTF-8", csv.getHeaders().getContentType().toString());
        assertEquals("attachment; filename=\"sales-2026-11-01-2026-11-19.csv\"",
                csv.getHeaders().getFirst(HttpHeaders.CONTENT_DISPOSITION));
        assertEquals("a,b", new String((byte[]) csv.getBody()));

        ResponseEntity<?> xlsx = call("pos-sessions", "xlsx");
        assertEquals("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                xlsx.getHeaders().getContentType().toString());
        verify(sessions).export(any(), eq("xlsx"), any(), anyInt());
        call("day-book", "csv");
        verify(dayBook).export(any(), eq("csv"), any(), anyInt());
        call("payment-modes", "xlsx");
        verify(paymentModes).export(any(), eq("xlsx"), any(), anyInt());
        call("cod-outstanding", "csv");
        verify(codDues).exportCod(any(), eq("csv"), any(), anyInt());
        call("customer-dues", "csv");
        verify(codDues).exportDues(any(), eq("csv"), any(), anyInt());
        call("products", "xlsx");
        verify(sales).exportProducts(any(), eq("xlsx"), any(), anyInt());
        assertThrows(InvalidRequestException.class, () -> call("sales", "pdf"));
    }

    @Test
    void theDayBookIsOneDayByDefaultAndAtMost31() {
        call("day-book", null);
        verify(dayBook).dayBook(argThat((ReportQuery q) -> q.range().equals(new ReportRange(TODAY, TODAY))));
        InvalidRequestException e = assertThrows(InvalidRequestException.class, () -> call(user("ADMIN"),
                "day-book", TODAY.minusDays(31), TODAY, null));
        assertTrue(e.getMessage().startsWith("VALIDATION"));
        call(user("ADMIN"), "day-book", TODAY.minusDays(30), TODAY, null);
        // Other reports default to this month.
        call("sales", null);
        verify(sales).sales(argThat((ReportQuery q) -> q.range().from().equals(LocalDate.of(2026, 11, 1))));
    }

    @Test
    void staffNamesAreReadOutsideTheReportAndOnlyWhenNamed() {
        when(dayBook.staffIds(any())).thenReturn(List.of("u-cashier"));
        when(userNames.names(List.of("u-cashier"))).thenReturn(Map.of("u-cashier", "Test Cashier"));
        call("day-book", null);
        verify(dayBook).dayBook(argThat((ReportQuery q) -> "Test Cashier".equals(q.staffName("u-cashier"))));
        call("customer-dues", null);
        verify(userNames, org.mockito.Mockito.times(1)).names(any());
    }

    @Test
    void cashiersAndWarehouseStaffAreRefusedEveryReportAndTheAuditList() {
        for (String role : List.of("COMMERCE_POS_CASHIER", "COMMERCE_WAREHOUSE_STAFF")) {
            CustomUserDetails staff = user(role);
            for (String name : ReportAccess.REPORT_KINDS.keySet()) {
                CommerceAccessDeniedException e = assertThrows(CommerceAccessDeniedException.class,
                        () -> call(staff, name, null, null, null), role + " " + name);
                assertEquals(CommerceAccessDeniedException.ROLE_NOT_ALLOWED, e.getCode());
            }
            assertThrows(CommerceAccessDeniedException.class, () -> auditController.list(staff, INSTITUTE, null,
                    null, null, null, null, null, null, null, null));
            assertThrows(CommerceAccessDeniedException.class, () -> auditController.approvals(staff, INSTITUTE,
                    null, null, null, null, null, null));
            assertThrows(CommerceAccessDeniedException.class, () -> auditController.kinds(staff, INSTITUTE));
        }
        verify(dayBook, never()).dayBook(any());
        verify(audit, never()).audit(any());
    }

    @Test
    void anAccountantReadsSalesAtTheirLocationsAndNotTaxReportsWhenTheFeatureIsOff() {
        CustomUserDetails accountant = user("COMMERCE_ACCOUNTANT");
        when(stockAccess.visibleLocationIds(accountant, INSTITUTE)).thenReturn(new LinkedHashSet<>(List.of("L2")));
        call(accountant, "sales", null, null, null);
        verify(sales).sales(argThat((ReportQuery q) -> q.scope().locationIn().equals(java.util.Set.of("L2"))));
        when(capabilities.isFeatureGranted(INSTITUTE, "commerce.tax_reports")).thenReturn(false);
        CommerceAccessDeniedException off = assertThrows(CommerceAccessDeniedException.class,
                () -> call(accountant, "day-book", null, null, null));
        assertEquals(CommerceAccessDeniedException.FEATURE_DISABLED, off.getCode());
        call(accountant, "customer-dues", null, null, null);
        verify(codDues).customerDues(any());
    }

    @Test
    void theAuditCsvIsAuditedAndNamed() throws Exception {
        when(audit.actors(any())).thenReturn(List.of("u-9"));
        when(userNames.names(List.of("u-9"))).thenReturn(Map.of("u-9", "Test Manager"));
        when(audit.exportCsv(any(), eq(Map.of("u-9", "Test Manager")), any(), anyInt())).thenReturn(0);
        ResponseEntity<?> csv = auditController.list(user("ADMIN"), INSTITUTE, null, null, null, null, "pos_void",
                null, null, null, "csv");
        assertEquals("text/csv;charset=UTF-8", csv.getHeaders().getContentType().toString());
        verify(runner).export(argThat(a -> CommerceAuditQueryService.AUDIT.equals(a.report())
                && "csv".equals(a.format()) && "POS_VOID".equals(a.filters().get("kind"))), any());
        assertThrows(InvalidRequestException.class, () -> auditController.list(user("ADMIN"), INSTITUTE, null, null,
                null, null, null, null, null, null, "xlsx"));
    }
}
