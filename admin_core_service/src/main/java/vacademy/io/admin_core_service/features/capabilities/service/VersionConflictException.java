package vacademy.io.admin_core_service.features.capabilities.service;

import lombok.Getter;

/** The stored blob changed since the caller read it; mapped to 409 {code: "VERSION_CONFLICT"}. */
@Getter
public class VersionConflictException extends RuntimeException {

    public static final String CODE = "VERSION_CONFLICT";

    private final String currentVersion;

    public VersionConflictException(String currentVersion) {
        super("Display settings changed since they were read; reload and re-apply your edit.");
        this.currentVersion = currentVersion;
    }
}
