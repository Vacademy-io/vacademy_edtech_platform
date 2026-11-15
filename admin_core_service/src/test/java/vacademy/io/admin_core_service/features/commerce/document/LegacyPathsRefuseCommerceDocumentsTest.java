package vacademy.io.admin_core_service.features.commerce.document;

import jakarta.persistence.EntityManager;
import jakarta.persistence.Query;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.test.util.ReflectionTestUtils;
import vacademy.io.admin_core_service.features.admin_activity_logs.async.AsyncAuditDispatcher;
import vacademy.io.admin_core_service.features.commerce.catalogue.repository.CommerceVariantRepository;
import vacademy.io.admin_core_service.features.commerce.common.CommercePlans;
import vacademy.io.admin_core_service.features.commerce.document.service.CommerceDocumentGuard;
import vacademy.io.admin_core_service.features.enroll_invite.entity.EnrollInvite;
import vacademy.io.admin_core_service.features.invoice.entity.Invoice;
import vacademy.io.admin_core_service.features.invoice.repository.InvoicePaymentLogMappingRepository;
import vacademy.io.admin_core_service.features.invoice.repository.InvoiceRepository;
import vacademy.io.admin_core_service.features.invoice.service.InvoiceNumberService;
import vacademy.io.admin_core_service.features.invoice.service.InvoiceService;
import vacademy.io.admin_core_service.features.user_subscription.entity.PaymentLog;
import vacademy.io.admin_core_service.features.user_subscription.entity.UserPlan;
import vacademy.io.admin_core_service.features.user_subscription.repository.PaymentLogRepository;
import vacademy.io.admin_core_service.features.user_subscription.service.PaymentDeletionService;
import vacademy.io.admin_core_service.features.user_subscription.service.PaymentVoidService;
import vacademy.io.common.exceptions.VacademyException;

import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertSame;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyCollection;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

/**
 * A shop payment never gets an invoice from the course series, and neither it nor its GST
 * document can be voided or deleted from the old screens. A course payment takes every old
 * path exactly as before.
 */
class LegacyPathsRefuseCommerceDocumentsTest {

    private static final String INST = "inst-1";
    private static final String USER = "admin-1";

    private CommerceVariantRepository variants;
    private InvoicePaymentLogMappingRepository mappings;
    private CommerceDocumentGuard guard;

    @BeforeEach
    void setUp() {
        variants = mock(CommerceVariantRepository.class);
        mappings = mock(InvoicePaymentLogMappingRepository.class);
        when(variants.countVariantsOnInvite("invite-shop")).thenReturn(1L);
        when(variants.countVariantsOnInvite("invite-course")).thenReturn(0L);
        guard = new CommerceDocumentGuard(new CommercePlans(variants), mappings);
    }

    private static PaymentLog log(String id, String inviteId, String vendor) {
        EnrollInvite invite = new EnrollInvite();
        invite.setId(inviteId);
        invite.setInstituteId(INST);
        UserPlan plan = new UserPlan();
        plan.setId("plan-" + id);
        plan.setEnrollInviteId(inviteId);
        plan.setEnrollInvite(invite);
        PaymentLog paymentLog = new PaymentLog();
        paymentLog.setId(id);
        paymentLog.setVendor(vendor);
        paymentLog.setPaymentStatus("PAID");
        paymentLog.setPaymentAmount(1000d);
        paymentLog.setCurrency("INR");
        paymentLog.setUserPlan(plan);
        return paymentLog;
    }

    // ------------------------------------------------------------------ the test itself

    @Test
    void aLogIsCommerceByItsVariantOrItsDocumentNeverByAnythingElse() {
        assertTrue(guard.isCommerceLog(log("pl-shop", "invite-shop", "OFFLINE")));
        assertFalse(guard.isCommerceLog(log("pl-course", "invite-course", "OFFLINE")));
        assertFalse(guard.isCommerceLog(null));

        // A shipping or COD-charge log has no variant; it is commerce once a document covers it.
        when(mappings.existsCommerceDocumentByPaymentLogId("pl-shipping")).thenReturn(true);
        assertTrue(guard.isCommerceLog(log("pl-shipping", "invite-course", "OFFLINE")));

        PaymentLog planless = new PaymentLog();
        planless.setId("pl-donation");
        assertFalse(guard.isCommerceLog(planless));
    }

