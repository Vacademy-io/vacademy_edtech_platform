package vacademy.io.admin_core_service.features.white_label.service;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Nested;
import org.junit.jupiter.api.Test;
import org.mockito.Mockito;
import org.springframework.test.util.ReflectionTestUtils;
import vacademy.io.admin_core_service.features.domain_routing.entity.InstituteDomainRouting;
import vacademy.io.common.institute.entity.Institute;

import java.util.HashMap;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * Pins which configured white-label host lands in
 * {@code institutes.<role>_portal_base_url}, and — the part that matters — WHEN.
 *
 * <p>Those three columns are the origin of every link the platform mails a
 * learner. The bug this class exists to prevent is writing one before it works:
 * a Cloudflare Pages custom domain reports {@code pending} until the customer's
 * CNAME lands, so stamping it at submit time mails dead links for however long
 * that takes. The mirror-image bug is never writing at all — a portal added
 * without the primary star used to leave the column on its {@code V1} default
 * ({@code learner.vacademy.io}) forever, so every branded institute mailed the
 * generic host.
 */
class PortalUrlReconcilerTest {

    private static final String INSTITUTE_ID = "inst-1";
    private static final String LEARNER_PROJECT = "learner-dashboard";
    private static final String ADMIN_PROJECT = "admin-dashboard";

    /** host → Cloudflare's custom-domain status; absent means "not attached". */
    private Map<String, String> cloudflareStatus;
    private CloudflareService cloudflareService;
    private PortalUrlReconciler reconciler;

    @BeforeEach
    void setUp() {
        cloudflareStatus = new HashMap<>();
        cloudflareService = Mockito.mock(CloudflareService.class);
        when(cloudflareService.isPagesEnabled()).thenReturn(true);
        when(cloudflareService.getPagesCustomDomainStatus(anyString(), anyString()))
                .thenAnswer(inv -> cloudflareStatus.get(inv.getArgument(1, String.class)));

        reconciler = new PortalUrlReconciler(cloudflareService);
        ReflectionTestUtils.setField(reconciler, "learnerCnameTarget", "learner.vacademy.io");
        ReflectionTestUtils.setField(reconciler, "adminCnameTarget", "dash.vacademy.io");
        ReflectionTestUtils.setField(reconciler, "teacherCnameTarget", "teacher.vacademy.io");
        ReflectionTestUtils.setField(reconciler, "learnerPagesProject", LEARNER_PROJECT);
        ReflectionTestUtils.setField(reconciler, "adminPagesProject", ADMIN_PROJECT);
        ReflectionTestUtils.setField(reconciler, "vacademyBaseDomain", "vacademy.io");
    }

    // ── Fixtures ─────────────────────────────────────────────────────────────

    private static Institute institute(String learnerUrl) {
        Institute i = new Institute();
        i.setId(INSTITUTE_ID);
        i.setLearnerPortalBaseUrl(learnerUrl);
        return i;
    }

    /** A routing row for {@code host}, split the way WhiteLabelService splits it. */
    private static InstituteDomainRouting row(String host, String role, boolean primary) {
        InstituteDomainRouting r = new InstituteDomainRouting();
        r.setInstituteId(INSTITUTE_ID);
        r.setRole(role);
        String[] parts = host.split("\\.", 2);
        if (parts.length == 2) {
            r.setSubdomain(parts[0]);
            r.setDomain(parts[1]);
        } else {
            r.setSubdomain("*");
            r.setDomain(host);
        }
        r.setPrimary(primary);
        return r;
    }

    private void active(String host) {
        cloudflareStatus.put(host, "active");
    }

    private void pending(String host) {
        cloudflareStatus.put(host, "pending");
    }

    private PortalUrlReconciler.ReconcileResult reconcile(Institute i, InstituteDomainRouting... rows) {
        return reconciler.reconcile(i, List.of(rows), reconciler.newProbe());
    }

    // ── Rule 1: the admin's flagged choice ───────────────────────────────────

    @Nested
    @DisplayName("Rule 1 — the primary-flagged host, once it serves")
    class PrimaryChoice {

