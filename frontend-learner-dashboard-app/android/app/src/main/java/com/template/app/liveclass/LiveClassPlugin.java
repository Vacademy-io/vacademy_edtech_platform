package io.vacademy.student.app.liveclass;

import android.Manifest;
import android.app.Activity;
import android.app.PictureInPictureParams;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.media.AudioDeviceInfo;
import android.media.AudioManager;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.os.SystemClock;
import android.util.Log;
import android.util.Rational;
import android.view.Window;
import android.view.WindowManager;
import androidx.annotation.Nullable;
import androidx.annotation.RequiresApi;
import androidx.appcompat.app.AppCompatActivity;
import androidx.core.content.ContextCompat;
import androidx.lifecycle.Lifecycle;
import com.getcapacitor.Bridge;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginHandle;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;
import java.util.ArrayList;
import java.util.List;

/**
 * Native "VacademyLiveClass" Capacitor plugin (Android). Local, in-repo plugin — no npm package —
 * so it is registered explicitly by {@code MainActivity.onCreate()}, same as Immersive/offline.
 *
 * Hosts a BigBlueButton class that runs in a cross-origin iframe inside the app's own WebView.
 * The JS contract is src/lib/live-class/native-live-class.ts. The JS only switches Android to the
 * in-app class when {@code Capacitor.isPluginAvailable("VacademyLiveClass")} is true, so an app
 * without this native code keeps opening classes in a Custom Tab — this file is the gate.
 *
 *  prepare({camera})        one runtime prompt for RECORD_AUDIO (+ CAMERA) (+ BLUETOOTH_CONNECT,
 *                           optional) BEFORE the frame loads, so BBB's own getUserMedia requests
 *                           are answered synchronously by BridgeWebChromeClient (its single
 *                           permissionListener field would otherwise be raced by two prompts).
 *  enterClass({title})      keep screen on, foreground service (mic + playback survive
 *                           background / screen lock), auto picture-in-picture, loudspeaker.
 *  exitClass()              undoes all of it. Idempotent.
 *  enterPictureInPicture()  PiP now. {entered}
 *  event pictureInPictureChanged {active}  fired from MainActivity.onPictureInPictureModeChanged.
 *
 * Screenshots stay blocked: PrivacyScreen's app-wide FLAG_SECURE is never touched here.
 */
@CapacitorPlugin(
    name = LiveClassPlugin.PLUGIN_ID,
    permissions = {
        @Permission(alias = "microphone", strings = { Manifest.permission.RECORD_AUDIO }),
        @Permission(alias = "camera", strings = { Manifest.permission.CAMERA }),
        // Runtime permission only on API 31+ ("Nearby devices"); needed to use a Bluetooth
        // headset's microphone (SCO). Optional — a denial never fails prepare().
        @Permission(alias = "bluetooth", strings = { Manifest.permission.BLUETOOTH_CONNECT })
    }
)
public class LiveClassPlugin extends Plugin {

    public static final String PLUGIN_ID = "VacademyLiveClass";
    public static final String EVENT_PIP_CHANGED = "pictureInPictureChanged";

    private static final String TAG = "LiveClass";
    private static final String ALIAS_MIC = "microphone";
    private static final String ALIAS_CAMERA = "camera";
    private static final String ALIAS_BLUETOOTH = "bluetooth";

    /** How long a "a system screen is about to open" mark blocks the leave-hint PiP (API 26-30). */
    private static final long AUTO_PIP_SUPPRESS_MS = 5000L;

    // All state below is touched on the main thread only.
    private boolean classActive = false;
    /** FLAG_KEEP_SCREEN_ON was already on before enterClass — then exitClass must not clear it. */
    private boolean keepScreenOnWasSet = false;
    private boolean keepScreenOnApplied = false;
    private boolean autoPipApplied = false;
    private long autoPipSuppressedUntil = 0L;
    @Nullable
    private LiveClassAudioRouter audioRouter;
    @Nullable
    private LiveClassChromeClient chromeClient;
    private final Handler mainHandler = new Handler(Looper.getMainLooper());

