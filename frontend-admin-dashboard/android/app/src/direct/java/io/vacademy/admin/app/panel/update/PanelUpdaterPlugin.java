package io.vacademy.admin.app.panel.update;

import android.app.PendingIntent;
import android.content.ActivityNotFoundException;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageInfo;
import android.content.pm.PackageInstaller;
import android.content.pm.PackageManager;
import android.content.pm.Signature;
import android.content.pm.SigningInfo;
import android.net.Uri;
import android.os.Build;
import android.os.SystemClock;
import android.provider.Settings;
import android.util.Log;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import io.vacademy.admin.app.R;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.lang.ref.WeakReference;
import java.net.URI;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicBoolean;
import javax.net.ssl.HttpsURLConnection;

/**
 * In-app updater for the DIRECT channel of Vacademy Classroom (panels without an app store).
 *
 * <p>This class exists only in the {@code direct} build type (src/direct/java). MainActivity
 * registers it by name, so store builds contain neither this code nor the install permission.
 *
 * <p>What it accepts, all checked here before the platform installer sees the file:
 * <ul>
 *   <li>https only, on a host this build was made with ({@code R.string.panel_update_hosts},
 *       from mobile-flavors.json {@code updateHosts}); redirects are not followed;</li>
 *   <li>at most the announced size plus 1 MB, and the announced sha256;</li>
 *   <li>the archive must be this app's package, the announced version code, newer than the
 *       installed one, and signed with exactly the installed app's certificates.</li>
 * </ul>
 * The install itself is a PackageInstaller session; Android shows its own confirm dialog and
 * the person at the panel taps Install.
 *
 * <p>The panel's JS offers updates only while nobody is signed in and no class is open
 * (src/panel/device/updateOffer.ts); this plugin never starts anything by itself.
 *
 * <p>JS contract: {@code registerPlugin('PanelUpdater')} with
 * <ul>
 *   <li>{@code status() → {canInstall, busy, installedVersionCode, downloaded: {versionCode,
 *       sha256} | null, lastResult: {status, message, versionCode, at} | null}}</li>
 *   <li>{@code download({url, sha256, versionCode, size}) → {versionCode, sha256, sizeBytes,
 *       reused}}; emits {@code downloadProgress {versionCode, receivedBytes, totalBytes}}.
 *       Rejects with a code from {@link UpdateErrors}.</li>
 *   <li>{@code install() → {needsPermission: true, opened} | {started: true, versionCode}};
 *       the outcome arrives as {@code installStatus {status, message, versionCode}} and is
 *       kept for {@code status().lastResult}. On success Android restarts the app.</li>
 *   <li>{@code clear() → {}} deletes any downloaded file.</li>
 * </ul>
 */
@CapacitorPlugin(name = "PanelUpdater")
public class PanelUpdaterPlugin extends Plugin {

    static final String TAG = "PanelUpdater";
    static final String EVENT_PROGRESS = "downloadProgress";
    static final String EVENT_INSTALL_STATUS = "installStatus";

    private static final String PREFS = "panel_updater";
    private static final String KEY_DL_CODE = "downloaded_version_code";
    private static final String KEY_DL_SHA = "downloaded_sha256";
    private static final String KEY_LAST_STATUS = "last_status";
    private static final String KEY_LAST_MESSAGE = "last_message";
    private static final String KEY_LAST_CODE = "last_version_code";
    private static final String KEY_LAST_AT = "last_at";

    private static final String DIR = "updates";
    private static final int CONNECT_TIMEOUT_MS = 15_000;
    private static final int READ_TIMEOUT_MS = 30_000;
    private static final long PROGRESS_EVERY_MS = 500L;

    /** The live instance, so the status receiver can tell the page. Cleared on destroy. */
    private static volatile WeakReference<PanelUpdaterPlugin> live = new WeakReference<>(null);

    private final ExecutorService worker = Executors.newSingleThreadExecutor();
    private final AtomicBoolean busy = new AtomicBoolean(false);

    @Override
    public void load() {
        live = new WeakReference<>(this);
        worker.execute(this::dropStaleDownloads);
    }

