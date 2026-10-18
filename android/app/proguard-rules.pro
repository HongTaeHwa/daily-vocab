# 난독화를 쓰지 않는다(isMinifyEnabled = false). JavascriptInterface 메서드 이름은 그대로 유지되어야 한다.
-keepclassmembers class kr.dailyvocab.app.SpeechBridge { @android.webkit.JavascriptInterface <methods>; }
