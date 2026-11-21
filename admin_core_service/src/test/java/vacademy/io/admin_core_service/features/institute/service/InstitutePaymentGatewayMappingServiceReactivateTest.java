package vacademy.io.admin_core_service.features.institute.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.Spy;
import org.mockito.junit.jupiter.MockitoExtension;
import vacademy.io.admin_core_service.features.enroll_invite.repository.EnrollInviteRepository;
import vacademy.io.admin_core_service.features.enroll_invite.repository.PackageSessionLearnerInvitationToPaymentOptionRepository;
import vacademy.io.admin_core_service.features.institute.dto.PaymentGatewayMappingDTO;
import vacademy.io.admin_core_service.features.institute.dto.PaymentGatewayMappingUpsertRequest;
import vacademy.io.admin_core_service.features.institute.dto.PaymentGatewayUsageDTO;
import vacademy.io.admin_core_service.features.institute.entity.InstitutePaymentGatewayMapping;
import vacademy.io.admin_core_service.features.institute.repository.InstitutePaymentGatewayMappingRepository;
import vacademy.io.common.exceptions.VacademyException;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyList;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * A deactivated gateway must be recoverable by the admin: through the activate
 * endpoint, or by adding the same vendor again. Both must bring back the SAME row,
 * because invite links resolve the gateway by (institute, vendor) and an admin who
 * re-adds keys expects every existing link to check out again.
 */
@ExtendWith(MockitoExtension.class)
class InstitutePaymentGatewayMappingServiceReactivateTest {

    private static final String INSTITUTE = "inst-1";
    private static final String MAPPING = "map-1";

    @Mock
    private InstitutePaymentGatewayMappingRepository mappingRepository;

    @Mock
    private EnrollInviteRepository enrollInviteRepository;

    @Mock
    private PackageSessionLearnerInvitationToPaymentOptionRepository invitationPaymentOptionRepository;

    @Spy
    private ObjectMapper objectMapper = new ObjectMapper();

    @InjectMocks
    private InstitutePaymentGatewayMappingService service;

    @Test
    @DisplayName("activate switches an INACTIVE row back to ACTIVE with its stored keys")
    void activateRestoresInactiveRow() throws Exception {
        InstitutePaymentGatewayMapping row = razorpayRow("INACTIVE");
        when(mappingRepository.findById(MAPPING)).thenReturn(Optional.of(row));
        when(mappingRepository.save(any())).thenAnswer(invocation -> invocation.getArgument(0));

        PaymentGatewayMappingDTO dto = service.activateMapping(INSTITUTE, MAPPING);

        assertEquals("ACTIVE", dto.getStatus());
        assertEquals(MAPPING, dto.getId());
        assertEquals("ACTIVE", row.getStatus());
        assertEquals("live-secret-1234", stored(row).get("keySecret"), "stored keys are untouched");
        assertEquals("••••1234", dto.getPaymentGatewaySpecificData().get("keySecret"), "the reply stays masked");
    }

    @Test
    @DisplayName("activate on an ACTIVE row is a no-op, and another institute's row is refused")
    void activateIsIdempotentAndScoped() {
        InstitutePaymentGatewayMapping row = razorpayRow("ACTIVE");
        when(mappingRepository.findById(MAPPING)).thenReturn(Optional.of(row));

        assertEquals("ACTIVE", service.activateMapping(INSTITUTE, MAPPING).getStatus());
        verify(mappingRepository, never()).save(any());

        assertThrows(VacademyException.class, () -> service.activateMapping("other-inst", MAPPING));
    }

    @Test
    @DisplayName("adding a vendor that has an INACTIVE row revives that row with the new keys")
    void createRevivesInactiveRow() throws Exception {
        InstitutePaymentGatewayMapping row = razorpayRow("INACTIVE");
        when(mappingRepository.findByInstituteIdAndVendorAndStatusIn(eq(INSTITUTE), eq("RAZORPAY"), anyList()))
                .thenReturn(Optional.of(row));
        when(mappingRepository.save(any())).thenAnswer(invocation -> invocation.getArgument(0));

        Map<String, Object> data = new LinkedHashMap<>();
        data.put("keyId", "rzp_live_new");
        data.put("keySecret", "new-secret-9999");
        data.put("webhookSecret", "••••5678"); // left masked: keep the stored one
        PaymentGatewayMappingDTO dto = service.createMapping(INSTITUTE,
                new PaymentGatewayMappingUpsertRequest("razorpay", null, data));

        ArgumentCaptor<InstitutePaymentGatewayMapping> saved = ArgumentCaptor.forClass(InstitutePaymentGatewayMapping.class);
        verify(mappingRepository).save(saved.capture());
        assertEquals(MAPPING, saved.getValue().getId(), "the same row comes back, not a new one");
        assertEquals("ACTIVE", dto.getStatus());
        Map<String, Object> keys = stored(saved.getValue());
        assertEquals("rzp_live_new", keys.get("keyId"));
        assertEquals("new-secret-9999", keys.get("keySecret"));
        assertEquals("whsec-5678", keys.get("webhookSecret"));
    }

    @Test
    @DisplayName("adding a vendor that is already ACTIVE is still refused")
    void createRefusesActiveDuplicate() {
        when(mappingRepository.findByInstituteIdAndVendorAndStatusIn(eq(INSTITUTE), eq("RAZORPAY"), anyList()))
                .thenReturn(Optional.of(razorpayRow("ACTIVE")));

        assertThrows(VacademyException.class, () -> service.createMapping(INSTITUTE,
                new PaymentGatewayMappingUpsertRequest("RAZORPAY", null, Map.of("keyId", "rzp_live_x"))));
        verify(mappingRepository, never()).save(any());
    }

    @Test
    @DisplayName("usage counts live invite links on the gateway's vendor, paid ones separately")
    void usageCountsInvitesOnVendor() {
        InstitutePaymentGatewayMapping row = razorpayRow("ACTIVE");
        when(mappingRepository.findById(MAPPING)).thenReturn(Optional.of(row));
        when(enrollInviteRepository.countByInstituteIdAndVendorAndStatusIn(INSTITUTE, "RAZORPAY", List.of("ACTIVE")))
                .thenReturn(6L);
        when(invitationPaymentOptionRepository.countPaidInvitesByInstituteIdAndVendor(
                INSTITUTE, "RAZORPAY", List.of("ACTIVE"), List.of("ACTIVE"), "FREE")).thenReturn(4L);

        PaymentGatewayUsageDTO usage = service.usageFor(INSTITUTE, MAPPING);

        assertEquals("RAZORPAY", usage.getVendor());
        assertEquals(6L, usage.getActiveInvites());
        assertEquals(4L, usage.getPaidActiveInvites());
    }

    private InstitutePaymentGatewayMapping razorpayRow(String status) {
        InstitutePaymentGatewayMapping row = new InstitutePaymentGatewayMapping();
        row.setId(MAPPING);
        row.setInstituteId(INSTITUTE);
        row.setVendor("RAZORPAY");
        row.setStatus(status);
        row.setPaymentGatewaySpecificData(
                "{\"keyId\":\"rzp_live_old\",\"keySecret\":\"live-secret-1234\",\"webhookSecret\":\"whsec-5678\"}");
        return row;
    }

    @SuppressWarnings("unchecked")
    private Map<String, Object> stored(InstitutePaymentGatewayMapping row) throws Exception {
        return objectMapper.readValue(row.getPaymentGatewaySpecificData(), Map.class);
    }
}