    @Override
    protected void handleOnDestroy() {
        if (live.get() == this) live = new WeakReference<>(null);
        worker.shutdown();
    }

    // --- plugin methods ----------------------------------------------------------------

    @PluginMethod
    public void status(PluginCall call) {
        Context ctx = getContext();
        SharedPreferences prefs = prefs(ctx);
        JSObject ret = new JSObject();
        ret.put("canInstall", canRequestInstalls(ctx));
        ret.put("busy", busy.get());
        ret.put("installedVersionCode", installedVersionCode(ctx));

        long dlCode = prefs.getLong(KEY_DL_CODE, 0L);
        String dlSha = prefs.getString(KEY_DL_SHA, null);
        if (dlCode > 0 && dlSha != null && apkFile(ctx, dlCode).isFile()) {
            JSObject dl = new JSObject();
            dl.put("versionCode", dlCode);
            dl.put("sha256", dlSha);
            ret.put("downloaded", dl);
        } else {
            ret.put("downloaded", JSObject.NULL);
        }

        String lastStatus = prefs.getString(KEY_LAST_STATUS, null);
        if (lastStatus != null) {
            JSObject last = new JSObject();
            last.put("status", lastStatus);
            String message = prefs.getString(KEY_LAST_MESSAGE, null);
            last.put("message", message == null ? JSObject.NULL : message);
            last.put("versionCode", prefs.getLong(KEY_LAST_CODE, 0L));
            last.put("at", prefs.getLong(KEY_LAST_AT, 0L));
            ret.put("lastResult", last);
        } else {
            ret.put("lastResult", JSObject.NULL);
        }
        call.resolve(ret);
    }

    @PluginMethod
    public void download(PluginCall call) {
        Context ctx = getContext();
        List<String> hosts = UpdateRules.parseHosts(ctx.getString(R.string.panel_update_hosts));
        URI uri = UpdateRules.allowedDownloadUri(call.getString("url"), hosts);
        if (uri == null) {
            call.reject("The update URL is not allowed", UpdateErrors.HOST_NOT_ALLOWED);
            return;
        }
        String sha = UpdateRules.normalizeSha256(call.getString("sha256"));
        // JS numbers arrive as Integer, Long or Double depending on size: PluginCall.getLong
        // alone would miss small ones.
        Long versionCode = UpdateRules.wholeNumber(call.getData().opt("versionCode"));
        Long size = UpdateRules.wholeNumber(call.getData().opt("size"));
        if (sha == null || versionCode == null || versionCode <= 0 || size == null || !UpdateRules.isAcceptableSize(size)) {
            call.reject("url, sha256, versionCode and size are required", UpdateErrors.INVALID_ARGUMENT);
            return;
        }
        if (versionCode <= installedVersionCode(ctx)) {
            call.reject("That version is not newer than the installed app", UpdateErrors.NOT_NEWER);
            return;
        }
        if (!busy.compareAndSet(false, true)) {
            call.reject("An update is already in progress", UpdateErrors.BUSY);
            return;
        }
        final long code = versionCode;
        final long announced = size;
        worker.execute(() -> {
            try {
                JSObject ret = downloadAndVerify(ctx, uri, sha, code, announced);
                call.resolve(ret);
            } catch (UpdateException e) {
                Log.w(TAG, "Download refused: " + e.code + " " + e.getMessage());
                call.reject(e.getMessage(), e.code);
            } catch (RuntimeException e) {
                Log.w(TAG, "Download failed", e);
                call.reject("Download failed", UpdateErrors.DOWNLOAD_FAILED);
            } finally {
                busy.set(false);
            }
        });
    }

