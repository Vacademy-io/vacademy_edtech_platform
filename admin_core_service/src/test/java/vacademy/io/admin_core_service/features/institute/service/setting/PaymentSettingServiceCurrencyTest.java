package vacademy.io.admin_core_service.features.institute.service.setting;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import vacademy.io.admin_core_service.features.institute.repository.InstituteRepository;
import vacademy.io.common.institute.entity.Institute;

import java.util.Optional;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

class PaymentSettingServiceCurrencyTest {

    private static final String INST = "inst-1";

    private InstituteRepository instituteRepository;
    private PaymentSettingService service;

    @BeforeEach
    void setUp() {
        instituteRepository = mock(InstituteRepository.class);
        service = new PaymentSettingService(instituteRepository, new ObjectMapper());
    }

    private void withSetting(String settingJson) {
        Institute institute = new Institute();
        institute.setId(INST);
        institute.setSetting(settingJson);
        when(instituteRepository.findById(INST)).thenReturn(Optional.of(institute));
    }

    @Test
    @DisplayName("reads PAYMENT_SETTING.data.defaultCurrency, upper-cased")
    void readsDefaultCurrency() {
        withSetting("{\"setting\":{\"PAYMENT_SETTING\":{\"data\":{\"defaultCurrency\":\" aud \"}}}}");
        assertEquals("AUD", service.getDefaultCurrency(INST));
    }

    @Test
    @DisplayName("no PAYMENT_SETTING, or a non-code value, means no default")
    void missingOrInvalidDefault() {
        withSetting("{\"setting\":{\"INVOICE_SETTING\":{\"data\":{\"currency\":\"INR\"}}}}");
        assertNull(service.getDefaultCurrency(INST));
        withSetting("{\"setting\":{\"PAYMENT_SETTING\":{\"data\":{\"defaultCurrency\":\"$\"}}}}");
        assertNull(service.getDefaultCurrency(INST));
        assertNull(service.getDefaultCurrency(null));
    }

    @Test
    @DisplayName("a real candidate currency always beats the institute default")
    void candidateWins() {
        withSetting("{\"setting\":{\"PAYMENT_SETTING\":{\"data\":{\"defaultCurrency\":\"AUD\"}}}}");
        assertEquals("GBP", service.resolveCurrency(INST, null, " ", "N/A", "#", "gbp", "USD"));
    }

    @Test
    @DisplayName("with no usable candidate: institute default, else INR")
    void fallsBackToInstituteThenInr() {
        withSetting("{\"setting\":{\"PAYMENT_SETTING\":{\"data\":{\"defaultCurrency\":\"AUD\"}}}}");
        assertEquals("AUD", service.resolveCurrency(INST, null, ""));
        withSetting("{\"setting\":{}}");
        assertEquals("INR", service.resolveCurrency(INST));
        when(instituteRepository.findById(INST)).thenReturn(Optional.empty());
        assertEquals("INR", service.resolveCurrency(INST, (String) null));
    }
}