        @Test
        @DisplayName("An ACTIVE primary is adopted into the column")
        void activePrimaryIsAdopted() {
            active("learn.myschool.com");
            Institute i = institute(null);

            var result = reconcile(i, row("learn.myschool.com", "LEARNER", true));

            assertEquals("https://learn.myschool.com", i.getLearnerPortalBaseUrl());
            assertTrue(result.isChanged());
            assertEquals(Map.of("LEARNER", "https://learn.myschool.com"), result.getAdoptedUrlByRole());
        }

        @Test
        @DisplayName("A PENDING primary is NOT written — that is the dead-link bug")
        void pendingPrimaryIsNotAdopted() {
            pending("learn.myschool.com");
            Institute i = institute("https://old.myschool.com");

            var result = reconcile(i, row("learn.myschool.com", "LEARNER", true));

            assertEquals("https://old.myschool.com", i.getLearnerPortalBaseUrl());
            assertFalse(result.isChanged());
        }

        @Test
        @DisplayName("A pending primary explains itself in a warning")
        void pendingPrimaryWarns() {
            pending("learn.myschool.com");

            var result = reconcile(institute(null), row("learn.myschool.com", "LEARNER", true));

            assertEquals(1, result.getWarnings().size());
            String warning = result.getWarnings().get(0);
            assertTrue(warning.contains("learn.myschool.com"), warning);
            assertTrue(warning.contains("automatically"), warning);
        }

        @Test
        @DisplayName("A host attached to no Pages project is not treated as live")
        void unattachedHostIsNotAdopted() {
            // cloudflareStatus has no entry: Cloudflare 404s, so we know nothing.
            Institute i = institute(null);

            reconcile(i, row("learn.myschool.com", "LEARNER", true));

            assertNull(i.getLearnerPortalBaseUrl());
        }

        @Test
        @DisplayName("An active primary overrides a working incumbent — it is a deliberate move")
        void activePrimaryOverridesWorkingIncumbent() {
            active("old.myschool.com");
            active("new.myschool.com");
            Institute i = institute("https://old.myschool.com");

            reconcile(i,
                    row("old.myschool.com", "LEARNER", false),
                    row("new.myschool.com", "LEARNER", true));

            assertEquals("https://new.myschool.com", i.getLearnerPortalBaseUrl());
        }
    }

    // ── Rule 2: don't flap ───────────────────────────────────────────────────

    @Nested
    @DisplayName("Rule 2 — a working incumbent is left alone")
    class Incumbent {

        @Test
        @DisplayName("Two live domains, neither primary: the stored one stays put")
        void doesNotFlapBetweenLiveDomains() {
            active("a.myschool.com");
            active("z.myschool.com");
            // 'z' sorts last, so a naive "first active wins" would move the column
            // on every status read.
            Institute i = institute("https://z.myschool.com");

            var result = reconcile(i,
                    row("a.myschool.com", "LEARNER", false),
                    row("z.myschool.com", "LEARNER", false));

            assertEquals("https://z.myschool.com", i.getLearnerPortalBaseUrl());
            assertFalse(result.isChanged());
        }

        @Test
        @DisplayName("Scheme and trailing slash do not make the incumbent look foreign")
        void normalisesStoredValueBeforeComparing() {
            active("learn.myschool.com");
            Institute i = institute("https://learn.myschool.com/");

            var result = reconcile(i, row("learn.myschool.com", "LEARNER", false));

            assertFalse(result.isChanged());
        }

        @Test
        @DisplayName("A bare host — the column's own default shape — matches too")
        void matchesSchemelessStoredValue() {
            active("learn.myschool.com");
            Institute i = institute("learn.myschool.com");

            assertFalse(reconcile(i, row("learn.myschool.com", "LEARNER", false)).isChanged());
        }
    }

    // ── Rule 3: claim an unset, defaulted or dead column ─────────────────────

    @Nested
    @DisplayName("Rule 3 — claiming a column nobody chose")
    class Claiming {

        @Test
        @DisplayName("A portal added without the primary star is still adopted once live")
        void adoptsWithoutAnyPrimaryFlag() {
            active("learn.myschool.com");
            Institute i = institute(null);

            reconcile(i, row("learn.myschool.com", "LEARNER", false));

            assertEquals("https://learn.myschool.com", i.getLearnerPortalBaseUrl());
        }

