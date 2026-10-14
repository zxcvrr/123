plugins {
    id("com.android.application")
}

android {
    namespace = "com.example.dskchat"
    compileSdk = 34

    defaultConfig {
        applicationId = "com.example.dskchat"
        minSdk = 24          // Android 7.0，WebView 支持足够现代
        targetSdk = 34
        versionCode = 1
        versionName = "1.0"
    }

    buildTypes {
        debug {
            isMinifyEnabled = false
            // debug 包由 AGP 自动用 ~/.android/debug.keystore 签名，可直接安装
        }
        release {
            isMinifyEnabled = false
            // 想正式发布：自行生成 keystore 并补 signingConfigs，见 README
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    // 本工程刻意零依赖：WebView 交互全部走 Android 系统 API，
    // 不需要 AndroidX / Material，构建更快、更少出错。
}

dependencies {
    // 无。全部使用 android.* 平台 API。
}
