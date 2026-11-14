package vacademy.io.admin_core_service.features.ai_models.service;

import org.springframework.stereotype.Service;

import java.util.Collections;
import java.util.List;

/**
 * Model priority per use case, from ai_model_defaults.
 *
 * <p>Delegates to {@link AiModelDefaultsResolver}: [default, fallback], plus the platform's
 * non-GLM fallback when needed. It no longer appends every model whose recommended_for
 * names the use case, nor every active model - a GLM failure used to cascade into
 * gpt-5.6-terra/luna and other expensive models that nobody chose.
 */
@Service
public class AIModelRegistryService {

        private final AiModelDefaultsResolver resolver;

        public AIModelRegistryService(AiModelDefaultsResolver resolver) {
                this.resolver = resolver;
        }

        public List<String> getModelPriority(String useCase) {
                if (useCase == null || useCase.isBlank()) {
                        return Collections.emptyList();
                }
                return resolver.resolve(useCase).models();
        }
}
