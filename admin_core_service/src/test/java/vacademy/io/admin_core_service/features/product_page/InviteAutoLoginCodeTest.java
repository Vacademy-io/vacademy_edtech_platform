package vacademy.io.admin_core_service.features.product_page;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.test.util.ReflectionTestUtils;
import org.springframework.transaction.PlatformTransactionManager;
import vacademy.io.admin_core_service.features.enroll_invite.entity.EnrollInvite;
import vacademy.io.admin_core_service.features.product_page.entity.ProductPageLoginCode;
import vacademy.io.admin_core_service.features.product_page.repository.ProductPageLoginCodeRepository;
import vacademy.io.admin_core_service.features.product_page.service.ProductPageAutoLoginService;
import vacademy.io.admin_core_service.features.user_subscription.entity.PaymentLog;
import vacademy.io.admin_core_service.features.user_subscription.repository.PaymentLogRepository;
import vacademy.io.common.auth.dto.UserDTO;

import java.util.Date;
import java.util.Optional;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

/** Enroll invites reuse the product-page one-time login code behind their own setting. */
class InviteAutoLoginCodeTest {

    private static final String ON = "{\"postformfillConfiguration\":{\"autoLoginAfterPayment\":true}}";

    private ProductPageLoginCodeRepository codes;
    private PaymentLogRepository paymentLogs;
    private ProductPageAutoLoginService service;

    @BeforeEach
    void setUp() {
        codes = mock(ProductPageLoginCodeRepository.class);
        paymentLogs = mock(PaymentLogRepository.class);
        service = new ProductPageAutoLoginService(mock(PlatformTransactionManager.class));
        ReflectionTestUtils.setField(service, "loginCodeRepository", codes);
        ReflectionTestUtils.setField(service, "paymentLogRepository", paymentLogs);
    }

    private static EnrollInvite invite(String settingJson) {
        EnrollInvite invite = new EnrollInvite();
        invite.setId("inv-1");
        invite.setSettingJson(settingJson);
        return invite;
    }

    private static UserDTO user(Date lastLogin) {
        UserDTO user = new UserDTO();
        user.setId("u-1");
        user.setLastLoginTime(lastLogin);
        return user;
    }

    private void paidLogOfUser() {
        PaymentLog log = new PaymentLog();
        log.setId("pl-1");
        log.setUserId("u-1");
        log.setPaymentStatus("PAID");
        when(paymentLogs.findById("pl-1")).thenReturn(Optional.of(log));
    }

    @Test
    void settingIsReadFromPostFormFillConfiguration() {
        assertTrue(ProductPageAutoLoginService.isInviteEnabled(ON));
        assertFalse(ProductPageAutoLoginService.isInviteEnabled(null));
        assertFalse(ProductPageAutoLoginService.isInviteEnabled("{\"postformfillConfiguration\":{\"showLoginButton\":true}}"));
        assertFalse(ProductPageAutoLoginService.isInviteEnabled("{\"autoLoginAfterPayment\":true}"));
        assertFalse(ProductPageAutoLoginService.isInviteEnabled("not json"));
    }

    @Test
    void noCodeWhenInviteDoesNotAskForIt() {
        assertNull(service.issueForInvite(invite("{}"), "pl-1", user(null), "inst"));
        verifyNoInteractions(codes);
    }

    @Test
    void noCodeForAnAccountThatHasLoggedInBefore() {
        assertNull(service.issueForInvite(invite(ON), "pl-1", user(new Date()), "inst"));
        verifyNoInteractions(codes);
    }

    @Test
    void newAccountGetsAnInviteCodeRecordedWithoutAProductPage() {
        paidLogOfUser();
        when(codes.accountCreatedByCheckout(eq("u-1"), eq("pl-1"), anyInt())).thenReturn(true);

        String code = service.issueForInvite(invite(ON), "pl-1", user(null), "inst");

        assertNotNull(code);
        ArgumentCaptor<ProductPageLoginCode> saved = ArgumentCaptor.forClass(ProductPageLoginCode.class);
        verify(codes).save(saved.capture());
        assertEquals("inv-1", saved.getValue().getEnrollInviteId());
        assertNull(saved.getValue().getProductPageId());
        assertNotEquals(code, saved.getValue().getCodeHash());
    }

    @Test
    void existingAccountGetsACodeThatIsNeverRecorded() {
        paidLogOfUser();
        when(codes.accountCreatedByCheckout(eq("u-1"), eq("pl-1"), anyInt())).thenReturn(false);

        service.issueForInvite(invite(ON), "pl-1", user(null), "inst");

        verify(codes, never()).save(any());
    }
}
