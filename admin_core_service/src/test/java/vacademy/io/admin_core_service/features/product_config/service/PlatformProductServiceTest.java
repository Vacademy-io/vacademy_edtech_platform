package vacademy.io.admin_core_service.features.product_config.service;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowMapper;
import vacademy.io.common.exceptions.VacademyException;
import vacademy.io.admin_core_service.features.product_config.dto.ProductSettingsDTO;
import vacademy.io.common.product.ProductConfigDTO;

import java.util.List;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.*;

@ExtendWith(MockitoExtension.class)
class PlatformProductServiceTest {

    @Mock JdbcTemplate jdbcTemplate;
    @InjectMocks PlatformProductService service;

    private ProductSettingsDTO valid() {
        return ProductSettingsDTO.builder().displayName("Evalezy").fromEmail("Support@Evalezy.com").fromName("Evalezy")
                .appPath("/evalezy").trialDays(5).selfSignupEnabled(true).returnHosts("vacademy.io, evalezy.com")
                .themeColor("#D61C28").websiteUrl("https://evalezy.com").build();
    }

    @Test
    @SuppressWarnings("unchecked")
    void savesToTheProductsSettingsRowWithWhoChangedIt() {
        when(jdbcTemplate.update(anyString(), anyString(), anyString(), anyString())).thenReturn(1);
        when(jdbcTemplate.query(anyString(), any(RowMapper.class), eq("product.evalezy"))).thenReturn(List.of(valid()));
        service.update("evalezy", valid(), "admin1");
        ArgumentCaptor<String> json = ArgumentCaptor.forClass(String.class);
        verify(jdbcTemplate).update(contains("ai_platform_settings"), json.capture(), eq("admin1"), eq("product.evalezy"));
        assertTrue(json.getValue().contains("\"from_email\":\"support@evalezy.com\""), json.getValue());
        assertTrue(json.getValue().contains("\"trial_days\":5"), json.getValue());
    }

    @Test
    @SuppressWarnings("unchecked")
    void anUnknownProductIsNotCreated() {
        when(jdbcTemplate.query(anyString(), any(RowMapper.class), anyString())).thenReturn(List.of());
        assertThrows(VacademyException.class, () -> service.update("nope", valid(), "a"));
    }

    @Test
    @SuppressWarnings("unchecked")
    void newFieldsSaveAndAFieldLeftOutIsKept() {
        when(jdbcTemplate.update(anyString(), anyString(), anyString(), anyString())).thenReturn(1);
        ProductSettingsDTO stored = valid();
        stored.setDemoCredits(50);
        stored.setSignupAlertEmails("team@example.com");
        when(jdbcTemplate.query(anyString(), any(RowMapper.class), eq("product.evalezy"))).thenReturn(List.of(stored));
        ProductSettingsDTO body = valid();
        body.setSignupAlertWhatsapp("+91 98765-43210, 919000000000");
        service.update("evalezy", body, "admin1");
        ArgumentCaptor<String> json = ArgumentCaptor.forClass(String.class);
        verify(jdbcTemplate).update(contains("ai_platform_settings"), json.capture(), eq("admin1"), eq("product.evalezy"));
        assertTrue(json.getValue().contains("\"demo_credits\":50"), json.getValue());
        assertTrue(json.getValue().contains("\"signup_alert_emails\":\"team@example.com\""), json.getValue());
        assertTrue(json.getValue().contains("\"signup_alert_whatsapp\":\"919876543210,919000000000\""), json.getValue());
    }

    @Test
    void badAlertSettingsAreRefused() {
        ProductSettingsDTO credits = valid();
        credits.setDemoCredits(-1);
        assertThrows(VacademyException.class, () -> PlatformProductService.validate(credits));
        ProductSettingsDTO email = valid();
        email.setSignupAlertEmails("ok@example.com, not-an-email");
        assertThrows(VacademyException.class, () -> PlatformProductService.validate(email));
        ProductSettingsDTO phone = valid();
        phone.setSignupAlertWhatsapp("12345");
        assertThrows(VacademyException.class, () -> PlatformProductService.validate(phone));
        ProductSettingsDTO template = valid();
        template.setSignupAlertTemplate("Bad Name");
        assertThrows(VacademyException.class, () -> PlatformProductService.validate(template));
    }

    @Test
    @SuppressWarnings("unchecked")
    void vacademyNeverReadsDemoCredits() {
        assertNull(service.demoCreditsFor("vacademy"));
        assertNull(service.demoCreditsFor(null));
        verify(jdbcTemplate, never()).query(anyString(), any(RowMapper.class), anyString());
    }

    @Test
    void badValuesAreRefused() {
        ProductSettingsDTO b = valid();
        b.setFromEmail("Evil <a@b.com>");
        assertThrows(VacademyException.class, () -> PlatformProductService.validate(b));
        ProductSettingsDTO header = valid();
        header.setFromName("x\r\nBcc: a@b.com");
        assertThrows(VacademyException.class, () -> PlatformProductService.validate(header));
        ProductSettingsDTO days = valid();
        days.setTrialDays(-1);
        assertThrows(VacademyException.class, () -> PlatformProductService.validate(days));
        ProductSettingsDTO hosts = valid();
        hosts.setReturnHosts("https://evil.com/x");
        assertThrows(VacademyException.class, () -> PlatformProductService.validate(hosts));
    }

    @Test
    void aSubdomainIsAllowedButALookalikeIsNot() {
        ProductConfigDTO p = ProductConfigDTO.builder().returnHosts("vacademy.io, evalezy.com").build();
        assertTrue(p.allowsReturnTo("dash.vacademy.io"));
        assertTrue(p.allowsReturnTo("evalezy.com"));
        assertFalse(p.allowsReturnTo("evilvacademy.io"));
        assertFalse(p.allowsReturnTo("evalezy.com.evil.io"));
    }

