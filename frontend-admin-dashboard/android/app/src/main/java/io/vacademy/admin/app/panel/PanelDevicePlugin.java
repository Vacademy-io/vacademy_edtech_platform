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
import androidx.core.content.FileProvider;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
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
 * </ul>
 */
@CapacitorPlugin(name = "PanelDevice")
public class PanelDevicePlugin extends Plugin {

    static final String ALBUM = "Vacademy Classroom";

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

    // --- helpers -------------------------------------------------------------

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
