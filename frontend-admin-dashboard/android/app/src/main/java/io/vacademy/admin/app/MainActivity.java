package io.vacademy.admin.app;

import android.content.pm.ApplicationInfo;
import android.os.Build;
import android.os.Bundle;
import android.os.SystemClock;
import android.provider.Settings;
import android.util.Log;
import android.view.View;
import android.view.ViewGroup;
import android.view.WindowManager;
import android.view.autofill.AutofillManager;
import android.webkit.RenderProcessGoneDetail;
import android.webkit.WebView;
import android.widget.Button;
import android.widget.TextView;
import android.widget.Toast;
import androidx.activity.OnBackPressedCallback;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;

import com.getcapacitor.BridgeActivity;
import com.getcapacitor.WebViewListener;

import io.vacademy.admin.app.panel.PanelDevicePlugin;
import io.vacademy.admin.app.panel.WebViewVersion;

import java.util.ArrayDeque;

public class MainActivity extends BridgeActivity {

    private static final String PANEL_TAG = "VacademyPanel";
    /** Debug-only intent extra that raises the WebView floor (e.g. --ei minWebViewOverride 999). */
    private static final String EXTRA_MIN_WEBVIEW_OVERRIDE = "minWebViewOverride";
    private static final int RENDER_CRASH_LIMIT = 3;
    private static final long RENDER_CRASH_WINDOW_MS = 60_000L;

    /** Renderer-death timestamps; static so they survive recreate() within the process. */
    private static final ArrayDeque<Long> renderCrashTimes = new ArrayDeque<>();

    /**
     * Vacademy Classroom panel mode (R.bool.panel_mode, generated per flavor from
     * mobile-flavors.json). FALSE for vacademy-admin, so every panel-only path below is inert there.
     */
    private boolean panelMode;
    /** True once a native panel screen (unsupported WebView / crash loop) replaced the bridge UI. */
    private boolean panelNativeScreenShown;

    @Override
    public void onCreate(Bundle savedInstanceState) {
        panelMode = getResources().getBoolean(R.bool.panel_mode);
        if (panelMode) {
            // Must be registered before super.onCreate(): BridgeActivity.onCreate calls load(),
            // which creates the bridge with the plugins registered so far.
            registerPlugin(PanelDevicePlugin.class);
        }

        super.onCreate(savedInstanceState);

        // Android WebView autofill can hijack the InputConnection of a text field
        // that looks like part of a credential form (e.g. a "username" next to a
        // password). When that happens the field gets focus but NO keyboard — both
        // the soft keyboard and hardware key input are swallowed — while the
        // password field keeps working. Opting the WebView (and its descendants)
        // out of autofill, and disabling the app's autofill service, restores a
        // normal IME connection for every input.
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            try {
                View webView = getBridge() != null ? getBridge().getWebView() : null;
                if (webView != null) {
                    webView.setImportantForAutofill(View.IMPORTANT_FOR_AUTOFILL_NO_EXCLUDE_DESCENDANTS);
                }
                AutofillManager autofillManager = getSystemService(AutofillManager.class);
                if (autofillManager != null) {
                    autofillManager.disableAutofillServices();
                }
            } catch (Exception ignored) {
                // Autofill tweaks are best-effort; never block app start on them.
            }
        }

        if (!panelMode) {
            return;
        }

