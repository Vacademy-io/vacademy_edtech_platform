package vacademy.io.admin_core_service.features.audience;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.test.util.ReflectionTestUtils;
import vacademy.io.admin_core_service.features.audience.dto.AudienceDTO;
import vacademy.io.admin_core_service.features.audience.entity.Audience;
import vacademy.io.admin_core_service.features.audience.repository.AudienceRepository;
import vacademy.io.admin_core_service.features.audience.service.AudienceService;
import vacademy.io.admin_core_service.features.common.service.InstituteCustomFiledService;
import vacademy.io.common.exceptions.ConflictException;

import java.util.List;
import java.util.Optional;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertSame;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * Campaign names are unique per institute (unique_institute_campaign), and a deleted
 * campaign keeps its name. A clash used to reach the admin as the raw Postgres batch
 * error; it must come back as a 409 with a sentence they can act on, without blocking
 * names the constraint itself allows.
 */
class AudienceCampaignNameConflictTest {

    private static final String INSTITUTE_ID = "inst-1";

    private AudienceRepository audienceRepository;
    private AudienceService service;

    @BeforeEach
    void setUp() {
        audienceRepository = mock(AudienceRepository.class);
        service = new AudienceService();
        ReflectionTestUtils.setField(service, "audienceRepository", audienceRepository);
        ReflectionTestUtils.setField(service, "instituteCustomFiledService", mock(InstituteCustomFiledService.class));
        when(audienceRepository.saveAndFlush(any(Audience.class))).thenAnswer(inv -> {
            Audience a = inv.getArgument(0);
            if (a.getId() == null) a.setId("aud-new");
            return a;
        });
        when(audienceRepository.findByInstituteIdAndCampaignNameIgnoreCase(anyString(), anyString()))
                .thenReturn(List.of());
    }

    private static AudienceDTO dto(String name) {
        return AudienceDTO.builder().instituteId(INSTITUTE_ID).campaignName(name).build();
    }

    private static Audience existing(String id, String name, String status) {
        Audience a = new Audience();
        a.setId(id);
        a.setInstituteId(INSTITUTE_ID);
        a.setCampaignName(name);
        a.setStatus(status);
        return a;
    }

    private void named(String name, Audience... lists) {
        when(audienceRepository.findByInstituteIdAndCampaignNameIgnoreCase(INSTITUTE_ID, name))
                .thenReturn(List.of(lists));
    }

    @Test
    void createWithFreeNameSaves() {
        assertEquals("aud-new", service.createCampaign(dto("testing")));
    }

    @Test
    void createWithTakenNameIsConflict() {
        named("testing", existing("aud-1", "testing", "ACTIVE"));

        ConflictException ex = assertThrows(ConflictException.class, () -> service.createCampaign(dto("testing")));

        assertTrue(ex.getMessage().contains("already exists"), ex.getMessage());
        verify(audienceRepository, never()).saveAndFlush(any());
    }

    @Test
    void createWithNameOfDeletedCampaignSaysSo() {
        named("testing", existing("aud-1", "testing", "DELETED"));

        ConflictException ex = assertThrows(ConflictException.class, () -> service.createCampaign(dto("testing")));

        assertTrue(ex.getMessage().contains("deleted campaign"), ex.getMessage());
    }

    @Test
    void createWithNameDifferingOnlyInCaseIsAllowed() {
        named("Testing", existing("aud-1", "testing", "ACTIVE"));

        assertEquals("aud-new", service.createCampaign(dto("Testing")));
    }

    @Test
    void createRaceOnConstraintIsConflict() {
        when(audienceRepository.saveAndFlush(any(Audience.class))).thenThrow(new DataIntegrityViolationException(
                "could not execute batch; constraint [unique_institute_campaign]"));

        assertThrows(ConflictException.class, () -> service.createCampaign(dto("testing")));
    }

    @Test
    void otherIntegrityErrorsAreNotRelabelled() {
        DataIntegrityViolationException other = new DataIntegrityViolationException("constraint [some_other_fk]");
        when(audienceRepository.saveAndFlush(any(Audience.class))).thenThrow(other);

        assertSame(other, assertThrows(DataIntegrityViolationException.class,
                () -> service.createCampaign(dto("testing"))));
    }

    @Test
    void updateKeepingItsOwnNameSkipsTheCheck() {
        when(audienceRepository.findById("aud-1")).thenReturn(Optional.of(existing("aud-1", "testing", "ACTIVE")));

        assertEquals("aud-1", service.updateCampaign("aud-1", dto("testing")));
        verify(audienceRepository, never()).findByInstituteIdAndCampaignNameIgnoreCase(anyString(), anyString());
    }

    @Test
    void updateRenamingToTakenNameIsConflict() {
        when(audienceRepository.findById("aud-1")).thenReturn(Optional.of(existing("aud-1", "old", "ACTIVE")));
        named("testing", existing("aud-2", "testing", "ACTIVE"));

        assertThrows(ConflictException.class, () -> service.updateCampaign("aud-1", dto("testing")));
        verify(audienceRepository, never()).saveAndFlush(any());
    }
}
