package vacademy.io.admin_core_service.features.credits.service;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import vacademy.io.admin_core_service.features.credits.util.TaxResolver;
import vacademy.io.admin_core_service.features.platform_billing.entity.PlatformBillingProfile;
import vacademy.io.admin_core_service.features.platform_billing.repository.PlatformBillingProfileRepository;
import vacademy.io.common.institute.entity.Institute;

import java.util.HashMap;
import java.util.Map;
import java.util.Optional;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.*;

/** F4: the buyer's GST identity lives in platform_billing_profile; institutes is read-only fallback. */
class PlatformBillingProfileServiceTest {

    private final Map<String, PlatformBillingProfile> table = new HashMap<>();
    private PlatformBillingProfileRepository repo;
    private PlatformBillingProfileService service;
    private Institute institute;

    @BeforeEach
    void setUp() {
        repo = mock(PlatformBillingProfileRepository.class);
        when(repo.findById(anyString())).thenAnswer(i -> Optional.ofNullable(table.get(i.<String>getArgument(0))));
        when(repo.save(any())).thenAnswer(i -> {
            PlatformBillingProfile p = i.getArgument(0);
            table.put(p.getInstituteId(), p);
            return p;
        });
        service = new PlatformBillingProfileService(repo);
        institute = spy(new Institute());
        institute.setId("inst-1");
        institute.setInstituteName("Shiksha Nation");
        institute.setAddress("12 MG Road");
        institute.setCity("Indore");
        institute.setEmail("office@shiksha.test");
    }

    @Test
    void withoutAProfileTheLegacyInstituteValuesAreUsedReadOnly() {
        institute.setGstin("23AAYFV8247N1Z3");
        institute.setStateCode("23");

        PlatformBillingProfileService.BuyerIdentity id = service.resolve(institute);

        assertEquals("Shiksha Nation", id.legalName());
        assertEquals("23AAYFV8247N1Z3", id.gstin());
        assertEquals("23", id.stateCode());
        assertEquals("12 MG Road, Indore", id.address());
        assertEquals("office@shiksha.test", id.billingEmail());
        verify(repo, never()).save(any());
    }

    @Test
    void orderFieldsWriteTheProfileAndNeverTheInstitute() {
        clearInvocations(institute);

        service.applyOrderFields(institute, "29abcde1234f1z5", null, "u1");

        PlatformBillingProfile p = table.get("inst-1");
        assertEquals("29ABCDE1234F1Z5", p.getGstin());
        assertEquals("29", p.getStateCode(), "state from the GSTIN prefix");
        assertEquals("u1", p.getUpdatedBy());
        verify(institute, never()).setGstin(any());
        verify(institute, never()).setStateCode(any());
        verify(institute, never()).setState(any());
        assertNull(institute.getGstin());
    }

    @Test
    void blankFieldsLeaveTheStoredProfileAlone() {
        assertNull(service.applyOrderFields(institute, null, null, "u1"));
        assertNull(service.applyOrderFields(institute, " ", "", "u1"));
        verify(repo, never()).save(any());
    }

    @Test
    void anExplicitEmptyGstinMakesTheBuyerUnregisteredInThatState() {
        service.applyOrderFields(institute, "29ABCDE1234F1Z5", null, "u1");
        service.applyOrderFields(institute, "", "27", "u1");
        assertNull(table.get("inst-1").getGstin());
        assertEquals("27", table.get("inst-1").getStateCode());
    }

    @Test
    void theFirstWriteKeepsTheLegacyGstinAndRejectsAStateThatContradictsIt() {
        institute.setGstin("23AAYFV8247N1Z3");
        institute.setStateCode("23");
        assertThrows(TaxResolver.TaxException.class, () -> service.applyOrderFields(institute, null, "27", "u1"));

        service.applyOrderFields(institute, null, "23", "u1");
        assertEquals("23AAYFV8247N1Z3", table.get("inst-1").getGstin());
    }

    @Test
    void invalidInputIsRefused() {
        assertThrows(TaxResolver.TaxException.class, () -> service.applyOrderFields(institute, "BADGSTIN", null, "u"));
        assertThrows(TaxResolver.TaxException.class, () -> service.applyOrderFields(institute, null, "99", "u"));
        assertThrows(TaxResolver.TaxException.class,
                () -> service.applyOrderFields(institute, "29ABCDE1234F1Z5", "27", "u"));
    }

    @Test
    void profileFieldsWinOverTheInstitute() {
        institute.setGstin("23AAYFV8247N1Z3");
        service.upsert("inst-1", "Shiksha Nation Pvt Ltd", null, "27", "Mumbai", "accounts@shiksha.test", "u1");

        PlatformBillingProfileService.BuyerIdentity id = service.resolve(institute);

        assertEquals("Shiksha Nation Pvt Ltd", id.legalName());
        assertNull(id.gstin(), "the profile says unregistered");
        assertEquals("27", id.stateCode());
        assertEquals("Mumbai", id.address());
        assertEquals("accounts@shiksha.test", id.billingEmail());
    }
}
