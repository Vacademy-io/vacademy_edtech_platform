package vacademy.io.admin_core_service.features.commerce.security;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import vacademy.io.admin_core_service.features.commerce.audit.CommerceAuditService;
import vacademy.io.admin_core_service.features.commerce.security.entity.CommerceStaffPin;
import vacademy.io.admin_core_service.features.commerce.security.repository.CommerceStaffPinRepository;
import vacademy.io.common.exceptions.InvalidRequestException;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.Date;
import java.util.Optional;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertDoesNotThrow;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.contains;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.ArgumentMatchers.isNull;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * Manager PIN: stored hashed, five wrong tries lock it, the lock passes with time, and a
 * right PIN or a new PIN clears the count. The repository is a mock holding one row.
 */
class CommercePinServiceTest {

    private static final String INSTITUTE = "inst-1";
    private static final String MANAGER = "manager-1";
    private static final Instant NOW = Instant.parse("2026-11-12T10:00:00Z");

    private CommerceStaffPinRepository repository;
    private CommercePinAttemptService attempts;
    private CommerceAuditService audit;
    private CommercePinService service;
    private CommerceStaffPin stored;

    @BeforeEach
    void setUp() {
        repository = mock(CommerceStaffPinRepository.class);
        audit = mock(CommerceAuditService.class);
        attempts = new CommercePinAttemptService(repository, audit);
        at(NOW);
        service = new CommercePinService(repository, attempts);
        when(repository.findByInstituteIdAndUserId(INSTITUTE, MANAGER)).thenAnswer(inv -> Optional.ofNullable(stored));
        when(repository.findForUpdate(INSTITUTE, MANAGER)).thenAnswer(inv -> Optional.ofNullable(stored));
        when(repository.save(any(CommerceStaffPin.class))).thenAnswer(inv -> {
            stored = inv.getArgument(0);
            return stored;
        });
    }

    private void at(Instant instant) {
        attempts.setClock(Clock.fixed(instant, ZoneOffset.UTC));
    }

    private String wrongTry() {
        return assertThrows(CommerceAccessDeniedException.class,
                () -> service.verify(INSTITUTE, MANAGER, "000000")).getCode();
    }

    @Test
    void pinIsStoredHashed() {
        service.setPin(INSTITUTE, MANAGER, "482913");
        assertNotNull(stored);
        assertEquals(INSTITUTE, stored.getInstituteId());
        assertEquals(MANAGER, stored.getUserId());
        assertNotEquals("482913", stored.getPinHash());
        assertFalse(stored.getPinHash().contains("482913"));
        assertTrue(stored.getPinHash().startsWith("$2"), "expected a BCrypt hash");
        assertDoesNotThrow(() -> service.verify(INSTITUTE, MANAGER, "482913"));
    }

    @Test
    void pinMustBeFourToEightDigits() {
        for (String bad : new String[]{null, "", "123", "123456789", "12a4", " 1234"}) {
            assertThrows(InvalidRequestException.class, () -> service.setPin(INSTITUTE, MANAGER, bad));
        }
        verify(repository, never()).save(any(CommerceStaffPin.class));
    }

    @Test
    void fiveWrongTriesLockThePinAndTheRightPinIsThenRefused() {
        service.setPin(INSTITUTE, MANAGER, "482913");
        for (int i = 1; i <= 4; i++) {
            assertEquals(CommerceAccessDeniedException.PIN_INVALID, wrongTry());
            assertEquals(i, stored.getFailedAttempts());
            assertNull(stored.getLockedUntil());
        }
        assertEquals(CommerceAccessDeniedException.PIN_LOCKED, wrongTry());
        assertEquals(5, stored.getFailedAttempts());
        assertEquals(Date.from(NOW.plus(CommercePinAttemptService.LOCK_DURATION)), stored.getLockedUntil());

        CommerceAccessDeniedException ex = assertThrows(CommerceAccessDeniedException.class,
                () -> service.verify(INSTITUTE, MANAGER, "482913"));
        assertEquals(CommerceAccessDeniedException.PIN_LOCKED, ex.getCode());
        // A try while locked is not counted and does not push the lock further out.
        assertEquals(5, stored.getFailedAttempts());
        assertEquals(Date.from(NOW.plus(CommercePinAttemptService.LOCK_DURATION)), stored.getLockedUntil());
    }

    @Test
    void lockPassesWithTimeAndTheCountStartsAgain() {
        service.setPin(INSTITUTE, MANAGER, "482913");
        for (int i = 0; i < 5; i++) {
            wrongTry();
        }
        at(NOW.plus(CommercePinAttemptService.LOCK_DURATION).plus(Duration.ofSeconds(1)));
        assertEquals(CommerceAccessDeniedException.PIN_INVALID, wrongTry());
        assertEquals(1, stored.getFailedAttempts());
        assertNull(stored.getLockedUntil());
        assertDoesNotThrow(() -> service.verify(INSTITUTE, MANAGER, "482913"));
        assertEquals(0, stored.getFailedAttempts());
    }

