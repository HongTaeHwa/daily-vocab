plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

// 서명 키는 저장소에 두지 않는다. GitHub Actions가 Secrets의 keystore를 풀어 아래 환경 변수로 넘긴다(android/README.md).
// 환경 변수가 없으면 debug 키로 서명한다(설치는 되지만 빌드마다 서명이 달라 업데이트 때 지우고 다시 설치해야 한다).
val keystorePath: String? = System.getenv("ANDROID_KEYSTORE_PATH")
val hasReleaseKey = !keystorePath.isNullOrBlank() && file(keystorePath).exists()

android {
    namespace = "kr.dailyvocab.app"
    compileSdk = 35

    defaultConfig {
        applicationId = "kr.dailyvocab.app"
        minSdk = 26
        targetSdk = 35
        versionCode = 4
        versionName = "1.3"
    }

    signingConfigs {
        if (hasReleaseKey) {
            create("release") {
                storeFile = file(keystorePath!!)
                storeType = "PKCS12" // scripts/setup-signing.sh 가 openssl로 만든 키 저장소
                storePassword = System.getenv("ANDROID_KEYSTORE_PASSWORD")
                keyAlias = System.getenv("ANDROID_KEY_ALIAS")
                keyPassword = System.getenv("ANDROID_KEY_PASSWORD")
            }
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            signingConfig = signingConfigs.findByName("release") ?: signingConfigs.getByName("debug")
        }
    }

    buildFeatures {
        buildConfig = true
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions {
        jvmTarget = "17"
    }
}

dependencies {
    implementation("androidx.core:core-ktx:1.15.0")
    implementation("androidx.appcompat:appcompat:1.7.0")
    implementation("androidx.activity:activity-ktx:1.9.3")
    implementation("androidx.webkit:webkit:1.12.1")
}
