package vacademy.io.admin_core_service.features.utm_attribution;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.test.util.ReflectionTestUtils;
import vacademy.io.admin_core_service.features.utm_attribution.dto.UtmTrackRequest;
import vacademy.io.admin_core_service.features.utm_attribution.entity.UtmAttribution;
import vacademy.io.admin_core_service.features.utm_attribution.repository.UtmAttributionRepository;
import vacademy.io.admin_core_service.features.utm_attribution.service.UtmAttributionService;

import java.sql.Timestamp;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.ArgumentMatchers.isNull;
import static org.mockito.Mockito.*;

/**
 * What does and does not become an attribution row.
 *
 * <p>The capture endpoint is unauthenticated and called from a public form, so
 * "record whatever arrives" is not an option — and the failure mode of getting
 * this wrong is not a crash but a silently useless report: a table full of rows
 * with no campaign on them, or one submission counted four times.
 */
class UtmAttributionServiceTest {

    private UtmAttributionRepository repository;
    private UtmAttributionService service;

    @BeforeEach
    void setUp() {
        repository = mock(UtmAttributionRepository.class);
        service = new UtmAttributionService();
        ReflectionTestUtils.setField(service, "repository", repository);
        when(repository.save(any(UtmAttribution.class))).thenAnswer(i -> i.getArgument(0));
    }

    private UtmTrackRequest.UtmTrackRequestBuilder valid() {
        return UtmTrackRequest.builder()
                .instituteId("inst-1")
                .userId("user-1")
                .sourceType("AUDIENCE")
                .sourceId("aud-9")
                .utmSource("whatsapp")
                .utmMedium("social")
                .utmCampaign("diwali-2026");
    }

    @Test
    void recordsATaggedSubmission() {
        UtmAttribution saved = service.record(valid().build());

        assertNotNull(saved);
        ArgumentCaptor<UtmAttribution> captor = ArgumentCaptor.forClass(UtmAttribution.class);
        verify(repository).save(captor.capture());
        assertEquals("whatsapp", captor.getValue().getUtmSource());
        assertEquals("AUDIENCE", captor.getValue().getSourceType());
        assertEquals("aud-9", captor.getValue().getSourceId());
    }

    /**
     * An untagged arrival is the ABSENCE of attribution, not a data point.
     * Storing those would bury the handful of real campaigns under a wall of
     * blank rows and make "how many people came from a campaign" unanswerable.
     */
    @Test
    void ignoresASubmissionWithNoCampaignAtAll() {
        assertNull(service.record(valid()
                .utmSource(null).utmMedium(null).utmCampaign(null)
                .build()));
        verify(repository, never()).save(any());
    }

    /** Blank strings are the same thing as absent — a form posting "" must not count. */
    @Test
    void treatsBlankValuesAsAbsent() {
        assertNull(service.record(valid()
                .utmSource("  ").utmMedium("").utmCampaign("   ")
                .build()));
        verify(repository, never()).save(any());
    }

    /** Anonymous campaign traffic belongs in catalogue_page_event, not here. */
    @Test
    void ignoresATouchWithNobodyToAttachItTo() {
        assertNull(service.record(valid().userId(null).email(null).mobileNumber(null).build()));
        verify(repository, never()).save(any());
    }

    @Test
    void rejectsASourceTypeOutsideTheAllowList() {
        assertNull(service.record(valid().sourceType("ARBITRARY").build()));
        assertNull(service.record(valid().sourceType(null).build()));
        verify(repository, never()).save(any());
    }

    @Test
    void acceptsSourceTypeInAnyCasing() {
        assertNotNull(service.record(valid().sourceType("live_session").build()));
        ArgumentCaptor<UtmAttribution> captor = ArgumentCaptor.forClass(UtmAttribution.class);
        verify(repository).save(captor.capture());
        assertEquals("LIVE_SESSION", captor.getValue().getSourceType());
    }

    /** A double-clicked submit is one touch, not two. */
    @Test
    void dropsADuplicateWithinTheDedupeWindow() {
        when(repository.countRecentDuplicates(anyString(), any(), any(), any(), anyString(), any(),
                any(), any(), any(Timestamp.class))).thenReturn(1L);

        assertNull(service.record(valid().build()));
        verify(repository, never()).save(any());
    }

    /**
     * A phone-identity institute sends no email at all. The dedupe query has to
     * be given the mobile too, otherwise its identity predicate is false for
     * every phone-only lead and they are never de-duplicated.
     */
    @Test
    void passesTheMobileToTheDedupeCheckForPhoneOnlyLeads() {
        service.record(valid().userId(null).email(null).mobileNumber("+911234567890").build());

        verify(repository).countRecentDuplicates(eq("inst-1"), isNull(), isNull(),
                eq("+911234567890"), eq("AUDIENCE"), any(), any(), any(), any(Timestamp.class));
    }

    /**
     * The email handed to the query must already be lowercased: the JPQL applies
     * LOWER() to the COLUMN only. Applying it to the parameter instead makes
     * Hibernate bind an untyped null, which PostgreSQL resolves as
     * lower(bytea) — a function that does not exist — and the statement dies.
     */
    @Test
    void lowercasesTheEmailBeforeItReachesTheQuery() {
        service.record(valid().userId(null).email("Learner@Example.COM").build());

        verify(repository).countRecentDuplicates(eq("inst-1"), isNull(), eq("learner@example.com"),
                any(), eq("AUDIENCE"), any(), any(), any(), any(Timestamp.class));
    }

