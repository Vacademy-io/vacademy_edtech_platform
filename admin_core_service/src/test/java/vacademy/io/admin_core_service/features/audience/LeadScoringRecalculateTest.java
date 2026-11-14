package vacademy.io.admin_core_service.features.audience;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import vacademy.io.admin_core_service.features.audience.entity.Audience;
import vacademy.io.admin_core_service.features.audience.entity.AudienceResponse;
import vacademy.io.admin_core_service.features.audience.entity.LeadScore;
import vacademy.io.admin_core_service.features.audience.repository.AudienceRepository;
import vacademy.io.admin_core_service.features.audience.repository.AudienceResponseRepository;
import vacademy.io.admin_core_service.features.audience.repository.LeadScoreRepository;
import vacademy.io.admin_core_service.features.audience.service.LeadScoringService;

import java.lang.reflect.Field;
import java.util.Optional;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.*;

/**
 * recalculateScore must be able to create a lead's FIRST score. It used to read the
 * institute only from an existing score, so a never-scored lead (e.g. an ad-platform
 * webhook lead from before intake scoring) made "Recalculate scores" a silent no-op.
 */
class LeadScoringRecalculateTest {

    private LeadScoringService service;
    private AudienceResponseRepository responses;
    private LeadScoreRepository scores;
    private AudienceRepository audiences;

    @BeforeEach
    void setUp() throws Exception {
        LeadScoringService real = new LeadScoringService();
        for (Field f : LeadScoringService.class.getDeclaredFields()) {
            if (f.isAnnotationPresent(Autowired.class) && !f.getType().isPrimitive()) {
                f.setAccessible(true);
                f.set(real, mock(f.getType()));
            }
        }
        service = spy(real);
        doReturn(null).when(service).calculateAndSaveScore(any(), any(), any(), any(), any());
        responses = (AudienceResponseRepository) get(real, "audienceResponseRepository");
        scores = (LeadScoreRepository) get(real, "leadScoreRepository");
        audiences = (AudienceRepository) get(real, "audienceRepository");

        AudienceResponse r = AudienceResponse.builder().id("resp-1").audienceId("aud-1")
                .sourceType("GOOGLE_LEAD_ADS").build();
        when(responses.findById("resp-1")).thenReturn(Optional.of(r));
    }

    private static Object get(Object target, String field) throws Exception {
        Field f = LeadScoringService.class.getDeclaredField(field);
        f.setAccessible(true);
        return f.get(target);
    }

    @Test
    void neverScoredLeadGetsItsFirstScoreFromTheListInstitute() {
        when(scores.findByAudienceResponseId("resp-1")).thenReturn(Optional.empty());
        Audience audience = new Audience();
        audience.setId("aud-1");
        audience.setInstituteId("inst-1");
        when(audiences.findById("aud-1")).thenReturn(Optional.of(audience));

        service.recalculateScore("resp-1");

        verify(service).calculateAndSaveScore("resp-1", "aud-1", "inst-1", "GOOGLE_LEAD_ADS", null);
    }

    @Test
    void scoredLeadKeepsTheInstituteOnItsScore() {
        LeadScore existing = new LeadScore();
        existing.setInstituteId("inst-from-score");
        when(scores.findByAudienceResponseId("resp-1")).thenReturn(Optional.of(existing));

        service.recalculateScore("resp-1");

        verify(service).calculateAndSaveScore("resp-1", "aud-1", "inst-from-score", "GOOGLE_LEAD_ADS", null);
        verifyNoInteractions(audiences);
    }

    @Test
    void noScoreAndNoListIsStillSkipped() {
        when(scores.findByAudienceResponseId("resp-1")).thenReturn(Optional.empty());
        when(audiences.findById("aud-1")).thenReturn(Optional.empty());

        service.recalculateScore("resp-1");

        verify(service, never()).calculateAndSaveScore(any(), any(), any(), any(), any());
    }
}