        @Test
        @DisplayName("The V1 column default is a stamp, not a choice, so it can be claimed")
        void claimsPlatformDefault() {
            active("learn.myschool.com");
            Institute i = institute("learner.vacademy.io");

            reconcile(i, row("learn.myschool.com", "LEARNER", false));

            assertEquals("https://learn.myschool.com", i.getLearnerPortalBaseUrl());
        }

        @Test
        @DisplayName("A configured host that stopped serving is replaced by one that does")
        void healsDeadIncumbent() {
            pending("old.myschool.com");
            active("new.myschool.com");
            Institute i = institute("https://old.myschool.com");

            reconcile(i,
                    row("new.myschool.com", "LEARNER", false),
                    row("old.myschool.com", "LEARNER", false));

            assertEquals("https://new.myschool.com", i.getLearnerPortalBaseUrl());
        }

        @Test
        @DisplayName("Nothing live yet: the column is left as it is rather than guessed at")
        void leavesColumnWhenNothingIsLive() {
            pending("a.myschool.com");
            pending("b.myschool.com");
            Institute i = institute("learner.vacademy.io");

            var result = reconcile(i,
                    row("a.myschool.com", "LEARNER", false),
                    row("b.myschool.com", "LEARNER", false));

            assertEquals("learner.vacademy.io", i.getLearnerPortalBaseUrl());
            assertFalse(result.isChanged());
        }

        @Test
        @DisplayName("A pending primary still lets a live sibling heal a defaulted column")
        void pendingPrimaryDoesNotBlockHealing() {
            pending("new.myschool.com");
            active("interim.myschool.com");
            Institute i = institute("learner.vacademy.io");

            reconcile(i,
                    row("new.myschool.com", "LEARNER", true),
                    row("interim.myschool.com", "LEARNER", false));

            assertEquals("https://interim.myschool.com", i.getLearnerPortalBaseUrl());
        }
    }

    // ── Rule 4: hands off somebody else's decision ───────────────────────────

    @Nested
    @DisplayName("Rule 4 — a curated URL that was never configured here")
    class CuratedUrl {

        @Test
        @DisplayName("Is never overwritten, even when a live candidate exists")
        void doesNotOverwriteCuratedUrl() {
            active("learn.myschool.com");
            // Set by hand or by an older tool; there is no routing row for it, so this
            // class has no idea why it is there and no business changing it.
            Institute i = institute("https://student.chanakyaias.in");

            var result = reconcile(i, row("learn.myschool.com", "LEARNER", false));

            assertEquals("https://student.chanakyaias.in", i.getLearnerPortalBaseUrl());
            assertFalse(result.isChanged());
        }

        @Test
        @DisplayName("But an explicit active primary still wins — the admin asked for it")
        void explicitPrimaryBeatsCuratedUrl() {
            active("learn.myschool.com");
            Institute i = institute("https://student.chanakyaias.in");

            reconcile(i, row("learn.myschool.com", "LEARNER", true));

            assertEquals("https://learn.myschool.com", i.getLearnerPortalBaseUrl());
        }
    }

    // ── Roles ────────────────────────────────────────────────────────────────

    @Nested
    @DisplayName("Roles")
    class Roles {

        @Test
        @DisplayName("Learner, admin and teacher each fill their own column")
        void fillsEachRolesColumn() {
            active("learn.myschool.com");
            active("admin.myschool.com");
            active("staff.myschool.com");
            Institute i = institute(null);

            reconcile(i,
                    row("learn.myschool.com", "LEARNER", true),
                    row("admin.myschool.com", "ADMIN", true),
                    row("staff.myschool.com", "TEACHER", true));

            assertEquals("https://learn.myschool.com", i.getLearnerPortalBaseUrl());
            assertEquals("https://admin.myschool.com", i.getAdminPortalBaseUrl());
            assertEquals("https://staff.myschool.com", i.getTeacherPortalBaseUrl());
        }