    /**
     * Only the HOST of the referrer is kept: a referring path routinely carries
     * search terms and occasionally personal data in its query string.
     */
    @Test
    void keepsOnlyTheReferrerHostAndTheLandingPath() {
        service.record(valid()
                .referrer("https://www.google.com/search?q=someone%27s+private+query")
                .landingUrl("https://learn.example.com/audience-response?instituteId=inst-1")
                .build());

        ArgumentCaptor<UtmAttribution> captor = ArgumentCaptor.forClass(UtmAttribution.class);
        verify(repository).save(captor.capture());
        assertEquals("www.google.com", captor.getValue().getReferrerHost());
        assertEquals("/audience-response", captor.getValue().getLandingPath());
    }

    @Test
    void lowercasesTheEmailSoLateMatchingCannotMiss() {
        service.record(valid().userId(null).email("Learner@Example.COM").build());

        ArgumentCaptor<UtmAttribution> captor = ArgumentCaptor.forClass(UtmAttribution.class);
        verify(repository).save(captor.capture());
        assertEquals("learner@example.com", captor.getValue().getEmail());
    }

    /**
     * Recording a touch must never rewrite rows that already exist. The read
     * side matches a learner on contact details instead, so there is nothing to
     * back-fill — and an unauthenticated caller cannot re-point somebody else's
     * attribution at a user id of its choosing.
     */
    @Test
    void neverMutatesExistingRowsWhenRecording() {
        service.record(valid().email("learner@example.com").build());

        verify(repository, never()).saveAll(any());
        verify(repository).save(any(UtmAttribution.class));
    }

    /** The flat-map overload is what the product-page flow already holds. */
    @Test
    void recordsFromTheFlatUtmParamsMap() {
        UtmAttribution saved = service.record("inst-1", "user-1", "a@b.com", "+911234567890",
                "PRODUCT_PAGE", "page-code",
                Map.of("utm_source", "instagram", "utm_medium", "social"));

        assertNotNull(saved);
        assertEquals("instagram", saved.getUtmSource());
        assertEquals("PRODUCT_PAGE", saved.getSourceType());
    }

    @Test
    void ignoresAnEmptyUtmParamsMapWithoutTouchingTheDatabase() {
        assertNull(service.record("inst-1", "user-1", null, null, "PRODUCT_PAGE", "p", Map.of()));
        assertNull(service.record("inst-1", "user-1", null, null, "PRODUCT_PAGE", "p", null));
        verify(repository, never()).save(any());
    }

    /**
     * Every caller is on a path where the learner's real work already
     * succeeded. A telemetry failure must never propagate into that.
     */
    @Test
    void swallowsARepositoryFailureRatherThanBreakingTheSubmission() {
        when(repository.save(any(UtmAttribution.class))).thenThrow(new RuntimeException("db down"));

        assertDoesNotThrow(() -> assertNull(service.record(valid().build())));
    }

    @Test
    void readsBackNothingWhenAskedWithoutIds() {
        assertTrue(service.findForUser(null, "user-1", null, null).isEmpty());
        // No identity of any kind: answer empty rather than scan the institute.
        assertTrue(service.findForUser("inst-1", "  ", null, "  ").isEmpty());
        verify(repository, never()).findForLearner(any(), any(), any(), any());
    }

    @Test
    void readsEveryTouchForALearnerOldestFirst() {
        UtmAttribution row = UtmAttribution.builder()
                .id("row-1").sourceType("AUDIENCE").utmSource("meta").build();
        when(repository.findForLearner(eq("inst-1"), eq("user-1"), any(), any()))
                .thenReturn(List.of(row));

        var result = service.findForUser("inst-1", "user-1", null, null);

        assertEquals(1, result.size());
        assertEquals("meta", result.get(0).getUtmSource());
        assertEquals("AUDIENCE", result.get(0).getSourceType());
    }

    /**
     * A bare country code is what an optional phone field saves in this product.
     * Using it as a match key would join together every learner who skipped the
     * field, handing each of them the others' acquisition history.
     */
    @Test
    void refusesADegenerateMobileAsAMatchKey() {
        when(repository.findForLearner(any(), any(), any(), any())).thenReturn(List.of());

        service.findForUser("inst-1", null, null, "+91");

        // Nothing matchable was supplied, so the query is never even issued.
        verify(repository, never()).findForLearner(any(), any(), any(), any());
    }

    @Test
    void acceptsARealMobileAsAMatchKey() {
        when(repository.findForLearner(any(), any(), any(), any())).thenReturn(List.of());

        service.findForUser("inst-1", null, null, "+91 98765 43210");

        verify(repository).findForLearner(eq("inst-1"), isNull(), isNull(), eq("+91 98765 43210"));
    }

    /**
     * The surfaces that matter most for campaigns — audience form, live session,
     * catalogue — never learn a user id at submit time. The read has to match
     * the person by contact details or those touches are invisible forever.
     */
    @Test
    void findsTouchesForALearnerWhoNeverHadAUserId() {
        UtmAttribution row = UtmAttribution.builder()
                .id("row-1").sourceType("CATALOGUE").utmSource("instagram").build();
        when(repository.findForLearner("inst-1", "user-1", "learner@example.com", "+911234567890"))
                .thenReturn(List.of(row));

        var result = service.findForUser("inst-1", "user-1", "Learner@Example.COM", "+911234567890");

        assertEquals(1, result.size());
        assertEquals("instagram", result.get(0).getUtmSource());
    }
}
