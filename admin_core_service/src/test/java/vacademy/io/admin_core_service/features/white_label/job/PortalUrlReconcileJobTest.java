package vacademy.io.admin_core_service.features.white_label.job;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Nested;
import org.junit.jupiter.api.Test;
import org.mockito.Mockito;
import org.springframework.test.util.ReflectionTestUtils;
import vacademy.io.admin_core_service.features.domain_routing.entity.InstituteDomainRouting;
import vacademy.io.admin_core_service.features.domain_routing.repository.InstituteDomainRoutingRepository;
import vacademy.io.admin_core_service.features.institute.repository.InstituteRepository;
import vacademy.io.admin_core_service.features.white_label.service.CloudflareService;
import vacademy.io.admin_core_service.features.white_label.service.PortalUrlReconciler;
import vacademy.io.common.institute.entity.Institute;

import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * The sweep that supplies the "look again" white-label adoption was missing.
 *
 * <p>{@code PortalUrlReconciler} decides correctly but only ever ran while an
 * admin had the settings page open, and a Cloudflare Pages custom domain goes
 * ACTIVE hours after that page is closed. The consequence measured on prod was 13
 * (institute, role) pairs mailing {@code learner.vacademy.io} links while their
 * own branded host was live. These tests pin that the sweep closes the gap without
 * loosening any of the reconciler's rules, and that it stays cheap enough to run
 * over every institute on the platform.
 */
class PortalUrlReconcileJobTest {

    private static final String LEARNER_PROJECT = "learner-dashboard";
    private static final String ADMIN_PROJECT = "admin-dashboard";

    private Map<String, String> learnerDomains;
    private Map<String, String> adminDomains;
    private Map<String, Institute> institutes;
    private Map<String, List<InstituteDomainRouting>> routings;

    private CloudflareService cloudflareService;
    private InstituteRepository instituteRepository;
    private InstituteDomainRoutingRepository routingRepository;
    private PortalUrlReconcileJob job;

    @BeforeEach
    void setUp() {
        learnerDomains = new HashMap<>();
        adminDomains = new HashMap<>();
        institutes = new HashMap<>();
        routings = new HashMap<>();

        cloudflareService = Mockito.mock(CloudflareService.class);
        when(cloudflareService.isPagesEnabled()).thenReturn(true);
        when(cloudflareService.isEnabled()).thenReturn(true);
        when(cloudflareService.listPagesCustomDomains(LEARNER_PROJECT)).thenAnswer(inv -> learnerDomains);
        when(cloudflareService.listPagesCustomDomains(ADMIN_PROJECT)).thenAnswer(inv -> adminDomains);

        PortalUrlReconciler reconciler = new PortalUrlReconciler(cloudflareService);
        ReflectionTestUtils.setField(reconciler, "learnerCnameTarget", "learner.vacademy.io");
        ReflectionTestUtils.setField(reconciler, "adminCnameTarget", "dash.vacademy.io");
        ReflectionTestUtils.setField(reconciler, "teacherCnameTarget", "teacher.vacademy.io");
        ReflectionTestUtils.setField(reconciler, "learnerPagesProject", LEARNER_PROJECT);
        ReflectionTestUtils.setField(reconciler, "adminPagesProject", ADMIN_PROJECT);
        ReflectionTestUtils.setField(reconciler, "vacademyBaseDomain", "vacademy.io");

        instituteRepository = Mockito.mock(InstituteRepository.class);
        routingRepository = Mockito.mock(InstituteDomainRoutingRepository.class);
        when(routingRepository.findDistinctInstituteIds())
                .thenAnswer(inv -> List.copyOf(routings.keySet()).stream().sorted().toList());
        when(routingRepository.findByInstituteId(anyString()))
                .thenAnswer(inv -> routings.getOrDefault(inv.getArgument(0, String.class), List.of()));
        when(instituteRepository.findById(anyString()))
                .thenAnswer(inv -> Optional.ofNullable(institutes.get(inv.getArgument(0, String.class))));

        job = new PortalUrlReconcileJob(instituteRepository, routingRepository, reconciler, cloudflareService);
    }

