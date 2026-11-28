package io.vacademy.student.app.filesave;

import android.content.ActivityNotFoundException;
import android.content.ContentResolver;
import android.content.ContentValues;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.provider.MediaStore;
import android.util.Base64;
import androidx.annotation.RequiresApi;
import androidx.core.content.FileProvider;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;

/**
 * Native `VacademyFileSave` Capacitor plugin (Android). Local, in-repo plugin — no npm package —
 * so it is registered explicitly by {@code MainActivity.onCreate()}.
 *
 * The WebView drops `<a download>` clicks (Capacitor has no download handler), so every
 * "Download" button in the app hands its file here instead (src/lib/download/save-file.ts):
 *  - `writeChunk({fileName, data, append})` — base64 bytes into a staging file in the app cache.
 *    Big files come in several calls so no single bridge message is huge.
 *  - `save({fileName, mimeType, open})` — Android 10+: copies the staged file into the public
 *    Downloads folder (MediaStore, no storage permission needed) and, unless `open` is false (a
 *    batch of files), opens it in the phone's viewer.
 *    Android 7–9 would need a storage permission the app does not ask for, so there the file is
 *    opened straight from the cache through the app's FileProvider instead.
 *    Resolves {@code {savedToDownloads, opened}}.
 */
@CapacitorPlugin(name = "VacademyFileSave")
public class FileSavePlugin extends Plugin {

    private static final String STAGING_DIR = "vacademy-downloads";
    private static final long STALE_AFTER_MS = 24L * 60 * 60 * 1000;

    @PluginMethod
    public void writeChunk(PluginCall call) {
        String fileName = call.getString("fileName");
        String data = call.getString("data");
        if (fileName == null || data == null) {
            call.reject("fileName and data are required");
            return;
        }
        boolean append = Boolean.TRUE.equals(call.getBoolean("append", false));
        try {
            if (!append) clearStaleFiles();
            byte[] bytes = Base64.decode(data, Base64.DEFAULT);
            try (FileOutputStream out = new FileOutputStream(stagingFile(fileName), append)) {
                out.write(bytes);
            }
            call.resolve();
        } catch (Exception e) {
            call.reject("Could not write the file", e);
        }
    }

    @PluginMethod
    public void save(PluginCall call) {
        String fileName = call.getString("fileName");
        if (fileName == null) {
            call.reject("fileName is required");
            return;
        }
        String mimeType = call.getString("mimeType", "application/octet-stream");
        boolean openAfter = !Boolean.FALSE.equals(call.getBoolean("open", true));
        File staged = stagingFile(fileName);
        if (!staged.exists()) {
            call.reject("Nothing was written for " + fileName);
            return;
        }

        Uri uri = null;
        boolean savedToDownloads = false;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            uri = copyToDownloads(staged, safeName(fileName), mimeType);
            savedToDownloads = uri != null;
            if (savedToDownloads) staged.delete();
        }
        if (uri == null) {
            try {
                uri = FileProvider.getUriForFile(getContext(), getContext().getPackageName() + ".fileprovider", staged);
            } catch (Exception e) {
                call.reject("Could not share the file", e);
                return;
            }
        }

        JSObject ret = new JSObject();
        ret.put("savedToDownloads", savedToDownloads);
        // The cache copy (Android 7–9) is only reachable by opening it, so that path always opens.
        ret.put("opened", (openAfter || !savedToDownloads) && open(uri, mimeType));
        call.resolve(ret);
    }

    /** Copies into MediaStore Downloads; null on any failure (the caller falls back to the cache copy). */
    @RequiresApi(api = Build.VERSION_CODES.Q)
    private Uri copyToDownloads(File source, String displayName, String mimeType) {
        ContentResolver resolver = getContext().getContentResolver();
        ContentValues values = new ContentValues();
        values.put(MediaStore.Downloads.DISPLAY_NAME, displayName);
        values.put(MediaStore.Downloads.MIME_TYPE, mimeType);
        values.put(MediaStore.Downloads.IS_PENDING, 1);
        Uri uri = null;
        try {
            uri = resolver.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values);
            if (uri == null) return null;
            try (InputStream in = new FileInputStream(source); OutputStream out = resolver.openOutputStream(uri)) {
                if (out == null) throw new IllegalStateException("No output stream");
                byte[] buffer = new byte[64 * 1024];
                int read;
                while ((read = in.read(buffer)) != -1) out.write(buffer, 0, read);
            }
            values.clear();
            values.put(MediaStore.Downloads.IS_PENDING, 0);
            resolver.update(uri, values, null, null);
            return uri;
        } catch (Exception e) {
            if (uri != null) {
                try {
                    resolver.delete(uri, null, null);
                } catch (Exception ignored) {
                    // A half-written entry is cleaned up by MediaStore when it stays pending.
                }
            }
            return null;
        }
    }

    /** Opens the file in whatever app handles its type; false when the phone has none. */
    private boolean open(Uri uri, String mimeType) {
        if (getActivity() == null) return false;
        Intent intent = new Intent(Intent.ACTION_VIEW);
        intent.setDataAndType(uri, mimeType);
        intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK);
        try {
            getActivity().startActivity(intent);
            return true;
        } catch (ActivityNotFoundException e) {
            return false;
        }
    }

    private File stagingFile(String fileName) {
        File dir = new File(getContext().getCacheDir(), STAGING_DIR);
        if (!dir.exists()) dir.mkdirs();
        return new File(dir, safeName(fileName));
    }

    /** Files from earlier downloads that the viewer has long finished reading (Android 7–9 path). */
    private void clearStaleFiles() {
        File[] files = new File(getContext().getCacheDir(), STAGING_DIR).listFiles();
        if (files == null) return;
        long cutoff = System.currentTimeMillis() - STALE_AFTER_MS;
        for (File f : files) {
            if (f.lastModified() < cutoff) f.delete();
        }
    }

    /** No path separators or reserved characters, never empty. */
    static String safeName(String fileName) {
        String name = fileName.replaceAll("[\\\\/:*?\"<>|\\p{Cntrl}]+", "_").trim();
        if (name.startsWith(".")) name = "_" + name;
        if (name.length() > 150) {
            int dot = name.lastIndexOf('.');
            String ext = dot > 0 && name.length() - dot <= 10 ? name.substring(dot) : "";
            name = name.substring(0, 150 - ext.length()) + ext;
        }
        return name.isEmpty() ? "download" : name;
    }
}
