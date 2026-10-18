// 매일 영단어 갤럭시용 앱(웹앱 래퍼). 빌드는 GitHub Actions(.github/workflows/android-apk.yml)가 한다.
pluginManagement {
    repositories {
        google()
        mavenCentral()
        gradlePluginPortal()
    }
}
dependencyResolutionManagement {
    repositoriesMode.set(RepositoriesMode.FAIL_ON_PROJECT_REPOS)
    repositories {
        google()
        mavenCentral()
    }
}
rootProject.name = "daily-vocab-app"
include(":app")
