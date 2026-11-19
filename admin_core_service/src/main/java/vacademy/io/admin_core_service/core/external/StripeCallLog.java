package vacademy.io.admin_core_service.core.external;

import com.stripe.exception.ApiConnectionException;
import com.stripe.net.ApiResource;
import com.stripe.net.HttpURLConnectionClient;
import com.stripe.net.LiveStripeResponseGetter;
import com.stripe.net.StripeRequest;
import com.stripe.net.StripeResponse;
import jakarta.annotation.PostConstruct;
import org.springframework.stereotype.Component;
import vacademy.io.common.external.ExternalCallLog;

import java.nio.charset.StandardCharsets;

/**
 * Every Stripe SDK call goes through this HTTP client, so a Stripe failure (a declined payment
 * intent, a bad key, Stripe down) is recorded like any other vendor's, with the form we sent
 * (emails and card fields hidden) and Stripe's error JSON.
 */
@Component
public class StripeCallLog {

    @PostConstruct
    void install() {
        ApiResource.setStripeResponseGetter(new LiveStripeResponseGetter(new Recording()));
    }

    static final class Recording extends HttpURLConnectionClient {
        @Override
        public StripeResponse request(StripeRequest request) throws ApiConnectionException {
            StripeResponse response;
            try {
                response = super.request(request);
            } catch (ApiConnectionException e) {
                ExternalCallLog.connectionFailed(request.url(), request.method().name(), null,
                        e.getClass().getSimpleName(), sent(request), null);
                throw e;
            }
            if (response.code() >= 400) {
                String body = response.body();
                ExternalCallLog.connectionFailed(request.url(), request.method().name(), response.code(), null,
                        sent(request), body == null ? null : body.getBytes(StandardCharsets.UTF_8));
            }
            return response;
        }

        private static byte[] sent(StripeRequest request) {
            try {
                return request.content() == null ? null : request.content().byteArrayContent();
            } catch (Exception e) {
                return null;
            }
        }
    }
}
