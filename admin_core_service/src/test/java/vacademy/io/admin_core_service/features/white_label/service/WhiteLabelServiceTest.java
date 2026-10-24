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
import vacademy.io.admin_core_service.features.white_label.dto.WhiteLabelSetupRequest;
import vacademy.io.admin_core_service.features.white_label.dto.WhiteLabelSetupResponse;
import vacademy.io.admin_core_service.features.white_label.dto.WhiteLabelStatusResponse;
import vacademy.io.common.auth.model.CustomUserDetails;
import vacademy.io.common.auth.repository.UserRoleRepository;
import vacademy.io.common.institute.entity.Institute;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
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
    private UserRoleRepository userRoleRepository;
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
        when(routingRepository.findByInstituteIdAndDomainAndSubdomainAndRole(any(), any(), any(), any()))
                .thenReturn(Optional.empty());

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

        userRoleRepository = Mockito.mock(UserRoleRepository.class);
        when(userRoleRepository.existsByUserIdAndInstituteIdAndRoleName(USER_ID, INSTITUTE_ID, "ADMIN"))
                .thenReturn(true);

        reconciler = new PortalUrlReconciler(cloudflareService);
        ReflectionTestUtils.setField(reconciler, "learnerCnameTarget", "learner.vacademy.io");
        ReflectionTestUtils.setField(reconciler, "adminCnameTarget", "dash.vacademy.io");
        ReflectionTestUtils.setField(reconciler, "teacherCnameTarget", "teacher.vacademy.io");
        ReflectionTestUtils.setField(reconciler, "learnerPagesProject", LEARNER_PROJECT);
        ReflectionTestUtils.setField(reconciler, "adminPagesProject", ADMIN_PROJECT);
        ReflectionTestUtils.setField(reconciler, "vacademyBaseDomain", "vacademy.io");

        service = new WhiteLabelService(instituteRepository, routingRepository,
                domainRoutingAdminService, cloudflareService, userRoleRepository, reconciler);
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
