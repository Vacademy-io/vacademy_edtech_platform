package vacademy.io.common.external;

import org.springframework.boot.web.client.RestTemplateCustomizer;
import org.springframework.boot.web.reactive.function.client.WebClientCustomizer;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

/**
 * Clients Spring builds for us (an injected RestTemplateBuilder or WebClient.Builder) get the
 * failure logging without anyone remembering to add it.
 */
@Configuration
public class ExternalCallLogClients {

    @Bean
    public RestTemplateCustomizer externalCallLogRestTemplate() {
        return ExternalCallLog::attach;
    }

    @Bean
    public WebClientCustomizer externalCallLogWebClient() {
        return ExternalCallLog::attach;
    }
}
