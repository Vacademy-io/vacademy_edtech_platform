package vacademy.io.notification_service.features.firebase_notifications;

import com.google.firebase.ErrorCode;
import com.google.firebase.messaging.FirebaseMessaging;
import com.google.firebase.messaging.FirebaseMessagingException;
import com.google.firebase.messaging.Message;
import com.google.firebase.messaging.MessagingErrorCode;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.test.util.ReflectionTestUtils;
import vacademy.io.notification_service.features.firebase_notifications.repository.FcmTokenRepository;
import vacademy.io.notification_service.features.firebase_notifications.service.MultiTenantFirebaseManager;
import vacademy.io.notification_service.features.firebase_notifications.service.PushNotificationService;

import java.util.List;
import java.util.Map;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.*;

/**
 * A white-label institute has one Firebase key (its Android app's project) but its web users register on
 * the shared "vacademy-app" project. FCM rejects those tokens with SENDER_ID_MISMATCH — they must be
 * retried on the other configured project, not dropped, and never deactivated for it.
 */
class PushNotificationFallbackProjectTest {

    private PushNotificationService service;
    private MultiTenantFirebaseManager manager;
    private FcmTokenRepository tokenRepo;
    private FirebaseMessaging instituteProject;
    private FirebaseMessaging otherProject;

    @BeforeEach
    void setUp() {
        service = new PushNotificationService();
        manager = mock(MultiTenantFirebaseManager.class);
        tokenRepo = mock(FcmTokenRepository.class);
        ReflectionTestUtils.setField(service, "multiTenantFirebaseManager", manager);
        ReflectionTestUtils.setField(service, "fcmTokenRepository", tokenRepo);
        instituteProject = mock(FirebaseMessaging.class);
        otherProject = mock(FirebaseMessaging.class);
        when(manager.getOtherMessaging(any())).thenAnswer(inv -> inv.getArgument(0) == otherProject
                ? List.of(instituteProject) : List.of(otherProject));
    }

    private static FirebaseMessagingException fcmError(ErrorCode code, MessagingErrorCode messagingCode) {
        FirebaseMessagingException e = mock(FirebaseMessagingException.class);
        when(e.getErrorCode()).thenReturn(code);
        when(e.getMessagingErrorCode()).thenReturn(messagingCode);
        when(e.getMessage()).thenReturn(String.valueOf(messagingCode));
        return e;
    }

    private void send(String token) {
        service.sendNotificationToToken(instituteProject, token, "Tech Team", "hi", Map.of("type", "chat"));
    }

    @Test
    @DisplayName("a token the institute's project accepts never touches the fallback")
    void normalSend() throws Exception {
        when(instituteProject.send(any(Message.class))).thenReturn("ok");

        send("tokenAAAAAAAA");

        verify(instituteProject).send(any(Message.class));
        verifyNoInteractions(otherProject);
        verify(manager, never()).getOtherMessaging(any());
    }

    @Test
    @DisplayName("another project's token is delivered via that project, and remembered")
    void senderMismatchFallsBackAndRemembers() throws Exception {
        FirebaseMessagingException mismatch = fcmError(ErrorCode.PERMISSION_DENIED, MessagingErrorCode.SENDER_ID_MISMATCH);
        when(instituteProject.send(any(Message.class))).thenThrow(mismatch);
        when(otherProject.send(any(Message.class))).thenReturn("ok");

        send("webTokenBBBBBB");
        send("webTokenBBBBBB");

        verify(instituteProject, times(1)).send(any(Message.class)); // second send skipped the wrong project
        verify(otherProject, times(2)).send(any(Message.class));
        verify(tokenRepo, never()).deactivateTokenByToken(anyString());
    }

    @Test
    @DisplayName("a bare PERMISSION_DENIED (e.g. a key without FCM rights) does not fan out to other projects")
    void bareePermissionDeniedDoesNotFallBack() throws Exception {
        FirebaseMessagingException denied = fcmError(ErrorCode.PERMISSION_DENIED, null);
        when(instituteProject.send(any(Message.class))).thenThrow(denied);

        send("webTokenCCCCCC");

        verifyNoInteractions(otherProject);
        verify(tokenRepo, never()).deactivateTokenByToken(anyString());
    }

    @Test
    @DisplayName("a token no project accepts is not retried on other projects again for a while")
    void missIsRemembered() throws Exception {
        FirebaseMessagingException mismatch = fcmError(ErrorCode.PERMISSION_DENIED, MessagingErrorCode.SENDER_ID_MISMATCH);
        FirebaseMessagingException alsoMismatch = fcmError(ErrorCode.PERMISSION_DENIED, MessagingErrorCode.SENDER_ID_MISMATCH);
        when(instituteProject.send(any(Message.class))).thenThrow(mismatch);
        when(otherProject.send(any(Message.class))).thenThrow(alsoMismatch);

        send("orphanTokenFFF");
        send("orphanTokenFFF");

        verify(instituteProject, times(2)).send(any(Message.class));
        verify(otherProject, times(1)).send(any(Message.class));
    }

    @Test
    @DisplayName("a dead token is deactivated and not retried on other projects")
    void unregisteredIsDeactivatedWithoutFallback() throws Exception {
        FirebaseMessagingException unregistered = fcmError(ErrorCode.NOT_FOUND, MessagingErrorCode.UNREGISTERED);
        when(instituteProject.send(any(Message.class))).thenThrow(unregistered);

        send("deadTokenDDDDD");

        verify(tokenRepo).deactivateTokenByToken("deadTokenDDDDD");
        verifyNoInteractions(otherProject);
    }

    @Test
    @DisplayName("when no project accepts the token it is left active (not a dead-token verdict)")
    void allProjectsRejectKeepsToken() throws Exception {
        FirebaseMessagingException mismatch = fcmError(ErrorCode.PERMISSION_DENIED, MessagingErrorCode.SENDER_ID_MISMATCH);
        when(instituteProject.send(any(Message.class))).thenThrow(mismatch);
        FirebaseMessagingException unregistered = fcmError(ErrorCode.NOT_FOUND, MessagingErrorCode.UNREGISTERED);
        when(otherProject.send(any(Message.class))).thenThrow(unregistered);

        send("orphanTokenEEE");

        verify(otherProject).send(any(Message.class));
        verify(tokenRepo, never()).deactivateTokenByToken(anyString());
    }
}