        @Test
        @DisplayName("One row serving two roles fills both columns")
        void multiRoleRowFillsBothColumns() {
            active("portal.myschool.com");
            Institute i = institute(null);

            reconcile(i, row("portal.myschool.com", "ADMIN,TEACHER", true));

            assertEquals("https://portal.myschool.com", i.getAdminPortalBaseUrl());
            assertEquals("https://portal.myschool.com", i.getTeacherPortalBaseUrl());
            assertNull(i.getLearnerPortalBaseUrl());
        }

        @Test
        @DisplayName("A custom role has no column, so nothing is adopted for it")
        void customRoleIsSkipped() {
            active("leads.myschool.com");
            Institute i = institute(null);

            var result = reconcile(i, row("leads.myschool.com", "MANAGE_LEAD", true));

            assertFalse(result.isChanged());
            assertNull(i.getLearnerPortalBaseUrl());
            assertNull(i.getAdminPortalBaseUrl());
        }

        @Test
        @DisplayName("Admin and teacher share the admin Pages project")
        void adminAndTeacherShareTheAdminProject() {
            assertEquals(ADMIN_PROJECT, reconciler.pagesProjectForRole("ADMIN"));
            assertEquals(ADMIN_PROJECT, reconciler.pagesProjectForRole("TEACHER"));
            assertEquals(ADMIN_PROJECT, reconciler.pagesProjectForRole("MANAGE_LEAD"));
            assertEquals(LEARNER_PROJECT, reconciler.pagesProjectForRole("LEARNER"));
            assertEquals(LEARNER_PROJECT, reconciler.pagesProjectForRole("LEARNER,MANAGE_LEAD"));
        }
    }

    // ── The legacy DNS-only deployment ───────────────────────────────────────

    @Nested
    @DisplayName("When Cloudflare Pages provisioning is not configured")
    class LegacyDnsOnly {

        @BeforeEach
        void pagesOff() {
            when(cloudflareService.isPagesEnabled()).thenReturn(false);
            ReflectionTestUtils.setField(reconciler, "learnerPagesProject", "");
            ReflectionTestUtils.setField(reconciler, "adminPagesProject", "");
        }

        @Test
        @DisplayName("An in-zone subdomain got a proxied CNAME and serves immediately")
        void inZoneHostCountsAsActive() {
            Institute i = institute(null);

            reconcile(i, row("myschool.vacademy.io", "LEARNER", true));

            assertEquals("https://myschool.vacademy.io", i.getLearnerPortalBaseUrl());
        }

        @Test
        @DisplayName("An external domain could not be provisioned at all, so it is not adopted")
        void externalHostIsNotAdopted() {
            Institute i = institute(null);

            reconcile(i, row("learn.myschool.com", "LEARNER", true));

            assertNull(i.getLearnerPortalBaseUrl());
        }
    }

    // ── The activation probe ─────────────────────────────────────────────────

    @Nested
    @DisplayName("ActivationProbe")
    class Probe {

        @Test
        @DisplayName("Asks Cloudflare once per host, however many times it is consulted")
        void memoisesCloudflareLookups() {
            active("learn.myschool.com");
            PortalUrlReconciler.ActivationProbe probe = reconciler.newProbe();

            probe.of("learn.myschool.com", "LEARNER");
            probe.of("learn.myschool.com", "LEARNER");
            probe.rawPagesStatus("learn.myschool.com", "LEARNER");

            verify(cloudflareService, times(1))
                    .getPagesCustomDomainStatus(LEARNER_PROJECT, "learn.myschool.com");
        }

        @Test
        @DisplayName("Reads a status of anything but 'active' as pending, not live")
        void nonActiveStatusIsPending() {
            cloudflareStatus.put("learn.myschool.com", "initializing");

            assertEquals(PortalUrlReconciler.Activation.PENDING,
                    reconciler.newProbe().of("learn.myschool.com", "LEARNER"));
        }

        @Test
        @DisplayName("Memoises a MISS too — an unattached host must not be re-asked every time")
        void memoisesNegativeLookups() {
            // Cloudflare 404s for a host that is not attached, i.e. the lookup
            // returns null. A cache that only remembers hits silently re-queries on
            // every consultation — and the not-attached host is exactly the one a
            // status page consults twice (reconcile, then row rendering).
            PortalUrlReconciler.ActivationProbe probe = reconciler.newProbe();

            probe.of("learn.myschool.com", "LEARNER");
            probe.of("learn.myschool.com", "LEARNER");
            probe.rawPagesStatus("learn.myschool.com", "LEARNER");

            verify(cloudflareService, times(1))
                    .getPagesCustomDomainStatus(LEARNER_PROJECT, "learn.myschool.com");
        }

