package vacademy.io.admin_core_service.features.user_subscription.service;

import jakarta.persistence.EntityManager;
import jakarta.persistence.Query;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.test.util.ReflectionTestUtils;
import vacademy.io.admin_core_service.features.admin_activity_logs.async.AsyncAuditDispatcher;
import vacademy.io.admin_core_service.features.admin_activity_logs.entity.AdminActivityLog;
import vacademy.io.admin_core_service.features.admin_activity_logs.repository.AdminActivityLogRepository;
import vacademy.io.admin_core_service.features.institute.service.setting.InstituteSettingService;
import vacademy.io.admin_core_service.features.invoice.entity.Invoice;
import vacademy.io.admin_core_service.features.invoice.entity.InvoicePaymentLogMapping;
import vacademy.io.admin_core_service.features.invoice.repository.InvoicePaymentLogMappingRepository;
import vacademy.io.admin_core_service.features.invoice.repository.InvoiceRepository;
import vacademy.io.admin_core_service.features.user_subscription.entity.PaymentLog;
import vacademy.io.admin_core_service.features.user_subscription.repository.PaymentLogRepository;
import vacademy.io.admin_core_service.features.live_session.client.InstituteRoleUserClient;
import vacademy.io.common.exceptions.VacademyException;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * Permanent delete is OFF unless Display Settings says otherwise for the caller's role, every
 * refusal leaves a DELETE_BLOCKED row in the activity log, and a delete that goes ahead voids
 * first and removes rows children-before-parents.
 */
class PaymentDeletionServiceTest {

    private static final String INST = "inst-1";
    private static final String USER = "admin-1";

    private PaymentLogRepository paymentLogRepository;
    private InvoiceRepository invoiceRepository;
    private InvoicePaymentLogMappingRepository mappingRepository;
    private PaymentVoidService voidService;
    private InstituteRoleUserClient roleClient;
    private InstituteSettingService settingService;
    private AsyncAuditDispatcher auditDispatcher;
    private AdminActivityLogRepository activityLogRepository;
    private EntityManager entityManager;
    private final List<String> executedSql = new ArrayList<>();
    private PaymentDeletionService service;

    @BeforeEach
    void setUp() {
        paymentLogRepository = mock(PaymentLogRepository.class);
        invoiceRepository = mock(InvoiceRepository.class);
        mappingRepository = mock(InvoicePaymentLogMappingRepository.class);
        voidService = mock(PaymentVoidService.class);
        roleClient = mock(InstituteRoleUserClient.class);
        settingService = mock(InstituteSettingService.class);
        auditDispatcher = mock(AsyncAuditDispatcher.class);
        activityLogRepository = mock(AdminActivityLogRepository.class);
        entityManager = mock(EntityManager.class);

        when(entityManager.createNativeQuery(anyString())).thenAnswer(inv -> {
            String sql = inv.getArgument(0);
            Query q = mock(Query.class);
            when(q.setParameter(any(Integer.class), any())).thenReturn(q);
            when(q.getSingleResult()).thenReturn(0L);
            when(q.executeUpdate()).thenAnswer(x -> {
                executedSql.add(sql);
                return 1;
            });
            return q;
        });
        when(mappingRepository.findAllByPaymentLogId(anyString())).thenReturn(List.of());
        when(mappingRepository.findByInvoiceId(anyString())).thenReturn(List.of());

        service = new PaymentDeletionService(paymentLogRepository, invoiceRepository, mappingRepository,
                voidService, roleClient, settingService, auditDispatcher, activityLogRepository,
                new com.fasterxml.jackson.databind.ObjectMapper().findAndRegisterModules());
        ReflectionTestUtils.setField(service, "entityManager", entityManager);
    }

    private void roles(String userId, Set<String> names, Set<String> ids) {
        when(roleClient.findRolesOfUser(INST, userId)).thenReturn(Optional.of(names));
        when(roleClient.findRoleIdsOfUser(INST, userId)).thenReturn(Optional.of(ids));
    }