    @Test
    void aDocumentIsCommerceOnlyWhenItHasADocumentType() {
        Invoice course = new Invoice();
        assertFalse(CommerceDocumentGuard.isCommerceDocument(course));
        assertFalse(course.isCommerceDocument());
        CommerceDocumentGuard.refuseCommerceDocument(course, "delete this invoice");

        Invoice shop = new Invoice();
        shop.setDocumentType("TAX_INVOICE");
        assertTrue(shop.isCommerceDocument());
        VacademyException refused = assertThrows(VacademyException.class,
                () -> CommerceDocumentGuard.refuseCommerceDocument(shop, "delete this invoice"));
        assertTrue(refused.getMessage().contains("credit note"));
    }

    // ------------------------------------------------------------------ void

    private PaymentVoidService voidService(PaymentLogRepository paymentLogs, InvoiceService invoiceService) {
        var faculty = mock(vacademy.io.admin_core_service.features.faculty.repository
                .FacultySubjectPackageSessionMappingRepository.class);
        when(faculty.findDistinctSubOrgIdsByUserAndLinkage(anyString(), any())).thenReturn(List.of());
        PaymentVoidService service = new PaymentVoidService(paymentLogs,
                mock(vacademy.io.admin_core_service.features.fee_management.repository
                        .StudentFeeAllocationLedgerRepository.class),
                mock(vacademy.io.admin_core_service.features.fee_management.repository
                        .StudentFeePaymentRepository.class),
                mappings, invoiceService,
                mock(vacademy.io.admin_core_service.features.user_account.service.UserAccountLedgerService.class),
                faculty,
                mock(vacademy.io.admin_core_service.features.user_account.repository.UserAccountLedgerRepository.class));
        ReflectionTestUtils.setField(service, "commerceDocumentGuard", guard);
        return service;
    }

    @Test
    void voidingAnOfflineShopPaymentIsRefusedBeforeAnythingIsUndone() {
        PaymentLogRepository paymentLogs = mock(PaymentLogRepository.class);
        InvoiceService invoiceService = mock(InvoiceService.class);
        PaymentLog shop = log("pl-shop", "invite-shop", "OFFLINE");
        when(paymentLogs.findById("pl-shop")).thenReturn(Optional.of(shop));
        PaymentVoidService service = voidService(paymentLogs, invoiceService);

        VacademyException refused = assertThrows(VacademyException.class,
                () -> service.voidPayment("pl-shop", INST, "typo", USER));
        assertTrue(refused.getMessage().contains("shop order"));
        assertThrows(VacademyException.class, () -> service.voidSingleRow("pl-shop", INST, "typo", USER));

        verifyNoInteractions(invoiceService);
        verify(paymentLogs, never()).save(any());
        assertEquals("PAID", shop.getPaymentStatus());
    }

    // ------------------------------------------------------------------ delete

    private PaymentDeletionService deletionService(PaymentLogRepository paymentLogs, InvoiceRepository invoices,
                                                   PaymentVoidService voidService, List<String> executedSql) {
        var roleClient = mock(vacademy.io.admin_core_service.features.live_session.client.InstituteRoleUserClient.class);
        var settings = mock(vacademy.io.admin_core_service.features.institute.service.setting.InstituteSettingService.class);
        when(roleClient.findRolesOfUser(INST, USER)).thenReturn(Optional.of(Set.of("ADMIN")));
        when(settings.getSettingByInstituteIdAndKey(INST, "ADMIN_DISPLAY_SETTINGS"))
                .thenReturn(Map.of("learnerManagement", Map.of("allowDeletePayments", true)));
        EntityManager entityManager = mock(EntityManager.class);
        when(entityManager.createNativeQuery(anyString())).thenAnswer(inv -> {
            String sql = inv.getArgument(0);
            Query query = mock(Query.class);
            when(query.setParameter(any(Integer.class), any())).thenReturn(query);
            when(query.getSingleResult()).thenReturn(0L);
            when(query.getResultList()).thenReturn(List.of());
            when(query.executeUpdate()).thenAnswer(x -> {
                executedSql.add(sql);
                return 1;
            });
            return query;
        });
        when(mappings.findAllByPaymentLogId(anyString())).thenReturn(List.of());
        when(mappings.findByInvoiceId(anyString())).thenReturn(List.of());
        PaymentDeletionService service = new PaymentDeletionService(paymentLogs, invoices, mappings, voidService,
                roleClient, settings, mock(AsyncAuditDispatcher.class),
                mock(vacademy.io.admin_core_service.features.admin_activity_logs.repository.AdminActivityLogRepository.class),
                new com.fasterxml.jackson.databind.ObjectMapper().findAndRegisterModules());
        ReflectionTestUtils.setField(service, "entityManager", entityManager);
        ReflectionTestUtils.setField(service, "commerceDocumentGuard", guard);
        return service;
    }