    @PluginMethod
    public void install(PluginCall call) {
        Context ctx = getContext();
        SharedPreferences prefs = prefs(ctx);
        long code = prefs.getLong(KEY_DL_CODE, 0L);
        String sha = prefs.getString(KEY_DL_SHA, null);
        File apk = code > 0 ? apkFile(ctx, code) : null;
        if (apk == null || sha == null || !apk.isFile()) {
            call.reject("No update has been downloaded", UpdateErrors.NOTHING_DOWNLOADED);
            return;
        }

        if (!canRequestInstalls(ctx)) {
            // Android 8+: the person must allow this app to install apps, once, in Settings.
            JSObject ret = new JSObject();
            ret.put("needsPermission", true);
            ret.put("opened", openInstallPermissionScreen(ctx));
            call.resolve(ret);
            return;
        }

        if (!busy.compareAndSet(false, true)) {
            call.reject("An update is already in progress", UpdateErrors.BUSY);
            return;
        }
        worker.execute(() -> {
            try {
                // Checked again: the file is re-read from disk for the installer.
                verifyFile(ctx, apk, sha, code);
                commitSession(ctx, apk, code);
                JSObject ret = new JSObject();
                ret.put("started", true);
                ret.put("versionCode", code);
                call.resolve(ret);
            } catch (UpdateException e) {
                Log.w(TAG, "Install refused: " + e.code + " " + e.getMessage());
                if (!UpdateErrors.INSTALL_FAILED.equals(e.code)) deleteDownloads(ctx);
                call.reject(e.getMessage(), e.code);
            } catch (RuntimeException e) {
                Log.w(TAG, "Install failed", e);
                call.reject("Install failed", UpdateErrors.INSTALL_FAILED);
            } finally {
                busy.set(false);
            }
        });
    }

    @PluginMethod
    public void clear(PluginCall call) {
        if (busy.get()) {
            call.reject("An update is in progress", UpdateErrors.BUSY);
            return;
        }
        deleteDownloads(getContext());
        call.resolve();
    }

    // --- download and verification -----------------------------------------------------

    private JSObject downloadAndVerify(Context ctx, URI uri, String sha, long code, long announced) throws UpdateException {
        File dir = updatesDir(ctx);
        File target = apkFile(ctx, code);
        SharedPreferences prefs = prefs(ctx);

        // Already here from an earlier offer: check it again and reuse it.
        if (target.isFile() && sha.equals(prefs.getString(KEY_DL_SHA, null)) && prefs.getLong(KEY_DL_CODE, 0L) == code) {
            try {
                verifyFile(ctx, target, sha, code);
                return downloaded(code, sha, target.length(), true);
            } catch (UpdateException e) {
                deleteDownloads(ctx);
            }
        }

        // Room for the file and the installer's own copy of it.
        if (dir.getUsableSpace() < 2 * (announced + UpdateRules.SIZE_SLACK_BYTES)) {
            throw new UpdateException(UpdateErrors.INSUFFICIENT_STORAGE, "Not enough free space for the update");
        }

        File part = new File(dir, code + ".apk.part");
        MessageDigest digest = sha256();
        HttpsURLConnection conn = null;
        long received = 0L;
        try {
            conn = (HttpsURLConnection) uri.toURL().openConnection();
            conn.setInstanceFollowRedirects(false);
            conn.setConnectTimeout(CONNECT_TIMEOUT_MS);
            conn.setReadTimeout(READ_TIMEOUT_MS);
            conn.setUseCaches(false);
            conn.setRequestProperty("Accept-Encoding", "identity");
            int httpStatus = conn.getResponseCode();
            if (httpStatus != HttpsURLConnection.HTTP_OK) {
                throw new UpdateException(UpdateErrors.DOWNLOAD_FAILED, "The server answered " + httpStatus);
            }
            long length = conn.getContentLengthLong();
            if (length > 0 && UpdateRules.exceedsAnnounced(length, announced)) {
                throw new UpdateException(UpdateErrors.TOO_LARGE, "The file is larger than announced");
            }

            long lastEmit = 0L;
            byte[] buffer = new byte[64 * 1024];
            try (InputStream in = conn.getInputStream(); FileOutputStream out = new FileOutputStream(part, false)) {
                int n;
                while ((n = in.read(buffer)) != -1) {
                    received += n;
                    if (UpdateRules.exceedsAnnounced(received, announced)) {
                        throw new UpdateException(UpdateErrors.TOO_LARGE, "The file is larger than announced");
                    }
                    digest.update(buffer, 0, n);
                    out.write(buffer, 0, n);
                    long now = SystemClock.elapsedRealtime();
                    if (now - lastEmit >= PROGRESS_EVERY_MS) {
                        lastEmit = now;
                        emitProgress(code, received, announced);
                    }
                }
                out.getFD().sync();
            }
            emitProgress(code, received, announced);
        } catch (UpdateException e) {
            part.delete();
            throw e;
        } catch (IOException | ClassCastException e) {
            part.delete();
            throw new UpdateException(UpdateErrors.DOWNLOAD_FAILED, "The download did not complete");
        } finally {
            if (conn != null) conn.disconnect();
        }

        if (!sha.equals(UpdateRules.toHex(digest.digest()))) {
            part.delete();
            throw new UpdateException(UpdateErrors.SHA_MISMATCH, "The file is not the announced build");
        }
        try {
            checkArchive(ctx, part, code);
        } catch (UpdateException e) {
            part.delete();
            throw e;
        }

        // Keep only this file.
        for (File f : listFiles(dir)) {
            if (!f.equals(part)) f.delete();
        }
        if (!part.renameTo(target)) {
            part.delete();
            throw new UpdateException(UpdateErrors.DOWNLOAD_FAILED, "Could not store the update");
        }
        prefs.edit().putLong(KEY_DL_CODE, code).putString(KEY_DL_SHA, sha).apply();
        return downloaded(code, sha, target.length(), false);
    }

