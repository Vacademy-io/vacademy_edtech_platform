package vacademy.io.admin_core_service.features.product_config.service;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import vacademy.io.admin_core_service.features.product_config.entity.PlatformProduct;
import vacademy.io.admin_core_service.features.product_config.repository.PlatformProductRepository;
import vacademy.io.common.exceptions.VacademyException;
import vacademy.io.common.product.ProductConfigDTO;

import java.util.Optional;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.*;

@ExtendWith(MockitoExtension.class)
class PlatformProductServiceTest {

    @Mock PlatformProductRepository repository;
    @InjectMocks PlatformProductService service;

    private ProductConfigDTO valid() {
        return ProductConfigDTO.builder().displayName("Evalezy").fromEmail("Support@Evalezy.com").fromName("Evalezy")
                .appPath("/evalezy").trialDays(5).selfSignupEnabled(true).returnHosts("vacademy.io, evalezy.com")
                .themeColor("#D61C28").websiteUrl("https://evalezy.com").build();
    }

    @Test
    void theFromEmailIsSavedWithWhoChangedIt() {
        PlatformProduct row = new PlatformProduct();
        row.setProductKey("evalezy");
        when(repository.findById("evalezy")).thenReturn(Optional.of(row));
        when(repository.save(any())).thenAnswer(i -> i.getArgument(0));
        ProductConfigDTO saved = service.update("evalezy", valid(), "admin1");
        assertEquals("support@evalezy.com", saved.getFromEmail());
        assertEquals(5, saved.getTrialDays());
        assertEquals("admin1", saved.getUpdatedBy());
        assertNotNull(saved.getUpdatedAt());
    }

    @Test
    void anUnknownProductIsNotCreated() {
        when(repository.findById("nope")).thenReturn(Optional.empty());
        assertThrows(VacademyException.class, () -> service.update("nope", valid(), "a"));
        verify(repository, never()).save(any());
    }

    @Test
    void badValuesAreRefused() {
        ProductConfigDTO b = valid();
        b.setFromEmail("Evil <a@b.com>");
        assertThrows(VacademyException.class, () -> PlatformProductService.validate(b));
        ProductConfigDTO header = valid();
        header.setFromName("x\r\nBcc: a@b.com");
        assertThrows(VacademyException.class, () -> PlatformProductService.validate(header));
        ProductConfigDTO days = valid();
        days.setTrialDays(-1);
        assertThrows(VacademyException.class, () -> PlatformProductService.validate(days));
        ProductConfigDTO hosts = valid();
        hosts.setReturnHosts("https://evil.com/x");
        assertThrows(VacademyException.class, () -> PlatformProductService.validate(hosts));
    }

    @Test
    void aSubdomainIsAllowedButALookalikeIsNot() {
        ProductConfigDTO p = valid();
        assertTrue(p.allowsReturnTo("dash.vacademy.io"));
        assertTrue(p.allowsReturnTo("evalezy.com"));
        assertFalse(p.allowsReturnTo("evilvacademy.io"));
        assertFalse(p.allowsReturnTo("evalezy.com.evil.io"));
    }
}
