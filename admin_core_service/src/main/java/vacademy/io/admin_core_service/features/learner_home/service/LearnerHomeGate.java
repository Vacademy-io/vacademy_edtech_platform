package vacademy.io.admin_core_service.features.learner_home.service;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;
import vacademy.io.admin_core_service.features.capabilities.service.CapabilityResolver;

import java.util.Arrays;
import java.util.Set;
import java.util.stream.Collectors;

/**
 * The two switches in front of the builder: the opt-in capability module (also the per-institute
 * kill switch) and the institutes whose home is hard-coded in the learner app (kept outside the builder).
 */
@Component
public class LearnerHomeGate {

    public static final String FEATURE_KEY = "learner_home.builder";

    private final CapabilityResolver capabilityResolver;
    private final Set<String> hardCodedHomeInstitutes;

    public LearnerHomeGate(CapabilityResolver capabilityResolver,
                           @Value("${learner-home.hard-coded-home-institute-ids:bd9f2362-84d1-4e01-9762-a5196f9bac80}")
                           String hardCodedHomeInstituteIds) {
        this.capabilityResolver = capabilityResolver;
        this.hardCodedHomeInstitutes = Arrays.stream(hardCodedHomeInstituteIds == null ? new String[0]
                        : hardCodedHomeInstituteIds.split(","))
                .map(String::trim).filter(s -> !s.isEmpty()).collect(Collectors.toUnmodifiableSet());
    }

    public boolean moduleEnabled(String instituteId) {
        return instituteId != null && capabilityResolver.isFeatureEnabled(instituteId, FEATURE_KEY);
    }

    /** The Holistic institute: its learner home stays hard-coded (decision Q1). */
    public boolean isHolistic(String instituteId) {
        return instituteId != null && hardCodedHomeInstitutes.contains(instituteId);
    }
}
