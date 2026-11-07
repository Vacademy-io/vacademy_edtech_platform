package vacademy.io.admin_core_service.features.audience;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.test.util.ReflectionTestUtils;
import vacademy.io.admin_core_service.features.audience.dto.SendAudienceMessageRequestDTO;
import vacademy.io.admin_core_service.features.audience.dto.SendAudienceMessageResponseDTO;
import vacademy.io.admin_core_service.features.audience.entity.Audience;
import vacademy.io.admin_core_service.features.audience.entity.AudienceCommunication;
import vacademy.io.admin_core_service.features.audience.entity.AudienceResponse;
import vacademy.io.admin_core_service.features.audience.repository.AudienceCommunicationRepository;
import vacademy.io.admin_core_service.features.audience.repository.AudienceRepository;
import vacademy.io.admin_core_service.features.audience.repository.AudienceResponseRepository;
import vacademy.io.admin_core_service.features.audience.service.AudienceService;
import vacademy.io.admin_core_service.features.audience.service.PlaceholderEmailService;
import vacademy.io.admin_core_service.features.common.repository.CustomFieldValuesRepository;
import vacademy.io.admin_core_service.features.institute.repository.InstituteRepository;
import vacademy.io.admin_core_service.features.notification.dto.UnifiedSendRequest;
import vacademy.io.admin_core_service.features.notification.dto.UnifiedSendResponse;
import vacademy.io.admin_core_service.features.notification_service.service.NotificationService;
import vacademy.io.admin_core_service.features.auth_service.service.AuthService;
import vacademy.io.common.exceptions.VacademyException;

import java.util.Collections;
import java.util.List;
import java.util.Optional;
import java.util.stream.Collectors;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyList;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * Who actually receives an audience send.
 *
 * <p>Ticking one lead in the lead table and hitting "Send message" used to blast the
 * whole audience: the dialog never passed the selection and this service always read
 * every ACTIVE response for the audience. On a WhatsApp template that is real money
 * and a real deliverability hit — messages that no one asked for, to people the sender
 * deliberately excluded — and it cannot be taken back once the provider accepts it.
 * So the recipient scope is worth pinning down in both directions: the selection must
 * narrow the send, and no selection must still mean everyone.
 */
class AudienceSendMessageRecipientScopeTest {

    private static final String AUDIENCE_ID = "aud-1";
    private static final String INSTITUTE_ID = "inst-1";

    private AudienceRepository audienceRepository;
    private AudienceResponseRepository audienceResponseRepository;
    private AudienceCommunicationRepository audienceCommunicationRepository;
    private CustomFieldValuesRepository customFieldValuesRepository;
    private InstituteRepository instituteRepository;
    private NotificationService notificationService;
    private PlaceholderEmailService placeholderEmailService;
    private AuthService authService;
    private AudienceService service;

    @BeforeEach
    void setUp() {
        audienceRepository = mock(AudienceRepository.class);
        audienceResponseRepository = mock(AudienceResponseRepository.class);
        audienceCommunicationRepository = mock(AudienceCommunicationRepository.class);
        customFieldValuesRepository = mock(CustomFieldValuesRepository.class);
        instituteRepository = mock(InstituteRepository.class);
        notificationService = mock(NotificationService.class);
        placeholderEmailService = mock(PlaceholderEmailService.class);
        authService = mock(AuthService.class);

        service = new AudienceService();
        ReflectionTestUtils.setField(service, "audienceRepository", audienceRepository);
        ReflectionTestUtils.setField(service, "audienceResponseRepository", audienceResponseRepository);
        ReflectionTestUtils.setField(service, "audienceCommunicationRepository", audienceCommunicationRepository);
        ReflectionTestUtils.setField(service, "customFieldValuesRepository", customFieldValuesRepository);
        ReflectionTestUtils.setField(service, "instituteRepository", instituteRepository);
        ReflectionTestUtils.setField(service, "notificationService", notificationService);
        ReflectionTestUtils.setField(service, "placeholderEmailService", placeholderEmailService);
        ReflectionTestUtils.setField(service, "authService", authService);

        Audience audience = new Audience();
        audience.setId(AUDIENCE_ID);
        when(audienceRepository.findById(AUDIENCE_ID)).thenReturn(Optional.of(audience));
        when(audienceResponseRepository.findActiveByAudienceId(AUDIENCE_ID)).thenReturn(leads());
        when(instituteRepository.findById(anyString())).thenReturn(Optional.empty());
        when(authService.getUsersFromAuthServiceByUserIds(anyList())).thenReturn(Collections.emptyList());
        when(customFieldValuesRepository.findBySourceTypeAndSourceIdIn(anyString(), anyList()))
                .thenReturn(Collections.emptyList());
        when(placeholderEmailService.isPlaceholder(anyString())).thenReturn(false);
        when(notificationService.sendUnified(any(UnifiedSendRequest.class)))
                .thenReturn(UnifiedSendResponse.builder()
                        .batchId("batch-1")
                        .accepted(1)
                        .failed(0)
                        .status("COMPLETED")
                        .build());
        when(audienceCommunicationRepository.save(any(AudienceCommunication.class)))
                .thenAnswer(inv -> inv.getArgument(0));
    }

    /** Three live leads on the audience, each reachable on WhatsApp. */
    private List<AudienceResponse> leads() {
        return List.of(
                AudienceResponse.builder().id("resp-1").userId("user-1")
                        .parentName("Manshu").parentMobile("919682419977").build(),
                AudienceResponse.builder().id("resp-2").userId("user-2")
                        .parentName("Himang").parentMobile("919166908033").build(),
                AudienceResponse.builder().id("resp-3").userId("user-3")
                        .parentName("Neeraj").parentMobile("442323232323").build());
    }

    private SendAudienceMessageRequestDTO whatsappRequest(List<String> responseIds) {
        return SendAudienceMessageRequestDTO.builder()
                .audienceId(AUDIENCE_ID)
                .instituteId(INSTITUTE_ID)
                .channel("WHATSAPP")
                .templateName("promo_template")
                .responseIds(responseIds)
                .build();
    }

    private List<String> sentPhones() {
        ArgumentCaptor<UnifiedSendRequest> captor = ArgumentCaptor.forClass(UnifiedSendRequest.class);
        verify(notificationService).sendUnified(captor.capture());
        return captor.getValue().getRecipients().stream()
                .map(UnifiedSendRequest.Recipient::getPhone)
                .collect(Collectors.toList());
    }

    @Test
    void sendsOnlyToTheTickedLead() {
        SendAudienceMessageResponseDTO response = service.sendAudienceMessage(
                whatsappRequest(List.of("resp-2")));

        assertEquals(List.of("919166908033"), sentPhones(),
                "one lead ticked must mean one recipient, not the whole audience");
        assertEquals(1, response.getRecipientCount());
    }

    @Test
    void sendsToEveryLeadWhenNothingIsTicked() {
        service.sendAudienceMessage(whatsappRequest(null));

        assertEquals(List.of("919682419977", "919166908033", "442323232323"), sentPhones(),
                "no selection must keep the original whole-audience blast");
    }

    @Test
    void ignoresIdsThatDoNotBelongToTheAudience() {
        // A stale/foreign response id must not widen the send, and must not silently
        // fall back to everyone either.
        assertThrows(VacademyException.class,
                () -> service.sendAudienceMessage(whatsappRequest(List.of("resp-from-another-audience"))));
    }
}
