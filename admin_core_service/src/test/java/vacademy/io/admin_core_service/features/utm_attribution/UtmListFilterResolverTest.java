package vacademy.io.admin_core_service.features.utm_attribution;

import jakarta.persistence.EntityManager;
import jakarta.persistence.Query;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.test.util.ReflectionTestUtils;
import vacademy.io.admin_core_service.features.common.service.CustomFieldListFilterResolver.Resolution;
import vacademy.io.admin_core_service.features.common.service.CustomFieldListFilterResolver.Surface;
import vacademy.io.admin_core_service.features.utm_attribution.dto.UtmListFilterDTO;
import vacademy.io.admin_core_service.features.utm_attribution.service.UtmListFilterResolver;

import java.util.HashSet;
import java.util.List;
import java.util.Set;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.*;

/**
 * The campaign filter is an ID-set that gets AND-ed into each list query. Two
 * things must hold or the list pages quietly lie: the SQL must only carry the
 * dimensions the admin actually chose (a stray predicate silently narrows the
 * list), and combining it with the custom-field set must never turn an empty
 * intersection into "no filter" (which would show the FULL list for a filter
 * that matches nobody).
 */
class UtmListFilterResolverTest {

    private EntityManager entityManager;
    private Query query;
    private UtmListFilterResolver resolver;

    @BeforeEach
    void setUp() {
        entityManager = mock(EntityManager.class);
        query = mock(Query.class);
        when(entityManager.createNativeQuery(anyString())).thenReturn(query);
        when(query.setParameter(anyString(), any())).thenReturn(query);
        when(query.getResultList()).thenReturn(List.of("ar-1", "ar-2"));
        resolver = new UtmListFilterResolver();
        ReflectionTestUtils.setField(resolver, "entityManager", entityManager);
    }

    @Test
    void noFilterMeansNoConstraint() {
        Resolution r = resolver.resolve(null, Surface.RESPONSE, "inst-1");
        assertNull(r.matchedIds);
        assertNull(r.excludedIds);
        assertFalse(r.shortCircuitsToEmpty());
        verifyNoInteractions(entityManager);

        Resolution empty = resolver.resolve(new UtmListFilterDTO(), Surface.RESPONSE, "inst-1");
        assertNull(empty.matchedIds);
        verifyNoInteractions(entityManager);
    }

    @Test
    void onlyChosenDimensionsReachTheSql() {
        UtmListFilterDTO filter = UtmListFilterDTO.builder()
                .sources(List.of(" Facebook ", "instagram", "facebook"))
                .campaigns(List.of("Diwali-2026"))
                .build();

        Resolution r = resolver.resolve(filter, Surface.RESPONSE, "inst-1");

        assertEquals(Set.of("ar-1", "ar-2"), r.matchedIds);
        ArgumentCaptor<String> sql = ArgumentCaptor.forClass(String.class);
        verify(entityManager).createNativeQuery(sql.capture());
        String s = sql.getValue();
        assertTrue(s.contains("LOWER(u.utm_source) IN (:sources)"));
        assertTrue(s.contains("LOWER(u.utm_campaign) IN (:campaigns)"));
        assertFalse(s.contains(":mediums"), "medium was not chosen");
        assertFalse(s.contains(":terms"));
        assertFalse(s.contains(":sourceTypes"));
        // Response surface joins to audience_response, not to student.
        assertTrue(s.contains("audience_response ar"));
        assertFalse(s.contains("JOIN student"));

        // Values are lower-cased, trimmed and de-duplicated before binding.
        verify(query).setParameter("sources", List.of("facebook", "instagram"));
        verify(query).setParameter("campaigns", List.of("diwali-2026"));
        verify(query).setParameter("instituteId", "inst-1");
    }

    @Test
    void userSurfacesResolveToUserIdsThroughEveryIdentityKey() {
        when(query.getResultList()).thenReturn(List.of("user-7"));
        UtmListFilterDTO filter = UtmListFilterDTO.builder().sourceTypes(List.of("enroll_invite")).build();

        Resolution r = resolver.resolve(filter, Surface.USER, "inst-1");

        assertEquals(Set.of("user-7"), r.matchedIds);
        ArgumentCaptor<String> sql = ArgumentCaptor.forClass(String.class);
        verify(entityManager).createNativeQuery(sql.capture());
        String s = sql.getValue();
        assertTrue(s.contains("u.source_type IN (:sourceTypes)"));
        assertTrue(s.contains("SELECT t.user_id FROM t WHERE t.user_id IS NOT NULL"));
        assertTrue(s.contains("JOIN student s ON LOWER(s.email) = t.email"));
        assertTrue(s.contains("JOIN student s ON s.mobile_number = t.mobile_number"));
        assertTrue(s.contains("LOWER(ar.parent_email) = t.email"));
        verify(query).setParameter("sourceTypes", List.of("ENROLL_INVITE"));
    }