    /** The loaded plugin instance on this bridge, or null (e.g. bridge failed to start). */
    @Nullable
    public static LiveClassPlugin from(@Nullable Bridge bridge) {
        if (bridge == null) return null;
        PluginHandle handle = bridge.getPlugin(PLUGIN_ID);
        if (handle == null) return null;
        Plugin instance = handle.getInstance();
        return instance instanceof LiveClassPlugin ? (LiveClassPlugin) instance : null;
    }

    /** Main thread. True between enterClass and exitClass. */
    public boolean isClassActive() {
        return classActive;
    }

    void attachChromeClient(@Nullable LiveClassChromeClient client) {
        this.chromeClient = client;
    }

    // ------------------------------------------------------------------ prepare

    @PluginMethod
    public void prepare(PluginCall call) {
        boolean wantCamera = Boolean.TRUE.equals(call.getBoolean("camera", false));

        List<String> aliases = new ArrayList<>();
        if (!isGranted(Manifest.permission.RECORD_AUDIO)) aliases.add(ALIAS_MIC);
        if (wantCamera && !isGranted(Manifest.permission.CAMERA)) aliases.add(ALIAS_CAMERA);
        if (
            Build.VERSION.SDK_INT >= Build.VERSION_CODES.S &&
            !isGranted(Manifest.permission.BLUETOOTH_CONNECT) &&
            // Ask for "Nearby devices" together with the mic/camera prompt, or on its own only when
            // a Bluetooth audio device is actually connected — never as a stray extra prompt.
            (!aliases.isEmpty() || hasBluetoothAudioOutput())
        ) {
            aliases.add(ALIAS_BLUETOOTH);
        }

        if (aliases.isEmpty()) {
            call.resolve(permissionResult());
            return;
        }

        // A system permission dialog is an activity: on API 26-30 that fires onUserLeaveHint and
        // would otherwise throw the app into PiP if a class is already running.
        suppressAutoPipForSystemUi();
        requestPermissionForAliases(aliases.toArray(new String[0]), call, "preparePermissionsCallback");
    }

    @PermissionCallback
    private void preparePermissionsCallback(PluginCall call) {
        if (call == null) return;
        // Report the real state of each permission; a denied (optional) Bluetooth grant is ignored.
        call.resolve(permissionResult());
    }

    private JSObject permissionResult() {
        JSObject result = new JSObject();
        result.put("microphone", isGranted(Manifest.permission.RECORD_AUDIO) ? "granted" : "denied");
        result.put("camera", isGranted(Manifest.permission.CAMERA) ? "granted" : "denied");
        return result;
    }

    private boolean isGranted(String permission) {
        return ContextCompat.checkSelfPermission(getContext(), permission) == PackageManager.PERMISSION_GRANTED;
    }

    private boolean hasBluetoothAudioOutput() {
        try {
            AudioManager am = (AudioManager) getContext().getSystemService(Context.AUDIO_SERVICE);
            if (am == null) return false;
            for (AudioDeviceInfo device : am.getDevices(AudioManager.GET_DEVICES_OUTPUTS)) {
                int type = device.getType();
                if (
                    type == AudioDeviceInfo.TYPE_BLUETOOTH_SCO ||
                    type == AudioDeviceInfo.TYPE_BLUETOOTH_A2DP ||
                    type == AudioDeviceInfo.TYPE_BLE_HEADSET
                ) {
                    return true;
                }
            }
        } catch (Exception e) {
            Log.w(TAG, "audio device scan failed", e);
        }
        return false;
    }

    // ------------------------------------------------------------------ enter / exit

    @PluginMethod
    public void enterClass(PluginCall call) {
        final String title = call.getString("title");
        final Activity activity = getActivity();
        if (activity == null) {
            call.reject("No activity");
            return;
        }
        activity.runOnUiThread(() -> {
            doEnterClass(activity, title);
            call.resolve();
        });
    }

