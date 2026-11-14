package vacademy.io.auth_service.feature.panel.service;

/** Fixed windows of the panel flows, in one place. Configurable values live in PanelProperties. */
public final class PanelTimers {

    public static final int PAIR_TTL_S = 15 * 60;
    public static final int PAIR_POLL_MS = 3000;
    public static final int REPEAT_WINDOW_S = 60;

    public static final int CHALLENGE_TTL_S = 5 * 60;
    public static final int CHALLENGE_POLL_MS = 2500;
    public static final int SCANNED_FLOOR_S = 2 * 60;
    public static final int SCANNED_CEILING_S = 10 * 60;
    public static final int REDEEM_WINDOW_S = 2 * 60;

    public static final long DEAD_MAN_MS = 60 * 60 * 1000L;

    public static final int SIGNED_OUT_SYNC_MS = 5 * 60 * 1000;
    public static final int SIGNED_IN_SYNC_MS = 60 * 1000;
    public static final int PRESENTING_SYNC_MS = 5000;
    public static final int PRESENTING_PHONE_SYNC_MS = 1000;
    /** A meeting screen is open: a sign-out from the phone or a revoke closes it this soon. */
    public static final int MEETING_SYNC_MS = 10 * 1000;

    public static final int LAST_SEEN_WRITE_S = 5 * 60;
    public static final int PANEL_SEEN_WRITE_S = 30;
    public static final int REMOTE_SEEN_WRITE_S = 10;

    public static final long PANEL_ONLINE_MS = 90 * 1000L;
    public static final long PHONE_CONNECTED_MS = 30 * 1000L;
    public static final long DEVICE_ONLINE_MS = 7 * 60 * 1000L;
    public static final long BRANDING_STALE_MS = 24 * 60 * 60 * 1000L;

    private PanelTimers() {
    }
}
