package vacademy.io.admin_core_service.features.telleo.controller;

import lombok.RequiredArgsConstructor;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestAttribute;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import vacademy.io.admin_core_service.core.security.InstituteAccessValidator;
import vacademy.io.admin_core_service.features.telephony.core.dto.AiCallResponseDTO;
import vacademy.io.admin_core_service.features.telleo.dto.TelleoAnswersDTO;
import vacademy.io.admin_core_service.features.telleo.dto.TelleoOnboardingStatusDTO;
import vacademy.io.admin_core_service.features.telleo.service.TelleoOnboardingService;
import vacademy.io.common.auth.model.CustomUserDetails;

/**
 * The Telleo setup page (dash.vacademy.io/telleo/setup), for the account's own staff (JWT +
 * institute membership). Every endpoint answers 404 for an institute that was not created through
 * Telleo sign-up.
 *
 * <pre>
 *   GET  /admin-core-service/v1/telleo/onboarding/{instituteId}           status
 *   POST /admin-core-service/v1/telleo/onboarding/{instituteId}/answers   save answers, set the account up
 *   POST /admin-core-service/v1/telleo/onboarding/{instituteId}/retry     run the steps that failed
 *   POST /admin-core-service/v1/telleo/onboarding/{instituteId}/call-me   the agent rings the verified phone
 * </pre>
 */
@RestController
@RequestMapping("/admin-core-service/v1/telleo/onboarding")
@RequiredArgsConstructor
public class TelleoOnboardingController {

    private final TelleoOnboardingService service;
    private final InstituteAccessValidator instituteAccessValidator;

    @GetMapping("/{instituteId}")
    public TelleoOnboardingStatusDTO status(@PathVariable("instituteId") String instituteId,
                                            @RequestAttribute("user") CustomUserDetails user) {
        instituteAccessValidator.validateUserAccess(user, instituteId);
        return service.status(instituteId);
    }

    @PostMapping("/{instituteId}/answers")
    public TelleoOnboardingStatusDTO answers(@PathVariable("instituteId") String instituteId,
                                             @RequestBody TelleoAnswersDTO answers,
                                             @RequestAttribute("user") CustomUserDetails user) {
        instituteAccessValidator.validateUserAccess(user, instituteId);
        return service.submit(instituteId, answers);
    }

    @PostMapping("/{instituteId}/retry")
    public TelleoOnboardingStatusDTO retry(@PathVariable("instituteId") String instituteId,
                                           @RequestAttribute("user") CustomUserDetails user) {
        instituteAccessValidator.validateUserAccess(user, instituteId);
        return service.retry(instituteId);
    }

    /** Body (optional): {"name": "Asha"}, the first name the agent greets. */
    @PostMapping("/{instituteId}/call-me")
    public AiCallResponseDTO callMe(@PathVariable("instituteId") String instituteId,
                                    @RequestBody(required = false) java.util.Map<String, String> body,
                                    @RequestAttribute("user") CustomUserDetails user) {
        instituteAccessValidator.validateUserAccess(user, instituteId);
        return service.callMe(instituteId, firstName(body == null ? null : body.get("name")), user.getUserId());
    }

    private static String firstName(String name) {
        if (name == null || name.isBlank()) return null;
        String first = name.trim().split("\\s+")[0].replaceAll("[^\\p{L}.'-]", "");
        return first.isEmpty() || first.length() > 40 ? null : first;
    }
}
