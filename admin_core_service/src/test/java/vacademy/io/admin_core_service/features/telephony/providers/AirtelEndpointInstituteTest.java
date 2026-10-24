package vacademy.io.admin_core_service.features.telephony.providers;

import org.junit.jupiter.api.Test;
import org.springframework.test.util.ReflectionTestUtils;
import vacademy.io.admin_core_service.features.telephony.persistence.entity.TelephonyCounsellorEndpoint;
import vacademy.io.admin_core_service.features.telephony.persistence.repository.TelephonyCounsellorEndpointRepository;
import vacademy.io.admin_core_service.features.telephony.providers.airtel.AirtelOriginationResolver;
import vacademy.io.admin_core_service.features.telephony.spi.dto.OriginationContext;
import vacademy.io.common.exceptions.VacademyException;

import java.util.Optional;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

/** An Airtel extension mapped by one institute never originates a call for another. */
class AirtelEndpointInstituteTest {

    private AirtelOriginationResolver resolver(String rowInstitute) {
        TelephonyCounsellorEndpointRepository repo = mock(TelephonyCounsellorEndpointRepository.class);
        when(repo.findByCounsellorUserIdAndProviderType("u-1", "AIRTEL")).thenReturn(Optional.of(
                TelephonyCounsellorEndpoint.builder().id("ep").instituteId(rowInstitute).counsellorUserId("u-1")
                        .providerType("AIRTEL").extension("447").did("0801").enabled(true).build()));
        AirtelOriginationResolver r = new AirtelOriginationResolver();
        ReflectionTestUtils.setField(r, "endpointRepo", repo);
        return r;
    }

    private static OriginationContext ctx(String institute) {
        return OriginationContext.builder().instituteId(institute).providerType("AIRTEL").counsellorUserId("u-1")
                .leadPhone("+919876543210").build();
    }

    @Test
    void sameInstituteDialsFromTheExtension() {
        AirtelOriginationResolver r = resolver("inst-1");
        assertTrue(r.callerBlockedReason("inst-1", "u-1").isEmpty());
        assertEquals("447", r.resolve(ctx("inst-1")).getFrom());
    }

    @Test
    void anotherInstitutesExtensionIsNotUsed() {
        AirtelOriginationResolver r = resolver("inst-2");
        assertTrue(r.callerBlockedReason("inst-1", "u-1").isPresent());
        assertThrows(VacademyException.class, () -> r.resolve(ctx("inst-1")));
    }
}
