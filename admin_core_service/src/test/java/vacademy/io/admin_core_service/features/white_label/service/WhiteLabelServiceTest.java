package vacademy.io.admin_core_service.features.white_label.service;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Nested;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.mockito.Mockito;
import org.springframework.test.util.ReflectionTestUtils;
import vacademy.io.admin_core_service.features.domain_routing.dto.DomainRoutingUpsertRequest;
import vacademy.io.admin_core_service.features.domain_routing.entity.InstituteDomainRouting;
import vacademy.io.admin_core_service.features.domain_routing.repository.InstituteDomainRoutingRepository;
import vacademy.io.admin_core_service.features.domain_routing.service.DomainRoutingAdminService;
import vacademy.io.admin_core_service.features.institute.repository.InstituteRepository;
import vacademy.io.admin_core_service.features.white_label.dto.PortalRoutingConfig;
import vacademy.io.admin_core_service.features.white_label.dto.WhiteLabelSetupRequest;
import vacademy.io.admin_core_service.features.white_label.dto.WhiteLabelSetupResponse;
import vacademy.io.admin_core_service.features.white_label.dto.WhiteLabelStatusResponse;
import vacademy.io.common.auth.model.CustomUserDetails;
import vacademy.io.common.exceptions.VacademyException;
import vacademy.io.admin_core_service.features.live_session.client.InstituteRoleUserClient;
import vacademy.io.common.institute.entity.Institute;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;

import static org.junit.jupiter.api.Assertions.assertArrayEquals;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * Covers the wiring between the white-label endpoints and
 * {@link PortalUrlReconciler} — the part that decides when an institute's portal
 * URL columns are written.
 *
 * <p>The behaviour under test is the one an admin sees: a domain they add is
 * remembered immediately, but only becomes the institute's portal URL once
 * Cloudflare serves it, and it does so without them coming back to press
 * anything.
 */
class WhiteLabelServiceTest {

    private static final String INSTITUTE_ID = "inst-1";
    private static final String USER_ID = "user-1";
    private static final String LEARNER_PROJECT = "learner-dashboard";
    private static final String ADMIN_PROJECT = "admin-dashboard";

    private InstituteRepository instituteRepository;
    private InstituteDomainRoutingRepository routingRepository;
    private DomainRoutingAdminService domainRoutingAdminService;
    private CloudflareService cloudflareService;
    private InstituteRoleUserClient instituteRoleUserClient;
    private PortalUrlReconciler reconciler;
    private WhiteLabelService service;

    /** host → Cloudflare's custom-domain status; absent means "not attached". */
    private Map<String, String> cloudflareStatus;
    /** Rows the repository will report for the institute. */
    private List<InstituteDomainRouting> storedRows;
    private Institute institute;

