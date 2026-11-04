package me.quiby.galinka;

import android.content.ClipData;
import android.content.Intent;
import android.content.SharedPreferences;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;
import androidx.core.content.FileProvider;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.net.URL;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import javax.net.ssl.HttpsURLConnection;

@CapacitorPlugin(name = "GalinkaUpdates")
public class GalinkaUpdatesPlugin extends Plugin {
    private final ExecutorService worker = Executors.newSingleThreadExecutor();
    private SharedPreferences preferences;
    private File directory;
    private String phase = "idle", version = "", error = "";
    private int percent;
    private long transferred, total;
    private volatile boolean downloading;
    private volatile boolean destroyed;
    private volatile boolean installing;
    private volatile HttpsURLConnection connection;

    @Override
    public void load() {
        preferences = getContext().getSharedPreferences("galinka-updates", 0);
        directory = new File(getContext().getCacheDir(), "updates");
        worker.execute(() -> {
            new File(directory, "update.part").delete();
            String saved = preferences.getString("version", "");
            if (!saved.isEmpty()) {
                try {
                    ApkVerifier.verify(getContext(), apk(), saved);
                    synchronized (this) { if (!downloading) { version = saved; phase = "downloaded"; percent = 100; } }
                } catch (Exception ignored) {
                    apk().delete();
                    preferences.edit().remove("version").apply();
                }
                publish();
            }
        });
    }

    private File apk() { return new File(directory, "update.apk"); }

    private boolean canInstall() {
        return Build.VERSION.SDK_INT < 26 || getContext().getPackageManager().canRequestPackageInstalls();
    }

    private synchronized JSObject snapshot() {
        JSObject status = new JSObject();
        status.put("phase", phase);
        status.put("version", version);
        status.put("percent", percent);
        status.put("transferred", transferred);
        status.put("total", total);
        status.put("error", error);
        status.put("autoDownload", preferences.getBoolean("autoDownload", false));
        status.put("canInstall", canInstall());
        status.put("mode", "automatic");
        status.put("platform", "android");
        return status;
    }

    private void publish() { if (!destroyed) notifyListeners("status", snapshot()); }

    @PluginMethod
    public void status(PluginCall call) { call.resolve(snapshot()); }

    @PluginMethod
    public void setAutoDownload(PluginCall call) {
        Boolean enabled = call.getBoolean("enabled");
        if (enabled == null) { call.reject("Invalid preference"); return; }
        preferences.edit().putBoolean("autoDownload", enabled).apply();
        publish();
        call.resolve(snapshot());
    }

    @PluginMethod
    public synchronized void download(PluginCall call) {
        String url = call.getString("url"), requestedVersion = call.getString("version");
        if (!UpdatePolicy.allowedUrl(url, true) || requestedVersion == null || !requestedVersion.matches("\\d+\\.\\d+\\.\\d+")) {
            call.reject("Invalid update"); return;
        }
        if (installing) { call.reject("Installation is in progress"); return; }
        if (downloading || ("downloaded".equals(phase) && requestedVersion.equals(version))) {
            call.resolve(snapshot()); return;
        }
        downloading = true;
        phase = "downloading";
        version = requestedVersion;
        error = "";
        percent = 0;
        total = transferred = 0;
        publish();
        call.resolve(snapshot());
        worker.execute(() -> fetchApk(url, requestedVersion));
    }

