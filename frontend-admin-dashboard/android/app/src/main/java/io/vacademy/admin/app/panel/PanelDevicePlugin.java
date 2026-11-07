package io.vacademy.admin.app.panel;

import android.app.Activity;
import android.app.ActivityManager;
import android.content.ActivityNotFoundException;
import android.content.ContentResolver;
import android.content.ContentValues;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.content.pm.ResolveInfo;
import android.media.MediaScannerConnection;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.provider.MediaStore;
import android.provider.Settings;
import android.util.Base64;
import android.util.DisplayMetrics;
import android.view.Display;
import android.view.WindowManager;
import androidx.activity.result.ActivityResult;
import androidx.core.content.FileProvider;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;
import io.vacademy.admin.app.R;
import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.OutputStream;

/**
 * In-app Capacitor plugin for Vacademy Classroom (panel mode). Registered by MainActivity only
 * when R.bool.panel_mode is true, so the admin flavor never exposes it
 * ({@code Capacitor.isPluginAvailable('PanelDevice')} is false there).
 *
 * <p>JS contract (src/panel/lib/native.ts): {@code registerPlugin('PanelDevice')} with
 * <ul>
 *   <li>{@code getInfo() → {webViewPackage, webViewVersion, webViewMajor, minWebViewMajor, sdkInt,
 *       release, androidRelease, manufacturer, brand, model, board, hardware, abis, abi,
 *       isDefaultHome, panelMode, appId, appVersionName, appVersionCode, totalRamMb,
 *       screenWidthPx, screenHeightPx, densityDpi}}</li>
 *   <li>{@code openSettings({target:'home'|'settings'|'app'|'developer'|'wifi'|'date'}) → {action}}
 *       (rejects with code NO_ACTIVITY / INVALID_TARGET)</li>
 *   <li>{@code saveImage({base64, fileName, mimeType}) → {uri, displayPath}}
 *       (rejects with INVALID_ARGUMENT / SAVE_FAILED)</li>
 *   <li>{@code openExternal({url}) → {opened, reason?}} (https only, never rejects; reason
 *       INVALID_URL / NO_HANDLER / ERROR)</li>
 *   <li>{@code openMeeting({url}) → {opened, reason?}} (https only, and only to a host in
 *       R.string.panel_meeting_hosts; never rejects; resolves when {@link PanelMeetingActivity}
 *       closes; reason INVALID_URL / ALREADY_OPEN / NO_HANDLER / ERROR)</li>
 *   <li>{@code closeMeeting() → {}} (closes the meeting screen if one is open; never rejects)</li>
 * </ul>
 */
@CapacitorPlugin(name = "PanelDevice")
public class PanelDevicePlugin extends Plugin {

    static final String ALBUM = "Vacademy Classroom";

    private static final String REASON_INVALID_URL = "INVALID_URL";
    private static final String REASON_NO_HANDLER = "NO_HANDLER";
    private static final String REASON_ALREADY_OPEN = "ALREADY_OPEN";
    private static final String REASON_ERROR = "ERROR";
    /** Android TV's placeholder for "no browser": it takes the intent and shows nothing. */
    private static final String TV_BROWSER_STUB_PACKAGE = "com.android.tv.frameworkpackagestubs";

    /** One meeting at a time: a second tap on Start must not stack another class on top. */
    private boolean meetingOpen;

