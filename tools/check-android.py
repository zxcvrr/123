"""Android 工程静态检查（不需要 Android SDK / JDK 也能跑）。

在没有工具链的机器上，这是能对 APK 工程做的最强校验：
  1. 所有 XML 是否格式良好
  2. manifest 里的 MainActivity 是否与 namespace / 源文件路径对得上
  3. 所有 @string/ @color/ @style/ @mipmap/ 引用是否真的存在
  4. 各密度的启动图标是否齐全、像素尺寸是否正确
  5. Java / Kotlin DSL 的括号是否平衡、package 是否与目录一致
  6. assets/www 是否与网页源文件逐字节一致（防止打进旧页面）

用法：python tools/check-android.py
"""
from __future__ import annotations

import hashlib
import re
import sys
import xml.etree.ElementTree as ET
from pathlib import Path

# Windows 控制台默认 GBK，中文与 emoji 会直接抛 UnicodeEncodeError
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

ROOT = Path(__file__).resolve().parent.parent
ANDROID = ROOT / "android"
MAIN = ANDROID / "app" / "src" / "main"
RES = MAIN / "res"
JAVA_DIR = MAIN / "java"

failures: list[str] = []
checks = 0


def ok(cond: bool, msg: str) -> None:
    global checks
    checks += 1
    print(("  PASS  " if cond else "  FAIL  ") + msg)
    if not cond:
        failures.append(msg)


# ── 1. XML 格式 ────────────────────────────────────────────
xml_files = sorted(MAIN.rglob("*.xml"))
ok(len(xml_files) >= 4, f"找到 {len(xml_files)} 个 XML 文件")
for f in xml_files:
    try:
        ET.parse(f)
        ok(True, f"XML 格式良好: {f.relative_to(MAIN)}")
    except ET.ParseError as e:
        ok(False, f"XML 解析失败: {f.relative_to(MAIN)} -> {e}")


# ── 2. manifest 与 namespace / 源文件路径 ──────────────────
manifest_text = (MAIN / "AndroidManifest.xml").read_text(encoding="utf-8")
gradle_app = (ANDROID / "app" / "build.gradle.kts").read_text(encoding="utf-8")
ns_match = re.search(r'namespace\s*=\s*"([^"]+)"', gradle_app)
namespace = ns_match.group(1) if ns_match else ""
ok(bool(namespace), f"build.gradle.kts 声明了 namespace = {namespace}")
ok('package=' not in manifest_text,
   "manifest 未使用旧的 package 属性（AGP 8 要求 namespace 写在 gradle 里）")

activity = re.search(r'android:name="\.([A-Za-z0-9_]+)"', manifest_text)
ok(activity is not None, "manifest 里找到了相对类名的 Activity")
if activity:
    cls = activity.group(1)
    src = JAVA_DIR.joinpath(*namespace.split("."), cls + ".java")
    ok(src.exists(), f"Activity 源文件存在: {src.relative_to(MAIN)}")
    if src.exists():
        text = src.read_text(encoding="utf-8")
        ok(re.search(rf"^package\s+{re.escape(namespace)}\s*;", text, re.M) is not None,
           f"Java package 与 namespace 一致: {namespace}")
        ok(f"class {cls}" in text, f"源文件里定义了 class {cls}")
        ok('getAssets().open("www"' in text, "拦截器指向 assets/www")

ok("android.permission.INTERNET" in manifest_text, "声明了 INTERNET 权限")
ok('android:usesCleartextTraffic="false"' in manifest_text, "禁用了明文流量")


# ── 3. 资源引用是否都存在 ──────────────────────────────────
defined: set[tuple[str, str]] = set()
for values in RES.glob("values*/*.xml"):
    root = ET.parse(values).getroot()
    for child in root:
        name = child.attrib.get("name")
        if name:
            defined.add((child.tag, name))
ok(len(defined) >= 4, f"values 中定义了 {len(defined)} 个资源")

REF = re.compile(r"@(?!android:|\+)([a-z]+)/([A-Za-z0-9_.]+)")
refs: set[tuple[str, str]] = set()
for f in xml_files:
    for t, n in REF.findall(f.read_text(encoding="utf-8")):
        refs.add((t, n))
ok(len(refs) >= 4, f"找到 {len(refs)} 个资源引用")
for t, n in sorted(refs):
    hit = (t, n) in defined or bool(list(RES.glob(f"{t}-*/{n}.*")))
    ok(hit, f"资源可解析: @{t}/{n}")


# ── 4. 启动图标齐全且尺寸正确 ──────────────────────────────
DENSITIES = {"mdpi": 1.0, "hdpi": 1.5, "xhdpi": 2.0, "xxhdpi": 3.0, "xxxhdpi": 4.0}
try:
    from PIL import Image  # type: ignore
    have_pillow = True
except ImportError:
    have_pillow = False

