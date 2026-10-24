package vacademy.io.admin_core_service.features.telephony.providers;

import org.junit.jupiter.api.Nested;
import org.junit.jupiter.api.Test;
import vacademy.io.admin_core_service.features.telephony.core.UserMobileResolver;
import vacademy.io.admin_core_service.features.telephony.core.VoiceCallingSettingsService;
import vacademy.io.admin_core_service.features.telephony.enums.ProviderType;
import vacademy.io.admin_core_service.features.telephony.persistence.entity.TelephonyCounsellorEndpoint;
import vacademy.io.admin_core_service.features.telephony.persistence.repository.TelephonyCounsellorEndpointRepository;
import vacademy.io.admin_core_service.features.telephony.providers.airtel.AirtelOriginationResolver;
import vacademy.io.admin_core_service.features.telephony.providers.exotel.ExotelOriginationResolver;
import vacademy.io.admin_core_service.features.telephony.providers.plivo.PlivoOriginationResolver;
import vacademy.io.admin_core_service.features.telephony.persistence.repository.TelephonyCallLogRepository;
import vacademy.io.common.exceptions.VacademyException;

import java.lang.reflect.Field;
import java.util.List;
import java.util.Optional;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

/**
 * Pre-flight readiness: "can THIS person place a call", asked before we know who
 * they are dialling, so the Call button can be disabled with an actionable
 * reason instead of failing after a click that may cost provider credits.
 *
 * <p>These exist because the first Airtel implementation inverted its own
 * answer. It chained {@code .map(e -> ready ? null : REASON)}, and
 * {@code Optional.map} turns a null mapper result into an EMPTY Optional — so
 * the ready case became indistinguishable from "no endpoint row" and fell
 * through to the not-mapped branch. The only people reported as blocked were
 * the ones correctly configured, which disabled calling for every Airtel
 * counsellor and admin who had an extension. Every branch is pinned here.
 */
class CallerReadinessTest {

    private static final String INSTITUTE = "inst-1";
    private static final String USER = "user-1";

    /** These resolvers take their collaborators by field injection, so the test
     *  sets them directly rather than standing up a Spring context. */
    private static void inject(Object target, String field, Object value) {
        try {
            Field f = target.getClass().getDeclaredField(field);
            f.setAccessible(true);
            f.set(target, value);
        } catch (ReflectiveOperationException e) {
            throw new IllegalStateException("could not inject " + field, e);
        }
    }

    private static TelephonyCounsellorEndpoint endpoint(String extension, boolean enabled) {
        TelephonyCounsellorEndpoint ep = new TelephonyCounsellorEndpoint();
        ep.setInstituteId(INSTITUTE);
        ep.setCounsellorUserId(USER);
        ep.setProviderType(ProviderType.AIRTEL);
        ep.setExtension(extension);
        ep.setEnabled(enabled);
        return ep;
    }

    @Nested
    class Airtel {

        private AirtelOriginationResolver resolverWith(Optional<TelephonyCounsellorEndpoint> row) {
            TelephonyCounsellorEndpointRepository repo =
                    mock(TelephonyCounsellorEndpointRepository.class);
            when(repo.findByCounsellorUserIdAndProviderType(anyString(), eq(ProviderType.AIRTEL)))
                    .thenReturn(row);
            AirtelOriginationResolver resolver = new AirtelOriginationResolver();
            inject(resolver, "endpointRepo", repo);
            return resolver;
        }

        /** The regression: a correctly-mapped extension must read as READY. */
        @Test
        void mappedExtensionIsReady() {
            Optional<String> blocked = resolverWith(Optional.of(endpoint("447", true)))
                    .callerBlockedReason(INSTITUTE, USER);
            assertTrue(blocked.isEmpty(),
                    "an enabled endpoint with an extension must not be reported blocked, got: "
                            + blocked.orElse(""));
        }

        @Test
        void noEndpointRowIsBlocked() {
            Optional<String> blocked = resolverWith(Optional.empty())
                    .callerBlockedReason(INSTITUTE, USER);
            assertTrue(blocked.isPresent());
            assertTrue(blocked.get().contains("extension"),
                    "reason should name the missing extension");
        }

        @Test
        void endpointWithBlankExtensionIsBlocked() {
            assertTrue(resolverWith(Optional.of(endpoint("  ", true)))
                    .callerBlockedReason(INSTITUTE, USER).isPresent());
            assertTrue(resolverWith(Optional.of(endpoint(null, true)))
                    .callerBlockedReason(INSTITUTE, USER).isPresent());
        }

        /** A disabled mapping is the admin's way of revoking calling. */
        @Test
        void disabledEndpointIsBlocked() {
            assertTrue(resolverWith(Optional.of(endpoint("447", false)))
                    .callerBlockedReason(INSTITUTE, USER).isPresent());
        }

        @Test
        void blankCallerIsBlocked() {
            AirtelOriginationResolver resolver = resolverWith(Optional.of(endpoint("447", true)));
            assertTrue(resolver.callerBlockedReason(INSTITUTE, null).isPresent());
            assertTrue(resolver.callerBlockedReason(INSTITUTE, "  ").isPresent());
        }
    }

    @Nested
    class VerifiedMobileProviders {

        private ExotelOriginationResolver exotel(UserMobileResolver mobiles) {
            return new ExotelOriginationResolver(mobiles, mock(TelephonyCallLogRepository.class),
                    List.of());
        }

        private PlivoOriginationResolver plivo(UserMobileResolver mobiles) {
            return new PlivoOriginationResolver(mobiles, mock(VoiceCallingSettingsService.class));
        }

        @Test
        void mobileOnFileIsReady() {
            UserMobileResolver mobiles = mock(UserMobileResolver.class);
            when(mobiles.findVerifiedMobileStrict(USER)).thenReturn(Optional.of("+919000000000"));
            assertTrue(exotel(mobiles).callerBlockedReason(INSTITUTE, USER).isEmpty());
            assertTrue(plivo(mobiles).callerBlockedReason(INSTITUTE, USER).isEmpty());
        }

        @Test
        void noMobileIsBlocked() {
            UserMobileResolver mobiles = mock(UserMobileResolver.class);
            when(mobiles.findVerifiedMobileStrict(USER)).thenReturn(Optional.empty());
            assertTrue(exotel(mobiles).callerBlockedReason(INSTITUTE, USER).isPresent());
            assertTrue(plivo(mobiles).callerBlockedReason(INSTITUTE, USER).isPresent());
        }

        /**
         * A lookup FAILURE must escape, not be reported as "no mobile". The
         * orchestrator catches it and leaves the button enabled — an
         * auth_service blip must never tell a counsellor to add a number they
         * already have, nor disable calling that would otherwise work.
         */
        @Test
        void lookupFailurePropagatesSoTheCallerCanFailOpen() {
            UserMobileResolver mobiles = mock(UserMobileResolver.class);
            when(mobiles.findVerifiedMobileStrict(USER))
                    .thenThrow(new VacademyException("auth_service down"));
            assertEquals("auth_service down",
                    org.junit.jupiter.api.Assertions.assertThrows(VacademyException.class,
                            () -> exotel(mobiles).callerBlockedReason(INSTITUTE, USER))
                            .getMessage());
            org.junit.jupiter.api.Assertions.assertThrows(VacademyException.class,
                    () -> plivo(mobiles).callerBlockedReason(INSTITUTE, USER));
        }
    }
}
