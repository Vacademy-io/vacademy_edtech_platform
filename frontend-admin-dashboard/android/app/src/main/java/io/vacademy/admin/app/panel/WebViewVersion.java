package io.vacademy.admin.app.panel;

import android.content.Context;
import android.content.pm.PackageInfo;
import android.os.Build;
import android.webkit.WebSettings;
import android.webkit.WebView;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Detects the system WebView provider that will actually render the app (Vacademy Classroom
 * panel mode). Classroom panels run Android 9-11 with a frozen WebView, so the gate in
 * MainActivity needs the real provider version, not the com.android.chrome package that
 * Capacitor's own check looks at on API &lt; 26.
 *
 * <ul>
 *   <li>API 26+: {@link WebView#getCurrentWebViewPackage()} (package + versionName).</li>
 *   <li>Otherwise, and as a fallback when the package info has no usable version: parse
 *       {@code Chrome/(\d+)} from {@link WebSettings#getDefaultUserAgent(Context)}.</li>
 *   <li>Any failure: {@code major == 0} and {@code packageName == null} (treated as "no
 *       usable WebView" by the gate).</li>
 * </ul>
 *
 * No androidx.webkit dependency is needed.
 */
public final class WebViewVersion {

    private static final Pattern CHROME_VERSION = Pattern.compile("Chrome/(\\d+)(\\.[\\d.]+)?");
    private static final Pattern LEADING_MAJOR = Pattern.compile("^(\\d+)");

    /** Provider package, e.g. com.android.webview / com.google.android.webview; null if unknown. */
    public final String packageName;
    /** Provider versionName (or the Chrome/x.y.z.w token from the UA); null if unknown. */
    public final String versionName;
    /** Chrome major version, 0 if no usable WebView was found. */
    public final int major;

    private WebViewVersion(String packageName, String versionName, int major) {
        this.packageName = packageName;
        this.versionName = versionName;
        this.major = major;
    }

    public static WebViewVersion detect(Context context) {
        String pkg = null;
        String version = null;
        int major = 0;

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            try {
                PackageInfo info = WebView.getCurrentWebViewPackage();
                if (info != null) {
                    pkg = info.packageName;
                    version = info.versionName;
                    major = parseLeadingMajor(info.versionName);
                }
            } catch (Throwable ignored) {
                // Fall through to the UA probe.
            }
        }

        if (major <= 0) {
            try {
                String ua = WebSettings.getDefaultUserAgent(context);
                Matcher m = CHROME_VERSION.matcher(ua == null ? "" : ua);
                if (m.find()) {
                    major = Integer.parseInt(m.group(1));
                    if (version == null) {
                        version = m.group(2) != null ? m.group(1) + m.group(2) : m.group(1);
                    }
                }
            } catch (Throwable t) {
                // WebSettings.getDefaultUserAgent throws (AndroidRuntimeException /
                // MissingWebViewPackageException) when no WebView provider can load.
                return new WebViewVersion(null, null, 0);
            }
        }

        return new WebViewVersion(pkg, version, Math.max(major, 0));
    }

    private static int parseLeadingMajor(String versionName) {
        if (versionName == null) return 0;
        Matcher m = LEADING_MAJOR.matcher(versionName.trim());
        if (!m.find()) return 0;
        try {
            return Integer.parseInt(m.group(1));
        } catch (NumberFormatException e) {
            return 0;
        }
    }
}
