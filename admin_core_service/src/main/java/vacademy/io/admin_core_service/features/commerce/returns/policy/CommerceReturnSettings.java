package vacademy.io.admin_core_service.features.commerce.returns.policy;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Component;
import vacademy.io.admin_core_service.features.commerce.stock.service.CommerceStockSettings;
import vacademy.io.admin_core_service.features.institute.service.setting.InstituteSettingService;

/** Reads {@code COMMERCE_SETTING.returns} of an institute; a read that fails gives the defaults. */
@Slf4j
@Component
public class CommerceReturnSettings {

    public static final String KEY = "returns";

    private final InstituteSettingService instituteSettingService;
    private final ObjectMapper objectMapper;

    public CommerceReturnSettings(InstituteSettingService instituteSettingService, ObjectMapper objectMapper) {
        this.instituteSettingService = instituteSettingService;
        this.objectMapper = objectMapper;
    }

    public CommerceReturnPolicy.Settings read(String instituteId) {
        try {
            Object data = instituteSettingService.getSettingByInstituteIdAndKey(instituteId,
                    CommerceStockSettings.SETTING_KEY);
            if (data == null) {
                return CommerceReturnPolicy.defaults();
            }
            JsonNode tree = objectMapper.valueToTree(data);
            return CommerceReturnPolicy.parse(tree == null ? null : tree.get(KEY));
        } catch (RuntimeException e) {
            log.warn("Could not read the return policy of institute {}; defaults apply: {}", instituteId,
                    e.getMessage());
            return CommerceReturnPolicy.defaults();
        }
    }
}