    @BeforeEach
    void setUp() {
        cloudflareStatus = new HashMap<>();
        storedRows = new ArrayList<>();

        institute = new Institute();
        institute.setId(INSTITUTE_ID);
        // What a never-configured institute actually looks like: the V1 column
        // defaults, stamped at creation.
        institute.setLearnerPortalBaseUrl("learner.vacademy.io");
        institute.setAdminPortalBaseUrl("dash.vacademy.io");

        cloudflareService = Mockito.mock(CloudflareService.class);
        when(cloudflareService.isEnabled()).thenReturn(true);
        when(cloudflareService.isPagesEnabled()).thenReturn(true);
        when(cloudflareService.getPagesCustomDomainStatus(anyString(), anyString()))
                .thenAnswer(inv -> cloudflareStatus.get(inv.getArgument(1, String.class)));
        when(cloudflareService.upsertPagesCustomDomain(anyString(), anyString()))
                .thenAnswer(inv -> {
                    String host = inv.getArgument(1, String.class);
                    return WhiteLabelSetupResponse.PagesDomainResult.builder()
                            .project(inv.getArgument(0, String.class))
                            .name(host)
                            .status(cloudflareStatus.getOrDefault(host, "pending"))
                            .action("CREATED")
                            .pagesCnameTarget(inv.getArgument(0, String.class) + ".pages.dev")
                            .build();
                });

        instituteRepository = Mockito.mock(InstituteRepository.class);
        when(instituteRepository.findById(INSTITUTE_ID)).thenReturn(Optional.of(institute));

        routingRepository = Mockito.mock(InstituteDomainRoutingRepository.class);
        when(routingRepository.findByInstituteId(INSTITUTE_ID)).thenAnswer(inv -> storedRows);
        when(routingRepository.findByDomain(any()))
                .thenAnswer(inv -> storedRows.stream()
                        .filter(r -> inv.getArgument(0, String.class).equalsIgnoreCase(r.getDomain()))
                        .toList());
        when(routingRepository.findByInstituteIdAndDomainAndSubdomain(any(), any(), any()))
                .thenAnswer(inv -> storedRows.stream()
                        .filter(r -> inv.getArgument(1, String.class).equals(r.getDomain())
                                && inv.getArgument(2, String.class).equals(r.getSubdomain()))
                        .toList());

        domainRoutingAdminService = Mockito.mock(DomainRoutingAdminService.class);
        when(domainRoutingAdminService.create(any())).thenAnswer(inv -> {
            DomainRoutingUpsertRequest req = inv.getArgument(0);
            InstituteDomainRouting created = new InstituteDomainRouting();
            created.setId("row-" + storedRows.size());
            created.setInstituteId(req.getInstituteId());
            created.setDomain(req.getDomain());
            created.setSubdomain(req.getSubdomain());
            created.setRole(req.getRole());
            created.setPrimary(Boolean.TRUE.equals(req.getPrimary()));
            storedRows.add(created);
            return created;
        });

        instituteRoleUserClient = Mockito.mock(InstituteRoleUserClient.class);
        when(instituteRoleUserClient.findRolesOfUser(INSTITUTE_ID, USER_ID))
                .thenReturn(Optional.of(Set.of("ADMIN")));

        reconciler = new PortalUrlReconciler(cloudflareService);
        ReflectionTestUtils.setField(reconciler, "learnerCnameTarget", "learner.vacademy.io");
        ReflectionTestUtils.setField(reconciler, "adminCnameTarget", "dash.vacademy.io");
        ReflectionTestUtils.setField(reconciler, "teacherCnameTarget", "teacher.vacademy.io");
        ReflectionTestUtils.setField(reconciler, "learnerPagesProject", LEARNER_PROJECT);
        ReflectionTestUtils.setField(reconciler, "adminPagesProject", ADMIN_PROJECT);
        ReflectionTestUtils.setField(reconciler, "vacademyBaseDomain", "vacademy.io");

        service = new WhiteLabelService(instituteRepository, routingRepository,
                domainRoutingAdminService, cloudflareService, instituteRoleUserClient, reconciler);
        ReflectionTestUtils.setField(service, "learnerCnameTarget", "learner.vacademy.io");
        ReflectionTestUtils.setField(service, "adminCnameTarget", "dash.vacademy.io");
        ReflectionTestUtils.setField(service, "teacherCnameTarget", "teacher.vacademy.io");
        ReflectionTestUtils.setField(service, "vacademyBaseDomain", "vacademy.io");
    }

    // ── Fixtures ─────────────────────────────────────────────────────────────

    /** {@code userId} is read-only on CustomUserDetails, hence the reflection. */
    private static CustomUserDetails user(String userId) {
        CustomUserDetails user = new CustomUserDetails();
        ReflectionTestUtils.setField(user, "userId", userId);
        return user;
    }

    private static CustomUserDetails admin() {
        return user(USER_ID);
    }

    private static CustomUserDetails outsider() {
        return user("someone-else");
    }

    private static WhiteLabelSetupRequest setupRequest(String host, String role, boolean primary) {
        WhiteLabelSetupRequest.DomainEntry entry = new WhiteLabelSetupRequest.DomainEntry();
        entry.setDomain(host);
        entry.setRole(role);
        entry.setPrimary(primary);
        WhiteLabelSetupRequest request = new WhiteLabelSetupRequest();
        request.setEntries(List.of(entry));
        return request;
    }

    private static WhiteLabelSetupRequest.DomainEntry entry(String host, String role, boolean primary) {
        WhiteLabelSetupRequest.DomainEntry entry = new WhiteLabelSetupRequest.DomainEntry();
        entry.setDomain(host);
        entry.setRole(role);
        entry.setPrimary(primary);
        return entry;
    }

