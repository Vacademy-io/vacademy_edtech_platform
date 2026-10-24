package vacademy.io.admin_core_service.features.domain_routing.service;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Nested;
import org.junit.jupiter.api.Test;
import org.mockito.Mockito;
import vacademy.io.admin_core_service.features.domain_routing.dto.DomainRoutingUpsertRequest;
import vacademy.io.admin_core_service.features.domain_routing.entity.InstituteDomainRouting;
import vacademy.io.admin_core_service.features.domain_routing.repository.InstituteDomainRoutingRepository;

import java.util.Optional;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.when;

/**
 * Pins the auth flags a routing row is written with.
 *
 * <p>The bug: these columns are nullable and nothing filled them in, but the two
 * screens reading them disagree about what null means. The login pages treat a
 * null {@code allow_*} as permitted ({@code allowSignup !== false}); the
 * white-label wizard renders the same null as an OFF switch
 * ({@code checked={!!config[field]}}). Admins configured a portal looking at six
 * switches reading "off", saved, and shipped one with all six on — self-signup
 * included. No row may leave this service with a null flag again.
 */
class DomainRoutingAdminServiceTest {

    private InstituteDomainRoutingRepository repository;
    private DomainRoutingAdminService service;

    @BeforeEach
    void setUp() {
        repository = Mockito.mock(InstituteDomainRoutingRepository.class);
        when(repository.save(any(InstituteDomainRouting.class)))
                .thenAnswer(inv -> inv.getArgument(0));
        service = new DomainRoutingAdminService(repository);
    }

    /** The minimum a request needs to pass validation. */
    private static DomainRoutingUpsertRequest bareRequest() {
        DomainRoutingUpsertRequest r = new DomainRoutingUpsertRequest();
        r.setInstituteId("inst-1");
        r.setDomain("myschool.com");
        r.setSubdomain("learn");
        r.setRole("LEARNER");
        return r;
    }

    private static InstituteDomainRouting existingRow() {
        InstituteDomainRouting row = new InstituteDomainRouting();
        row.setId("row-1");
        row.setInstituteId("inst-1");
        row.setDomain("myschool.com");
        row.setSubdomain("learn");
        row.setRole("LEARNER");
        return row;
    }

    @Nested
    @DisplayName("phoneCountryGeoMode")
    class PhoneCountryGeoMode {

        @Test
        @DisplayName("A caller that never heard of the field cannot wipe a portal's chosen mode")
        void updateWithoutTheFieldKeepsIt() {
            // Same trap as subOrgId and primary: the white-label wizard is the only
            // thing that sets this, and its save round-trips through update(). A
            // generic-CRUD caller, a script, or a stale frontend bundle saving an
            // unrelated change sends no mode — blanking on null would silently
            // revert the portal to INSTITUTE_FIRST with nothing to notice it by.
            InstituteDomainRouting existing = existingRow();
            existing.setPhoneCountryGeoMode("GEO_FIRST");
            when(repository.findById("row-1")).thenReturn(Optional.of(existing));

            DomainRoutingUpsertRequest request = bareRequest();
            assertNull(request.getPhoneCountryGeoMode(), "precondition: request omits the field");

            InstituteDomainRouting updated = service.update("row-1", request).orElseThrow();

            assertEquals("GEO_FIRST", updated.getPhoneCountryGeoMode());
        }

        @Test
        @DisplayName("An explicit mode still overwrites, and is canonicalised")
        void updateWithTheFieldSetsIt() {
            InstituteDomainRouting existing = existingRow();
            existing.setPhoneCountryGeoMode("GEO_FIRST");
            when(repository.findById("row-1")).thenReturn(Optional.of(existing));

            DomainRoutingUpsertRequest request = bareRequest();
            request.setPhoneCountryGeoMode("  institute_only ");

            InstituteDomainRouting updated = service.update("row-1", request).orElseThrow();

            assertEquals("INSTITUTE_ONLY", updated.getPhoneCountryGeoMode());
        }

        @Test
        @DisplayName("A new row that never chose a mode stores null, not a stamped default")
        void createLeavesItNull() {
            // Null is what every pre-migration row holds and what the resolve
            // endpoint reads as INSTITUTE_FIRST. Stamping the default here would
            // make "never chose" indistinguishable from "chose the default".
            assertNull(service.create(bareRequest()).getPhoneCountryGeoMode());
        }
    }

    @Nested
    @DisplayName("create()")
    class Create {

        @Test
        @DisplayName("Self-signup is off unless somebody asked for it")
        void signupDefaultsOff() {
            InstituteDomainRouting created = service.create(bareRequest());

            assertEquals(Boolean.FALSE, created.getAllowSignup());
        }

        @Test
        @DisplayName("Auth methods read as `!== false` are written down as true — what null already did")
        void authMethodsDefaultOn() {
            InstituteDomainRouting created = service.create(bareRequest());

            assertEquals(Boolean.TRUE, created.getAllowGoogleAuth());
            assertEquals(Boolean.TRUE, created.getAllowGithubAuth());
            assertEquals(Boolean.TRUE, created.getAllowEmailOtpAuth());
            assertEquals(Boolean.TRUE, created.getAllowUsernamePasswordAuth());
        }

        @Test
        @DisplayName("Phone auth defaults OFF — the frontends read it as `=== true`, so null already meant off")
        void phoneAuthDefaultsOff() {
            // Not an inconsistency for its own sake: login-form.tsx on BOTH
            // dashboards reads `allowPhoneAuth === true`, and step-two-form /
            // useInviteForm use it to decide whether a learner is enrolled with a
            // phone number as their username. Defaulting it true would switch phone
            // login on for portals that never asked, and change how they enrol.
            assertEquals(Boolean.FALSE, service.create(bareRequest()).getAllowPhoneAuth());
        }

