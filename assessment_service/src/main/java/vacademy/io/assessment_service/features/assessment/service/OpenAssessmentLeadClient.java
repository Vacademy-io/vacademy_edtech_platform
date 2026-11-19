package vacademy.io.assessment_service.features.assessment.service;

import jakarta.annotation.PostConstruct;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpEntity;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.client.SimpleClientHttpRequestFactory;
import org.springframework.scheduling.annotation.Async;
import org.springframework.stereotype.Service;
import org.springframework.web.client.RestTemplate;
import vacademy.io.common.core.internal_api_wrapper.HmacUtils;

import java.util.Map;

/**
 * Sends open-assessment events to admin_core's {@code /internal/open-assessment-leads}, which
 * keeps the test's own lead list up to date. Fire-and-forget on its own bounded pool
 * (OpenAssessmentLeadExecutorConfig), never the workflow-trigger one; a failure is logged and
 * never reaches the learner.
 */
@Slf4j
@Service
public class OpenAssessmentLeadClient {

    private RestTemplate restTemplate;

    private final HmacUtils hmacUtils;

    public OpenAssessmentLeadClient(HmacUtils hmacUtils) {
        this.hmacUtils = hmacUtils;
    }

    @Value("${admin.core.service.baseurl:http://admin-core-service:8072}")
    private String adminCoreServiceUrl;

    @Value("${spring.application.name:assessment_service}")
    private String clientName;

    @PostConstruct
    void init() {
        SimpleClientHttpRequestFactory factory = new SimpleClientHttpRequestFactory();
        factory.setConnectTimeout(2000);
        factory.setReadTimeout(10000);
        this.restTemplate = new RestTemplate(factory);
    }

    /** @param action registration | result */
    @Async(OpenAssessmentLeadExecutorConfig.EXECUTOR)
    public void send(String action, Map<String, Object> body) {
        try {
            String secretKey = hmacUtils.retrieveSecretKeyFromDatabase(clientName);
            if (secretKey == null) {
                log.warn("No client secret for {} — dropping open-assessment lead event {}", clientName, action);
                return;
            }
            HttpHeaders headers = new HttpHeaders();
            headers.setContentType(MediaType.APPLICATION_JSON);
            headers.set("clientName", clientName);
            headers.set("Signature", secretKey);
            restTemplate.postForEntity(
                    adminCoreServiceUrl + "/admin-core-service/internal/open-assessment-leads/" + action,
                    new HttpEntity<>(body, headers), Void.class);
        } catch (Exception e) {
            log.warn("Open-assessment lead event {} for assessment {} failed: {}",
                    action, body != null ? body.get("assessmentId") : null, e.getMessage());
        }
    }
}