    private void admin(boolean flag) {
        roles(USER, Set.of("ADMIN", "TEACHER"), Set.of("5", "6"));
        when(settingService.getSettingByInstituteIdAndKey(INST, "ADMIN_DISPLAY_SETTINGS"))
                .thenReturn(Map.of("learnerManagement", Map.of("allowPortalAccess", true, "allowDeletePayments", flag)));
    }

    private PaymentLog payment(String vendor, String status) {
        PaymentLog pl = new PaymentLog();
        pl.setId("pl-1");
        pl.setVendor(vendor);
        pl.setPaymentStatus(status);
        pl.setPaymentAmount(10000d);
        pl.setCurrency("INR");
        when(paymentLogRepository.findById("pl-1")).thenReturn(Optional.of(pl));
        return pl;
    }

    private AdminActivityLog blockedRow() {
        ArgumentCaptor<AdminActivityLog> row = ArgumentCaptor.forClass(AdminActivityLog.class);
        verify(auditDispatcher).dispatch(row.capture());
        return row.getValue();
    }

    // ------------------------------------------------------------------ permission

    @Test
    @DisplayName("off by default: an admin whose settings never mention the flag cannot delete")
    void offByDefault() {
        roles(USER, Set.of("ADMIN"), Set.of("5"));
        when(settingService.getSettingByInstituteIdAndKey(INST, "ADMIN_DISPLAY_SETTINGS"))
                .thenReturn(Map.of("learnerManagement", Map.of("allowPortalAccess", true)));
        assertFalse(service.canDelete(USER, INST));
    }

    @Test
    @DisplayName("an admin reads the admin card; a custom role reads its own card; a teacher the teacher card")
    void permissionFollowsTheRoleCard() {
        admin(true);
        assertTrue(service.canDelete(USER, INST));

        roles("u2", Set.of("MENTOR"), Set.of("role-9"));
        when(settingService.getSettingByInstituteIdAndKey(INST, "ROLE_DISPLAY_SETTINGS"))
                .thenReturn(Map.of("role-9", Map.of("learnerManagement", Map.of("allowDeletePayments", true))));
        assertTrue(service.canDelete("u2", INST));

        roles("u3", Set.of("TEACHER"), Set.of("role-1"));
        when(settingService.getSettingByInstituteIdAndKey(INST, "TEACHER_DISPLAY_SETTINGS"))
                .thenReturn(Map.of("learnerManagement", Map.of("allowDeletePayments", false)));
        assertFalse(service.canDelete("u3", INST));
    }

    @Test
    @DisplayName("a custom-role card decides for its holders, exactly as the app does — the teacher card is not consulted")
    void customCardOverridesTeacherCard() {
        roles("u4", Set.of("MENTOR"), Set.of("role-7"));
        when(settingService.getSettingByInstituteIdAndKey(INST, "ROLE_DISPLAY_SETTINGS"))
                .thenReturn(Map.of("role-7", Map.of("learnerManagement", Map.of("allowDeletePayments", false))));
        when(settingService.getSettingByInstituteIdAndKey(INST, "TEACHER_DISPLAY_SETTINGS"))
                .thenReturn(Map.of("learnerManagement", Map.of("allowDeletePayments", true)));
        assertFalse(service.canDelete("u4", INST));
    }

    @Test
    @DisplayName("fails closed when auth_service cannot say who the caller is")
    void failsClosed() {
        when(roleClient.findRolesOfUser(INST, USER)).thenReturn(Optional.empty());
        when(settingService.getSettingByInstituteIdAndKey(INST, "ADMIN_DISPLAY_SETTINGS"))
                .thenReturn(Map.of("learnerManagement", Map.of("allowDeletePayments", true)));
        assertFalse(service.canDelete(USER, INST));
        assertFalse(service.canDelete(null, INST));

        roles("u5", Set.of("MENTOR"), Set.of());
        when(roleClient.findRoleIdsOfUser(INST, "u5")).thenReturn(Optional.empty());
        assertFalse(service.canDelete("u5", INST));
    }

    @Test
    @DisplayName("regression: roles come from auth_service, not admin_core's own DB (which has no user_role table)")
    void adminWithSwitchOnIsAllowed() {
        admin(true);
        assertTrue(service.canDelete(USER, INST));
        verify(roleClient).findRolesOfUser(INST, USER);
    }