    @PluginMethod
    public void exitClass(PluginCall call) {
        final Activity activity = getActivity();
        if (activity == null) {
            // Still stop the service: it must never outlive the class.
            stopLiveClassService();
            call.resolve();
            return;
        }
        activity.runOnUiThread(() -> {
            doExitClass(activity);
            call.resolve();
        });
    }

    /** Main thread. Every step is independent: one failing must not block the others. */
    private void doEnterClass(Activity activity, @Nullable String title) {
        classActive = true;

        try {
            Window window = activity.getWindow();
            if (window != null && !keepScreenOnApplied) {
                keepScreenOnWasSet = (window.getAttributes().flags & WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON) != 0;
                window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
                keepScreenOnApplied = true;
            }
        } catch (Exception e) {
            Log.w(TAG, "keep-screen-on failed", e);
        }

        // Re-sent on a second enterClass too: refreshes the notification title.
        startLiveClassService(title);

        setAutoEnterPip(activity, true);

        try {
            if (audioRouter == null) {
                audioRouter = new LiveClassAudioRouter(getContext());
                audioRouter.start();
            }
        } catch (Exception e) {
            Log.w(TAG, "audio routing failed", e);
            audioRouter = null;
        }
    }

    /** Main thread. Safe to call any number of times, with or without a class running. */
    private void doExitClass(@Nullable Activity activity) {
        classActive = false;
        autoPipSuppressedUntil = 0L;

        if (chromeClient != null) {
            try {
                chromeClient.exitFullscreenIfShowing();
            } catch (Exception e) {
                Log.w(TAG, "exit fullscreen failed", e);
            }
        }

        try {
            if (keepScreenOnApplied && activity != null && activity.getWindow() != null && !keepScreenOnWasSet) {
                activity.getWindow().clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
            }
        } catch (Exception e) {
            Log.w(TAG, "clear keep-screen-on failed", e);
        }
        keepScreenOnApplied = false;
        keepScreenOnWasSet = false;

        stopLiveClassService();

        if (activity != null) setAutoEnterPip(activity, false);

        if (audioRouter != null) {
            try {
                audioRouter.stop();
            } catch (Exception e) {
                Log.w(TAG, "audio restore failed", e);
            }
            audioRouter = null;
        }
    }

    private void startLiveClassService(@Nullable String title) {
        Context context = getContext();
        Intent intent = new Intent(context, LiveClassService.class);
        if (title != null) intent.putExtra(LiveClassService.EXTRA_TITLE, title);
        try {
            // Deliberately startService, not startForegroundService: enterClass runs while the app
            // is in the foreground (allowed), and the service then promotes itself. If that
            // promotion is refused it can simply stop — startForegroundService would instead
            // crash the app when startForeground() is never reached.
            context.startService(intent);
        } catch (Exception e) {
            // IllegalStateException on API 26+ if the app is somehow already in the background.
            Log.w(TAG, "could not start live class service", e);
        }
    }

    private void stopLiveClassService() {
        try {
            Context context = getContext();
            context.stopService(new Intent(context, LiveClassService.class));
        } catch (Exception e) {
            Log.w(TAG, "could not stop live class service", e);
        }
    }

    // ------------------------------------------------------------------ picture-in-picture

    @PluginMethod
    public void enterPictureInPicture(PluginCall call) {
        final Activity activity = getActivity();
        if (activity == null) {
            JSObject r = new JSObject();
            r.put("entered", false);
            call.resolve(r);
            return;
        }
        activity.runOnUiThread(() -> {
            JSObject r = new JSObject();
            r.put("entered", enterPipNow(activity));
            call.resolve(r);
        });
    }