    private static WhiteLabelSetupRequest setupRequest(WhiteLabelSetupRequest.DomainEntry... entries) {
        WhiteLabelSetupRequest request = new WhiteLabelSetupRequest();
        request.setEntries(List.of(entries));
        return request;
    }

    private void givenStoredRow(String host, String role, boolean primary) {
        InstituteDomainRouting r = new InstituteDomainRouting();
        r.setId("row-" + storedRows.size());
        r.setInstituteId(INSTITUTE_ID);
        r.setRole(role);
        String[] parts = host.split("\\.", 2);
        r.setSubdomain(parts[0]);
        r.setDomain(parts[1]);
        r.setPrimary(primary);
        storedRows.add(r);
    }

    // ── setup() ──────────────────────────────────────────────────────────────

    @Nested
    @DisplayName("setup()")
    class Setup {

        @Test
        @DisplayName("A domain that is already live becomes the portal URL straight away")
        void activeDomainIsAdoptedImmediately() {
            cloudflareStatus.put("learn.myschool.com", "active");

            WhiteLabelSetupResponse response = service.setup(admin(), INSTITUTE_ID,
                    setupRequest("learn.myschool.com", "LEARNER", true));

            assertEquals("https://learn.myschool.com", institute.getLearnerPortalBaseUrl());
            assertEquals("https://learn.myschool.com", response.getLearnerPortalUrl());
            verify(instituteRepository).save(institute);
        }

        @Test
        @DisplayName("A pending domain is remembered but NOT stamped into the institute row")
        void pendingDomainIsRememberedNotStamped() {
            // The external-domain case: Cloudflare will not serve this until the
            // customer adds their CNAME. Writing it now mails dead links.
            WhiteLabelSetupResponse response = service.setup(admin(), INSTITUTE_ID,
                    setupRequest("learn.myschool.com", "LEARNER", true));

            assertEquals("learner.vacademy.io", institute.getLearnerPortalBaseUrl());
            assertEquals("learner.vacademy.io", response.getLearnerPortalUrl());
            verify(instituteRepository, never()).save(any());
        }

        @Test
        @DisplayName("The choice is persisted on the routing row, so it outlives the request")
        void primaryFlagIsPersisted() {
            service.setup(admin(), INSTITUTE_ID, setupRequest("learn.myschool.com", "LEARNER", true));

            ArgumentCaptor<DomainRoutingUpsertRequest> captor =
                    ArgumentCaptor.forClass(DomainRoutingUpsertRequest.class);
            verify(domainRoutingAdminService).create(captor.capture());
            assertEquals(Boolean.TRUE, captor.getValue().getPrimary());
            assertEquals("learn", captor.getValue().getSubdomain());
            assertEquals("myschool.com", captor.getValue().getDomain());
        }

        @Test
        @DisplayName("A pending choice says so, rather than silently doing nothing")
        void pendingChoiceIsExplained() {
            WhiteLabelSetupResponse response = service.setup(admin(), INSTITUTE_ID,
                    setupRequest("learn.myschool.com", "LEARNER", true));

            assertTrue(response.getWarnings().stream()
                    .anyMatch(w -> w.contains("learn.myschool.com") && w.contains("automatically")),
                    "expected an explanatory warning, got: " + response.getWarnings());
        }

        @Test
        @DisplayName("An unflagged domain is still adopted once live — the column was only a default")
        void unflaggedDomainIsAdopted() {
            cloudflareStatus.put("learn.myschool.com", "active");

            service.setup(admin(), INSTITUTE_ID, setupRequest("learn.myschool.com", "LEARNER", false));

            assertEquals("https://learn.myschool.com", institute.getLearnerPortalBaseUrl());
        }

        @Test
        @DisplayName("Choosing a new primary clears the flag on the domain it replaces")
        void supersededPrimaryIsDemoted() {
            givenStoredRow("old.myschool.com", "LEARNER", true);
            cloudflareStatus.put("new.myschool.com", "active");

            service.setup(admin(), INSTITUTE_ID, setupRequest("new.myschool.com", "LEARNER", true));

            InstituteDomainRouting old = storedRows.stream()
                    .filter(r -> "old".equals(r.getSubdomain())).findFirst().orElseThrow();
            assertFalse(old.isPrimary());
            verify(routingRepository).save(old);
        }