    @PluginMethod
    public void getInfo(PluginCall call) {
        Context ctx = getContext();
        JSObject ret = new JSObject();

        WebViewVersion wv = WebViewVersion.detect(ctx);
        ret.put("webViewPackage", wv.packageName == null ? JSObject.NULL : wv.packageName);
        ret.put("webViewVersion", wv.versionName == null ? JSObject.NULL : wv.versionName);
        ret.put("webViewMajor", wv.major);
        ret.put("minWebViewMajor", ctx.getResources().getInteger(R.integer.panel_min_webview_major));

        ret.put("sdkInt", Build.VERSION.SDK_INT);
        ret.put("release", Build.VERSION.RELEASE);
        ret.put("androidRelease", Build.VERSION.RELEASE);
        ret.put("manufacturer", Build.MANUFACTURER);
        ret.put("brand", Build.BRAND);
        ret.put("model", Build.MODEL);
        ret.put("board", Build.BOARD);
        ret.put("hardware", Build.HARDWARE);
        JSArray abis = new JSArray();
        String[] supported = Build.SUPPORTED_ABIS;
        if (supported != null) {
            for (String abi : supported) abis.put(abi);
        }
        ret.put("abis", abis);
        ret.put("abi", supported != null && supported.length > 0 ? supported[0] : "");

        ret.put("isDefaultHome", isDefaultHome(ctx));
        ret.put("panelMode", ctx.getResources().getBoolean(R.bool.panel_mode));

        ret.put("appId", ctx.getPackageName());
        String versionName = "";
        long versionCode = 0;
        try {
            PackageInfo pi = ctx.getPackageManager().getPackageInfo(ctx.getPackageName(), 0);
            versionName = pi.versionName == null ? "" : pi.versionName;
            versionCode = Build.VERSION.SDK_INT >= Build.VERSION_CODES.P ? pi.getLongVersionCode() : pi.versionCode;
        } catch (PackageManager.NameNotFoundException ignored) {
            // Own package always exists; keep defaults.
        }
        ret.put("appVersionName", versionName);
        ret.put("appVersionCode", versionCode);

        long totalRamMb = 0;
        try {
            ActivityManager am = (ActivityManager) ctx.getSystemService(Context.ACTIVITY_SERVICE);
            if (am != null) {
                ActivityManager.MemoryInfo mi = new ActivityManager.MemoryInfo();
                am.getMemoryInfo(mi);
                totalRamMb = mi.totalMem / (1024L * 1024L);
            }
        } catch (Exception ignored) {
            // Best effort.
        }
        ret.put("totalRamMb", totalRamMb);

        // Physical (real) display size, not the window minus system bars.
        int w = 0;
        int h = 0;
        int dpi = ctx.getResources().getDisplayMetrics().densityDpi;
        try {
            WindowManager wm = (WindowManager) ctx.getSystemService(Context.WINDOW_SERVICE);
            if (wm != null) {
                Display display = wm.getDefaultDisplay();
                DisplayMetrics dm = new DisplayMetrics();
                display.getRealMetrics(dm);
                w = dm.widthPixels;
                h = dm.heightPixels;
                dpi = dm.densityDpi;
            }
        } catch (Exception ignored) {
            DisplayMetrics dm = ctx.getResources().getDisplayMetrics();
            w = dm.widthPixels;
            h = dm.heightPixels;
        }
        ret.put("screenWidthPx", w);
        ret.put("screenHeightPx", h);
        ret.put("densityDpi", dpi);

        call.resolve(ret);
    }

    @PluginMethod
    public void openSettings(PluginCall call) {
        String target = call.getString("target", "settings");
        String[] actions;
        switch (target) {
            case "home":
                actions = new String[] { Settings.ACTION_HOME_SETTINGS, Settings.ACTION_MANAGE_DEFAULT_APPS_SETTINGS };
                break;
            case "settings":
                actions = new String[] { Settings.ACTION_SETTINGS };
                break;
            case "app":
                actions = new String[] { Settings.ACTION_APPLICATION_DETAILS_SETTINGS };
                break;
            case "developer":
                actions = new String[] { Settings.ACTION_APPLICATION_DEVELOPMENT_SETTINGS };
                break;
            case "wifi":
                actions = new String[] { Settings.ACTION_WIFI_SETTINGS };
                break;
            case "date":
                actions = new String[] { Settings.ACTION_DATE_SETTINGS };
                break;
            default:
                call.reject("Unknown settings target: " + target, "INVALID_TARGET");
                return;
        }

        String opened = openFirstAvailable(getActivity() != null ? getActivity() : getContext(), actions);
        if (opened == null) {
            call.reject("No settings screen for target '" + target + "' on this device", "NO_ACTIVITY");
            return;
        }
        JSObject ret = new JSObject();
        ret.put("action", opened);
        call.resolve(ret);
    }

