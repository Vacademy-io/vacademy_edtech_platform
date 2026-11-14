package io.vacademy.admin.app.panel;

import android.Manifest;
import android.annotation.SuppressLint;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.pm.ActivityInfo;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.graphics.drawable.GradientDrawable;
import android.graphics.drawable.StateListDrawable;
import android.net.Uri;
import android.net.http.SslError;
import android.os.Build;
import android.os.Bundle;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.view.Window;
import android.view.WindowManager;
import android.webkit.CookieManager;
import android.webkit.PermissionRequest;
import android.webkit.RenderProcessGoneDetail;
import android.webkit.SslErrorHandler;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Button;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.TextView;
import androidx.activity.OnBackPressedCallback;
import androidx.annotation.NonNull;
import androidx.appcompat.app.AlertDialog;
import androidx.appcompat.app.AppCompatActivity;
import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;
import io.vacademy.admin.app.R;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;

/**
 * Full-screen host for a live class on panels whose WebView can run it. Declared only in the
 * vacademyClassroom manifest and started only by {@link PanelDevicePlugin#openMeeting}.
 *
 * <p>The page gets its own WebView at top level, with no JavaScript bridge and no route into the
 * panel app. It stays on https and never launches another app. Closing it leaves the class; the
 * class keeps running for everyone else. The panel's auth cookies carry an expiry, so removing
 * session cookies here leaves them in place.
 *
 * <p>It opens only https URLs on a host listed in R.string.panel_meeting_hosts (mobile-flavors.json
 * {@code meetingHosts}), and closes when {@link #ACTION_CLOSE} arrives from
 * {@link PanelDevicePlugin#closeMeeting}, which the panel sends whenever its session ends.
 */
public class PanelMeetingActivity extends AppCompatActivity {

    static final String EXTRA_URL = "io.vacademy.classroom.MEETING_URL";
    /** Sent only within this app (setPackage) and received only by a non-exported receiver. */
    static final String ACTION_CLOSE = "io.vacademy.classroom.CLOSE_MEETING";

    private static final int PERMISSION_REQUEST_CODE = 4101;

    private WebView webView;
    private View errorView;
    private Button retryButton;
    private String meetingUrl;
    /** The top-level URL being loaded, to tell its failures from those of a page's resources. */
    private String mainFrameUrl;
    /** Host the class runs on: the one we opened, or where its own opening redirects landed. */
    private String meetingHost;
    private int meetingPort;
    private boolean firstPageFinished;
    private PermissionRequest pendingPermission;
    private AlertDialog exitDialog;
    private boolean closeReceiverRegistered;

    private final BroadcastReceiver closeReceiver = new BroadcastReceiver() {
        @Override
        public void onReceive(Context context, Intent intent) {
            finish();
        }
    };

    /** The Uri when {@code url} is a well-formed absolute https URL, else null. */
    static Uri parseHttps(String url) {
        if (url == null || url.isEmpty() || url.indexOf('\\') >= 0 || !url.equals(url.trim())) return null;
        Uri uri = Uri.parse(url);
        if (!"https".equalsIgnoreCase(uri.getScheme())) return null;
        String host = uri.getHost();
        return host == null || host.isEmpty() ? null : uri;
    }

