package vacademy.io.admin_core_service.features.commerce.security;

import org.junit.jupiter.api.Test;
import vacademy.io.common.auth.model.CustomUserDetails;

import java.util.Set;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;

/** Setup screens open on any one commerce feature; every other refusal of the guard stands. */
class CommerceSetupAccessTest {

    private static final Set<CommerceRole> MANAGER = Set.of(CommerceRole.STORE_MANAGER);

    private final CommerceAccessGuard guard = mock(CommerceAccessGuard.class);
    private final CommerceSetupAccess access = new CommerceSetupAccess(guard);
    private final CustomUserDetails user = mock(CustomUserDetails.class);

    private static CommerceAccessDeniedException refusal(String code) {
        return new CommerceAccessDeniedException(code, "refused");
    }

    @Test
    void oneGrantedFeatureIsEnough() {
        for (CommerceFeature feature : CommerceFeature.values()) {
            if (feature != CommerceFeature.POS) {
                doThrow(refusal(CommerceAccessDeniedException.FEATURE_DISABLED))
                        .when(guard).require(user, "inst-1", feature, MANAGER);
            }
        }
        access.require(user, "inst-1", MANAGER);
        verify(guard).require(user, "inst-1", CommerceFeature.POS, MANAGER);
    }

    @Test
    void noFeatureAtAllIsRefusedAsFeatureDisabled() {
        doThrow(refusal(CommerceAccessDeniedException.FEATURE_DISABLED))
                .when(guard).require(eq(user), eq("inst-1"), any(), eq(MANAGER));
        CommerceAccessDeniedException e = assertThrows(CommerceAccessDeniedException.class,
                () -> access.require(user, "inst-1", MANAGER));
        assertEquals(CommerceAccessDeniedException.FEATURE_DISABLED, e.getCode());
        verify(guard, times(CommerceFeature.values().length)).require(eq(user), eq("inst-1"), any(), eq(MANAGER));
    }

    @Test
    void aNonMemberOrAWrongRoleIsRefusedAtOnceAndNoOtherFeatureIsTried() {
        for (String code : new String[]{CommerceAccessDeniedException.ACCESS_DENIED,
                CommerceAccessDeniedException.ROLE_NOT_ALLOWED}) {
            CommerceAccessGuard strict = mock(CommerceAccessGuard.class);
            doThrow(refusal(code)).when(strict).require(eq(user), eq("inst-1"), any(), eq(MANAGER));
            CommerceAccessDeniedException e = assertThrows(CommerceAccessDeniedException.class,
                    () -> new CommerceSetupAccess(strict).require(user, "inst-1", MANAGER));
            assertEquals(code, e.getCode());
            verify(strict, times(1)).require(eq(user), eq("inst-1"), any(), eq(MANAGER));
        }
    }
}
