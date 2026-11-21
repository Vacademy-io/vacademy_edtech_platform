package vacademy.io.community_service.feature.support.client;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.http.HttpEntity;
import org.springframework.test.util.ReflectionTestUtils;
import org.springframework.web.client.RestTemplate;
import vacademy.io.common.core.internal_api_wrapper.HmacUtils;
import vacademy.io.community_service.feature.support.dto.SupportRecipientDto;

import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/** The support alert goes to a route that requires this service's credentials. */
class SupportAnnouncementClientTest {

    private final RestTemplate restTemplate = mock(RestTemplate.class);
    private final HmacUtils hmacUtils = mock(HmacUtils.class);
    private final SupportAnnouncementClient client = new SupportAnnouncementClient();

    @BeforeEach
    void wire() {
        ReflectionTestUtils.setField(client, "restTemplate", restTemplate);
        ReflectionTestUtils.setField(client, "hmacUtils", hmacUtils);
        ReflectionTestUtils.setField(client, "clientName", "community_service");
        ReflectionTestUtils.setField(client, "notificationServerBaseUrl", "http://notification");
    }

    private void send() {
        client.sendSystemAlert("I1", "Reply", "<p>hi</p>", "u0", "Support",
                List.of(new SupportRecipientDto("u1", "a@example.com", "Admin")));
    }

    @Test
    @SuppressWarnings("unchecked")
    void sendsServiceCredentials() {
        when(hmacUtils.retrieveSecretKeyFromDatabase("community_service")).thenReturn("secret");

        send();

        ArgumentCaptor<HttpEntity<?>> entity = ArgumentCaptor.forClass(HttpEntity.class);
        verify(restTemplate).postForEntity(
                eq("http://notification/notification-service/v1/announcements/admin/multiple"),
                entity.capture(), eq(String.class));
        assertThat(entity.getValue().getHeaders().getFirst("clientName")).isEqualTo("community_service");
        assertThat(entity.getValue().getHeaders().getFirst("Signature")).isEqualTo("secret");
    }

    @Test
    void skipsTheCallWithoutCredentials() {
        when(hmacUtils.retrieveSecretKeyFromDatabase("community_service")).thenReturn(null);

        send();

        verify(restTemplate, never()).postForEntity(any(String.class), any(), eq(String.class));
    }
}