    /** True when {@code uri}'s host is one this build may open a meeting on. */
    static boolean isAllowedMeetingHost(Context context, Uri uri) {
        String host = uri == null ? null : uri.getHost();
        if (host == null || host.isEmpty()) return false;
        for (String allowed : context.getString(R.string.panel_meeting_hosts).split(",")) {
            String name = allowed.trim();
            if (!name.isEmpty() && name.toLowerCase(Locale.ROOT).equals(host.toLowerCase(Locale.ROOT))) return true;
        }
        return false;
    }

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        // The manifest theme is translucent so MainActivity stays visible underneath: a hidden
        // WebView stops running page timers after 5 minutes, and the panel's session sync with it.
        // The content here is opaque, and needs the AppCompat theme from this point on.
        setTheme(R.style.AppTheme_NoActionBar);
        super.onCreate(savedInstanceState);
        // Android 8.0 refuses a fixed orientation on a translucent activity, so not in the manifest.
        if (Build.VERSION.SDK_INT != Build.VERSION_CODES.O) {
            setRequestedOrientation(ActivityInfo.SCREEN_ORIENTATION_SENSOR_LANDSCAPE);
        }
        meetingUrl = getIntent().getStringExtra(EXTRA_URL);
        Uri uri = parseHttps(meetingUrl);
        if (uri == null || !isAllowedMeetingHost(this, uri)) {
            finish();
            return;
        }
        rememberMeetingHost(uri);
        ContextCompat.registerReceiver(this, closeReceiver, new IntentFilter(ACTION_CLOSE), ContextCompat.RECEIVER_NOT_EXPORTED);
        closeReceiverRegistered = true;

        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        setContentView(buildContent());
        applyImmersive(getWindow());

        getOnBackPressedDispatcher().addCallback(
            this,
            new OnBackPressedCallback(true) {
                @Override
                public void handleOnBackPressed() {
                    confirmExit();
                }
            }
        );

