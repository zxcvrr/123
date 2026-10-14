package com.example.dskchat;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import android.view.KeyEvent;
import android.webkit.JavascriptInterface;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Toast;

import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.util.HashMap;
import java.util.Map;

/**
 * 一个 WebView 壳，把 assets/www 里的网页当作 "https://appassets.androidplatform.net/" 提供。
 *
 * 为什么不直接 file:///android_asset/www/index.html：
 * file:// 页面的 Origin 是 opaque，Android WebView 默认禁止它发起跨域 fetch，
 * 我们的对话请求就打不出去了。用 shouldInterceptRequest 把资源挂在一个 https origin 下，
 * 页面就是普通的安全上下文：跨域 fetch 正常、localStorage 正常、Service Worker 也能注册。
 */
public class MainActivity extends Activity {

    private static final String HOST = "appassets.androidplatform.net";
    private static final String ORIGIN = "https://" + HOST;

    private WebView web;

    @SuppressLint("SetJavaScriptEnabled")
    @Override
    protected void onCreate(Bundle savedState) {
        super.onCreate(savedState);

        web = new WebView(this);

        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);              // 会话与 Key 存在 localStorage
        s.setAllowFileAccess(false);               // 走拦截器，不需要 file://
        s.setAllowContentAccess(false);
        s.setSupportZoom(false);
        s.setBuiltInZoomControls(false);
        s.setTextZoom(100);                        // 不跟随系统字体缩放，避免布局错位
        s.setMediaPlaybackRequiresUserGesture(true);
        s.setCacheMode(WebSettings.LOAD_DEFAULT);

        web.setBackgroundColor(0xFF0B0F17);
        web.setWebViewClient(new LocalClient());
        web.addJavascriptInterface(new ShareBridge(), "AndroidSave");
        WebView.setWebContentsDebuggingEnabled(true);   // 便于 chrome://inspect 调试

        setContentView(web);

        if (savedState == null) {
            web.loadUrl(ORIGIN + "/index.html");
        } else {
            web.restoreState(savedState);
        }
    }

    /** 把 appassets 下的路径映射到 assets/www，并给外部链接换手到系统浏览器。 */
    private final class LocalClient extends WebViewClient {
        @Override
        public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
            Uri uri = request.getUrl();
            if (!HOST.equals(uri.getHost())) return null;   // 放行 api.deepseek.com 等真实网络请求

            String path = uri.getPath();
            if (path == null || "/".equals(path)) path = "/index.html";

            try {
                InputStream in = getAssets().open("www" + path);
                return new WebResourceResponse(mimeOf(path), null, 200, "OK", headers(), in);
            } catch (IOException notFound) {
                byte[] body = "404".getBytes(StandardCharsets.UTF_8);
                return new WebResourceResponse("text/plain", "utf-8", 404, "Not Found",
                        headers(), new ByteArrayInputStream(body));
            }
        }

        @Override
        public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
            Uri uri = request.getUrl();
            if (HOST.equals(uri.getHost())) return false;    // 本站内部导航交给 WebView

            String scheme = uri.getScheme();
            if ("http".equals(scheme) || "https".equals(scheme)) {
                try {
                    startActivity(new Intent(Intent.ACTION_VIEW, uri));   // 外部链接用系统浏览器打开
                } catch (Exception e) {
                    Toast.makeText(MainActivity.this, "没有可打开该链接的应用", Toast.LENGTH_SHORT).show();
                }
                return true;
            }
            return true;   // 其它协议（intent:、mailto: 之外）一律不处理
        }
    }

    /** 供网页调用的桥：把导出的 Markdown 交给系统分享面板（WebView 不支持下 blob 下载）。 */
    private final class ShareBridge {
        @JavascriptInterface
        public void share(final String name, final String text) {
            final String title = (name == null || name.trim().isEmpty()) ? "deepseek-chat.md" : name.trim();
            final String body = text == null ? "" : text;
            runOnUiThread(new Runnable() {
                @Override
                public void run() {
                    Intent send = new Intent(Intent.ACTION_SEND);
                    send.setType("text/plain");
                    send.putExtra(Intent.EXTRA_SUBJECT, title);
                    send.putExtra(Intent.EXTRA_TEXT, body);
                    startActivity(Intent.createChooser(send, "导出会话"));
                }
            });
        }
    }

    private static Map<String, String> headers() {
        Map<String, String> h = new HashMap<>();
        h.put("Cache-Control", "no-cache");
        return h;
    }

    private static String mimeOf(String path) {
        String p = path.toLowerCase();
        if (p.endsWith(".html")) return "text/html";
        if (p.endsWith(".js") || p.endsWith(".mjs")) return "text/javascript";
        if (p.endsWith(".css")) return "text/css";
        if (p.endsWith(".json")) return "application/json";
        if (p.endsWith(".webmanifest")) return "application/manifest+json";
        if (p.endsWith(".svg")) return "image/svg+xml";
        if (p.endsWith(".png")) return "image/png";
        if (p.endsWith(".jpg") || p.endsWith(".jpeg")) return "image/jpeg";
        if (p.endsWith(".webp")) return "image/webp";
        if (p.endsWith(".ico")) return "image/x-icon";
        if (p.endsWith(".woff2")) return "font/woff2";
        if (p.endsWith(".txt") || p.endsWith(".md")) return "text/plain";
        return "application/octet-stream";
    }

    @Override
    public boolean onKeyDown(int keyCode, KeyEvent event) {
        if (keyCode == KeyEvent.KEYCODE_BACK && web != null && web.canGoBack()) {
            web.goBack();
            return true;
        }
        return super.onKeyDown(keyCode, event);
    }

    @Override
    protected void onSaveInstanceState(Bundle outState) {
        super.onSaveInstanceState(outState);
        if (web != null) web.saveState(outState);
    }

    @Override
    protected void onPause() {
        super.onPause();
        if (web != null) web.onPause();
    }

    @Override
    protected void onResume() {
        super.onResume();
        if (web != null) web.onResume();
    }

    @Override
    protected void onDestroy() {
        if (web != null) {
            web.removeJavascriptInterface("AndroidSave");
            web.destroy();
            web = null;
        }
        super.onDestroy();
    }
}
