package vacademy.io.auth_service.feature.panel.phase2;

/**
 * Stores nothing and acks nothing: the phase 1 behaviour. Not a bean. The running service uses
 * {@code usage.PanelActivityRecorder}; this class only backs the phase 1 constructor of
 * PanelSessionService that tests use.
 */
public class NoopPanelActivityIngest implements PanelActivityIngest {
}