        loadMeeting();
    }

    @Override
    public void onResume() {
        super.onResume();
        applyImmersive(getWindow());
    }

    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        if (hasFocus) applyImmersive(getWindow());
    }

    @Override
    protected void onDestroy() {
        if (closeReceiverRegistered) {
            unregisterReceiver(closeReceiver);
            closeReceiverRegistered = false;
        }
        if (exitDialog != null) exitDialog.dismiss();
        denyPendingPermission();
        destroyWebView();
        // Process-wide, so this covers any WebView; session cookies in the panel app would go too.
        CookieManager cookies = CookieManager.getInstance();
        cookies.removeSessionCookies(null);
        cookies.flush();
        super.onDestroy();
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, @NonNull String[] permissions, @NonNull int[] results) {
        super.onRequestPermissionsResult(requestCode, permissions, results);
        if (requestCode != PERMISSION_REQUEST_CODE || pendingPermission == null) return;
        PermissionRequest request = pendingPermission;
        pendingPermission = null;
        boolean granted = results.length > 0;
        for (int result : results) granted &= result == PackageManager.PERMISSION_GRANTED;
        if (granted) {
            request.grant(request.getResources());
        } else {
            request.deny();
        }
    }

    // --- views -----------------------------------------------------------------------------------

    private View buildContent() {
        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setBackgroundColor(ContextCompat.getColor(this, R.color.panel_surface));

        // A bar of its own, so the button never covers a control inside the class.
        LinearLayout bar = new LinearLayout(this);
        bar.setOrientation(LinearLayout.HORIZONTAL);
        bar.setGravity(Gravity.CENTER_VERTICAL | Gravity.END);
        bar.setPadding(dp(16), dp(8), dp(16), dp(8));
        Button exit = primaryButton("Exit class");
        exit.setOnClickListener(view -> confirmExit());
        bar.addView(exit);
        root.addView(bar, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));

        FrameLayout stage = new FrameLayout(this);
        webView = new WebView(this);
        configureWebView();
        stage.addView(webView, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        errorView = buildErrorView();
        errorView.setVisibility(View.GONE);
        stage.addView(errorView, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        root.addView(stage, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f));
        return root;
    }

    private View buildErrorView() {
        LinearLayout box = new LinearLayout(this);
        box.setOrientation(LinearLayout.VERTICAL);
        box.setGravity(Gravity.CENTER);
        box.setBackgroundColor(ContextCompat.getColor(this, R.color.panel_surface));
        TextView message = new TextView(this);
        message.setText("Could not open the class. Check the internet connection and try again.");
        message.setTextSize(20f);
        message.setGravity(Gravity.CENTER);
        message.setTextColor(ContextCompat.getColor(this, R.color.panel_text));
        message.setPadding(dp(24), 0, dp(24), dp(24));
        box.addView(message);
        retryButton = primaryButton("Try again");
        retryButton.setOnClickListener(view -> loadMeeting());
        box.addView(retryButton, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT));
        return box;
    }

    /** A large filled button with a clear focus ring for TV remotes. */
    private Button primaryButton(String label) {
        Button button = new Button(this);
        button.setText(label);
        button.setAllCaps(false);
        button.setTextSize(18f);
        button.setTextColor(Color.WHITE);
        button.setMinHeight(dp(56));
        button.setMinWidth(dp(160));
        button.setPadding(dp(24), 0, dp(24), 0);
        StateListDrawable background = new StateListDrawable();
        background.addState(new int[] { android.R.attr.state_focused }, buttonFill(true));
        background.addState(new int[] {}, buttonFill(false));
        button.setBackground(background);
        return button;
    }

    private GradientDrawable buttonFill(boolean focused) {
        GradientDrawable fill = new GradientDrawable();
        fill.setCornerRadius(dp(8));
        fill.setColor(ContextCompat.getColor(this, R.color.panel_brand));
        if (focused) fill.setStroke(dp(3), ContextCompat.getColor(this, R.color.panel_text));
        return fill;
    }

    private int dp(int value) {
        return Math.round(value * getResources().getDisplayMetrics().density);
    }

    private static void applyImmersive(Window window) {
        WindowInsetsControllerCompat controller = WindowCompat.getInsetsController(window, window.getDecorView());
        controller.setSystemBarsBehavior(WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
        controller.hide(WindowInsetsCompat.Type.systemBars());
    }

    private void loadMeeting() {
        if (webView == null) return;
        errorView.setVisibility(View.GONE);
        webView.setVisibility(View.VISIBLE);
        webView.requestFocus();
        firstPageFinished = false;
        mainFrameUrl = meetingUrl;
        webView.loadUrl(meetingUrl);
    }

    private void confirmExit() {
        if (exitDialog != null && exitDialog.isShowing()) return;
        exitDialog = new AlertDialog.Builder(this)
            .setTitle("Leave this class?")
            .setMessage("You will leave the class on this panel. To end it for everyone, end the meeting inside the class first.")
            .setPositiveButton("Leave", (dialog, which) -> finish())
            .setNegativeButton("Stay", null)
            .show();
        // A dialog is its own window: without this the system bars return while it is open.
        applyImmersive(exitDialog.getWindow());
        int brand = ContextCompat.getColor(this, R.color.panel_brand);
        exitDialog.getButton(AlertDialog.BUTTON_POSITIVE).setTextColor(brand);
        exitDialog.getButton(AlertDialog.BUTTON_NEGATIVE).setTextColor(brand);
    }

    // --- WebView ---------------------------------------------------------------------------------

    @SuppressLint("SetJavaScriptEnabled")
    private void configureWebView() {
        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setMediaPlaybackRequiresUserGesture(false);
        settings.setSaveFormData(false);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(false);
        settings.setGeolocationEnabled(false);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        // onCreateWindow keeps its default (no window), so a new-tab link cannot replace the class.
        settings.setSupportMultipleWindows(true);
        settings.setJavaScriptCanOpenWindowsAutomatically(false);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            // Same reason as MainActivity: autofill can take the keyboard away from a text field.
            webView.setImportantForAutofill(View.IMPORTANT_FOR_AUTOFILL_NO_EXCLUDE_DESCENDANTS);
        }

        webView.setWebViewClient(
            new WebViewClient() {
                @Override
                public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                    Uri url = request.getUrl();
                    if (request.isForMainFrame()) {
                        if (parseHttps(url.toString()) == null) return true;
                        if (request.isRedirect() && !firstPageFinished) rememberMeetingHost(url);
                        mainFrameUrl = url.toString();
                        return false;
                    }
                    String scheme = url.getScheme();
                    return !("https".equalsIgnoreCase(scheme) ||
                        "about".equalsIgnoreCase(scheme) ||
                        "blob".equalsIgnoreCase(scheme) ||
                        "data".equalsIgnoreCase(scheme));
                }

                @Override
                public void onPageFinished(WebView view, String url) {
                    firstPageFinished = true;
                }

                @Override
                public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
                    if (request.isForMainFrame()) showLoadError();
                }

                @Override
                public void onReceivedSslError(WebView view, SslErrorHandler handler, SslError error) {
                    super.onReceivedSslError(view, handler, error); // Cancels the load.
                    if (error.getUrl().equals(mainFrameUrl)) showLoadError();
                }

                @Override
                public boolean onRenderProcessGone(WebView view, RenderProcessGoneDetail detail) {
                    // The default kills the whole app. The renderer is gone, so leave the class.
                    if (view == webView) destroyWebView();
                    finish();
                    return true;
                }
            }
        );
        webView.setWebChromeClient(
            new WebChromeClient() {
                @Override
                public void onPermissionRequest(PermissionRequest request) {
                    handlePermissionRequest(request);
                }

                @Override
                public void onPermissionRequestCanceled(PermissionRequest request) {
                    if (request == pendingPermission) pendingPermission = null;
                }
            }
        );
    }

    /** Hides the WebView's own error page, which prints the URL it could not open. */
    private void showLoadError() {
        if (webView == null) return;
        webView.setVisibility(View.INVISIBLE);
        errorView.setVisibility(View.VISIBLE);
        retryButton.requestFocus();
    }

    private void destroyWebView() {
        if (webView == null) return;
        WebView dying = webView;
        webView = null;
        if (dying.getParent() instanceof ViewGroup) ((ViewGroup) dying.getParent()).removeView(dying);
        dying.stopLoading();
        dying.clearHistory();
        dying.clearFormData();
        dying.destroy();
    }

    // --- microphone and camera -------------------------------------------------------------------

    private void rememberMeetingHost(Uri uri) {
        meetingHost = uri.getHost();
        meetingPort = effectivePort(uri);
    }

    private static int effectivePort(Uri uri) {
        return uri.getPort() == -1 ? 443 : uri.getPort();
    }

    /**
     * Grants capture only to the class's own https host, once Android allows it. WebView treats a
     * grant as all or nothing, so any resource we cannot give denies the whole request.
     */
    private void handlePermissionRequest(PermissionRequest request) {
        Uri origin = request.getOrigin();
        boolean ownHost =
            origin != null &&
            "https".equalsIgnoreCase(origin.getScheme()) &&
            meetingHost.equalsIgnoreCase(origin.getHost()) &&
            meetingPort == effectivePort(origin);
        List<String> needed = new ArrayList<>();
        boolean supported = ownHost;
        for (String resource : request.getResources()) {
            if (PermissionRequest.RESOURCE_AUDIO_CAPTURE.equals(resource)) {
                needed.add(Manifest.permission.RECORD_AUDIO);
            } else if (PermissionRequest.RESOURCE_VIDEO_CAPTURE.equals(resource)) {
                needed.add(Manifest.permission.CAMERA);
            } else {
                supported = false;
            }
        }
        if (!supported || needed.isEmpty()) {
            request.deny();
            return;
        }
        List<String> missing = new ArrayList<>();
        for (String permission : needed) {
            if (ContextCompat.checkSelfPermission(this, permission) != PackageManager.PERMISSION_GRANTED) missing.add(permission);
        }
        if (missing.isEmpty()) {
            request.grant(request.getResources());
            return;
        }
        denyPendingPermission();
        pendingPermission = request;
        ActivityCompat.requestPermissions(this, missing.toArray(new String[0]), PERMISSION_REQUEST_CODE);
    }

    private void denyPendingPermission() {
        if (pendingPermission == null) return;
        pendingPermission.deny();
        pendingPermission = null;
    }
}
