package vacademy.io.admin_core_service.features.credits.controller;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import vacademy.io.admin_core_service.core.security.InstituteAccessValidator;
import vacademy.io.admin_core_service.features.credits.dto.CreditPackPurchaseRequestDTO;
import vacademy.io.admin_core_service.features.credits.service.CreditPackService;
import vacademy.io.admin_core_service.features.platform_billing.entity.PlatformInvoice;
import vacademy.io.admin_core_service.features.platform_billing.entity.PlatformPayment;
import vacademy.io.admin_core_service.features.platform_billing.repository.PlatformInvoiceRepository;
import vacademy.io.admin_core_service.features.platform_billing.repository.PlatformPaymentRepository;
import vacademy.io.admin_core_service.features.platform_billing.service.PlatformInvoicePdfService;
import vacademy.io.common.auth.model.CustomUserDetails;
import vacademy.io.common.exceptions.ForbiddenException;

import java.util.Optional;

import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.*;

/**
 * The credit-pack endpoints must never use validateUserAccess: its root-user bypass
 * admits learners (who are root users) for any institute. Billing endpoints need an
 * institute ADMIN, listing packs needs staff, and a refusal must stop before the service.
 */
@ExtendWith(MockitoExtension.class)
class CreditPackControllerAccessTest {

    private static final String INST = "inst-1";

    @Mock private CreditPackService creditPackService;
    @Mock private InstituteAccessValidator validator;
    @Mock private PlatformPaymentRepository platformPaymentRepository;
    @Mock private PlatformInvoiceRepository platformInvoiceRepository;
    @Mock private PlatformInvoicePdfService platformInvoicePdfService;
    @Mock private CustomUserDetails user;

    @InjectMocks private CreditPackController controller;

    @Test
    void listingPacksNeedsStaffWithoutRootBypass() {
        controller.listPacks(user, INST);
        verify(validator).requireInstituteStaff(user, INST);
        verify(validator, never()).validateUserAccess(any(), any());
    }

    @Test
    void billingProfileAndInvoicesNeedAdmin() {
        controller.getBillingProfile(user, INST);
        controller.listInvoices(user, INST);
        verify(validator, times(2)).requireInstituteAdmin(user, INST);
        verify(validator, never()).validateUserAccess(any(), any());
    }

    @Test
    void invoicePdfAndOrderStatusNeedAdminOfTheOwningInstitute() {
        PlatformInvoice invoice = new PlatformInvoice();
        invoice.setBuyerInstituteId(INST);
        when(platformInvoiceRepository.findById("inv-1")).thenReturn(Optional.of(invoice));
        doThrow(new ForbiddenException("no")).when(validator).requireInstituteAdmin(user, INST);
        assertThrows(ForbiddenException.class, () -> controller.downloadInvoicePdf(user, "inv-1"));
        verify(platformInvoicePdfService, never()).renderPdf(any(PlatformInvoice.class));

        PlatformPayment payment = new PlatformPayment();
        payment.setInstituteId(INST);
        when(platformPaymentRepository.findById("pp-1")).thenReturn(Optional.of(payment));
        assertThrows(ForbiddenException.class, () -> controller.getOrderStatus(user, "pp-1"));
        verify(creditPackService, never()).getOrderStatus(any());
    }

    @Test
    void purchaseRefusedForNonAdminNeverCreatesAnOrderOrTouchesGstin() {
        CreditPackPurchaseRequestDTO request = new CreditPackPurchaseRequestDTO();
        request.setInstituteId(INST);
        request.setPackId("pack-1");
        request.setBuyerGstin("23AAAAA0000A1Z5");
        doThrow(new ForbiddenException("no")).when(validator).requireInstituteAdmin(user, INST);
        assertThrows(ForbiddenException.class, () -> controller.purchase(user, request));
        verifyNoInteractions(creditPackService);
    }
}