    // ── Fixtures ─────────────────────────────────────────────────────────────

    /** Registers an institute with one routing row for {@code host}. */
    private Institute configured(String id, String host, String role, String currentLearnerUrl) {
        Institute i = new Institute();
        i.setId(id);
        i.setLearnerPortalBaseUrl(currentLearnerUrl);
        institutes.put(id, i);

        InstituteDomainRouting r = new InstituteDomainRouting();
        r.setInstituteId(id);
        r.setRole(role);
        String[] parts = host.split("\\.", 2);
        r.setSubdomain(parts[0]);
        r.setDomain(parts[1]);
        routings.put(id, List.of(r));
        return i;
    }

    private void activeOnLearner(String host) {
        learnerDomains.put(host, "active");
    }

    // ── The gap the job exists to close ──────────────────────────────────────

    @Nested
    @DisplayName("Adoption without anyone opening the settings page")
    class Adoption {

        @Test
        @DisplayName("A host that went live since setup is adopted by the sweep")
        void adoptsHostThatWentLive() {
            Institute i = configured("inst-1", "learn.myschool.com", "LEARNER", null);
            activeOnLearner("learn.myschool.com");

            assertEquals(1, job.runOnce());

            assertEquals("https://learn.myschool.com", i.getLearnerPortalBaseUrl());
            verify(instituteRepository).save(i);
        }

        @Test
        @DisplayName("A column still on its V1 platform default is claimed")
        void claimsPlatformDefault() {
            Institute i = configured("inst-1", "learn.myschool.com", "LEARNER", "learner.vacademy.io");
            activeOnLearner("learn.myschool.com");

            assertEquals(1, job.runOnce());

            assertEquals("https://learn.myschool.com", i.getLearnerPortalBaseUrl());
        }

        @Test
        @DisplayName("A host that is still pending is left alone until it serves")
        void leavesPendingAlone() {
            Institute i = configured("inst-1", "learn.myschool.com", "LEARNER", null);
            learnerDomains.put("learn.myschool.com", "pending");

            assertEquals(0, job.runOnce());

            assertNull(i.getLearnerPortalBaseUrl());
            verify(instituteRepository, never()).save(any());
        }

        @Test
        @DisplayName("A curated URL nobody configured here is never overwritten")
        void doesNotOverwriteCuratedUrl() {
            // The sweep runs unattended over every institute, so this is the rule
            // whose failure would be least likely to be noticed before the emails go out.
            Institute i = configured("inst-1", "learn.myschool.com", "LEARNER", "https://student.chanakyaias.in");
            activeOnLearner("learn.myschool.com");

            assertEquals(0, job.runOnce());

            assertEquals("https://student.chanakyaias.in", i.getLearnerPortalBaseUrl());
        }

        @Test
        @DisplayName("An institute already on its live host is not re-saved")
        void skipsUnchangedInstitute() {
            configured("inst-1", "learn.myschool.com", "LEARNER", "https://learn.myschool.com");
            activeOnLearner("learn.myschool.com");

            assertEquals(0, job.runOnce());

            verify(instituteRepository, never()).save(any());
        }
    }

    // ── Sweeping many institutes ─────────────────────────────────────────────

    @Nested
    @DisplayName("Across the platform")
    class Sweep {

        @Test
        @DisplayName("Each institute is judged on its own hosts")
        void reconcilesEachInstituteIndependently() {
            Institute live = configured("inst-1", "learn.myschool.com", "LEARNER", null);
            Institute notLive = configured("inst-2", "learn.other.com", "LEARNER", null);
            activeOnLearner("learn.myschool.com");

            assertEquals(1, job.runOnce());

            assertEquals("https://learn.myschool.com", live.getLearnerPortalBaseUrl());
            assertNull(notLive.getLearnerPortalBaseUrl());
        }