        @Test
        @DisplayName("Demoting a domain that served another role too says what it cost")
        void demotionReportsCollateral() {
            givenStoredRow("portal.myschool.com", "LEARNER,TEACHER", true);
            cloudflareStatus.put("new.myschool.com", "active");

            WhiteLabelSetupResponse response = service.setup(admin(), INSTITUTE_ID,
                    setupRequest("new.myschool.com", "LEARNER", true));

            assertTrue(response.getWarnings().stream()
                    .anyMatch(w -> w.contains("portal.myschool.com") && w.contains("TEACHER")),
                    "expected a collateral warning, got: " + response.getWarnings());
        }
    }

    // ── Roles allowed to log in ──────────────────────────────────────────────

    @Nested
    @DisplayName("setup() with several roles on one domain")
    class AllowedRoles {

        @Test
        @DisplayName("Seeded role names with a space are accepted and stored canonically")
        void rolesWithSpacesAreAccepted() {
            service.setup(admin(), INSTITUTE_ID,
                    setupRequest("admin.myschool.com", "ADMIN, course  creator,Counsellor", true));

            ArgumentCaptor<DomainRoutingUpsertRequest> captor =
                    ArgumentCaptor.forClass(DomainRoutingUpsertRequest.class);
            verify(domainRoutingAdminService).create(captor.capture());
            assertEquals("ADMIN,COUNSELLOR,COURSE CREATOR", captor.getValue().getRole());
        }

        @Test
        @DisplayName("A role name carrying a control character is rejected")
        void malformedRoleIsRejected() {
            assertThrows(VacademyException.class, () -> service.setup(admin(), INSTITUTE_ID,
                    setupRequest("admin.myschool.com", "ADMIN,BAD\u0000ROLE", true)));
        }

        @Test
        @DisplayName("Changing the roles of a saved domain updates its row instead of adding a second one")
        void changingRolesUpdatesTheSameRow() {
            givenStoredRow("admin.myschool.com", "ADMIN,EVALUATOR,COURSE CREATOR,TEACHER", true);

            service.setup(admin(), INSTITUTE_ID,
                    setupRequest("admin.myschool.com", "ADMIN,COUNSELLOR,TEACHER", true));

            ArgumentCaptor<DomainRoutingUpsertRequest> captor =
                    ArgumentCaptor.forClass(DomainRoutingUpsertRequest.class);
            verify(domainRoutingAdminService).update(eq("row-0"), captor.capture());
            verify(domainRoutingAdminService, never()).create(any());
            assertEquals("ADMIN,COUNSELLOR,TEACHER", captor.getValue().getRole());
        }

        @Test
        @DisplayName("The same domain twice in one request is refused, not silently merged")
        void duplicateHostIsRejected() {
            assertThrows(VacademyException.class, () -> service.setup(admin(), INSTITUTE_ID, setupRequest(
                    entry("admin.myschool.com", "ADMIN", true),
                    entry("Admin.MySchool.com", "TEACHER", false))));
        }

        @Test
        @DisplayName("An admin portal that lets teachers in and the teacher portal can both be primary")
        void adminPortalWithTeacherDoesNotCollideWithTeacherPortal() {
            cloudflareStatus.put("admin.myschool.com", "active");
            cloudflareStatus.put("teach.myschool.com", "active");

            service.setup(admin(), INSTITUTE_ID, setupRequest(
                    entry("admin.myschool.com", "ADMIN,TEACHER", true),
                    entry("teach.myschool.com", "TEACHER", true)));

            assertEquals("https://admin.myschool.com", institute.getAdminPortalBaseUrl());
            assertEquals("https://teach.myschool.com", institute.getTeacherPortalBaseUrl());
        }

        @Test
        @DisplayName("Two primaries for the same portal are still refused")
        void twoPrimaryAdminPortalsAreRejected() {
            assertThrows(VacademyException.class, () -> service.setup(admin(), INSTITUTE_ID, setupRequest(
                    entry("admin.myschool.com", "ADMIN,TEACHER", true),
                    entry("staff.myschool.com", "ADMIN,COUNSELLOR", true))));
        }