        @Test
        @DisplayName("Listing the configured projects survives un-injected properties")
        void configuredProjectsToleratesNulls() {
            // The @Value fields are null in any context Spring has not wired, and
            // List.of throws on a null element — so this is a NoSuchElement-shaped
            // crash in the reconcile sweep's very first statement.
            PortalUrlReconciler bare = new PortalUrlReconciler(cloudflareService);

            assertTrue(bare.configuredPagesProjects().isEmpty());
        }

        @Test
        @DisplayName("Lists only the projects that are actually configured")
        void configuredProjectsListsBoth() {
            assertEquals(java.util.Set.of(LEARNER_PROJECT, ADMIN_PROJECT),
                    reconciler.configuredPagesProjects());
        }

        @Test
        @DisplayName("Reads an unattached host as unknown, never as live")
        void unattachedIsUnknown() {
            assertEquals(PortalUrlReconciler.Activation.UNKNOWN,
                    reconciler.newProbe().of("learn.myschool.com", "LEARNER"));
        }

        @Test
        @DisplayName("A seeded project listing answers without asking Cloudflare again")
        void seededListingAvoidsLookups() {
            PortalUrlReconciler.ActivationProbe probe = reconciler.newProbe();
            probe.seedProjectListing(LEARNER_PROJECT, Map.of("learn.myschool.com", "active"));

            assertEquals(PortalUrlReconciler.Activation.ACTIVE,
                    probe.of("learn.myschool.com", "LEARNER"));
            verify(cloudflareService, Mockito.never())
                    .getPagesCustomDomainStatus(anyString(), anyString());
        }

        @Test
        @DisplayName("A host absent from a seeded listing is unattached — and is not looked up")
        void seededListingAnswersMissesLocally() {
            // The whole point of seeding: the sweep asks about every configured host,
            // and the ones that are NOT attached must not each cost a round trip to
            // be told so.
            PortalUrlReconciler.ActivationProbe probe = reconciler.newProbe();
            probe.seedProjectListing(LEARNER_PROJECT, Map.of("other.myschool.com", "active"));

            assertEquals(PortalUrlReconciler.Activation.UNKNOWN,
                    probe.of("learn.myschool.com", "LEARNER"));
            verify(cloudflareService, Mockito.never())
                    .getPagesCustomDomainStatus(anyString(), anyString());
        }

        @Test
        @DisplayName("A failed listing (null) falls back to per-host lookups rather than 'nothing is attached'")
        void failedListingFallsBackToLookups() {
            // Recording a failed listing as complete would read as "no host on this
            // project is attached", which silently stops all adoption platform-wide
            // for as long as Cloudflare is unhappy.
            active("learn.myschool.com");
            PortalUrlReconciler.ActivationProbe probe = reconciler.newProbe();
            probe.seedProjectListing(LEARNER_PROJECT, null);

            assertEquals(PortalUrlReconciler.Activation.ACTIVE,
                    probe.of("learn.myschool.com", "LEARNER"));
            verify(cloudflareService, times(1))
                    .getPagesCustomDomainStatus(LEARNER_PROJECT, "learn.myschool.com");
        }

        @Test
        @DisplayName("Seeding one project leaves the other still asking Cloudflare")
        void seedingIsPerProject() {
            active("admin.myschool.com");
            PortalUrlReconciler.ActivationProbe probe = reconciler.newProbe();
            probe.seedProjectListing(LEARNER_PROJECT, Map.of("learn.myschool.com", "active"));

            assertEquals(PortalUrlReconciler.Activation.ACTIVE,
                    probe.of("admin.myschool.com", "ADMIN"));
            verify(cloudflareService, times(1))
                    .getPagesCustomDomainStatus(ADMIN_PROJECT, "admin.myschool.com");
        }
    }

    // ── Degenerate input ─────────────────────────────────────────────────────

    @Nested
    @DisplayName("Degenerate input")
    class Degenerate {