    @Test
    void untaggedOnlyBecomesAnExclusionSet() {
        UtmListFilterDTO filter = UtmListFilterDTO.builder()
                .untaggedOnly(true)
                // Ignored: a person cannot be both untagged and from facebook.
                .sources(List.of("facebook"))
                .build();

        Resolution r = resolver.resolve(filter, Surface.CONTACT, "inst-1");

        assertNull(r.matchedIds);
        assertEquals(Set.of("ar-1", "ar-2"), r.excludedIds);
        assertFalse(r.shortCircuitsToEmpty());
        ArgumentCaptor<String> sql = ArgumentCaptor.forClass(String.class);
        verify(entityManager).createNativeQuery(sql.capture());
        assertFalse(sql.getValue().contains(":sources"));
    }

    @Test
    void aFilterThatMatchesNobodyShortCircuits() {
        when(query.getResultList()).thenReturn(List.of());
        UtmListFilterDTO filter = UtmListFilterDTO.builder().campaigns(List.of("nope")).build();

        Resolution r = resolver.resolve(filter, Surface.RESPONSE, "inst-1");

        assertNotNull(r.matchedIds);
        assertTrue(r.matchedIds.isEmpty());
        assertTrue(r.shortCircuitsToEmpty());
    }

    @Test
    void missingInstituteMatchesNothingRatherThanEverything() {
        UtmListFilterDTO filter = UtmListFilterDTO.builder().sources(List.of("facebook")).build();

        Resolution r = resolver.resolve(filter, Surface.RESPONSE, "  ");

        assertTrue(r.shortCircuitsToEmpty());
        verifyNoInteractions(entityManager);
    }

    @Test
    void aFailingQueryMatchesNothingRatherThanEverything() {
        when(query.getResultList()).thenThrow(new RuntimeException("boom"));
        UtmListFilterDTO filter = UtmListFilterDTO.builder().sources(List.of("facebook")).build();

        Resolution r = resolver.resolve(filter, Surface.RESPONSE, "inst-1");

        assertTrue(r.shortCircuitsToEmpty());
    }

    // ── Resolution.and — how the two filter families combine ──────────────

    @Test
    void andIntersectsMatchedSetsAndUnionsExclusions() {
        Resolution cf = new Resolution(new HashSet<>(Set.of("a", "b", "c")), null);
        Resolution utm = new Resolution(new HashSet<>(Set.of("b", "c", "d")), null);

        Resolution both = cf.and(utm);
        assertEquals(Set.of("b", "c"), both.matchedIds);
        assertNull(both.excludedIds);

        Resolution untagged = new Resolution(null, new HashSet<>(Set.of("c")));
        Resolution combined = cf.and(untagged);
        // Exclusions fold into the matched set so the query applies one IN.
        assertEquals(Set.of("a", "b"), combined.matchedIds);
        assertNull(combined.excludedIds);

        Resolution onlyExclusions = new Resolution(null, new HashSet<>(Set.of("x"))).and(untagged);
        assertNull(onlyExclusions.matchedIds);
        assertEquals(Set.of("x", "c"), onlyExclusions.excludedIds);
    }

    @Test
    void andWithNoFilterOnEitherSideKeepsTheOther() {
        Resolution none = new Resolution(null, null);
        Resolution utm = new Resolution(new HashSet<>(Set.of("b")), null);

        assertEquals(Set.of("b"), none.and(utm).matchedIds);
        assertEquals(Set.of("b"), utm.and(none).matchedIds);
        assertNull(none.and(none).matchedIds);
    }

    @Test
    void andOfDisjointSetsShortCircuitsInsteadOfDisablingTheFilter() {
        Resolution cf = new Resolution(new HashSet<>(Set.of("a")), null);
        Resolution utm = new Resolution(new HashSet<>(Set.of("b")), null);

        Resolution both = cf.and(utm);
        assertTrue(both.shortCircuitsToEmpty());
        // The CSV form of an empty set is "" — which the SQL reads as "no
        // filter". Callers MUST check shortCircuitsToEmpty first; assert the
        // trap is still there so nobody "fixes" it into a silent full list.
        assertEquals("", both.matchedIdsCsv());
    }

    @Test
    void normaliseHandlesNullsBlanksCaseAndDuplicates() {
        assertNull(UtmListFilterDTO.normalise(null));
        assertNull(UtmListFilterDTO.normalise(List.of("", "  ")));
        assertEquals(List.of("facebook", "meta"),
                UtmListFilterDTO.normalise(java.util.Arrays.asList("Facebook", null, " META ", "facebook")));
        assertEquals(List.of("AUDIENCE"), UtmListFilterDTO.normaliseUpper(List.of("audience")));
        assertTrue(UtmListFilterDTO.builder().untaggedOnly(true).build().hasAny());
        assertFalse(UtmListFilterDTO.builder().sources(List.of(" ")).build().hasAny());
    }
}
