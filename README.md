# DeepSeek 小助手（手机端单页 App）

一个纯前端的手机 App：填一个 API Key，就能直接和 DeepSeek 模型对话。没有后端、没有依赖、没有构建步骤，全部代码就是下面这几个文件。

```
deepseek-mobile/
├── index.html              页面结构
├── styles.css              移动端深色样式（含安全区适配）
├── app.js                  全部逻辑：流式对话、多会话、Markdown、余额
├── manifest.webmanifest    PWA 清单（可"添加到主屏幕"当 App 用）
├── sw.js                   离线壳（只缓存本站静态资源，绝不碰 API 请求）
├── icons/                  图标（192 / 512 / maskable / svg）
├── .github/workflows/      云端构建 APK 的 GitHub Actions 配置
├── android/                安卓 WebView 壳工程（可直接装到手机）
│   ├── settings.gradle.kts / build.gradle.kts / gradle.properties
│   └── app/
│       ├── build.gradle.kts
│       └── src/main/
│           ├── AndroidManifest.xml
│           ├── java/com/example/dskchat/MainActivity.java
│           ├── res/                主题、颜色、各密度启动图标
│           └── assets/www/         网页的拷贝（由脚本同步，勿手改）
├── tools/
│   ├── make-icons.py       生成 PWA 与 Android 图标
│   ├── sync-assets.mjs     把网页同步进 Android assets
│   ├── smoke-test.mjs      网页侧冒烟测试
│   └── check-android.py    Android 侧静态检查（无 SDK 也能跑）
└── README.md
```

## 为什么可以纯前端直连

DeepSeek API 支持浏览器跨域。实测（`OPTIONS https://api.deepseek.com/chat/completions`，带 `Origin` 头）：

| 响应头 | 值 |
| --- | --- |
| `access-control-allow-origin` | 回显请求的 Origin |
| `access-control-allow-methods` | `POST` |
| `access-control-allow-headers` | `authorization,content-type` |
| `access-control-allow-credentials` | `true` |

所以**不需要任何代理服务器**，手机浏览器直接 `fetch` 就行。这也意味着 API Key 只存在你自己手机里，除了 `api.deepseek.com` 不会被发给任何第三方。

## 装到手机上（三选一）

### 方案 A：放到免费静态托管（推荐）

有 HTTPS，能"添加到主屏幕"变成真正的 App 图标，还能离线打开。

- **Cloudflare Pages**：把整个 `deepseek-mobile` 文件夹拖到 Pages 的 Direct Upload 里，几十秒后拿到 `https://xxx.pages.dev`。
- **GitHub Pages**：把这个文件夹推到仓库，Settings → Pages 选分支 + 根目录即可。
- **Vercel / Netlify**：同样支持拖拽部署。

> 仓库/站点里**不要放 API Key**。Key 是你打开页面后自己填、存在本机浏览器里的，同一份代码谁部署都一样。

然后在手机浏览器打开那个网址 → 右上角 ⚙ 填 Key → 浏览器菜单选"添加到主屏幕"。iPhone 用 Safari，安卓用 Chrome。

### 方案 B：手机本地起服务（不联网托管，也不暴露到局域网）