        @Test
        @DisplayName("No flag is ever left null")
        void noFlagIsNull() {
            InstituteDomainRouting c = service.create(bareRequest());

            assertTrue(c.getAllowSignup() != null
                    && c.getAllowGoogleAuth() != null
                    && c.getAllowGithubAuth() != null
                    && c.getAllowEmailOtpAuth() != null
                    && c.getAllowPhoneAuth() != null
                    && c.getAllowUsernamePasswordAuth() != null,
                    "a null flag survived create()");
        }

        @Test
        @DisplayName("An explicit choice always beats the default")
        void explicitValuesWin() {
            DomainRoutingUpsertRequest req = bareRequest();
            req.setAllowSignup(true);
            req.setAllowGithubAuth(false);
            req.setAllowPhoneAuth(true);

            InstituteDomainRouting created = service.create(req);

            assertEquals(Boolean.TRUE, created.getAllowSignup());
            assertEquals(Boolean.FALSE, created.getAllowGithubAuth());
            assertEquals(Boolean.TRUE, created.getAllowPhoneAuth());
        }
    }

    @Nested
    @DisplayName("sub-org linkage")
    class SubOrgLinkage {

        @Test
        @DisplayName("A save that carries no sub-org field must NOT unlink the portal")
        void omittedSubOrgIsPreserved() {
            // This is what the white-label wizard used to post: a routing config with
            // no sub-org field at all. It was blanking sub_org_id on every save —
            // reverting the portal to parent branding and disabling the
            // portalSubOrgId login check, after which any sub-org admin could sign in
            // on any sibling sub-org's portal.
            InstituteDomainRouting row = existingRow();
            row.setSubOrgId("sub-org-9");
            when(repository.findById("row-1")).thenReturn(Optional.of(row));

            InstituteDomainRouting updated = service.update("row-1", bareRequest()).orElseThrow();

            assertEquals("sub-org-9", updated.getSubOrgId());
        }

        @Test
        @DisplayName("An explicit id re-points the portal at another sub-org")
        void explicitSubOrgIsApplied() {
            InstituteDomainRouting row = existingRow();
            row.setSubOrgId("sub-org-9");
            when(repository.findById("row-1")).thenReturn(Optional.of(row));

            DomainRoutingUpsertRequest req = bareRequest();
            req.setSubOrgId("sub-org-42");

            assertEquals("sub-org-42", service.update("row-1", req).orElseThrow().getSubOrgId());
        }

        @Test
        @DisplayName("A blank string is the way to unlink — null can no longer mean clear")
        void blankStringClearsTheLink() {
            InstituteDomainRouting row = existingRow();
            row.setSubOrgId("sub-org-9");
            when(repository.findById("row-1")).thenReturn(Optional.of(row));

            DomainRoutingUpsertRequest req = bareRequest();
            req.setSubOrgId("   ");

            assertNull(service.update("row-1", req).orElseThrow().getSubOrgId());
        }

        @Test
        @DisplayName("A blank id on create stores null rather than an empty string")
        void blankOnCreateIsNull() {
            DomainRoutingUpsertRequest req = bareRequest();
            req.setSubOrgId("");

            assertNull(service.create(req).getSubOrgId());
        }
    }

    @Nested
    @DisplayName("update()")
    class Update {

        @Test
        @DisplayName("A partial payload does not switch off what the institute turned on")
        void omittedFieldKeepsStoredValue() {
            InstituteDomainRouting row = existingRow();
            row.setAllowSignup(true);
            row.setAllowGithubAuth(false);
            row.setAllowPhoneAuth(true);
            when(repository.findById("row-1")).thenReturn(Optional.of(row));

            // The generic CRUD callers post payloads without these fields at all.
            InstituteDomainRouting updated = service.update("row-1", bareRequest()).orElseThrow();

            assertEquals(Boolean.TRUE, updated.getAllowSignup(), "an enabled signup was silently revoked");
            assertEquals(Boolean.FALSE, updated.getAllowGithubAuth(), "a disabled method was silently re-enabled");
            assertEquals(Boolean.TRUE, updated.getAllowPhoneAuth(), "an enabled phone login was silently revoked");
        }

        @Test
        @DisplayName("A row still holding nulls is healed on the next save")
        void nullsAreHealed() {
            when(repository.findById("row-1")).thenReturn(Optional.of(existingRow()));

            InstituteDomainRouting updated = service.update("row-1", bareRequest()).orElseThrow();

            assertEquals(Boolean.FALSE, updated.getAllowSignup());
            assertEquals(Boolean.FALSE, updated.getAllowPhoneAuth());
            assertEquals(Boolean.TRUE, updated.getAllowUsernamePasswordAuth());
            assertEquals(Boolean.TRUE, updated.getAllowEmailOtpAuth());
        }

        @Test
        @DisplayName("Turning a switch off is still honoured")
        void explicitFalseIsApplied() {
            InstituteDomainRouting row = existingRow();
            row.setAllowSignup(true);
            row.setAllowGoogleAuth(true);
            when(repository.findById("row-1")).thenReturn(Optional.of(row));

            DomainRoutingUpsertRequest req = bareRequest();
            req.setAllowSignup(false);
            req.setAllowGoogleAuth(false);

            InstituteDomainRouting updated = service.update("row-1", req).orElseThrow();

            assertFalse(updated.getAllowSignup());
            assertFalse(updated.getAllowGoogleAuth());
        }
    }
}