    /** sha256 of the file on disk, then the archive checks. */
    private void verifyFile(Context ctx, File apk, String sha, long code) throws UpdateException {
        MessageDigest digest = sha256();
        byte[] buffer = new byte[64 * 1024];
        try (InputStream in = new FileInputStream(apk)) {
            int n;
            while ((n = in.read(buffer)) != -1) digest.update(buffer, 0, n);
        } catch (IOException e) {
            throw new UpdateException(UpdateErrors.INVALID_APK, "Could not read the update");
        }
        if (!sha.equals(UpdateRules.toHex(digest.digest()))) {
            throw new UpdateException(UpdateErrors.SHA_MISMATCH, "The file is not the announced build");
        }
        checkArchive(ctx, apk, code);
    }

    /** Package name, version code and signing certificates of the archive against this app. */
    private static void checkArchive(Context ctx, File apk, long expectedCode) throws UpdateException {
        PackageManager pm = ctx.getPackageManager();
        int flags = signatureFlags();
        PackageInfo installed;
        try {
            installed = pm.getPackageInfo(ctx.getPackageName(), flags);
        } catch (PackageManager.NameNotFoundException e) {
            throw new UpdateException(UpdateErrors.INVALID_APK, "Own package not found");
        }
        PackageInfo archive = pm.getPackageArchiveInfo(apk.getAbsolutePath(), flags);

        // Compare like with like: signingInfo on both sides when both have it, otherwise the
        // legacy signature list on both sides.
        List<String> installedSigners = signingInfoDigests(installed);
        List<String> archiveSigners = signingInfoDigests(archive);
        if (installedSigners.isEmpty() || archiveSigners.isEmpty()) {
            installedSigners = legacyDigests(installed);
            archiveSigners = legacyDigests(archive);
        }

        String problem = UpdateRules.archiveProblem(
            ctx.getPackageName(),
            versionCodeOf(installed),
            installedSigners,
            archive == null ? null : archive.packageName,
            archive == null ? 0L : versionCodeOf(archive),
            expectedCode,
            archiveSigners,
            archive != null && archive.applicationInfo != null ? archive.applicationInfo.minSdkVersion : 0,
            Build.VERSION.SDK_INT
        );
        if (problem != null) {
            throw new UpdateException(problem, "The update does not match this app (" + problem + ")");
        }
    }

    // --- install -------------------------------------------------------------------------

    private void commitSession(Context ctx, File apk, long code) throws UpdateException {
        PackageInstaller installer = ctx.getPackageManager().getPackageInstaller();
        PackageInstaller.SessionParams params = new PackageInstaller.SessionParams(PackageInstaller.SessionParams.MODE_FULL_INSTALL);
        params.setAppPackageName(ctx.getPackageName());
        params.setSize(apk.length());
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            // Always the system confirm dialog, never a silent update.
            params.setRequireUserAction(PackageInstaller.SessionParams.USER_ACTION_REQUIRED);
        }

