package vacademy.io.community_service.feature.appregistry.build;

import org.springframework.http.client.SimpleClientHttpRequestFactory;
import org.springframework.web.client.RestTemplate;

/**
 * HTTP for the build feature's outbound calls. The dashboard polls the status endpoint every
 * 10 s while a build runs; without timeouts a hung GitHub or Firebase call would hold a
 * community_service request thread forever and the polls would pile up behind it.
 */
final class BuildHttp {

    private BuildHttp() {
    }

    static RestTemplate restTemplate() {
        SimpleClientHttpRequestFactory factory = new SimpleClientHttpRequestFactory();
        factory.setConnectTimeout(5_000);
        factory.setReadTimeout(20_000);
        return new RestTemplate(factory);
    }
}
