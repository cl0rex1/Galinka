package me.quiby.galinka;

import static org.junit.Assert.*;

import androidx.test.core.app.ActivityScenario;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;
import org.junit.Test;
import org.junit.runner.RunWith;

@RunWith(AndroidJUnit4.class)
public class ApiRoutingTest {
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
    public void bundledInterfaceUsesNetworkForApi() throws Exception {
        try (ActivityScenario<MainActivity> app = ActivityScenario.launch(MainActivity.class)) {
            boolean ready = false;
            for (int i = 0; i < 100; i++) {
                if ("true".equals(evaluate(app, "document.readyState === 'complete' && !!window.Capacitor"))) {
                    ready = true;
                    break;
                }
                Thread.sleep(100);
            }
            assertTrue("Bundled interface did not load", ready);
            evaluate(app, "window.__apiRoutingTest = null; Promise.all([fetch('/messenger/health'), "
                    + "fetch('/messenger/me', {credentials:'include'})]).then(async ([health, me]) => {"
                    + "window.__apiRoutingTest = health.ok && (await health.json()).ok === true && me.status === 401;"
                    + "}).catch(() => { window.__apiRoutingTest = false; }); void 0;");
            String result = "null";
            for (int i = 0; i < 150 && "null".equals(result); i++) {
                Thread.sleep(200);
                result = evaluate(app, "window.__apiRoutingTest");
            }
            assertEquals("API requests must return server JSON, not the bundled HTML", "true", result);
        }
    }
}