    @Test
    void rightPinClearsEarlierWrongTries() {
        service.setPin(INSTITUTE, MANAGER, "482913");
        for (int i = 0; i < 4; i++) {
            wrongTry();
        }
        assertDoesNotThrow(() -> service.verify(INSTITUTE, MANAGER, "482913"));
        assertEquals(0, stored.getFailedAttempts());
        for (int i = 0; i < 4; i++) {
            assertEquals(CommerceAccessDeniedException.PIN_INVALID, wrongTry());
        }
    }

    @Test
    void settingANewPinClearsTheLock() {
        service.setPin(INSTITUTE, MANAGER, "482913");
        for (int i = 0; i < 5; i++) {
            wrongTry();
        }
        service.setPin(INSTITUTE, MANAGER, "905718");
        assertEquals(0, stored.getFailedAttempts());
        assertNull(stored.getLockedUntil());
        assertDoesNotThrow(() -> service.verify(INSTITUTE, MANAGER, "905718"));
        assertEquals(CommerceAccessDeniedException.PIN_INVALID,
                assertThrows(CommerceAccessDeniedException.class,
                        () -> service.verify(INSTITUTE, MANAGER, "482913")).getCode());
    }

    @Test
    void userWithNoPinAndMissingValuesAreRefusedAsInvalid() {
        assertEquals(CommerceAccessDeniedException.PIN_INVALID, wrongTry());
        service.setPin(INSTITUTE, MANAGER, "482913");
        for (String[] args : new String[][]{{INSTITUTE, MANAGER, null}, {INSTITUTE, null, "482913"},
                {null, MANAGER, "482913"}, {"inst-2", MANAGER, "482913"}, {INSTITUTE, "someone-else", "482913"}}) {
            CommerceAccessDeniedException ex = assertThrows(CommerceAccessDeniedException.class,
                    () -> service.verify(args[0], args[1], args[2]));
            assertEquals(CommerceAccessDeniedException.PIN_INVALID, ex.getCode());
        }
    }

    @Test
    void eachLockIsLongerAndTheThirdLastsUntilANewPin() {
        service.setPin(INSTITUTE, MANAGER, "482913");
        Instant now = NOW;
        for (int i = 0; i < 5; i++) {
            wrongTry();
        }
        assertEquals(Date.from(now.plus(CommercePinAttemptService.LOCK_DURATION)), stored.getLockedUntil());
        verify(audit).record(eq(INSTITUTE), isNull(), eq("PIN_LOCKED"), eq("STAFF_PIN"), eq(MANAGER), contains("\"lock_count\":1"));

        now = now.plus(CommercePinAttemptService.LOCK_DURATION).plus(Duration.ofSeconds(1));
        at(now);
        for (int i = 0; i < 5; i++) {
            wrongTry();
        }
        assertEquals(Date.from(now.plus(CommercePinAttemptService.SECOND_LOCK_DURATION)), stored.getLockedUntil());

        now = now.plus(CommercePinAttemptService.SECOND_LOCK_DURATION).plus(Duration.ofSeconds(1));
        at(now);
        for (int i = 0; i < 5; i++) {
            wrongTry();
        }
        assertEquals(3, stored.getLockCount());
        verify(audit).record(eq(INSTITUTE), isNull(), eq("PIN_LOCKED"), eq("STAFF_PIN"), eq(MANAGER), contains("\"until_new_pin\":true"));

        // A year on, the right PIN is still refused: 480 guesses a day no longer walks the space.
        at(now.plus(Duration.ofDays(365)));
        assertEquals(CommerceAccessDeniedException.PIN_LOCKED, assertThrows(CommerceAccessDeniedException.class,
                () -> service.verify(INSTITUTE, MANAGER, "482913")).getCode());

        service.setPin(INSTITUTE, MANAGER, "905718");
        assertEquals(0, stored.getLockCount());
        assertDoesNotThrow(() -> service.verify(INSTITUTE, MANAGER, "905718"));
    }

    @Test
    void shortAndEasyPinsAreRefused() {
        for (String weak : new String[]{"4829", "48291", "111111", "123456", "654321", "0000000", "12345678"}) {
            assertThrows(InvalidRequestException.class, () -> service.setPin(INSTITUTE, MANAGER, weak), weak);
        }
        assertDoesNotThrow(() -> service.setPin(INSTITUTE, MANAGER, "112233"));
    }
}
