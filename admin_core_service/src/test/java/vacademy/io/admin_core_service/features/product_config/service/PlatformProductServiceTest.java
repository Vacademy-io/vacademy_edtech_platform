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
}