    // ------------------------------------------------------------------ refusals are logged

    @Test
    @DisplayName("turned off: nothing is touched and a DELETE_BLOCKED row (403) records who tried")
    void blockedWhenTurnedOff() {
        admin(false);
        payment("MANUAL", "PAID");

        assertThrows(VacademyException.class, () -> service.deletePayment("pl-1", INST, USER));

        verify(voidService, never()).voidPayment(anyString(), anyString(), any(), any());
        assertTrue(executedSql.isEmpty());
        AdminActivityLog row = blockedRow();
        assertEquals("DELETE_BLOCKED", row.getAction());
        assertEquals("PAYMENT", row.getEntityType());
        assertEquals("pl-1", row.getEntityId());
        assertEquals(INST, row.getInstituteId());
        assertEquals(USER, row.getActorId());
        assertEquals(403, row.getResponseStatus());
    }

    @Test
    @DisplayName("a gateway payment is refused and the refusal is logged (400)")
    void gatewayPaymentRefused() {
        admin(true);
        payment("RAZORPAY", "PAID");

        assertThrows(VacademyException.class, () -> service.deletePayment("pl-1", INST, USER));

        assertTrue(executedSql.isEmpty());
        AdminActivityLog row = blockedRow();
        assertEquals(400, row.getResponseStatus());
        assertTrue(row.getDescription().contains("refunded through the payment gateway"));
    }

    @Test
    @DisplayName("an invoice with a live payment against it is refused")
    void paidInvoiceRefused() {
        admin(true);
        Invoice invoice = new Invoice();
        invoice.setId("inv-1");
        invoice.setInstituteId(INST);
        invoice.setSource("ADMIN_MANUAL");
        when(invoiceRepository.findById("inv-1")).thenReturn(Optional.of(invoice));
        PaymentLog paid = new PaymentLog();
        paid.setId("pl-9");
        paid.setPaymentStatus("PAID");
        InvoicePaymentLogMapping mapping = new InvoicePaymentLogMapping();
        mapping.setInvoice(invoice);
        mapping.setPaymentLog(paid);
        when(mappingRepository.findByInvoiceId("inv-1")).thenReturn(List.of(mapping));

        assertThrows(VacademyException.class, () -> service.deleteInvoice("inv-1", INST, USER));

        assertTrue(executedSql.isEmpty());
        assertEquals("INVOICE", blockedRow().getEntityType());
    }

    @Test
    @DisplayName("an invoice with a checkout still in progress is refused (its webhook could still land)")
    void pendingCheckoutRefused() {
        admin(true);
        Invoice invoice = new Invoice();
        invoice.setId("inv-2");
        invoice.setInstituteId(INST);
        invoice.setSource("ADMIN_MANUAL");
        invoice.setStatus("PENDING_PAYMENT");
        when(invoiceRepository.findById("inv-2")).thenReturn(Optional.of(invoice));
        PaymentLog pending = new PaymentLog();
        pending.setId("pl-8");
        pending.setPaymentStatus("PAYMENT_PENDING");
        InvoicePaymentLogMapping mapping = new InvoicePaymentLogMapping();
        mapping.setInvoice(invoice);
        mapping.setPaymentLog(pending);
        when(mappingRepository.findByInvoiceId("inv-2")).thenReturn(List.of(mapping));

        assertThrows(VacademyException.class, () -> service.deleteInvoice("inv-2", INST, USER));
        assertTrue(executedSql.isEmpty());
    }

    // ------------------------------------------------------------------ deletes

