package me.quiby.galinka;

import static org.junit.Assert.*;
import android.content.Context;
import android.content.pm.PackageManager;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.core.app.ActivityScenario;
import androidx.test.platform.app.InstrumentationRegistry;
import java.io.File;
import java.io.FileOutputStream;
import java.util.Arrays;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;
import org.junit.Test;
import org.junit.runner.RunWith;

@RunWith(AndroidJUnit4.class)
public class UpdateValidationTest {
    private String evaluate(ActivityScenario<MainActivity> app, String script) throws Exception {
        CountDownLatch done = new CountDownLatch(1);
        AtomicReference<String> value = new AtomicReference<>();
        app.onActivity(activity -> activity.getBridge().getWebView().evaluateJavascript(script, result -> {
            value.set(result);
            done.countDown();
        }));
        assertTrue("WebView did not respond", done.await(10, TimeUnit.SECONDS));
        return value.get();
    }

    @Test
    public void nativeBridgeExposesPreferencesAndRejectsUntrustedDownloadWithoutNetwork() throws Exception {
        try (ActivityScenario<MainActivity> app = ActivityScenario.launch(MainActivity.class)) {
            boolean ready = false;
            for (int i = 0; i < 100; i++) {
                if ("true".equals(evaluate(app, "document.readyState === 'complete' && !!window.Capacitor?.Plugins?.GalinkaUpdates"))) { ready = true; break; }
                Thread.sleep(100);
            }
            assertTrue("Native update plugin did not register", ready);
            evaluate(app, "window.__updateBridgeTest = null; (async () => {"
                    + "const updater = window.Capacitor.Plugins.GalinkaUpdates;"
                    + "const before = await updater.status();"
                    + "const disabled = await updater.setAutoDownload({enabled:false});"
                    + "let rejected = false; try { await updater.download({url:'https://example.org/untrusted.apk',version:'99.0.0'}); } catch { rejected = true; }"
                    + "await updater.setAutoDownload({enabled:before.autoDownload});"
                    + "window.__updateBridgeTest = before.platform === 'android' && typeof before.canInstall === 'boolean' && disabled.autoDownload === false && rejected;"
                    + "})().catch(() => { window.__updateBridgeTest = false; }); void 0;");
            String result = "null";
            for (int i = 0; i < 100 && "null".equals(result); i++) {
                Thread.sleep(100);
                result = evaluate(app, "window.__updateBridgeTest");
            }
            assertEquals("Update bridge must expose a working, constrained native API", "true", result);
        }
    }

    @Test
    public void realPackageParserRejectsReinstallForeignPackageAndCorruptApk() throws Exception {
        Context app = InstrumentationRegistry.getInstrumentation().getTargetContext();
        String version = app.getPackageManager().getPackageInfo(app.getPackageName(), 0).versionName;
        File installed = new File(app.getApplicationInfo().sourceDir);
        SecurityException sameVersion = assertThrows(SecurityException.class, () -> ApkVerifier.verify(app, installed, version));
        assertEquals("Update must be newer", sameVersion.getMessage());
        File foreign = new File(InstrumentationRegistry.getInstrumentation().getContext().getApplicationInfo().sourceDir);
        SecurityException wrongPackage = assertThrows(SecurityException.class, () -> ApkVerifier.verify(app, foreign, version));
        assertEquals("Wrong package", wrongPackage.getMessage());
        File corrupt = new File(app.getCacheDir(), "invalid-update-test.apk");
        try {
            try (FileOutputStream stream = new FileOutputStream(corrupt)) { stream.write(new byte[] {1, 2, 3, 4}); }
            assertThrows(SecurityException.class, () -> ApkVerifier.verify(app, corrupt, "99.0.0"));
        } finally { corrupt.delete(); }
        assertTrue(Arrays.asList(app.getPackageManager().getPackageInfo(app.getPackageName(), PackageManager.GET_PERMISSIONS).requestedPermissions)
                .contains("android.permission.REQUEST_INSTALL_PACKAGES"));
    }
}