        @Test
        @DisplayName("Starring a teacher portal leaves the admin portal that lets teachers in starred")
        void teacherPrimaryDoesNotDemoteAdminPortal() {
            givenStoredRow("admin.myschool.com", "ADMIN,TEACHER", true);

            service.setup(admin(), INSTITUTE_ID, setupRequest("teach.myschool.com", "TEACHER", true));

            InstituteDomainRouting adminRow = storedRows.stream()
                    .filter(r -> "admin".equals(r.getSubdomain())).findFirst().orElseThrow();
            assertTrue(adminRow.isPrimary());
        }
    }

    // ── Apex domains, extra settings, removal ────────────────────────────────

    @Nested
    @DisplayName("Settings that used to need a database edit")
    class FormerlyDatabaseOnly {

        @Test
        @DisplayName("A bare two-label domain is stored as the apex row the portals look up")
        void apexDomainIsStoredAsWildcard() {
            // The portals resolve myschool.com as domain=myschool.com,
            // subdomain=* — the old split stored domain=com, subdomain=myschool.
            assertArrayEquals(new String[] { "myschool.com", "*" },
                    WhiteLabelService.splitDomain("myschool.com"));
            assertArrayEquals(new String[] { "myschool.com", "learn" },
                    WhiteLabelService.splitDomain("https://learn.myschool.com/path"));
            assertArrayEquals(new String[] { "myschool.com", "*" },
                    WhiteLabelService.splitDomain("*.myschool.com"));
            assertArrayEquals(new String[] { "localhost", "learn" },
                    WhiteLabelService.splitDomain("learn.localhost"));
        }

        @Test
        @DisplayName("The apex and its wildcard spelling in one request are the same host")
        void apexAndWildcardAreOneHost() {
            assertThrows(VacademyException.class, () -> service.setup(admin(), INSTITUTE_ID, setupRequest(
                    entry("myschool.com", "LEARNER", true),
                    entry("*.myschool.com", "LEARNER", false))));
        }

        @Test
        @DisplayName("Login-page terminology and the root website are written from the wizard")
        void namingAndRootCatalogueAreSaved() {
            WhiteLabelSetupRequest request = setupRequest("myschool.com", "LEARNER", true);
            PortalRoutingConfig cfg = new PortalRoutingConfig();
            cfg.setApplyNamingSetting(true);
            cfg.setRootCatalogueTag("new-website");
            request.getEntries().get(0).setRoutingConfig(cfg);

            service.setup(admin(), INSTITUTE_ID, request);

            ArgumentCaptor<DomainRoutingUpsertRequest> captor =
                    ArgumentCaptor.forClass(DomainRoutingUpsertRequest.class);
            verify(domainRoutingAdminService).create(captor.capture());
            assertEquals(Boolean.TRUE, captor.getValue().getApplyNamingSetting());
            assertEquals("new-website", captor.getValue().getRootCatalogueTag());
            assertEquals("myschool.com", captor.getValue().getDomain());
            assertEquals("*", captor.getValue().getSubdomain());
        }

        @Test
        @DisplayName("Two saved rows showing the same host each update their own row")
        void routingIdKeepsLookalikeRowsApart() {
            // Seen in prod: a "*" row on school.co.in and an exact row
            // school @ co.in. Both display as school.co.in, so the form posts that
            // host twice; only the row id says which row each entry is.
            InstituteDomainRouting wildcard = new InstituteDomainRouting();
            wildcard.setId("row-star");
            wildcard.setInstituteId(INSTITUTE_ID);
            wildcard.setDomain("school.co.in");
            wildcard.setSubdomain("*");
            wildcard.setRole("LEARNER");
            givenStoredRow("school.co.in", "LEARNER", false);
            storedRows.add(wildcard);
            when(routingRepository.findById("row-0")).thenReturn(Optional.of(storedRows.get(0)));
            when(routingRepository.findById("row-star")).thenReturn(Optional.of(wildcard));

            WhiteLabelSetupRequest.DomainEntry exact = entry("school.co.in", "LEARNER", false);
            exact.setRoutingId("row-0");
            WhiteLabelSetupRequest.DomainEntry star = entry("school.co.in", "LEARNER", false);
            star.setRoutingId("row-star");

            service.setup(admin(), INSTITUTE_ID, setupRequest(exact, star));

            ArgumentCaptor<DomainRoutingUpsertRequest> captor =
                    ArgumentCaptor.forClass(DomainRoutingUpsertRequest.class);
            verify(domainRoutingAdminService).update(eq("row-0"), any());
            verify(domainRoutingAdminService).update(eq("row-star"), captor.capture());
            verify(domainRoutingAdminService, never()).create(any());
            // The "*" row keeps its shape rather than being rewritten as school @ co.in.
            assertEquals("school.co.in", captor.getValue().getDomain());
            assertEquals("*", captor.getValue().getSubdomain());
        }