        if (getBridge() == null) {
            // BridgeActivity.onCreate shows Capacitor's generic no_webview layout and returns
            // BEFORE load() when the WebView cannot even be inflated. On a panel set as the Home
            // app that would be a dead end, so show our gate screen (with escape hatches) instead.
            if (!panelNativeScreenShown) {
                showUnsupportedWebView(WebViewVersion.detect(this), getMinWebViewMajor());
            }
            applyImmersive();
            return;
        }

        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        applyImmersive();
        getBridge().addWebViewListener(
            new WebViewListener() {
                @Override
                public boolean onRenderProcessGone(WebView view, RenderProcessGoneDetail detail) {
                    return handleRenderProcessGone(view, detail);
                }
            }
        );
    }

    /**
     * Panel mode: gate on the real system WebView version BEFORE the bridge (and any page) loads.
     * Every BridgeActivity lifecycle method null-checks {@code bridge}, so skipping super.load()
     * is safe. Admin flavors go straight to super.load().
     */
    @Override
    protected void load() {
        if (panelMode) {
            int min = getMinWebViewMajor();
            WebViewVersion v = WebViewVersion.detect(this);
            Log.i(PANEL_TAG, "WebView " + v.packageName + " " + v.versionName + " (major " + v.major + "), min " + min);
            if (min > 0 && v.major < min) {
                showUnsupportedWebView(v, min);
                return;
            }
        }
        super.load();
    }

    @Override
    public void onResume() {
        super.onResume();
        if (panelMode) applyImmersive();
    }

    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        if (panelMode && hasFocus) applyImmersive();
    }

    // --- panel mode helpers --------------------------------------------------------------

    private int getMinWebViewMajor() {
        int min = getResources().getInteger(R.integer.panel_min_webview_major);
        // Debug builds only (FLAG_DEBUGGABLE; BuildConfig is off by default in AGP 8): allow
        // forcing the gate, e.g. `am start ... --ei minWebViewOverride 999`.
        if ((getApplicationInfo().flags & ApplicationInfo.FLAG_DEBUGGABLE) != 0 && getIntent() != null) {
            min = getIntent().getIntExtra(EXTRA_MIN_WEBVIEW_OVERRIDE, min);
        }
        return min;
    }

    /** Sticky immersive: hide status + navigation bars; a swipe shows them transiently. */
    private void applyImmersive() {
        try {
            WindowInsetsControllerCompat controller = WindowCompat.getInsetsController(getWindow(), getWindow().getDecorView());
            controller.setSystemBarsBehavior(WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
            controller.hide(WindowInsetsCompat.Type.systemBars());
        } catch (Exception e) {
            Log.w(PANEL_TAG, "Immersive mode failed", e);
        }
    }

    /**
     * Capacitor returns false from onRenderProcessGone by default, which kills the app process.
     * For a Home app that means a kill/relaunch loop, so we handle it: recreate the activity
     * (BridgeActivity.onDetachedFromWindow destroys the dead WebView), or after 3 deaths within
     * 60 s show a native screen instead of reloading again.
     */
    private boolean handleRenderProcessGone(WebView view, RenderProcessGoneDetail detail) {
        boolean didCrash = Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && detail != null && detail.didCrash();
        long now = SystemClock.elapsedRealtime();
        int recent;
        synchronized (renderCrashTimes) {
            renderCrashTimes.addLast(now);
            while (!renderCrashTimes.isEmpty() && now - renderCrashTimes.peekFirst() > RENDER_CRASH_WINDOW_MS) {
                renderCrashTimes.removeFirst();
            }
            recent = renderCrashTimes.size();
        }
        Log.w(PANEL_TAG, "WebView render process gone (didCrash=" + didCrash + "), " + recent + " in the last 60 s");

        if (recent >= RENDER_CRASH_LIMIT) {
            // The dead WebView must not be reused: detach and destroy it before the native screen
            // replaces the bridge UI (a later destroy() from onDetachedFromWindow is a no-op).
            try {
                if (view.getParent() instanceof ViewGroup) ((ViewGroup) view.getParent()).removeView(view);
                view.destroy();
            } catch (Exception e) {
                Log.w(PANEL_TAG, "Destroying the dead WebView failed", e);
            }
            showRenderCrashScreen(recent);
        } else {
            recreate();
        }
        return true;
    }

    private void showUnsupportedWebView(WebViewVersion v, int min) {
        panelNativeScreenShown = true;
        setContentView(R.layout.panel_webview_unsupported);

        String unknown = getString(R.string.panel_unsupported_unknown);
        ((TextView) findViewById(R.id.panel_unsupported_requirement)).setText(getString(R.string.panel_unsupported_requirement, min));
        TextView detected = findViewById(R.id.panel_unsupported_detected);
        if (v.major <= 0 && v.packageName == null) {
            detected.setText(getString(R.string.panel_unsupported_no_webview));
        } else {
            detected.setText(
                getString(
                    R.string.panel_unsupported_detected,
                    v.packageName != null ? v.packageName : unknown,
                    v.versionName != null ? v.versionName : unknown,
                    v.major,
                    Build.VERSION.RELEASE,
                    Build.VERSION.SDK_INT,
                    Build.MANUFACTURER,
                    Build.MODEL
                )
            );
        }

        Button retry = findViewById(R.id.panel_btn_retry);
        retry.setOnClickListener(view -> recreate());
        bindEscapeHatches();
        retry.requestFocus();
        blockBackOnPanelScreen();
    }

    private void showRenderCrashScreen(int crashes) {
        panelNativeScreenShown = true;
        setContentView(R.layout.panel_render_crash);
        ((TextView) findViewById(R.id.panel_crash_body)).setText(getString(R.string.panel_crash_body, crashes));
        Button restart = findViewById(R.id.panel_btn_restart);
        restart.setOnClickListener(view -> {
            synchronized (renderCrashTimes) {
                renderCrashTimes.clear();
            }
            recreate();
        });
        bindEscapeHatches();
        restart.requestFocus();
        blockBackOnPanelScreen();
    }

    private void bindEscapeHatches() {
        findViewById(R.id.panel_btn_home).setOnClickListener(view ->
            openSettingsOrToast(new String[] { Settings.ACTION_HOME_SETTINGS, Settings.ACTION_MANAGE_DEFAULT_APPS_SETTINGS })
        );
        findViewById(R.id.panel_btn_settings).setOnClickListener(view -> openSettingsOrToast(new String[] { Settings.ACTION_SETTINGS }));
    }

    private void openSettingsOrToast(String[] actions) {
        try {
            if (PanelDevicePlugin.openFirstAvailable(this, actions) == null) {
                Toast.makeText(this, R.string.panel_action_unavailable, Toast.LENGTH_LONG).show();
            }
        } catch (Exception e) {
            Toast.makeText(this, R.string.panel_action_unavailable, Toast.LENGTH_LONG).show();
        }
    }

    /** A Home app must not finish on Back while a native panel screen is showing. */
    private void blockBackOnPanelScreen() {
        getOnBackPressedDispatcher().addCallback(
            this,
            new OnBackPressedCallback(true) {
                @Override
                public void handleOnBackPressed() {
                    // Intentionally ignored: use Retry / Choose Home app / Settings.
                }
            }
        );
    }
}
