package io.vacademy.student.app;

import android.content.res.Configuration;
import android.os.Bundle;
import androidx.core.view.WindowCompat;
import com.getcapacitor.BridgeActivity;
import io.vacademy.student.app.immersive.ImmersivePlugin;
import io.vacademy.student.app.liveclass.LiveClassChromeClient;
import io.vacademy.student.app.liveclass.LiveClassPlugin;
import io.vacademy.student.app.offlinedownloads.OfflineDownloadsPlugin;
import io.vacademy.student.app.offlinemedia.OfflineMediaPlugin;

public class MainActivity extends BridgeActivity {
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        // OfflineMediaPlugin is a local, in-repo plugin (no npm package), so it isn't present in
        // capacitor.plugins.json's auto-registration list and must be registered manually, before
        // super.onCreate() (which is where the Bridge/WebView actually gets constructed).
        registerPlugin(OfflineMediaPlugin.class);
        registerPlugin(OfflineDownloadsPlugin.class);
        registerPlugin(ImmersivePlugin.class);
        // Live class inside the app (BBB iframe). Its presence is what lets the JS host classes
        // in-app instead of a Custom Tab: Capacitor.isPluginAvailable("VacademyLiveClass").
        registerPlugin(LiveClassPlugin.class);
        super.onCreate(savedInstanceState);
        // Enable edge-to-edge rendering so WebView extends behind status bar and navigation bar
        WindowCompat.setDecorFitsSystemWindows(getWindow(), false);
        // Working HTML fullscreen during a live class (Capacitor's stock client refuses it). Must
        // run here — after the bridge exists, before the activity is STARTED. Falls back to the
        // stock client on any failure; outside a class it behaves exactly like the stock one.
        LiveClassChromeClient.install(getBridge());
    }

    /** Home / app switch. On API 26-30 this is where a running class enters PiP. */
    @Override
    protected void onUserLeaveHint() {
        super.onUserLeaveHint();
        LiveClassPlugin liveClass = LiveClassPlugin.from(getBridge());
        if (liveClass != null) liveClass.handleUserLeaveHint();
    }

    @Override
    public void onPictureInPictureModeChanged(boolean isInPictureInPictureMode, Configuration newConfig) {
        super.onPictureInPictureModeChanged(isInPictureInPictureMode, newConfig);
        LiveClassPlugin liveClass = LiveClassPlugin.from(getBridge());
        if (liveClass != null) liveClass.handlePictureInPictureModeChanged(isInPictureInPictureMode);
    }
}
