package vacademy.io.admin_core_service.features.telephony.core;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import vacademy.io.admin_core_service.features.audience.service.TokenEncryptionService;
import vacademy.io.admin_core_service.features.telephony.controller.dto.AiVoiceCarrierDTO;
import vacademy.io.admin_core_service.features.telephony.controller.dto.AiVoiceCarrierViewDTO;
import vacademy.io.admin_core_service.features.telephony.enums.ConfigRole;
import vacademy.io.admin_core_service.features.telephony.enums.ProviderType;
import vacademy.io.admin_core_service.features.telephony.persistence.entity.InstituteTelephonyConfig;
import vacademy.io.admin_core_service.features.telephony.persistence.repository.InstituteTelephonyConfigRepository;
import vacademy.io.common.exceptions.VacademyException;

import java.util.Map;
import java.util.Optional;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/** A line we set up on the platform's Plivo account cannot be edited, unlinked or read by the customer. */
class AiVoiceCarrierPlatformManagedTest {

    private static final String INST = "inst-1";

    private InstituteTelephonyConfigRepository repo;
    private AiVoiceCarrierService service;

    @BeforeEach
    void setUp() {
        repo = mock(InstituteTelephonyConfigRepository.class);
        service = new AiVoiceCarrierService(repo, mock(TelephonyConfigCache.class),
                mock(TelephonyProviderRegistry.class), mock(TokenEncryptionService.class));
    }

    private void aiLine(boolean managed) {
        InstituteTelephonyConfig cfg = new InstituteTelephonyConfig();
        cfg.setInstituteId(INST);
        cfg.setRole(ConfigRole.AI_VOICE);
        cfg.setProviderType(ProviderType.PLIVO);
        cfg.setEnabled(true);
        cfg.setProviderSecretsEnc("enc");
        cfg.setProviderConfig(TelephonyJson.write(managed
                ? Map.of("authId", "MAPLATFORM", "callerId", "+918035614126", "platformManaged", "true")
                : Map.of("authId", "MAOWN", "callerId", "+918000000000")));
        when(repo.findAiVoiceByInstituteId(INST)).thenReturn(Optional.of(cfg));
        when(repo.findPrimaryByInstituteId(INST)).thenReturn(Optional.empty());
    }

    @Test
    void managedLineCannotBeEdited() {
        aiLine(true);
        AiVoiceCarrierDTO body = new AiVoiceCarrierDTO();
        body.setMode("DEDICATED");
        body.setCallerId("+919999999999");
        VacademyException e = assertThrows(VacademyException.class, () -> service.save(INST, body));
        assertEquals(AiVoiceCarrierService.PLATFORM_MANAGED_MESSAGE, e.getMessage());
        verify(repo, never()).save(any());
    }

    @Test
    void managedLineCannotBeUnlinkedOrSwitchedToPrimary() {
        aiLine(true);
        assertThrows(VacademyException.class, () -> service.unlink(INST));
        AiVoiceCarrierDTO primary = new AiVoiceCarrierDTO();
        primary.setMode("PRIMARY");
        assertThrows(VacademyException.class, () -> service.save(INST, primary));
        verify(repo, never()).delete(any());
    }

    @Test
    void managedLineHidesThePlatformAccountId() {
        aiLine(true);
        AiVoiceCarrierViewDTO view = service.view(INST);
        assertTrue(view.isPlatformManaged());
        assertNull(view.getAuthId());
        assertEquals("+918035614126", view.getCallerId());
        assertTrue(view.isReady());
    }

    @Test
    void customersOwnLineIsUnchanged() {
        aiLine(false);
        AiVoiceCarrierViewDTO view = service.view(INST);
        assertFalse(view.isPlatformManaged());
        assertEquals("MAOWN", view.getAuthId());
    }
}
