package vacademy.io.admin_core_service.features.capabilities.service;

import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import vacademy.io.admin_core_service.features.capabilities.catalog.CapabilityCatalogRegistry;
import vacademy.io.admin_core_service.features.institute.repository.InstituteRepository;
import vacademy.io.admin_core_service.features.institute.setting_history.InstituteSettingWriter;
import vacademy.io.common.exceptions.VacademyException;
import vacademy.io.common.institute.entity.Institute;

import java.util.LinkedHashMap;
import java.util.Map;

/** Tenant reads (spec §12.2): the catalogue and an institute's effective capabilities. */
@Service
public class CapabilityQueryService {

    private final CapabilityCatalogRegistry registry;
    private final CapabilityResolver resolver;
    private final InstituteRepository instituteRepository;

    public CapabilityQueryService(CapabilityCatalogRegistry registry, CapabilityResolver resolver,
                                  InstituteRepository instituteRepository) {
        this.registry = registry;
        this.resolver = resolver;
        this.instituteRepository = instituteRepository;
    }

    /** {catalog, nav}; nav null when nav-manifest.json is not on the classpath. */
    public Map<String, Object> catalog() {
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("catalog", registry.rawCatalog());
        out.put("nav", registry.navManifest());
        return out;
    }

    /** {mode, catalog_version, modules, features, display_settings_version}: effective state. */
    public Map<String, Object> me(String instituteId) {
        Institute institute = instituteRepository.findById(instituteId)
                .orElseThrow(() -> new VacademyException(HttpStatus.NOT_FOUND, "Institute not found."));
        CapabilityResolver.Snapshot snapshot = resolver.snapshot(instituteId);
        CapabilityResolver.Resolved effective = snapshot.effective();
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("mode", snapshot.mode());
        out.put("catalog_version", registry.version());
        out.put("modules", effective.modules());
        out.put("features", effective.features());
        out.put("display_settings_version", DisplaySettingsFormat.displaySettingsVersion(
                InstituteSettingWriter.settingNodes(institute.getSetting())));
        return out;
    }
}