    @Test
    void deletingAShopPaymentIsRefusedAndNoRowIsRemoved() {
        PaymentLogRepository paymentLogs = mock(PaymentLogRepository.class);
        PaymentVoidService voidService = mock(PaymentVoidService.class);
        when(paymentLogs.findById("pl-shop")).thenReturn(Optional.of(log("pl-shop", "invite-shop", "MANUAL")));
        List<String> executedSql = new java.util.ArrayList<>();
        PaymentDeletionService service = deletionService(paymentLogs, mock(InvoiceRepository.class), voidService,
                executedSql);

        VacademyException refused = assertThrows(VacademyException.class,
                () -> service.deletePayment("pl-shop", INST, USER));

        assertTrue(refused.getMessage().contains("shop order"));
        verify(voidService, never()).voidPayment(anyString(), anyString(), any(), any());
        assertTrue(executedSql.stream().noneMatch(sql -> sql.startsWith("DELETE")), "no row was deleted");
    }

    @Test
    void deletingAShopInvoiceIsRefusedAndNoRowIsRemoved() {
        InvoiceRepository invoices = mock(InvoiceRepository.class);
        Invoice shop = new Invoice();
        shop.setId("inv-shop");
        shop.setInstituteId(INST);
        shop.setInvoiceNumber("CC/2627-00001");
        shop.setStatus("GENERATED");
        shop.setDocumentType("TAX_INVOICE");
        when(invoices.findById("inv-shop")).thenReturn(Optional.of(shop));
        List<String> executedSql = new java.util.ArrayList<>();
        PaymentDeletionService service = deletionService(mock(PaymentLogRepository.class), invoices,
                mock(PaymentVoidService.class), executedSql);

        VacademyException refused = assertThrows(VacademyException.class,
                () -> service.deleteInvoice("inv-shop", INST, USER));

        assertTrue(refused.getMessage().contains("never deleted"));
        assertTrue(executedSql.stream().noneMatch(sql -> sql.startsWith("DELETE")), "no row was deleted");
    }

    // ------------------------------------------------------------------ the course invoice generator

    private InvoiceService invoiceService(PaymentLogRepository paymentLogs, InvoiceNumberService numbering) {
        InvoiceService service = new InvoiceService();
        ReflectionTestUtils.setField(service, "invoicePaymentLogMappingRepository", mappings);
        ReflectionTestUtils.setField(service, "paymentLogRepository", paymentLogs);
        ReflectionTestUtils.setField(service, "invoiceNumberService", numbering);
        ReflectionTestUtils.setField(service, "commerceDocumentGuard", guard);
        return service;
    }

    @Test
    void thePaidPathOfAShopOrderGetsNoCourseSeriesInvoice() {
        PaymentLogRepository paymentLogs = mock(PaymentLogRepository.class);
        InvoiceNumberService numbering = mock(InvoiceNumberService.class);
        InvoiceService service = invoiceService(paymentLogs, numbering);
        PaymentLog shop = log("pl-shop", "invite-shop", "RAZORPAY");
        when(mappings.findCommerceDocumentsByPaymentLogIds(anyCollection())).thenReturn(List.of());

        // Online prepaid: paid, nothing mapped yet (the invoice comes at PACKED).
        InvoiceService.InvoiceGenerationResult result =
                service.generateInvoiceWithResult(shop.getUserPlan(), shop, INST, true);

        assertNotNull(result, "always a result object: generateInvoice() dereferences it");
        assertNull(result.getInvoice());
        assertNull(result.getPdfBytes());
        assertTrue(result.isAlreadyExisted());
        assertNull(service.generateInvoice(shop.getUserPlan(), shop, INST));
        verifyNoInteractions(numbering);
        verify(mappings, never()).existsByPaymentLogId(anyString());
    }

