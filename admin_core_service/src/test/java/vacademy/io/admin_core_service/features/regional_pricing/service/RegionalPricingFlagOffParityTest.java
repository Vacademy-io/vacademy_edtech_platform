package vacademy.io.admin_core_service.features.regional_pricing.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import vacademy.io.admin_core_service.features.enroll_invite.dto.EnrollInviteDTO;
import vacademy.io.admin_core_service.features.enroll_invite.dto.PackageSessionToPaymentOptionDTO;
import vacademy.io.admin_core_service.features.regional_pricing.repository.PaymentPlanRegionalPriceRepository;
import vacademy.io.admin_core_service.features.user_subscription.dto.PaymentOptionDTO;
import vacademy.io.admin_core_service.features.user_subscription.dto.PaymentPlanDTO;
import vacademy.io.admin_core_service.features.user_subscription.entity.PaymentOption;
import vacademy.io.admin_core_service.features.user_subscription.entity.PaymentPlan;
import vacademy.io.admin_core_service.features.user_subscription.repository.PaymentOptionRepository;

import java.util.List;
import java.util.Optional;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

/**
 * Until an admin switches regional pricing on for an option, everything must behave exactly
 * as it did before the feature existed: no regional price is ever looked up, and the public
 * payloads go out byte-for-byte unchanged, even for a viewer abroad and even when a lookup fails.
 */
class RegionalPricingFlagOffParityTest {

    private PaymentPlanRegionalPriceRepository regionalPriceRepository;
    private PaymentOptionRepository paymentOptionRepository;
    private ViewerCountryResolver viewerCountryResolver;
    private RegionalPriceResolver resolver;
    private final ObjectMapper json = new ObjectMapper();

    @BeforeEach
    void setUp() {
        regionalPriceRepository = mock(PaymentPlanRegionalPriceRepository.class);
        paymentOptionRepository = mock(PaymentOptionRepository.class);
        viewerCountryResolver = mock(ViewerCountryResolver.class);
        // A viewer in the US: the case where a regional price WOULD apply if the flag were on.
        when(viewerCountryResolver.currentCountry()).thenReturn(Optional.of("US"));
        resolver = new RegionalPriceResolver(regionalPriceRepository, paymentOptionRepository,
                viewerCountryResolver, json);
    }

    private static PaymentOption option(boolean regionalOn) {
        PaymentOption o = new PaymentOption();
        o.setId("opt-1");
        o.setType("ONE_TIME");
        o.setRegionalPricingEnabled(regionalOn);
        return o;
    }

    private static PaymentPlan plan(PaymentOption option) {
        PaymentPlan p = new PaymentPlan();
        p.setId("plan-1");
        p.setActualPrice(999);
        p.setElevatedPrice(1499);
        p.setCurrency("INR");
        p.setPaymentOption(option);
        return p;
    }

    private static EnrollInviteDTO invite() {
        PaymentPlanDTO planDto = PaymentPlanDTO.builder().id("plan-1").actualPrice(999d).elevatedPrice(1499d)
                .currency("INR").build();
        PaymentOptionDTO optionDto = PaymentOptionDTO.builder().id("opt-1").type("ONE_TIME")
                .paymentPlans(List.of(planDto)).build();
        EnrollInviteDTO invite = new EnrollInviteDTO();
        invite.setId("inv-1");
        invite.setCurrency("INR");
        invite.setVendor("RAZORPAY");
        invite.setPackageSessionToPaymentOptions(List.of(
                PackageSessionToPaymentOptionDTO.builder().id("b-1").paymentOption(optionDto).build()));
        return invite;
    }

    @Test
    void checkoutQuoteIsEmptyAndTouchesNoRegionalDataWhileTheFlagIsOff() {
        assertTrue(resolver.quote(plan(option(false)), "RAZORPAY").isEmpty());
        assertTrue(resolver.quote(plan(option(false)), "US", "STRIPE").isEmpty());
        verifyNoInteractions(regionalPriceRepository);
        // The viewer's country (an IP lookup) is not even worked out for an option that is off.
        verifyNoInteractions(viewerCountryResolver);
    }

    @Test
    void inviteCarryingTheSwitchOffIsLeftAloneWithoutAnyLookup() throws Exception {
        EnrollInviteDTO dto = invite();
        dto.getPackageSessionToPaymentOptions().get(0).getPaymentOption().setRegionalPricingEnabled(false);
        String before = json.writeValueAsString(dto);

        resolver.localize(dto);

        assertEquals(before, json.writeValueAsString(dto));
        verifyNoInteractions(paymentOptionRepository, regionalPriceRepository, viewerCountryResolver);
    }

    @Test
    void optionCreatedBeforeTheFeatureCountsAsOff() {
        PaymentOption legacy = option(false);
        legacy.setRegionalPricingEnabled(null);
        assertTrue(resolver.quote(plan(legacy), "US", null).isEmpty());
        verifyNoInteractions(regionalPriceRepository);
    }

    @Test
    void publicInvitePayloadIsUnchangedWhileTheFlagIsOff() throws Exception {
        when(paymentOptionRepository.findAllById(any())).thenReturn(List.of(option(false)));
        EnrollInviteDTO dto = invite();
        String before = json.writeValueAsString(dto);

        resolver.localize(dto);

        assertEquals(before, json.writeValueAsString(dto));
        verifyNoInteractions(regionalPriceRepository);
    }

    @Test
    void aFailingLookupNeverBreaksThePublicInvitePage() throws Exception {
        when(paymentOptionRepository.findAllById(any())).thenThrow(new RuntimeException("db down"));
        EnrollInviteDTO dto = invite();
        String before = json.writeValueAsString(dto);

        resolver.localize(dto); // must not throw

        assertEquals(before, json.writeValueAsString(dto));
    }

    @Test
    void enabledOptionButUnknownViewerCountryKeepsTheBasePrice() throws Exception {
        when(viewerCountryResolver.currentCountry()).thenReturn(Optional.empty());
        EnrollInviteDTO dto = invite();
        dto.getPackageSessionToPaymentOptions().get(0).getPaymentOption().setRegionalPricingEnabled(true);
        String before = json.writeValueAsString(dto);

        resolver.localize(dto);

        assertEquals(before, json.writeValueAsString(dto));
        verifyNoInteractions(paymentOptionRepository, regionalPriceRepository);
    }
}
