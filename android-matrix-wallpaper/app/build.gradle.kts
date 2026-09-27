plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "com.example.matrixwallpaper"
    compileSdk = 34

    defaultConfig {
        applicationId = "com.example.matrixwallpaper"
        minSdk = 26          // Android 8.0+ (adaptive icons, все актуальные Pixel/GrapheneOS)
        targetSdk = 34
        versionCode = 2
        versionName = "1.1"
    }

    buildTypes {
        release {
            // Без обфускации — код крошечный, так проще собирать debug/release одинаково.
            isMinifyEnabled = false
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    kotlinOptions {
        jvmTarget = "17"
    }
}

// Зависимостей нет: используем только классы Android-фреймворка.
// Kotlin-stdlib подключается плагином автоматически.
dependencies {
}