        @Test
        @DisplayName("A null institute is a no-op rather than an NPE")
        void nullInstitute() {
            assertFalse(reconciler.reconcile(null, List.of(), reconciler.newProbe()).isChanged());
        }

        @Test
        @DisplayName("A wildcard subdomain is a marker, not a label to prepend")
        void wildcardSubdomainIsNotPrepended() {
            active("myschool.com");
            Institute i = institute(null);

            reconcile(i, row("myschool.com", "LEARNER", true));

            assertEquals("https://myschool.com", i.getLearnerPortalBaseUrl());
        }

        @Test
        @DisplayName("Two rows claiming primary for one role resolve deterministically")
        void duplicatePrimariesAreDeterministic() {
            active("a.myschool.com");
            active("z.myschool.com");

            for (int attempt = 0; attempt < 3; attempt++) {
                Institute i = institute(null);
                reconcile(i,
                        row("z.myschool.com", "LEARNER", true),
                        row("a.myschool.com", "LEARNER", true));
                assertEquals("https://a.myschool.com", i.getLearnerPortalBaseUrl());
            }
        }

        @Test
        @DisplayName("Duplicate primaries never demote the live host already in the column")
        void duplicatePrimariesKeepLiveIncumbent() {
            // Three prod institutes carry two is_primary rows for one role, from a
            // V486 backfill row plus a later setup. Alphabetical order is not a
            // choice, and letting it win moved EduStream's teacher portal from
            // teacher.edustream.ae to admin.edustream.ae and Brahm Varchas' learners
            // from learning.brahmvarchas.org to brahmvarchas.vacademy.io — a branded
            // host lost to a tie-break, in every link either mails.
            active("a.myschool.com");
            active("z.myschool.com");
            Institute i = institute("https://z.myschool.com");

            var result = reconcile(i,
                    row("z.myschool.com", "LEARNER", true),
                    row("a.myschool.com", "LEARNER", true));

            assertEquals("https://z.myschool.com", i.getLearnerPortalBaseUrl());
            assertFalse(result.isChanged());
        }

        @Test
        @DisplayName("Duplicate primaries say so, so the extra star can be cleared")
        void duplicatePrimariesWarn() {
            active("a.myschool.com");
            active("z.myschool.com");
            Institute i = institute("https://z.myschool.com");

            var result = reconcile(i,
                    row("z.myschool.com", "LEARNER", true),
                    row("a.myschool.com", "LEARNER", true));

            assertTrue(result.getWarnings().stream()
                    .anyMatch(w -> w.contains("More than one") && w.contains("z.myschool.com")),
                    "expected a warning naming the host being kept, got " + result.getWarnings());
        }

        @Test
        @DisplayName("A dead incumbent among duplicate primaries still yields to a live one")
        void duplicatePrimariesHealDeadIncumbent() {
            // The incumbent only holds because it works. When it doesn't, the tie
            // still has to resolve — otherwise a dead column stays dead forever.
            active("a.myschool.com");
            Institute i = institute("https://z.myschool.com");

            reconcile(i,
                    row("z.myschool.com", "LEARNER", true),
                    row("a.myschool.com", "LEARNER", true));

            assertEquals("https://a.myschool.com", i.getLearnerPortalBaseUrl());
        }

        @Test
        @DisplayName("An ACTIVE primary is preferred over one that merely sorts first")
        void activePrimaryBeatsPendingPrimary() {
            pending("a.myschool.com");
            active("z.myschool.com");
            Institute i = institute(null);

            reconcile(i,
                    row("a.myschool.com", "LEARNER", true),
                    row("z.myschool.com", "LEARNER", true));

            assertEquals("https://z.myschool.com", i.getLearnerPortalBaseUrl());
        }

        @Test
        @DisplayName("No routing rows at all leaves every column untouched")
        void noRoutingRows() {
            Institute i = institute("learner.vacademy.io");

            var result = reconciler.reconcile(i, List.of(), reconciler.newProbe());

            assertFalse(result.isChanged());
            assertEquals("learner.vacademy.io", i.getLearnerPortalBaseUrl());
            verify(cloudflareService, Mockito.never()).getPagesCustomDomainStatus(any(), any());
        }
    }
}