        @Test
        @DisplayName("Saving a row the old apex split broke moves it to the shape portals look up")
        void brokenApexRowIsHealedOnSave() {
            // Seen in prod: stored as subdomain=myschool, domain=com.
            InstituteDomainRouting broken = new InstituteDomainRouting();
            broken.setId("row-broken");
            broken.setInstituteId(INSTITUTE_ID);
            broken.setDomain("com");
            broken.setSubdomain("myschool");
            broken.setRole("LEARNER");
            when(routingRepository.findById("row-broken")).thenReturn(Optional.of(broken));

            WhiteLabelSetupRequest.DomainEntry e = entry("myschool.com", "LEARNER", false);
            e.setRoutingId("row-broken");
            service.setup(admin(), INSTITUTE_ID, setupRequest(e));

            ArgumentCaptor<DomainRoutingUpsertRequest> captor =
                    ArgumentCaptor.forClass(DomainRoutingUpsertRequest.class);
            verify(domainRoutingAdminService).update(eq("row-broken"), captor.capture());
            assertEquals("myschool.com", captor.getValue().getDomain());
            assertEquals("*", captor.getValue().getSubdomain());
        }

        @Test
        @DisplayName("An apex domain that would override the domain's other portals is refused")
        void apexOverOtherHostsIsRefused() {
            givenStoredRow("learn.myschool.com", "LEARNER", true);

            VacademyException e = assertThrows(VacademyException.class, () -> service.setup(admin(),
                    INSTITUTE_ID, setupRequest("myschool.com", "LEARNER", false)));

            assertTrue(e.getMessage().contains("learn.myschool.com"), e.getMessage());
            verify(domainRoutingAdminService, never()).create(any());
        }

        @Test
        @DisplayName("Saving the existing apex row of a shared domain is still allowed")
        void existingApexRowStillSaves() {
            // Seen in prod: a "*" row next to www. and other subdomain rows.
            InstituteDomainRouting star = new InstituteDomainRouting();
            star.setId("row-star");
            star.setInstituteId(INSTITUTE_ID);
            star.setDomain("myschool.com");
            star.setSubdomain("*");
            star.setRole("LEARNER");
            storedRows.add(star);
            givenStoredRow("www.myschool.com", "LEARNER", false);

            service.setup(admin(), INSTITUTE_ID, setupRequest("myschool.com", "LEARNER", false));

            verify(domainRoutingAdminService).update(eq("row-star"), any());
        }

        @Test
        @DisplayName("Free-text custom role names are accepted; an over-long list is refused with a reason")
        void roleNameRules() {
            service.setup(admin(), INSTITUTE_ID,
                    setupRequest("admin.myschool.com", "ADMIN,Sales-Team,HOD's", true));
            ArgumentCaptor<DomainRoutingUpsertRequest> captor =
                    ArgumentCaptor.forClass(DomainRoutingUpsertRequest.class);
            verify(domainRoutingAdminService).create(captor.capture());
            assertEquals("ADMIN,HOD'S,SALES-TEAM", captor.getValue().getRole());

            String tooMany = "ADMIN,ASSESSMENT CREATOR,COUNSELLOR,COURSE CREATOR,CRM_ACCESS,EVALUATOR,"
                    + "MANAGE_LEAD,TEACHER,SOCIAL MEDIA TEAM";
            VacademyException e = assertThrows(VacademyException.class, () -> service.setup(admin(),
                    INSTITUTE_ID, setupRequest("staff.myschool.com", tooMany, false)));
            assertTrue(e.getMessage().contains("Too many roles"), e.getMessage());
        }

