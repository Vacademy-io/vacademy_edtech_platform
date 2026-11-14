package io.vacademy.admin.app.panel.update;

/** Rejection codes of the PanelUpdater plugin, as the panel's JS sees them in {@code error.code}. */
public final class UpdateErrors {

    /** Missing or malformed argument (url, sha256, versionCode, size). */
    public static final String INVALID_ARGUMENT = "INVALID_ARGUMENT";
    /** The URL is not https on a host this build allows. */
    public static final String HOST_NOT_ALLOWED = "HOST_NOT_ALLOWED";
    /** Another download or install is running. */
    public static final String BUSY = "BUSY";
    /** Not enough free space for the download and the installer's copy of it. */
    public static final String INSUFFICIENT_STORAGE = "INSUFFICIENT_STORAGE";
    /** The server answered something other than 200, or the connection failed. */
    public static final String DOWNLOAD_FAILED = "DOWNLOAD_FAILED";
    /** The download went past the announced size. */
    public static final String TOO_LARGE = "TOO_LARGE";
    /** The file's sha256 is not the announced one. */
    public static final String SHA_MISMATCH = "SHA_MISMATCH";
    /** The file is not an APK the package manager can read. */
    public static final String INVALID_APK = "INVALID_APK";
    /** The APK is for a different package. */
    public static final String PACKAGE_MISMATCH = "PACKAGE_MISMATCH";
    /** The APK's version code is not the announced one. */
    public static final String VERSION_MISMATCH = "VERSION_MISMATCH";
    /** The APK is not newer than the installed app. */
    public static final String NOT_NEWER = "NOT_NEWER";
    /** The APK is not signed with exactly the installed app's certificates. */
    public static final String SIGNATURE_MISMATCH = "SIGNATURE_MISMATCH";
    /** The APK needs a newer Android than this device has. */
    public static final String SDK_TOO_LOW = "SDK_TOO_LOW";
    /** install() was called with nothing downloaded. */
    public static final String NOTHING_DOWNLOADED = "NOTHING_DOWNLOADED";
    /** The platform installer could not take the file. */
    public static final String INSTALL_FAILED = "INSTALL_FAILED";

    private UpdateErrors() {}
}