    @Test
    void theGeneratorHandsBackTheCommerceDocumentOnceItExists() {
        InvoiceService service = invoiceService(mock(PaymentLogRepository.class), mock(InvoiceNumberService.class));
        PaymentLog shop = log("pl-shop", "invite-shop", "RAZORPAY");
        Invoice document = new Invoice();
        document.setId("inv-shop");
        document.setDocumentType("TAX_INVOICE");
        when(mappings.findCommerceDocumentsByPaymentLogIds(anyCollection())).thenReturn(List.of(document));

        assertSame(document, service.generateInvoice(shop.getUserPlan(), shop, INST));
    }

    @Test
    void theCombinedReceiptLeavesShopPaymentsOut() {
        PaymentLogRepository paymentLogs = mock(PaymentLogRepository.class);
        InvoiceNumberService numbering = mock(InvoiceNumberService.class);
        InvoiceService service = invoiceService(paymentLogs, numbering);
        when(paymentLogs.findById("pl-a")).thenReturn(Optional.of(log("pl-a", "invite-shop", "OFFLINE")));
        when(paymentLogs.findById("pl-b")).thenReturn(Optional.of(log("pl-b", "invite-shop", "OFFLINE")));

        assertNull(service.generateCombinedInvoiceForCommittedPayments(List.of("pl-a", "pl-b"), INST));
        verifyNoInteractions(numbering);
    }

    @Test
    void theTestEndpointsRefuseAShopPayment() {
        PaymentLogRepository paymentLogs = mock(PaymentLogRepository.class);
        InvoiceNumberService numbering = mock(InvoiceNumberService.class);
        InvoiceService service = invoiceService(paymentLogs, numbering);
        PaymentLog shop = log("pl-shop", "invite-shop", "RAZORPAY");
        when(paymentLogs.findById("pl-shop")).thenReturn(Optional.of(shop));
        when(paymentLogs.findAllByOrderIdInOriginalRequest("order-1")).thenReturn(List.of(shop));

        assertThrows(VacademyException.class, () -> service.testGenerateInvoice("pl-shop"));
        assertThrows(VacademyException.class, () -> service.testGenerateInvoiceSingle("pl-shop"));
        assertThrows(VacademyException.class, () -> service.testGenerateInvoiceForMultiPackage("order-1"));
        verifyNoInteractions(numbering);
    }

    /**
     * Shop documents are served only through /commerce/v1: none of the course invoice readers
     * hands one out.
     */
    @Test
    void theOldReadPathsNeverHandOutAShopDocument() {
        InvoiceService service = invoiceService(mock(PaymentLogRepository.class), mock(InvoiceNumberService.class));
        InvoiceRepository invoices = mock(InvoiceRepository.class);
        ReflectionTestUtils.setField(service, "invoiceRepository", invoices);
        Invoice shop = new Invoice();
        shop.setId("inv-shop");
        shop.setDocumentType("BILL_OF_SUPPLY");
        shop.setPdfFileId("file-1");
        when(invoices.findById("inv-shop")).thenReturn(Optional.of(shop));

        // The download endpoint and the bulk export: no link, although the PDF exists.
        assertNull(service.resolveOrRegeneratePdfUrl("inv-shop"));
        // The payment-link read and the by-id read: the same answer as an unknown id.
        VacademyException refused = assertThrows(VacademyException.class, () -> service.getInvoiceById("inv-shop"));
        assertTrue(refused.getMessage().contains("Invoice not found"));
        verify(invoices, never()).save(any());
    }

    /** The list reads (by user, by email, by institute, bulk export) leave shop documents out in the query. */
    @Test
    void theOldListQueriesLeaveShopDocumentsOut() throws Exception {
        for (String method : List.of("findByUserIdOrderByCreatedAtDesc", "findByUserIdAndInstituteIdOrderByCreatedAtDesc",
                "findByInstituteIdWithFilters", "findForBulkExport")) {
            java.lang.reflect.Method found = java.util.Arrays.stream(InvoiceRepository.class.getMethods())
                    .filter(m -> m.getName().equals(method)).findFirst().orElseThrow();
            org.springframework.data.jpa.repository.Query query =
                    found.getAnnotation(org.springframework.data.jpa.repository.Query.class);
            assertNotNull(query, method + " must be a written query");
            assertTrue(query.value().contains("i.documentType IS NULL"), method + " must leave shop documents out");
        }
    }
}
