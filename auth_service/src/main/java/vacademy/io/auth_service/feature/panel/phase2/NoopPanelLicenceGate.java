package vacademy.io.auth_service.feature.panel.phase2;

/**
 * Phase 1 behaviour (every room may start sessions, nothing shown), for the phase 1 constructors of
 * the panel services that tests use. Not a bean: the application's {@link PanelLicenceGate} is
 * {@link vacademy.io.auth_service.feature.panel.phase2.licence.PanelLicenceService}.
 */
public class NoopPanelLicenceGate implements PanelLicenceGate {
}
