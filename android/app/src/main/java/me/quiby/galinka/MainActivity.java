package me.quiby.galinka;

import android.os.Bundle;
import android.net.Uri;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebView;
import com.getcapacitor.BridgeActivity;
import com.getcapacitor.BridgeWebViewClient;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        bridge.setWebViewClient(new BridgeWebViewClient(bridge) {
            @Override
            public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                Uri url = request.getUrl();
                String path = url.getPath();
                // Keep assets bundled, but send API, SSE and file requests to the real HTTPS server.
                if ("https".equals(url.getScheme()) && "mess.quiby.me".equals(url.getHost())
                        && path != null && (path.equals("/messenger") || path.startsWith("/messenger/"))) {
                    return null;
                }
                return super.shouldInterceptRequest(view, request);
            }
        });
    }
}