    private void fetchApk(String url, String requestedVersion) {
        File partial = new File(directory, "update.part");
        try {
            if (!directory.isDirectory() && !directory.mkdirs()) throw new Exception("Cache unavailable");
            HttpsURLConnection request = null;
            for (int redirects = 0; redirects <= 5; redirects++) {
                if (!UpdatePolicy.allowedUrl(url, redirects == 0)) throw new SecurityException("Untrusted redirect");
                request = (HttpsURLConnection) new URL(url).openConnection();
                connection = request;
                request.setInstanceFollowRedirects(false);
                request.setConnectTimeout(20000);
                request.setReadTimeout(30000);
                request.setRequestProperty("User-Agent", "Galinka-Android");
                request.setRequestProperty("Accept", "application/octet-stream");
                int status = request.getResponseCode();
                if (status == 200) break;
                if (status != 301 && status != 302 && status != 303 && status != 307 && status != 308)
                    throw new Exception("Download failed");
                String location = request.getHeaderField("Location");
                if (location == null || redirects == 5) throw new SecurityException("Too many redirects");
                url = new URL(new URL(url), location).toString();
                request.disconnect();
                request = null;
            }
            if (request == null) throw new Exception("No download");
            long length = request.getContentLengthLong();
            if (length > UpdatePolicy.MAX_BYTES) throw new SecurityException("APK too large");
            synchronized (this) { total = Math.max(0, length); }
            long received = 0, lastEvent = 0;
            try (InputStream input = request.getInputStream(); FileOutputStream output = new FileOutputStream(partial)) {
                byte[] buffer = new byte[65536];
                int count;
                while ((count = input.read(buffer)) != -1) {
                    if (Thread.currentThread().isInterrupted()) throw new InterruptedException();
                    received += count;
                    if (received > UpdatePolicy.MAX_BYTES) throw new SecurityException("APK too large");
                    output.write(buffer, 0, count);
                    synchronized (this) {
                        transferred = received;
                        percent = length > 0 ? (int) Math.min(99, received * 100 / length) : 0;
                    }
                    if (System.currentTimeMillis() - lastEvent > 500) { publish(); lastEvent = System.currentTimeMillis(); }
                }
                output.getFD().sync();
            }
            if (length >= 0 && received != length) throw new Exception("Incomplete APK");
            ApkVerifier.verify(getContext(), partial, requestedVersion);
            if (apk().exists() && !apk().delete()) throw new Exception("Cache unavailable");
            if (!partial.renameTo(apk())) throw new Exception("Cache unavailable");
            preferences.edit().putString("version", requestedVersion).apply();
            synchronized (this) { phase = "downloaded"; percent = 100; }
        } catch (Exception ignored) {
            partial.delete();
            synchronized (this) {
                phase = "error";
                error = "Не удалось скачать или проверить APK. Попробуйте ещё раз либо скачайте его со страницы загрузок.";
            }
        } finally {
            if (connection != null) connection.disconnect();
            connection = null;
            downloading = false;
            publish();
        }
    }

    @PluginMethod
    public void install(PluginCall call) {
        final String readyVersion;
        synchronized (this) {
            if (!"downloaded".equals(phase) || downloading || installing) { call.reject("Update is not ready"); return; }
            readyVersion = version;
            installing = true;
        }
        worker.execute(() -> {
            try {
                // Validate again immediately before exposing the APK to the system installer.
                ApkVerifier.verify(getContext(), apk(), readyVersion);
                getActivity().runOnUiThread(() -> {
                    try {
                        if (!canInstall()) {
                            Intent permission = new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
                                    Uri.parse("package:" + getContext().getPackageName()));
                            getActivity().startActivity(permission);
                            installing = false;
                            call.resolve(new JSObject().put("openedSettings", true));
                            return;
                        }
                        Uri uri = FileProvider.getUriForFile(getContext(), getContext().getPackageName() + ".fileprovider", apk());
                        Intent installer = new Intent(Intent.ACTION_VIEW);
                        installer.setDataAndType(uri, "application/vnd.android.package-archive");
                        installer.setClipData(ClipData.newRawUri("Galinka update", uri));
                        installer.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
                        getActivity().startActivity(installer);
                        call.resolve(new JSObject().put("openedSettings", false));
                    } catch (Exception ignored) { installing = false; call.reject("Не удалось открыть установку Android."); }
                });
            } catch (Exception ignored) {
                installing = false;
                apk().delete();
                preferences.edit().remove("version").apply();
                synchronized (this) { phase = "error"; error = "APK не прошёл проверку. Скачайте обновление заново."; }
                publish();
                call.reject("APK не прошёл проверку.");
            }
        });
    }

    @Override
    protected void handleOnResume() { installing = false; if (preferences != null) publish(); }

    @Override
    protected void handleOnDestroy() {
        destroyed = true;
        worker.shutdownNow();
        if (connection != null) connection.disconnect();
    }
}