    private static boolean isPipSupported(Activity activity) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return false;
        try {
            return activity.getPackageManager().hasSystemFeature(PackageManager.FEATURE_PICTURE_IN_PICTURE);
        } catch (Exception e) {
            return false;
        }
    }

    /** Main thread. */
    private boolean enterPipNow(Activity activity) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O || !isPipSupported(activity)) return false;
        try {
            if (activity.isInPictureInPictureMode()) return true;
            // These params also replace the activity's stored ones, so keep auto-enter as it is.
            return activity.enterPictureInPictureMode(buildPipParams(classActive && autoPipApplied));
        } catch (Exception e) {
            // IllegalStateException when PiP is unsupported or turned off for the app in Settings.
            Log.w(TAG, "enterPictureInPictureMode failed", e);
            return false;
        }
    }

    @RequiresApi(api = Build.VERSION_CODES.O)
    private static PictureInPictureParams buildPipParams(boolean autoEnter) {
        PictureInPictureParams.Builder builder = new PictureInPictureParams.Builder().setAspectRatio(new Rational(16, 9));
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            builder.setAutoEnterEnabled(autoEnter);
            // The class is a web page, not a video surface: don't cross-fade-resize it.
            builder.setSeamlessResizeEnabled(false);
        }
        return builder.build();
    }

    /**
     * Main thread. Android 12+ only: the system itself enters PiP when the user goes Home / swipes
     * up. On API 26-30 the same job is done by {@link #handleUserLeaveHint()}.
     */
    private void setAutoEnterPip(Activity activity, boolean enabled) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S) return;
        if (!enabled && !autoPipApplied) return;
        if (!isPipSupported(activity)) return;
        try {
            activity.setPictureInPictureParams(buildPipParams(enabled));
            autoPipApplied = enabled;
        } catch (Exception e) {
            Log.w(TAG, "setPictureInPictureParams failed", e);
        }
    }

    /**
     * A permission dialog or file picker (both are activities) is about to open from inside the
     * class. Leaving for it must not count as "the user left the app" — otherwise the class would
     * shrink into PiP behind the picker. Re-armed on the next resume (or after a few seconds).
     */
    void suppressAutoPipForSystemUi() {
        mainHandler.post(() -> {
            if (!classActive) return;
            autoPipSuppressedUntil = SystemClock.elapsedRealtime() + AUTO_PIP_SUPPRESS_MS;
            Activity activity = getActivity();
            if (activity == null) return;
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S && autoPipApplied) {
                setAutoEnterPip(activity, false);
                // If nothing actually opened (no resume will come), re-arm once the window passes.
                mainHandler.postDelayed(this::rearmAutoPipIfResumed, AUTO_PIP_SUPPRESS_MS);
            }
        });
    }

    private void rearmAutoPipIfResumed() {
        AppCompatActivity activity = getActivity();
        if (!classActive || activity == null || autoPipApplied) return;
        if (activity.getLifecycle().getCurrentState().isAtLeast(Lifecycle.State.RESUMED)) {
            autoPipSuppressedUntil = 0L;
            setAutoEnterPip(activity, true);
        }
    }

    /** Called by MainActivity.onUserLeaveHint (Home pressed / app switched) — API 26-30 path. */
    public void handleUserLeaveHint() {
        if (!classActive) return;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) return; // auto-enter does it
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        if (SystemClock.elapsedRealtime() < autoPipSuppressedUntil) return;
        Activity activity = getActivity();
        if (activity != null) enterPipNow(activity);
    }

    /** Called by MainActivity.onPictureInPictureModeChanged. */
    public void handlePictureInPictureModeChanged(boolean active) {
        JSObject data = new JSObject();
        data.put("active", active);
        notifyListeners(EVENT_PIP_CHANGED, data);
    }

    // ------------------------------------------------------------------ lifecycle

    @Override
    protected void handleOnResume() {
        super.handleOnResume();
        autoPipSuppressedUntil = 0L;
        if (classActive && !autoPipApplied) {
            Activity activity = getActivity();
            if (activity != null) setAutoEnterPip(activity, true);
        }
    }

    @Override
    protected void handleOnDestroy() {
        // The WebView (and the class with it) is going away: nothing may outlive it — no service,
        // no "class in progress" notification, no forced loudspeaker.
        mainHandler.removeCallbacksAndMessages(null);
        if (classActive || keepScreenOnApplied || audioRouter != null) {
            doExitClass(getActivity());
        } else {
            stopLiveClassService();
        }
        super.handleOnDestroy();
    }
}
