package io.vacademy.student.app.liveclass;

import android.Manifest;
import android.app.Activity;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.net.Uri;
import android.util.Log;
import android.view.View;
import android.view.ViewGroup;
import android.view.ViewParent;
import android.view.Window;
import android.webkit.PermissionRequest;
import android.webkit.ValueCallback;
import android.webkit.WebView;
import android.widget.FrameLayout;
import androidx.activity.OnBackPressedCallback;
import androidx.annotation.Nullable;
import androidx.appcompat.app.AppCompatActivity;
import androidx.core.content.ContextCompat;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;
import com.getcapacitor.Bridge;
import com.getcapacitor.BridgeWebChromeClient;
import java.util.Arrays;
import java.util.List;

/**
 * Capacitor's BridgeWebChromeClient with working HTML fullscreen DURING A LIVE CLASS.
 *
 * Stock {@code BridgeWebChromeClient.onShowCustomView} calls {@code callback.onCustomViewHidden()}
 * straight away, so element.requestFullscreen() (BBB presentation / webcam fullscreen) is dead.
 * While a class is active this subclass shows the fullscreen view in a black container on top of
 * the decor view and hides the system bars (swipe brings them back). Outside a class it defers to
 * the stock behaviour, so the rest of the app (assessments / proctoring, course videos) behaves
 * exactly as before.
 *
 * Everything else — file chooser, getUserMedia permissions, JS dialogs, console, geolocation — is
 * inherited untouched. The two extra overrides (permissions, file chooser) only mark "a system
 * screen is about to open" for the PiP logic, then call super.
 *
 * Capacitor 7.4 has no supported hook for a custom WebChromeClient (Bridge only exposes
 * setWebViewClient), so MainActivity installs this with WebView.setWebChromeClient right after
 * the bridge is created — still inside onCreate, i.e. before the activity is STARTED, which
 * BridgeWebChromeClient's constructor needs (it registers ActivityResult launchers).
 */
public class LiveClassChromeClient extends BridgeWebChromeClient {

    private static final String TAG = "LiveClassChrome";

    private final Bridge bridge;

    @Nullable
    private View customView;
    @Nullable
    private CustomViewCallback customViewCallback;
    @Nullable
    private FrameLayout fullscreenContainer;
    @Nullable
    private OnBackPressedCallback backCallback;
    private boolean systemBarsWereVisible = true;

    public LiveClassChromeClient(Bridge bridge) {
        super(bridge);
        this.bridge = bridge;
    }

    /**
     * Swap the bridge WebView's chrome client for this one. Call from MainActivity.onCreate after
     * super.onCreate(). Any failure leaves Capacitor's stock client in place.
     */
    public static void install(@Nullable Bridge bridge) {
        if (bridge == null) return;
        try {
            WebView webView = bridge.getWebView();
            if (webView == null) return;
            LiveClassChromeClient client = new LiveClassChromeClient(bridge);
            webView.setWebChromeClient(client);
            LiveClassPlugin plugin = LiveClassPlugin.from(bridge);
            if (plugin != null) plugin.attachChromeClient(client);
        } catch (Exception e) {
            Log.w(TAG, "could not install live class chrome client; keeping Capacitor's", e);
        }
    }

    private boolean classActive() {
        LiveClassPlugin plugin = LiveClassPlugin.from(bridge);
        return plugin != null && plugin.isClassActive();
    }

    // ------------------------------------------------------------------ fullscreen

    @Override
    public void onShowCustomView(View view, CustomViewCallback callback) {
        if (!classActive()) {
            // Stock Capacitor behaviour (refuses fullscreen) everywhere outside a live class.
            super.onShowCustomView(view, callback);
            return;
        }
        AppCompatActivity activity = bridge.getActivity();
        if (activity == null || activity.isFinishing() || view == null) {
            if (callback != null) callback.onCustomViewHidden();
            return;
        }
        if (customView != null) {
            // A second element went fullscreen without the first exiting: replace it.
            exitFullscreenIfShowing();
        }

        try {
            Window window = activity.getWindow();
            ViewGroup decor = (ViewGroup) window.getDecorView();

            FrameLayout container = new FrameLayout(activity);
            container.setBackgroundColor(Color.BLACK);
            ViewParent oldParent = view.getParent();
            if (oldParent instanceof ViewGroup) ((ViewGroup) oldParent).removeView(view);
            container.addView(
                view,
                new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT)
            );

            // Take ownership before attaching, so any failure below is cleaned up by
            // exitFullscreenIfShowing() (which also tells the page via the callback).
            customView = view;
            customViewCallback = callback;
            fullscreenContainer = container;

            decor.addView(
                container,
                new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT)
            );