        @Test
        @DisplayName("One institute failing does not end the sweep")
        void oneFailureDoesNotStopTheSweep() {
            Institute first = configured("inst-1", "learn.myschool.com", "LEARNER", null);
            Institute second = configured("inst-2", "learn.other.com", "LEARNER", null);
            activeOnLearner("learn.myschool.com");
            activeOnLearner("learn.other.com");
            when(instituteRepository.save(first)).thenThrow(new RuntimeException("read-only transaction"));

            assertEquals(1, job.runOnce());

            // The second institute was still reached and written.
            assertEquals("https://learn.other.com", second.getLearnerPortalBaseUrl());
            verify(instituteRepository).save(second);
        }

        @Test
        @DisplayName("A routing row whose institute is gone is skipped, not fatal")
        void missingInstituteIsSkipped() {
            configured("inst-1", "learn.myschool.com", "LEARNER", null);
            institutes.remove("inst-1");
            activeOnLearner("learn.myschool.com");

            assertEquals(0, job.runOnce());
        }

        @Test
        @DisplayName("Does nothing at all when Cloudflare is not configured on this deployment")
        void skippedWhenCloudflareDisabled() {
            // setup() and getStatus() both refuse outright on such a deployment, so a
            // portal URL can never be adopted there by hand. An unattended sweep must
            // not be the one path that writes these columns anyway.
            when(cloudflareService.isPagesEnabled()).thenReturn(false);
            when(cloudflareService.isEnabled()).thenReturn(false);
            Institute i = configured("inst-1", "learn.myschool.com", "LEARNER", null);
            activeOnLearner("learn.myschool.com");

            assertEquals(0, job.runOnce());

            assertNull(i.getLearnerPortalBaseUrl());
            verify(instituteRepository, never()).save(any());
            verify(routingRepository, never()).findDistinctInstituteIds();
        }

        @Test
        @DisplayName("No configured institutes means no Cloudflare traffic at all")
        void noInstitutesNoCalls() {
            assertEquals(0, job.runOnce());

            verify(cloudflareService, never()).listPagesCustomDomains(anyString());
        }
    }

    // ── Cost ─────────────────────────────────────────────────────────────────

    @Nested
    @DisplayName("Cloudflare traffic")
    class Cost {

        @Test
        @DisplayName("Lists each project once and then asks about no host individually")
        void listsOncePerProjectInsteadOfPerHost() {
            // The reason to batch: per-host lookups over the whole platform are ~120
            // serial round trips against an API shared with live setup requests.
            for (int n = 1; n <= 5; n++) {
                configured("inst-" + n, "learn" + n + ".myschool.com", "LEARNER", null);
                activeOnLearner("learn" + n + ".myschool.com");
            }

            assertEquals(5, job.runOnce());

            verify(cloudflareService, times(1)).listPagesCustomDomains(LEARNER_PROJECT);
            verify(cloudflareService, times(1)).listPagesCustomDomains(ADMIN_PROJECT);
            verify(cloudflareService, never()).getPagesCustomDomainStatus(anyString(), anyString());
        }

        @Test
        @DisplayName("A failed listing degrades to per-host lookups rather than stalling adoption")
        void failedListingStillAdopts() {
            // listPagesCustomDomains returning null means "Cloudflare did not answer",
            // which must not be read as "no host is attached" — that would silently
            // freeze every institute's portal URL for as long as the API is unhappy.
            configured("inst-1", "learn.myschool.com", "LEARNER", null);
            when(cloudflareService.listPagesCustomDomains(LEARNER_PROJECT)).thenReturn(null);
            when(cloudflareService.getPagesCustomDomainStatus(LEARNER_PROJECT, "learn.myschool.com"))
                    .thenReturn("active");

            assertEquals(1, job.runOnce());

            assertEquals("https://learn.myschool.com", institutes.get("inst-1").getLearnerPortalBaseUrl());
        }
    }
}