    @Test
    @SuppressWarnings("unchecked")
    void publicOfferCarriesOnlyTheTrialFields() {
        ProductSettingsDTO stored = valid();
        stored.setProductKey("evalezy");
        stored.setDemoCredits(50);
        stored.setTrialDays(3);
        stored.setSignupAlertEmails("team@example.com");
        stored.setSignupAlertWhatsapp("919876543210");
        when(jdbcTemplate.query(anyString(), any(RowMapper.class), eq("product.evalezy"))).thenReturn(List.of(stored));
        var offer = service.publicOffer("Evalezy");
        assertEquals("evalezy", offer.getProduct());
        assertEquals(50, offer.getDemoCredits());
        assertEquals(3, offer.getTrialDays());
        assertTrue(offer.getSelfSignupEnabled());
        String json = assertDoesNotThrow(() -> new com.fasterxml.jackson.databind.ObjectMapper().writeValueAsString(offer));
        assertFalse(json.contains("team@example.com") || json.contains("919876543210") || json.contains("from_email"), json);
        assertTrue(json.contains("\"demo_credits\":50") && json.contains("\"trial_days\":3"), json);
    }

    @Test
    void publicOfferRefusesOddKeysWithoutAQuery() {
        assertThrows(VacademyException.class, () -> service.publicOffer("../x"));
        assertThrows(VacademyException.class, () -> service.publicOffer("a b"));
        verifyNoInteractions(jdbcTemplate);
    }

    private static List<vacademy.io.admin_core_service.features.product_config.dto.ProductPlanDTO> twoPlans() {
        var b = vacademy.io.admin_core_service.features.product_config.dto.ProductPlanDTO.builder();
        return List.of(b.key("starter").name("Starter").priceInr(5000).credits(100).users(1).build(),
                vacademy.io.admin_core_service.features.product_config.dto.ProductPlanDTO.builder()
                        .key("team").name("Team").priceInr(20000).credits(2000).users(15).build());
    }

    @Test
    @SuppressWarnings("unchecked")
    void plansSaveAndAnOlderDashboardKeepsThem() {
        when(jdbcTemplate.update(anyString(), anyString(), anyString(), anyString())).thenReturn(1);
        ProductSettingsDTO stored = valid();
        stored.setPlans(twoPlans());
        stored.setPlanValidityMonths(12);
        stored.setExtraCreditPriceInr(java.math.BigDecimal.ONE);
        when(jdbcTemplate.query(anyString(), any(RowMapper.class), eq("product.evalezy"))).thenReturn(List.of(stored));
        ProductSettingsDTO withPlans = valid();
        var sent = twoPlans();
        sent.get(0).setName("  Starter ");
        withPlans.setPlans(sent);
        service.update("evalezy", withPlans, "admin1");
        service.update("evalezy", valid(), "admin1");
        ArgumentCaptor<String> json = ArgumentCaptor.forClass(String.class);
        verify(jdbcTemplate, times(2)).update(contains("ai_platform_settings"), json.capture(), eq("admin1"), eq("product.evalezy"));
        for (String saved : json.getAllValues()) {
            assertTrue(saved.contains("{\"key\":\"starter\",\"name\":\"Starter\",\"price_inr\":5000,\"credits\":100,\"users\":1}"), saved);
            assertTrue(saved.contains("\"credits\":2000,\"users\":15"), saved);
            assertTrue(saved.contains("\"plan_validity_months\":12") && saved.contains("\"extra_credit_price_inr\":1"), saved);
        }
    }

    @Test
    void badPlansAreRefused() {
        ProductSettingsDTO dup = valid();
        dup.setPlans(List.of(twoPlans().get(0), twoPlans().get(0)));
        assertThrows(VacademyException.class, () -> PlatformProductService.validate(dup));
        ProductSettingsDTO noUsers = valid();
        var p = twoPlans().get(1);
        p.setUsers(0);
        noUsers.setPlans(List.of(p));
        assertThrows(VacademyException.class, () -> PlatformProductService.validate(noUsers));
        ProductSettingsDTO badKey = valid();
        var k = twoPlans().get(0);
        k.setKey("Starter Plan");
        badKey.setPlans(List.of(k));
        assertThrows(VacademyException.class, () -> PlatformProductService.validate(badKey));
        ProductSettingsDTO months = valid();
        months.setPlanValidityMonths(0);
        assertThrows(VacademyException.class, () -> PlatformProductService.validate(months));
        ProductSettingsDTO ok = valid();
        ok.setPlans(twoPlans());
        ok.setPlanValidityMonths(12);
        ok.setExtraCreditPriceInr(java.math.BigDecimal.ONE);
        assertDoesNotThrow(() -> PlatformProductService.validate(ok));
    }

    @Test
    @SuppressWarnings("unchecked")
    void publicOfferCarriesThePlans() {
        ProductSettingsDTO stored = valid();
        stored.setProductKey("evalezy");
        stored.setPlans(twoPlans());
        stored.setPlanValidityMonths(12);
        stored.setExtraCreditPriceInr(java.math.BigDecimal.ONE);
        when(jdbcTemplate.query(anyString(), any(RowMapper.class), eq("product.evalezy"))).thenReturn(List.of(stored));
        var offer = service.publicOffer("evalezy");
        assertEquals(2, offer.getPlans().size());
        assertEquals(2000, offer.getPlans().get(1).getCredits());
        assertEquals(12, offer.getPlanValidityMonths());
    }
}