        int sessionId = -1;
        PackageInstaller.Session session = null;
        try {
            sessionId = installer.createSession(params);
            session = installer.openSession(sessionId);
            try (InputStream in = new FileInputStream(apk); OutputStream out = session.openWrite("base.apk", 0, apk.length())) {
                byte[] buffer = new byte[64 * 1024];
                int n;
                while ((n = in.read(buffer)) != -1) out.write(buffer, 0, n);
                session.fsync(out);
            }
            recordResult(ctx, "STARTED", null, code);
            session.commit(statusIntent(ctx, sessionId, code).getIntentSender());
            session.close();
            session = null;
        } catch (IOException | RuntimeException e) {
            Log.w(TAG, "PackageInstaller session failed", e);
            if (session != null) {
                try {
                    session.abandon();
                } catch (RuntimeException ignored) {
                    // Already gone.
                }
            } else if (sessionId != -1) {
                try {
                    installer.abandonSession(sessionId);
                } catch (RuntimeException ignored) {
                    // Already gone.
                }
            }
            recordResult(ctx, "FAILURE", "The installer could not take the file", code);
            throw new UpdateException(UpdateErrors.INSTALL_FAILED, "The installer could not take the file");
        }
    }

    private static PendingIntent statusIntent(Context ctx, int sessionId, long code) {
        Intent intent = new Intent(ctx, PanelUpdateStatusReceiver.class);
        intent.setAction(PanelUpdateStatusReceiver.ACTION_STATUS);
        intent.setPackage(ctx.getPackageName());
        intent.putExtra(PanelUpdateStatusReceiver.EXTRA_VERSION_CODE, code);
        int flags = PendingIntent.FLAG_UPDATE_CURRENT;
        // The installer adds its status extras to this intent, so it must stay fillable.
        // The intent is explicit (our own non-exported receiver).
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) flags |= PendingIntent.FLAG_MUTABLE;
        return PendingIntent.getBroadcast(ctx, sessionId, intent, flags);
    }

    /** Called by {@link PanelUpdateStatusReceiver} with the installer's answer. */
    static void onInstallStatus(Context ctx, String status, String message, long code) {
        recordResult(ctx, status, message, code);
        PanelUpdaterPlugin plugin = live.get();
        if (plugin != null) {
            JSObject data = new JSObject();
            data.put("status", status);
            data.put("message", message == null ? JSObject.NULL : message);
            data.put("versionCode", code);
            plugin.notifyListeners(EVENT_INSTALL_STATUS, data);
        }
    }

    // --- helpers -------------------------------------------------------------------------

    private boolean openInstallPermissionScreen(Context ctx) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return false;
        Intent intent = new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:" + ctx.getPackageName()));
        Context launcher = getActivity() != null ? getActivity() : ctx;
        if (launcher == ctx) intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        try {
            launcher.startActivity(intent);
            return true;
        } catch (ActivityNotFoundException | SecurityException e) {
            // Some panel builds hide this screen.
            return false;
        }
    }

    @SuppressWarnings("deprecation")
    private static boolean canRequestInstalls(Context ctx) {
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                return ctx.getPackageManager().canRequestPackageInstalls();
            }
            return Settings.Secure.getInt(ctx.getContentResolver(), Settings.Secure.INSTALL_NON_MARKET_APPS, 0) == 1;
        } catch (RuntimeException e) {
            return false;
        }
    }

    private void emitProgress(long code, long received, long total) {
        JSObject data = new JSObject();
        data.put("versionCode", code);
        data.put("receivedBytes", received);
        data.put("totalBytes", total);
        notifyListeners(EVENT_PROGRESS, data);
    }

    private static JSObject downloaded(long code, String sha, long size, boolean reused) {
        JSObject ret = new JSObject();
        ret.put("versionCode", code);
        ret.put("sha256", sha);
        ret.put("sizeBytes", size);
        ret.put("reused", reused);
        return ret;
    }

    /** At load: a download that is not newer than what is installed (the update landed) goes. */
    private void dropStaleDownloads() {
        try {
            Context ctx = getContext();
            long dlCode = prefs(ctx).getLong(KEY_DL_CODE, 0L);
            File dir = updatesDir(ctx);
            for (File f : listFiles(dir)) {
                if (f.getName().endsWith(".part")) f.delete();
            }
            if (dlCode > 0 && dlCode <= installedVersionCode(ctx)) deleteDownloads(ctx);
        } catch (RuntimeException e) {
            Log.w(TAG, "Cleanup failed", e);
        }
    }

    private static void deleteDownloads(Context ctx) {
        for (File f : listFiles(updatesDir(ctx))) f.delete();
        prefs(ctx).edit().remove(KEY_DL_CODE).remove(KEY_DL_SHA).apply();
    }

    private static void recordResult(Context ctx, String status, String message, long code) {
        prefs(ctx)
            .edit()
            .putString(KEY_LAST_STATUS, status)
            .putString(KEY_LAST_MESSAGE, message)
            .putLong(KEY_LAST_CODE, code)
            .putLong(KEY_LAST_AT, System.currentTimeMillis())
            .apply();
    }

    private static SharedPreferences prefs(Context ctx) {
        return ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    private static File updatesDir(Context ctx) {
        File dir = new File(ctx.getFilesDir(), DIR);
        if (!dir.isDirectory()) dir.mkdirs();
        return dir;
    }

    private static File apkFile(Context ctx, long code) {
        return new File(updatesDir(ctx), code + ".apk");
    }

    private static List<File> listFiles(File dir) {
        File[] files = dir.listFiles();
        if (files == null) return Collections.emptyList();
        List<File> out = new ArrayList<>();
        Collections.addAll(out, files);
        return out;
    }

    private static long installedVersionCode(Context ctx) {
        try {
            return versionCodeOf(ctx.getPackageManager().getPackageInfo(ctx.getPackageName(), 0));
        } catch (PackageManager.NameNotFoundException e) {
            return Long.MAX_VALUE;
        }
    }

    @SuppressWarnings("deprecation")
    private static long versionCodeOf(PackageInfo pi) {
        if (pi == null) return 0L;
        return Build.VERSION.SDK_INT >= Build.VERSION_CODES.P ? pi.getLongVersionCode() : pi.versionCode;
    }

    /**
     * Both flags on API 28+: some releases fill the archive's certificates only when
     * GET_SIGNATURES is asked for.
     */
    @SuppressWarnings("deprecation")
    private static int signatureFlags() {
        int flags = PackageManager.GET_SIGNATURES;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) flags |= PackageManager.GET_SIGNING_CERTIFICATES;
        return flags;
    }

    private static List<String> signingInfoDigests(PackageInfo pi) {
        if (pi == null || Build.VERSION.SDK_INT < Build.VERSION_CODES.P) return Collections.emptyList();
        SigningInfo info = pi.signingInfo;
        if (info == null) return Collections.emptyList();
        // The current signer set, without the rotation history: an update must carry exactly
        // the installed app's certificates.
        return digests(info.getApkContentsSigners());
    }

    @SuppressWarnings("deprecation")
    private static List<String> legacyDigests(PackageInfo pi) {
        return pi == null ? Collections.emptyList() : digests(pi.signatures);
    }

    private static List<String> digests(Signature[] signatures) {
        if (signatures == null) return Collections.emptyList();
        List<String> out = new ArrayList<>();
        for (Signature s : signatures) {
            if (s == null) continue;
            out.add(UpdateRules.toHex(sha256().digest(s.toByteArray())));
        }
        return out;
    }

    private static MessageDigest sha256() {
        try {
            return MessageDigest.getInstance("SHA-256");
        } catch (NoSuchAlgorithmException e) {
            throw new IllegalStateException(e);
        }
    }

    /** A refusal with one of the {@link UpdateErrors} codes. */
    static final class UpdateException extends Exception {
        final String code;

        UpdateException(String code, String message) {
            super(message);
            this.code = code;
        }
    }
}