        @Test
        @DisplayName("A row id from another institute is ignored, not written through")
        void foreignRoutingIdIsIgnored() {
            InstituteDomainRouting foreign = new InstituteDomainRouting();
            foreign.setId("row-x");
            foreign.setInstituteId("someone-else");
            foreign.setDomain("myschool.com");
            foreign.setSubdomain("learn");
            foreign.setRole("LEARNER");
            when(routingRepository.findById("row-x")).thenReturn(Optional.of(foreign));

            WhiteLabelSetupRequest.DomainEntry e = entry("learn.myschool.com", "LEARNER", false);
            e.setRoutingId("row-x");
            service.setup(admin(), INSTITUTE_ID, setupRequest(e));

            verify(domainRoutingAdminService, never()).update(eq("row-x"), any());
            verify(domainRoutingAdminService).create(any());
        }

    }

    // ── getStatus() ──────────────────────────────────────────────────────────

    @Nested
    @DisplayName("getStatus()")
    class Status {

        @Test
        @DisplayName("Adopts a chosen domain that has gone live since setup — with nobody pressing anything")
        void adoptsOnceTheDomainGoesLive() {
            givenStoredRow("learn.myschool.com", "LEARNER", true);
            cloudflareStatus.put("learn.myschool.com", "active");

            WhiteLabelStatusResponse response = service.getStatus(admin(), INSTITUTE_ID);

            assertEquals("https://learn.myschool.com", institute.getLearnerPortalBaseUrl());
            assertEquals(List.of("LEARNER"), response.getRolesAdoptedNow());
            verify(instituteRepository).save(institute);
        }

        @Test
        @DisplayName("A still-pending domain is left pending — the read is not a shortcut past the gate")
        void doesNotAdoptWhilePending() {
            givenStoredRow("learn.myschool.com", "LEARNER", true);
            cloudflareStatus.put("learn.myschool.com", "pending");

            WhiteLabelStatusResponse response = service.getStatus(admin(), INSTITUTE_ID);

            assertEquals("learner.vacademy.io", institute.getLearnerPortalBaseUrl());
            assertTrue(response.getRolesAdoptedNow().isEmpty());
            verify(instituteRepository, never()).save(any());
        }

        @Test
        @DisplayName("Writes nothing for a caller who is not a member of the institute")
        void doesNotWriteForAnOutsider() {
            givenStoredRow("learn.myschool.com", "LEARNER", true);
            cloudflareStatus.put("learn.myschool.com", "active");

            service.getStatus(outsider(), INSTITUTE_ID);

            assertEquals("learner.vacademy.io", institute.getLearnerPortalBaseUrl());
            verify(instituteRepository, never()).save(any());
        }

        @Test
        @DisplayName("Reports the chosen host and the in-use host as separate facts")
        void reportsPrimaryAndPortalUrlSeparately() {
            givenStoredRow("chosen.myschool.com", "LEARNER", true);
            givenStoredRow("live.myschool.com", "LEARNER", false);
            cloudflareStatus.put("chosen.myschool.com", "pending");
            cloudflareStatus.put("live.myschool.com", "active");

            WhiteLabelStatusResponse response = service.getStatus(admin(), INSTITUTE_ID);

            // The pending choice cannot be used yet, so the live sibling claims the
            // defaulted column — and the two rows must not both claim to be "the URL".
            var chosen = response.getRoutingEntries().stream()
                    .filter(e -> "chosen".equals(e.getSubdomain())).findFirst().orElseThrow();
            var live = response.getRoutingEntries().stream()
                    .filter(e -> "live".equals(e.getSubdomain())).findFirst().orElseThrow();

            assertTrue(chosen.isPrimary());
            assertFalse(chosen.isPortalUrl());
            assertFalse(live.isPrimary());
            assertTrue(live.isPortalUrl());
        }

        @Test
        @DisplayName("Asks Cloudflare once per host, not once per use of that host")
        void doesNotDoubleQueryCloudflare() {
            givenStoredRow("learn.myschool.com", "LEARNER", true);
            cloudflareStatus.put("learn.myschool.com", "active");

            service.getStatus(admin(), INSTITUTE_ID);

            // Reconcile consults it, then the row rendering shows its status: one call.
            verify(cloudflareService, Mockito.times(1))
                    .getPagesCustomDomainStatus(LEARNER_PROJECT, "learn.myschool.com");
        }
    }
}