            WindowInsetsCompat insets = ViewCompat.getRootWindowInsets(decor);
            systemBarsWereVisible = insets == null || insets.isVisible(WindowInsetsCompat.Type.statusBars());
            WindowInsetsControllerCompat controller = WindowCompat.getInsetsController(window, decor);
            controller.setSystemBarsBehavior(WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
            controller.hide(WindowInsetsCompat.Type.systemBars());

            // Back while fullscreen = leave fullscreen (not leave the class). Only registered while
            // fullscreen is showing; the app's normal back handling is untouched otherwise.
            backCallback = new OnBackPressedCallback(true) {
                @Override
                public void handleOnBackPressed() {
                    exitFullscreenIfShowing();
                }
            };
            activity.getOnBackPressedDispatcher().addCallback(backCallback);
        } catch (Exception e) {
            Log.w(TAG, "could not show fullscreen view", e);
            boolean owned = customView != null;
            exitFullscreenIfShowing();
            // Failed before taking ownership: still tell the page fullscreen ended.
            if (!owned && callback != null) {
                try {
                    callback.onCustomViewHidden();
                } catch (Exception ignored) {}
            }
        }
    }

    @Override
    public void onHideCustomView() {
        if (customView == null && fullscreenContainer == null) {
            super.onHideCustomView();
            return;
        }
        exitFullscreenIfShowing();
    }

    /** Main thread. Tear the fullscreen view down (if any) and tell the page. Idempotent. */
    void exitFullscreenIfShowing() {
        View view = customView;
        CustomViewCallback callback = customViewCallback;
        FrameLayout container = fullscreenContainer;
        customView = null;
        customViewCallback = null;
        fullscreenContainer = null;

        if (backCallback != null) {
            backCallback.remove();
            backCallback = null;
        }
        if (view == null && container == null) return;

        if (container != null) {
            container.removeAllViews();
            ViewParent parent = container.getParent();
            if (parent instanceof ViewGroup) ((ViewGroup) parent).removeView(container);
        }

        Activity activity = bridge.getActivity();
        if (activity != null && systemBarsWereVisible) {
            try {
                Window window = activity.getWindow();
                WindowCompat.getInsetsController(window, window.getDecorView()).show(WindowInsetsCompat.Type.systemBars());
            } catch (Exception ignored) {}
        }
        systemBarsWereVisible = true;

        // Fields are already cleared, so the onHideCustomView this may trigger is a no-op.
        if (callback != null) {
            try {
                callback.onCustomViewHidden();
            } catch (Exception ignored) {}
        }
    }

    // ------------------------------------------------------------------ PiP guards

    @Override
    public void onPermissionRequest(final PermissionRequest request) {
        if (classActive() && willShowPermissionDialog(request)) {
            LiveClassPlugin plugin = LiveClassPlugin.from(bridge);
            if (plugin != null) plugin.suppressAutoPipForSystemUi();
        }
        super.onPermissionRequest(request);
    }

    @Override
    public boolean onShowFileChooser(
        WebView webView,
        ValueCallback<Uri[]> filePathCallback,
        FileChooserParams fileChooserParams
    ) {
        if (classActive()) {
            LiveClassPlugin plugin = LiveClassPlugin.from(bridge);
            if (plugin != null) plugin.suppressAutoPipForSystemUi();
        }
        return super.onShowFileChooser(webView, filePathCallback, fileChooserParams);
    }

    private boolean willShowPermissionDialog(PermissionRequest request) {
        try {
            List<String> resources = Arrays.asList(request.getResources());
            if (resources.contains(PermissionRequest.RESOURCE_VIDEO_CAPTURE) && !granted(Manifest.permission.CAMERA)) {
                return true;
            }
            return resources.contains(PermissionRequest.RESOURCE_AUDIO_CAPTURE) && !granted(Manifest.permission.RECORD_AUDIO);
        } catch (Exception e) {
            return false;
        }
    }

    private boolean granted(String permission) {
        return ContextCompat.checkSelfPermission(bridge.getContext(), permission) == PackageManager.PERMISSION_GRANTED;
    }
}