    @PluginMethod
    public void saveImage(PluginCall call) {
        String base64 = call.getString("base64");
        String fileName = call.getString("fileName");
        String mimeType = call.getString("mimeType", "image/png");
        if (base64 == null || base64.isEmpty()) {
            call.reject("base64 is required", "INVALID_ARGUMENT");
            return;
        }
        // Contract says no data: prefix; tolerate one anyway.
        int comma = base64.startsWith("data:") ? base64.indexOf(',') : -1;
        if (comma >= 0) base64 = base64.substring(comma + 1);

        byte[] bytes;
        try {
            bytes = Base64.decode(base64, Base64.DEFAULT);
        } catch (IllegalArgumentException e) {
            call.reject("base64 is not valid", "INVALID_ARGUMENT", e);
            return;
        }
        if (mimeType == null || mimeType.isEmpty()) mimeType = "image/png";
        String name = sanitizeFileName(fileName, mimeType);

        try {
            JSObject ret = Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q ? saveViaMediaStore(bytes, name, mimeType) : saveToAppPictures(bytes, name, mimeType);
            call.resolve(ret);
        } catch (Exception e) {
            call.reject("Could not save image: " + e.getMessage(), "SAVE_FAILED", e);
        }
    }

    @PluginMethod
    public void openExternal(PluginCall call) {
        Uri uri = PanelMeetingActivity.parseHttps(call.getString("url"));
        if (uri == null) {
            resolveOpen(call, false, REASON_INVALID_URL);
            return;
        }
        Intent intent = new Intent(Intent.ACTION_VIEW, uri);
        intent.addCategory(Intent.CATEGORY_BROWSABLE);
        // Its own task: the panel app can be the Home app and must stay as it was underneath.
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        try {
            ResolveInfo target = getContext().getPackageManager()
                    .resolveActivity(intent, PackageManager.MATCH_DEFAULT_ONLY);
            if (target != null && target.activityInfo != null
                    && TV_BROWSER_STUB_PACKAGE.equals(target.activityInfo.packageName)) {
                resolveOpen(call, false, REASON_NO_HANDLER);
                return;
            }
            getContext().startActivity(intent);
            resolveOpen(call, true, null);
        } catch (ActivityNotFoundException e) {
            resolveOpen(call, false, REASON_NO_HANDLER);
        } catch (RuntimeException e) {
            resolveOpen(call, false, REASON_ERROR);
        }
    }

    @PluginMethod
    public void openMeeting(PluginCall call) {
        String url = call.getString("url");
        Uri uri = PanelMeetingActivity.parseHttps(url);
        // The host list comes from the build, not from the page.
        if (uri == null || !PanelMeetingActivity.isAllowedMeetingHost(getContext(), uri)) {
            resolveOpen(call, false, REASON_INVALID_URL);
            return;
        }
        if (meetingOpen) {
            resolveOpen(call, false, REASON_ALREADY_OPEN);
            return;
        }
        Intent intent = new Intent(getContext(), PanelMeetingActivity.class);
        intent.putExtra(PanelMeetingActivity.EXTRA_URL, url);
        meetingOpen = true;
        try {
            startActivityForResult(call, intent, "onMeetingClosed");
        } catch (ActivityNotFoundException e) {
            meetingOpen = false;
            bridge.releaseCall(call);
            resolveOpen(call, false, REASON_NO_HANDLER);
        } catch (RuntimeException e) {
            meetingOpen = false;
            bridge.releaseCall(call);
            resolveOpen(call, false, REASON_ERROR);
        }
    }

    /** The panel's session ended: the meeting screen, with its microphone and camera, goes too. */
    @PluginMethod
    public void closeMeeting(PluginCall call) {
        Intent intent = new Intent(PanelMeetingActivity.ACTION_CLOSE);
        intent.setPackage(getContext().getPackageName());
        getContext().sendBroadcast(intent);
        call.resolve();
    }

    @ActivityCallback
    private void onMeetingClosed(PluginCall call, ActivityResult result) {
        meetingOpen = false;
        // Null when the panel page reloaded while the meeting was in front: nobody is waiting.
        if (call == null) return;
        bridge.releaseCall(call);
        resolveOpen(call, true, null);
    }

    // --- helpers -------------------------------------------------------------

    private static void resolveOpen(PluginCall call, boolean opened, String reason) {
        JSObject ret = new JSObject();
        ret.put("opened", opened);
        if (reason != null) ret.put("reason", reason);
        call.resolve(ret);
    }