安卓装 [Termux](https://termux.dev/)，把文件夹传进去（`termux-setup-storage` 后从 `/sdcard` 复制），然后：

```sh
cd ~/deepseek-mobile
python -m http.server 8080
```

手机浏览器打开 `http://localhost:8080` 即可。`localhost` 被浏览器视为安全上下文，PWA、剪贴板、Service Worker 都能用。

iOS 可以用 a-Shell 里的 `python3 -m http.server 8080`，效果一样。

### 方案 C：电脑上起服务，手机同 Wi-Fi 访问

```sh
cd deepseek-mobile
python -m http.server 8080 --bind 0.0.0.0
```

手机浏览器打开 `http://<电脑局域网IP>:8080`。这是 `http` 非安全上下文，聊天功能正常，但"添加到主屏幕"和剪贴板 API 会受限（代码里已做 `execCommand` 回退）。用完记得 `Ctrl+C`。

> 直接双击用 `file://` 打开**不行**：Chrome 会拒绝从 `file://` 页面发出的跨域请求。

## 直接用（不写代码）

如果只是想用，不想部署页面：手机装任意支持自定义 API 地址的客户端（Chatbox、Cherry Studio、NextChat 等），填 `https://api.deepseek.com`、你的 Key、模型 `deepseek-flash` 即可。

## 用到的 API

| 用途 | 请求 |
| --- | --- |
| 对话（流式） | `POST /chat/completions`，`stream: true`，SSE 以 `data: [DONE]` 结束 |
| 查余额 | `GET /user/balance` |
| 认证 | 请求头 `Authorization: Bearer <API_KEY>` |

模型（以官方文档为准）：`deepseek-flash`（快、便宜）、`deepseek-v4-pro`（更强）。

请求体关键字段：

```json
{
  "model": "deepseek-flash",
  "messages": [{ "role": "user", "content": "你好" }],
  "stream": true,
  "stream_options": { "include_usage": true },
  "thinking": { "type": "enabled" },
  "reasoning_effort": "high"
}
```

- `thinking.type`：`enabled` / `disabled`（默认 `enabled`）。
- `reasoning_effort`：`none` / `low` / `high` / `max`，默认 `high`。
- 思考模式下，思维链在流式增量的 `delta.reasoning_content` 里，最终答案在 `delta.content` 里 —— App 里把它渲染成可折叠的"💭 思考过程"。
- `usage` 在最后一个块里给出，包含 `prompt_cache_hit_tokens`（缓存命中）和 `completion_tokens_details.reasoning_tokens`（思考消耗）。
- 思考模式下 `temperature` 不生效；`top_p` 有效区间 0.95–1.0。`frequency_penalty` / `presence_penalty` 已废弃。

## 安全与费用

- **Key 存在浏览器里**：默认存 `localStorage`（关掉设置里的"记住 Key"则只存 `sessionStorage`，关页面即失效）。手机丢了或被别人用了，立刻去 [platform.deepseek.com/api_keys](https://platform.deepseek.com/api_keys) 吊销。
- **不要在公开页面里硬编码 Key**，也不要为了"隐藏 Key"而自己搭代理 —— 那要把 Key 交给代理服务器，反而更不安全。
- **按量计费**，预充值。App 里"余额"按钮可直接查。`401` = Key 无效，`402` = 余额不足，`429` = 限流。
- 长对话会把历史全部重新发一遍（这也是为什么 `prompt_cache_hit_tokens` 有意义）。会话很长时用 ☰ 新建会话。

## 调试

任何静态服务器都能跑，例如：

```sh
python -m http.server 8080      # 然后打开 http://localhost:8080
```

改 `app.js` / `styles.css` 后强刷（`sw.js` 会缓存壳，改完前端记得在浏览器里注销 Service Worker 或改一下 `CACHE` 版本号）。

重新生成图标：

```sh
python tools/make-icons.py      # 需要 Pillow + numpy
```

## 安卓 APK（WebView 壳）

`android/` 是一个零依赖的 WebView 壳工程：把网页当作 `https://appassets.androidplatform.net/` 提供，而不是 `file://`。

**为什么不直接用 `file:///android_asset/...`**：`file://` 页面的 Origin 是 opaque，Android WebView 默认禁止它发跨域 `fetch`，对话请求会直接失败。用 `shouldInterceptRequest` 把资源挂在一个 https origin 下，页面就成了普通安全上下文 —— 跨域请求、`localStorage`、Service Worker 全部正常，和浏览器里跑一模一样。

### 拿到 APK 的三种方式

**方式 1：GitHub Actions 云端构建（不需要本机装任何东西）**

把 `deepseek-mobile` 作为仓库根目录推到 GitHub，`.github/workflows/build-apk.yml` 会自动跑：同步资源 → 装 JDK 17 与 Android SDK → `gradle assembleDebug` → 把 APK 上传成 Artifact。大约 3~5 分钟，在 Actions 运行页面的 Artifacts 里下载 `deepseek-mobile-debug-apk`。

**方式 2：Android Studio**

装 Android Studio → Open → 选中 `android/` 目录 → 等 Gradle 同步完 → Build → Build APK(s)。产物在 `android/app/build/outputs/apk/debug/app-debug.apk`。

**方式 3：命令行**

需要 JDK 17 + Android SDK（`ANDROID_HOME` 指向 SDK，含 `platforms;android-34` 与 `build-tools;34.0.0`），然后：

```sh
node tools/sync-assets.mjs          # 先同步网页资源
cd android && gradle assembleDebug
```

### 安装

把 APK 传到手机（微信/网盘/数据线都行）→ 点击安装 → 系统会提示"允许安装未知来源应用"，同意即可。debug 包用 AGP 自动生成的调试密钥签名，能直接装；正式发布再自己建 keystore 并在 `app/build.gradle.kts` 里补 `signingConfigs`。

### 改了网页代码之后

网页只有一份真源（根目录那几个文件），`android/app/src/main/assets/www/` 是拷贝。**改完网页必须重新同步**，否则打进 APK 的还是旧页面：

```sh
node tools/sync-assets.mjs
```

`tools/check-android.py` 会检查这个拷贝有没有过期（逐字节比对），CI 也会先同步再构建，所以云端构建不会踩这个坑。

### 想改名字 / 包名

- 应用名：`android/app/src/main/res/values/strings.xml` 里的 `app_name`
- 包名：`android/app/build.gradle.kts` 的 `namespace` 与 `applicationId`，同时把 `java/com/example/dskchat/` 目录与 `MainActivity.java` 里的 `package` 行一起改掉

### 壳工程做了什么

| 关注点 | 处理 |
| --- | --- |
| 资源加载 | `shouldInterceptRequest` 把 `appassets` 映射到 `assets/www`，带正确的 MIME |
| 跨域对话 | 页面处于 https origin，直接 `fetch` `api.deepseek.com`，与浏览器一致 |
| 键盘遮挡 | `windowSoftInputMode="adjustResize"` |
| 返回键 | 有历史就 `goBack()`，否则退出 |
| 旋转/分屏 | `configChanges` 接管，不重建 Activity，聊天记录不丢 |
| 导出会话 | WebView 不支持 `blob:` 下载，改注入 `AndroidSave.share()` 走系统分享面板 |
| 系统字体缩放 | `setTextZoom(100)`，避免用户放大字体后布局错乱 |
| 明文流量 | `usesCleartextTraffic="false"`，只允许 https |
| 调试 | `setWebContentsDebuggingEnabled(true)`，可用 Chrome 的 `chrome://inspect` 连上看控制台 |

### 关于验证的实话

本机没有 JDK / Android SDK / Gradle，磁盘可用空间也读不到，所以 **Java 编译和 GitHub Actions 都没有在本地实际跑过**。我在没有工具链的前提下做到了这些检查（`python tools/check-android.py`，共 61 项，全部通过）：

- 5 个 XML 全部格式良好；`@string/ @color/ @style/ @mipmap/` 引用逐个能解析到真实资源
- manifest 的 `.MainActivity` ↔ `namespace` ↔ 源文件路径 ↔ `package` 声明四方一致
- 五个密度的启动图标齐全，像素尺寸与 dp 换算逐一核对（48/72/96/144/192 与 108/162/216/324/432），前景层确认带透明通道
- Java 与 Kotlin DSL 括号平衡（注释和字符串已剔除后再统计）
- `assets/www` 与网页源码逐字节一致
- workflow 的 YAML 用真正的 YAML 解析器解析并核对了十个步骤、`working-directory`、产物路径
- 自适应图标合成后套圆形遮罩目视确认，标记完整落在安全区内

## 其它平台

- **安卓**：已经在 `android/` 里做好了，见上一节。
- **跨平台**：Flutter / React Native 里只需 `fetch` 同样的接口，UI 重写即可 —— 上面的请求体和 SSE 解析逻辑可以照搬。
- **iOS**：需要一个 Mac + Xcode 才能签名安装（免费账号的签名 7 天过期）。没有 Mac 的话，方案 A 的"添加到主屏幕"是最接近原生体验的做法：独立窗口、无地址栏、有图标。

## 已知限制

- 流式渲染是把累计文本整体重新渲染 Markdown，超长回答会略吃 CPU（已用 `requestAnimationFrame` 节流）。
- 没有图片输入、function calling、文件上传 —— 这些接口官方都有，需要的话按同样的方式加。
- 会话只存在本机浏览器，不跨设备同步，换浏览器/清数据即丢失（可用"导出当前会话为 Markdown"备份）。
