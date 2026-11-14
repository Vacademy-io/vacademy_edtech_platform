package vacademy.io.admin_core_service.features.telephony.core;

import org.junit.jupiter.api.Test;
import org.springframework.test.util.ReflectionTestUtils;
import vacademy.io.admin_core_service.features.audience.entity.AudienceResponse;
import vacademy.io.admin_core_service.features.audience.repository.AudienceResponseRepository;
import vacademy.io.admin_core_service.features.telephony.core.dto.ConnectCallRequestDTO;
import vacademy.io.admin_core_service.features.telephony.persistence.entity.InstituteTelephonyConfig;
import vacademy.io.admin_core_service.features.telephony.persistence.repository.TelephonyCallLogRepository;
import vacademy.io.admin_core_service.features.telephony.spi.OutboundOriginationResolver;
import vacademy.io.admin_core_service.features.telephony.spi.dto.OriginationPlan;
import vacademy.io.common.exceptions.VacademyException;

import java.util.List;
import java.util.Optional;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.*;

/**
 * Click-to-call loads the lead by the id the browser sends. It must be a lead of the
 * institute the call is placed in, or a counsellor could dial — and file a call under —
 * another institute's lead by its UUID.
 */
class CallLifecycleLeadOwnershipTest {

    private final AudienceResponseRepository leads = mock(AudienceResponseRepository.class);
    private final TelephonyCallLogRepository logs = mock(TelephonyCallLogRepository.class);
    private final TelephonyProviderRegistry registry = mock(TelephonyProviderRegistry.class);
    private final TelephonyConfigCache cache = mock(TelephonyConfigCache.class);
    private final OutboundOriginationResolver resolver = mock(OutboundOriginationResolver.class);
    private final CallLifecycleTxOps tx = new CallLifecycleTxOps();

    CallLifecycleLeadOwnershipTest() {
        ReflectionTestUtils.setField(tx, "callLogRepo", logs);
        ReflectionTestUtils.setField(tx, "audienceResponseRepo", leads);
        ReflectionTestUtils.setField(tx, "registry", registry);
        ReflectionTestUtils.setField(tx, "userMobileResolver", mock(UserMobileResolver.class));
        ReflectionTestUtils.setField(tx, "configCache", cache);
        InstituteTelephonyConfig cfg = InstituteTelephonyConfig.builder()
                .instituteId("inst-1").providerType("EXOTEL").enabled(true).build();
        when(cache.get("inst-1")).thenReturn(Optional.of(TelephonyConfigCache.Resolved.builder()
                .config(cfg).enabledNumbers(List.of()).build()));
        when(registry.originationResolver("EXOTEL")).thenReturn(resolver);
        when(resolver.resolve(any())).thenReturn(OriginationPlan.builder().from("+919800000001").callerId("0801").build());
        AudienceResponse lead = new AudienceResponse();
        lead.setId("lead-1");
        lead.setAudienceId("campaign-1");
        lead.setUserId("lead-user");
        lead.setParentMobile("+919876543210");
        when(leads.findById("lead-1")).thenReturn(Optional.of(lead));
    }

    private static vacademy.io.common.auth.model.CustomUserDetails counsellor() {
        vacademy.io.common.auth.dto.UserServiceDTO dto = new vacademy.io.common.auth.dto.UserServiceDTO();
        dto.setUserId("counsellor-1");
        dto.setUsername("counsellor-1");
        dto.setAuthorities(java.util.List.of("TEACHER"));
        return new vacademy.io.common.auth.model.CustomUserDetails(dto);
    }

    private static ConnectCallRequestDTO req() {
        ConnectCallRequestDTO r = new ConnectCallRequestDTO();
        r.setInstituteId("inst-1");
        r.setResponseId("lead-1");
        return r;
    }

    @Test
    void anotherInstitutesLeadIsNotFound() {
        when(leads.isLeadInInstitute("lead-1", "inst-1")).thenReturn(false);
        VacademyException e = assertThrows(VacademyException.class,
                () -> tx.prepareAndPersist("inst-1", req(), counsellor()));
        assertEquals("Lead not found", e.getMessage());
        verifyNoInteractions(logs, resolver);
    }

    private AudienceResponse admissionLead(String applicantId) {
        // Admission / application leads have no campaign (audience_id NULL).
        AudienceResponse lead = new AudienceResponse();
        lead.setId("lead-2");
        lead.setUserId("parent-user");
        lead.setParentMobile("+919811111111");
        lead.setApplicantId(applicantId);
        when(leads.findById("lead-2")).thenReturn(Optional.of(lead));
        return lead;
    }

    private static ConnectCallRequestDTO reqFor(String responseId) {
        ConnectCallRequestDTO r = new ConnectCallRequestDTO();
        r.setInstituteId("inst-1");
        r.setResponseId(responseId);
        return r;
    }

    @Test
    void anAdmissionLeadOfThisInstituteIsDialled() {
        admissionLead("7b1d0c2e-1111-2222-3333-444455556666");
        when(leads.isApplicantLeadInInstitute("lead-2", "inst-1")).thenReturn(true);
        CallOrchestrator.Prepared p = tx.prepareAndPersist("inst-1", reqFor("lead-2"), counsellor());
        assertEquals("lead-2", p.responseId());
        assertEquals("+919811111111", p.bridge().getTo());
        verify(leads, never()).isLeadInInstitute(anyString(), anyString());
    }

    @Test
    void anotherInstitutesAdmissionLeadIsNotFound() {
        admissionLead("7b1d0c2e-1111-2222-3333-444455556666");
        when(leads.isApplicantLeadInInstitute("lead-2", "inst-1")).thenReturn(false);
        VacademyException e = assertThrows(VacademyException.class,
                () -> tx.prepareAndPersist("inst-1", reqFor("lead-2"), counsellor()));
        assertEquals("Lead not found", e.getMessage());
        verifyNoInteractions(logs, resolver);
    }

    @Test
    void aCampaignLessLeadWithNoApplicationIsNotFound() {
        admissionLead(null);
        assertThrows(VacademyException.class, () -> tx.prepareAndPersist("inst-1", reqFor("lead-2"), counsellor()));
        verify(leads, never()).isApplicantLeadInInstitute(anyString(), anyString());
        verifyNoInteractions(logs, resolver);
    }

    @Test
    void aCampaignLeadIsNeverAcceptedThroughAnApplication() {
        // Only the campaign decides for a lead that has one, even if an application says otherwise.
        when(leads.isLeadInInstitute("lead-1", "inst-1")).thenReturn(false);
        when(leads.isApplicantLeadInInstitute("lead-1", "inst-1")).thenReturn(true);
        assertThrows(VacademyException.class, () -> tx.prepareAndPersist("inst-1", req(), counsellor()));
    }

    @Test
    void ownLeadIsDialledAndFiledUnderTheCounsellor() {
        when(leads.isLeadInInstitute("lead-1", "inst-1")).thenReturn(true);
        CallOrchestrator.Prepared p = tx.prepareAndPersist("inst-1", req(), counsellor());
        assertEquals("lead-1", p.responseId());
        assertEquals("+919876543210", p.bridge().getTo());
        verify(logs).save(argThat(row -> "counsellor-1".equals(row.getCounsellorUserId())
                && "lead-user".equals(row.getUserId()) && "INITIATED".equals(row.getStatus())));
    }
}