    /** API 29+: shared Pictures/Vacademy Classroom via MediaStore (no permission needed). */
    private JSObject saveViaMediaStore(byte[] bytes, String name, String mimeType) throws IOException {
        ContentResolver resolver = getContext().getContentResolver();
        ContentValues values = new ContentValues();
        values.put(MediaStore.Images.Media.DISPLAY_NAME, name);
        values.put(MediaStore.Images.Media.MIME_TYPE, mimeType);
        values.put(MediaStore.Images.Media.RELATIVE_PATH, Environment.DIRECTORY_PICTURES + "/" + ALBUM);
        values.put(MediaStore.Images.Media.IS_PENDING, 1);

        Uri collection = MediaStore.Images.Media.getContentUri(MediaStore.VOLUME_EXTERNAL_PRIMARY);
        Uri uri = resolver.insert(collection, values);
        if (uri == null) throw new IOException("MediaStore insert returned null");
        try (OutputStream out = resolver.openOutputStream(uri)) {
            if (out == null) throw new IOException("Could not open output stream");
            out.write(bytes);
        } catch (IOException e) {
            resolver.delete(uri, null, null);
            throw e;
        }
        ContentValues done = new ContentValues();
        done.put(MediaStore.Images.Media.IS_PENDING, 0);
        resolver.update(uri, done, null, null);

        JSObject ret = new JSObject();
        ret.put("uri", uri.toString());
        ret.put("displayPath", Environment.DIRECTORY_PICTURES + "/" + ALBUM + "/" + name);
        return ret;
    }

    /** API 24-28: app-specific external Pictures/Vacademy Classroom (no permission needed). */
    private JSObject saveToAppPictures(byte[] bytes, String name, String mimeType) throws IOException {
        Context ctx = getContext();
        File base = ctx.getExternalFilesDir(Environment.DIRECTORY_PICTURES);
        if (base == null) base = new File(ctx.getFilesDir(), Environment.DIRECTORY_PICTURES);
        File dir = new File(base, ALBUM);
        if (!dir.exists() && !dir.mkdirs()) throw new IOException("Could not create " + dir);
        File file = new File(dir, name);
        try (FileOutputStream out = new FileOutputStream(file)) {
            out.write(bytes);
        }
        try {
            MediaScannerConnection.scanFile(ctx, new String[] { file.getAbsolutePath() }, new String[] { mimeType }, null);
        } catch (Exception ignored) {
            // Gallery indexing is best effort.
        }

        String uri;
        try {
            uri = FileProvider.getUriForFile(ctx, ctx.getPackageName() + ".fileprovider", file).toString();
        } catch (IllegalArgumentException e) {
            uri = Uri.fromFile(file).toString();
        }
        JSObject ret = new JSObject();
        ret.put("uri", uri);
        ret.put("displayPath", file.getAbsolutePath());
        return ret;
    }

    private static String sanitizeFileName(String fileName, String mimeType) {
        String ext = "image/jpeg".equals(mimeType) ? ".jpg" : "image/webp".equals(mimeType) ? ".webp" : ".png";
        String name = fileName == null ? "" : fileName.trim();
        name = name.replaceAll("[\\\\/:*?\"<>|\\x00-\\x1F]", "_");
        if (name.isEmpty() || name.startsWith(".")) name = "whiteboard-" + System.currentTimeMillis() + name;
        if (!name.toLowerCase().matches(".*\\.(png|jpe?g|webp)$")) name = name + ext;
        if (name.length() > 120) name = name.substring(name.length() - 120);
        return name;
    }

    /** Opens the first settings action that resolves. Returns it, or null if none could open. */
    public static String openFirstAvailable(Context ctx, String[] actions) {
        for (String action : actions) {
            Intent intent = new Intent(action);
            if (Settings.ACTION_APPLICATION_DETAILS_SETTINGS.equals(action)) {
                intent.setData(Uri.parse("package:" + ctx.getPackageName()));
            }
            if (!(ctx instanceof Activity)) intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            try {
                ctx.startActivity(intent);
                return action;
            } catch (ActivityNotFoundException | SecurityException e) {
                // Try the next one.
            }
        }
        return null;
    }

    /** True when this app is the device's default Home (launcher) app. */
    static boolean isDefaultHome(Context ctx) {
        try {
            Intent home = new Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_HOME);
            ResolveInfo ri = ctx.getPackageManager().resolveActivity(home, PackageManager.MATCH_DEFAULT_ONLY);
            return ri != null && ri.activityInfo != null && ctx.getPackageName().equals(ri.activityInfo.packageName);
        } catch (Exception e) {
            return false;
        }
    }
}
