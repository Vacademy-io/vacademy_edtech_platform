package vacademy.io.auth_service.feature.panel.phase2;

/**
 * Phase 1 behaviour as a plain object: no update offer and no floor. No longer a bean: the running
 * service uses {@link vacademy.io.auth_service.feature.panel.phase2.release.PanelReleaseService}. It is
 * kept only because the phase 1 constructor of PanelSessionService, which tests use, builds one.
 */
public class NoopPanelReleaseOffer implements PanelReleaseOffer {
}