for density, factor in DENSITIES.items():
    legacy = RES / f"mipmap-{density}" / "ic_launcher.png"
    fg = RES / f"mipmap-{density}" / "ic_launcher_foreground.png"
    ok(legacy.exists() and fg.exists(), f"{density}: 传统图标与自适应前景都在")
    if have_pillow and legacy.exists() and fg.exists():
        want_legacy = round(48 * factor)
        want_fg = round(108 * factor)
        with Image.open(legacy) as im:
            ok(im.size == (want_legacy, want_legacy),
               f"{density}: 传统图标 {im.size[0]}px（期望 {want_legacy}px）")
        with Image.open(fg) as im:
            ok(im.size == (want_fg, want_fg),
               f"{density}: 前景层 {im.size[0]}px（期望 {want_fg}px）")
            ok(im.mode == "RGBA", f"{density}: 前景层带透明通道")

adaptive = RES / "mipmap-anydpi-v26" / "ic_launcher.xml"
ok(adaptive.exists(), "存在 mipmap-anydpi-v26/ic_launcher.xml（Android 8+ 自适应图标）")


# ── 5. Java / Kotlin 括号平衡与 package 路径 ───────────────
def strip_code(text: str) -> str:
    """去掉注释与字符串字面量，便于做括号平衡检查。"""
    out, i, n = [], 0, len(text)
    while i < n:
        c = text[i]
        if c == "/" and i + 1 < n and text[i + 1] == "/":
            i = text.find("\n", i)
            if i < 0:
                break
        elif c == "/" and i + 1 < n and text[i + 1] == "*":
            end = text.find("*/", i + 2)
            i = n if end < 0 else end + 2
        elif c in "\"'":
            quote, i = c, i + 1
            while i < n and text[i] != quote:
                i += 2 if text[i] == "\\" else 1
            i += 1
        else:
            out.append(c)
            i += 1
    return "".join(out)


for src in sorted(JAVA_DIR.rglob("*.java")):
    body = strip_code(src.read_text(encoding="utf-8"))
    for opener, closer in (("{", "}"), ("(", ")"), ("[", "]")):
        ok(body.count(opener) == body.count(closer),
           f"{src.name}: {opener}{closer} 平衡 ({body.count(opener)}/{body.count(closer)})")
    pkg = re.search(r"^package\s+([\w.]+)\s*;", src.read_text(encoding="utf-8"), re.M)
    if pkg:
        expected = JAVA_DIR.joinpath(*pkg.group(1).split("."))
        ok(src.parent == expected, f"{src.name}: 目录与 package 声明一致")

for gradle in sorted(ANDROID.rglob("*.gradle.kts")):
    body = strip_code(gradle.read_text(encoding="utf-8"))
    ok(body.count("{") == body.count("}"),
       f"{gradle.name}: 花括号平衡 ({body.count('{')}/{body.count('}')})")


# ── 6. assets/www 与网页源文件一致 ─────────────────────────
ASSETS = MAIN / "assets" / "www"
ITEMS = ["index.html", "styles.css", "app.js", "manifest.webmanifest", "sw.js", "icons"]


def digest(p: Path) -> str:
    return hashlib.sha256(p.read_bytes()).hexdigest()


ok(ASSETS.exists(), "assets/www 已生成")
stale: list[str] = []
missing: list[str] = []
for item in ITEMS:
    src = ROOT / item
    if src.is_dir():
        for f in src.rglob("*"):
            if f.is_file():
                rel = f.relative_to(ROOT)
                dst = ASSETS / rel
                if not dst.exists():
                    missing.append(str(rel))
                elif digest(f) != digest(dst):
                    stale.append(str(rel))
    else:
        dst = ASSETS / item
        if not dst.exists():
            missing.append(item)
        elif digest(src) != digest(dst):
            stale.append(item)

ok(not missing, f"assets 无缺失文件{'' if not missing else ': ' + ', '.join(missing)}")
ok(not stale,
   "assets 与网页源码一致" + ("" if not stale else f"（过期，请跑 tools/sync-assets.mjs）: {', '.join(stale)}"))

# WebView 壳的入口必须是真实存在的文件
ok((ASSETS / "index.html").exists(), "assets/www/index.html 存在（拦截器入口）")


# ── 7. GitHub Actions workflow 基本结构 ────────────────────
wf = ROOT / ".github" / "workflows" / "build-apk.yml"
ok(wf.exists(), "存在 .github/workflows/build-apk.yml")
if wf.exists():
    text = wf.read_text(encoding="utf-8")
    for need in ("actions/checkout@v4", "actions/setup-java@v4", "gradle/actions/setup-gradle@v4",
                 "actions/upload-artifact@v4", "assembleDebug", "tools/sync-assets.mjs"):
        ok(need in text, f"workflow 包含: {need}")
    try:
        import yaml  # type: ignore
        yaml.safe_load(text)
        ok(True, "workflow YAML 可解析")
    except ImportError:
        print("  SKIP  workflow YAML 解析（本机没有 PyYAML，未能验证缩进）")
    except Exception as e:  # noqa: BLE001
        ok(False, f"workflow YAML 解析失败: {e}")


print()
if failures:
    print(f"失败 {len(failures)} 项 / 共 {checks} 项检查 ❌")
    for f in failures:
        print("  - " + f)
    sys.exit(1)
print(f"全部通过 ✅ （{checks} 项检查）")