    @Test
    @DisplayName("a paid offline payment is voided first, then its rows go children-first")
    void deletesPaidPayment() {
        admin(true);
        payment("MANUAL", "PAID");

        Map<String, Object> result = service.deletePayment("pl-1", INST, USER);

        verify(voidService).voidPayment(eq("pl-1"), eq(INST), anyString(), eq(USER));
        assertEquals("pl-1", result.get("payment_log_id"));
        assertEquals(5, executedSql.size());
        assertTrue(executedSql.get(0).startsWith("DELETE FROM user_account_ledger"));
        assertTrue(executedSql.get(executedSql.size() - 1).startsWith("DELETE FROM payment_log WHERE"));
        verify(auditDispatcher, never()).dispatch(any());
        // The DELETE row is written in the same transaction, with who did it and what was deleted.
        ArgumentCaptor<AdminActivityLog> row = ArgumentCaptor.forClass(AdminActivityLog.class);
        verify(activityLogRepository).save(row.capture());
        assertEquals("DELETE", row.getValue().getAction());
        assertEquals("PAYMENT", row.getValue().getEntityType());
        assertEquals(USER, row.getValue().getActorId());
        assertEquals(INST, row.getValue().getInstituteId());
        assertTrue(row.getValue().getBeforePayload().contains("\"vendor\":\"MANUAL\""));
    }

    @Test
    @DisplayName("regression: a receipt invoice with NO source is deleted with its payment (was an NPE)")
    void receiptWithNullSourceIsDeleted() {
        admin(true);
        PaymentLog pl = payment("MANUAL", "PAID");
        Invoice receipt = new Invoice();
        receipt.setId("inv-r");
        receipt.setInvoiceNumber("INV-20260609-0001");
        receipt.setInstituteId(INST);
        receipt.setSource(null); // half of production's invoices look like this
        InvoicePaymentLogMapping mapping = new InvoicePaymentLogMapping();
        mapping.setInvoice(receipt);
        mapping.setPaymentLog(pl);
        when(mappingRepository.findAllByPaymentLogId("pl-1")).thenReturn(List.of(mapping));
        when(mappingRepository.findByInvoiceId("inv-r")).thenReturn(List.of(mapping));

        Map<String, Object> result = service.deletePayment("pl-1", INST, USER);

        assertEquals(List.of("INV-20260609-0001"), result.get("invoices_deleted"));
        assertTrue(executedSql.stream().anyMatch(q -> q.startsWith("DELETE FROM invoice WHERE id")));
        assertTrue(executedSql.stream().anyMatch(q -> q.startsWith("INSERT INTO invoice_released_number")));
    }

    @Test
    @DisplayName("an already-voided payment is not voided again, only checked and removed")
    void deletesVoidedPayment() {
        admin(true);
        PaymentLog pl = payment("OFFLINE", "VOIDED");

        service.deletePayment("pl-1", INST, USER);

        verify(voidService, never()).voidPayment(anyString(), anyString(), any(), any());
        verify(voidService).assertBelongsToInstitute(pl, INST);
        assertTrue(executedSql.get(executedSql.size() - 1).startsWith("DELETE FROM payment_log WHERE"));
    }

    @Test
    @DisplayName("an unpaid admin bill goes with its own ledger obligation")
    void deletesUnpaidBill() {
        admin(true);
        Invoice invoice = new Invoice();
        invoice.setId("inv-1");
        invoice.setInstituteId(INST);
        invoice.setSource("ADMIN_MANUAL");
        invoice.setInvoiceNumber("INV-20260925-0001");
        when(invoiceRepository.findById("inv-1")).thenReturn(Optional.of(invoice));

        Map<String, Object> result = service.deleteInvoice("inv-1", INST, USER);

        assertEquals("INV-20260925-0001", result.get("invoice_number"));
        assertTrue(executedSql.get(0).contains("source_type = 'ADMIN_INVOICE'"));
        assertTrue(executedSql.get(executedSql.size() - 1).startsWith("DELETE FROM invoice WHERE"));
        // Its number is released for re-issue before the row goes.
        assertTrue(executedSql.stream().anyMatch(q -> q.startsWith("INSERT INTO invoice_released_number")));
        ArgumentCaptor<AdminActivityLog> row = ArgumentCaptor.forClass(AdminActivityLog.class);
        verify(activityLogRepository).save(row.capture());
        assertEquals("INVOICE", row.getValue().getEntityType());
        assertTrue(row.getValue().getDescription().contains("INV-20260925-0001"));
    }
}
