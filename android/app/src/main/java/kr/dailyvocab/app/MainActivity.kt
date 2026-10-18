package kr.dailyvocab.app

import android.Manifest
import android.annotation.SuppressLint
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Bitmap
import android.net.Uri
import android.os.Bundle
import android.os.Environment
import android.provider.MediaStore
import android.view.View
import android.view.ViewGroup
import android.view.WindowManager
import android.widget.LinearLayout
import android.webkit.PermissionRequest
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.activity.OnBackPressedCallback
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.ContextCompat
import androidx.core.content.FileProvider
import androidx.core.view.ViewCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat
import androidx.webkit.WebViewCompat
import androidx.webkit.WebViewFeature
import java.io.File
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

/**
 * 매일 영단어 웹앱(https://hongtaehwa.github.io/daily-vocab/)을 WebView로 여는 갤럭시용 앱.
 * 하는 일은 셋뿐이다.
 *  1. FLAG_SECURE — 이 앱 화면에서는 스크린샷·화면 녹화·서클 투 서치가 동작하지 않는다(다른 앱에는 영향 없음).
 *  2. 음성 인식·TTS 브리지 — WebView에는 Web Speech API가 없어 안드로이드 기본 인식기/TTS를 연결한다(SpeechBridge + assets/bridge.js).
 *  3. 사진 선택·촬영, 마이크 권한, 뒤로 가기, 아이 전용 링크 열기.
 * 세트·기록·가족 기록함·오늘의 단어는 모두 웹앱 그대로다(앱은 웹앱 주소만 안다).
 */
class MainActivity : AppCompatActivity() {
    companion object {
        const val APP_URL = "https://hongtaehwa.github.io/daily-vocab/"
        const val APP_HOST = "hongtaehwa.github.io"
        const val UA_SUFFIX = " DailyVocabApp/" + BuildConfig.VERSION_NAME // 웹앱이 기기 종류를 ‘Android 태블릿(앱)’으로 표시하는 데 쓴다
    }

    private lateinit var webView: WebView
    private lateinit var speech: SpeechBridge
    private var fileCallback: ValueCallback<Array<Uri>>? = null
    private var cameraUri: Uri? = null
    private var pendingWebPermission: PermissionRequest? = null

    private val micPermission = registerForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
        speech.onPermissionResult(granted)
        pendingWebPermission?.let { request ->
            if (granted) request.grant(request.resources) else request.deny()
            pendingWebPermission = null
        }
    }

    private val chooser = registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { result ->
        val callback = fileCallback ?: return@registerForActivityResult
        fileCallback = null
        val uris = mutableListOf<Uri>()
        if (result.resultCode == RESULT_OK) {
            val data = result.data
            val clip = data?.clipData
            if (clip != null) for (i in 0 until clip.itemCount) uris += clip.getItemAt(i).uri
            else data?.data?.let { uris += it }
            if (uris.isEmpty()) cameraUri?.let { uris += it } // 카메라 앱은 보통 data 없이 EXTRA_OUTPUT 파일에 저장한다
        }
        cameraUri = null
        callback.onReceiveValue(if (uris.isEmpty()) null else uris.toTypedArray())
    }

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        // 화면 캡처 금지: 스크린샷·화면 녹화·서클 투 서치가 이 앱 화면을 읽지 못한다.
        window.setFlags(WindowManager.LayoutParams.FLAG_SECURE, WindowManager.LayoutParams.FLAG_SECURE)

        // Android 15(targetSdk 35)부터 창이 상태 표시줄·내비게이션 바 아래까지 그려진다(edge-to-edge). 모든 버전에서 같은 방식으로
        // 처리하기 위해 직접 여백을 둔다: 위 여백(상태 표시줄 높이)은 웹앱 상단 바 색, 아래 여백(내비게이션 바 또는 키보드 높이)은 흰색.
        WindowCompat.setDecorFitsSystemWindows(window, false)
        webView = WebView(this)
        val root = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }
        val topSpacer = View(this).apply { setBackgroundColor(ContextCompat.getColor(this@MainActivity, R.color.navy)) }
        val bottomSpacer = View(this).apply { setBackgroundColor(ContextCompat.getColor(this@MainActivity, R.color.white)) }
        root.addView(topSpacer, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0))
        root.addView(webView, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f))
        root.addView(bottomSpacer, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0))
        setContentView(root)
        ViewCompat.setOnApplyWindowInsetsListener(root) { _, insets ->
            val bars = insets.getInsets(WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.displayCutout())
            val ime = insets.getInsets(WindowInsetsCompat.Type.ime())
            topSpacer.layoutParams = topSpacer.layoutParams.apply { height = bars.top }
            bottomSpacer.layoutParams = bottomSpacer.layoutParams.apply { height = maxOf(bars.bottom, ime.bottom) }
            root.setPadding(bars.left, 0, bars.right, 0)
            WindowInsetsCompat.CONSUMED
        }
        WindowInsetsControllerCompat(window, root).apply {
            isAppearanceLightStatusBars = false // 남색 위 흰 아이콘
            isAppearanceLightNavigationBars = true // 흰 바 위 검은 아이콘
        }
        with(webView.settings) {
            javaScriptEnabled = true
            domStorageEnabled = true
            databaseEnabled = true
            mediaPlaybackRequiresUserGesture = false
            allowFileAccess = false
            cacheMode = WebSettings.LOAD_DEFAULT
            userAgentString = userAgentString + UA_SUFFIX
        }

        speech = SpeechBridge(this, webView) { micPermission.launch(Manifest.permission.RECORD_AUDIO) }
        webView.addJavascriptInterface(speech, "AndroidSpeech")

        // 페이지 스크립트보다 먼저 실행되어 window.SpeechRecognition / speechSynthesis 를 안드로이드 브리지로 바꿔 둔다.
        val bridge = assets.open("bridge.js").bufferedReader().use { it.readText() }
        val startScript = WebViewFeature.isFeatureSupported(WebViewFeature.DOCUMENT_START_SCRIPT)
        if (startScript) WebViewCompat.addDocumentStartJavaScript(webView, bridge, setOf("https://$APP_HOST"))

        webView.webViewClient = object : WebViewClient() {
            override fun onPageStarted(view: WebView, url: String?, favicon: Bitmap?) {
                if (!startScript) view.evaluateJavascript(bridge, null) // 옛 WebView 대비(스크립트 로드 전에 실행되는 것이 보통이다)
            }

            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                val url = request.url
                if (url.host == APP_HOST) return false
                return try {
                    startActivity(Intent(Intent.ACTION_VIEW, url)) // 바깥 링크(저장소 안내 등)는 브라우저로
                    true
                } catch (e: Exception) {
                    false
                }
            }
        }

        webView.webChromeClient = object : WebChromeClient() {
            // 설정 → 마이크 권한 요청(getUserMedia)
            override fun onPermissionRequest(request: PermissionRequest) {
                if (!request.resources.contains(PermissionRequest.RESOURCE_AUDIO_CAPTURE)) {
                    request.deny()
                    return
                }
                if (hasMicPermission()) request.grant(request.resources)
                else {
                    pendingWebPermission = request
                    micPermission.launch(Manifest.permission.RECORD_AUDIO)
                }
            }

            // 세트 만들기의 사진 선택(<input type=file>)·촬영(capture)
            override fun onShowFileChooser(view: WebView, callback: ValueCallback<Array<Uri>>, params: FileChooserParams): Boolean {
                fileCallback?.onReceiveValue(null)
                fileCallback = callback
                val pick = Intent(Intent.ACTION_GET_CONTENT).apply {
                    addCategory(Intent.CATEGORY_OPENABLE)
                    type = "image/*"
                    putExtra(Intent.EXTRA_ALLOW_MULTIPLE, params.mode == FileChooserParams.MODE_OPEN_MULTIPLE)
                }
                val camera = cameraIntent()
                val intent = when {
                    params.isCaptureEnabled && camera != null -> camera
                    else -> Intent.createChooser(pick, getString(R.string.choose_photo)).apply {
                        if (camera != null) putExtra(Intent.EXTRA_INITIAL_INTENTS, arrayOf(camera))
                    }
                }
                return try {
                    chooser.launch(intent)
                    true
                } catch (e: Exception) {
                    fileCallback = null
                    false
                }
            }
        }

        // 뒤로 가기: 웹앱의 화면 되돌리기(pushState)를 먼저, 더 갈 곳이 없으면 앱 종료
        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                if (webView.canGoBack()) webView.goBack()
                else {
                    isEnabled = false
                    onBackPressedDispatcher.onBackPressed()
                }
            }
        })

        if (savedInstanceState != null) webView.restoreState(savedInstanceState)
        else webView.loadUrl(linkFrom(intent) ?: APP_URL)
    }

    // 아이 전용 링크를 이 앱으로 열면(singleTask) 그 주소를 읽어 연결한다.
    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        linkFrom(intent)?.let { webView.loadUrl(it) }
    }

    private fun linkFrom(intent: Intent?): String? {
        val data = intent?.data ?: return null
        return if (intent.action == Intent.ACTION_VIEW && data.host == APP_HOST) data.toString() else null
    }

    private fun hasMicPermission() =
        ContextCompat.checkSelfPermission(this, Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED

    private fun cameraIntent(): Intent? {
        val intent = Intent(MediaStore.ACTION_IMAGE_CAPTURE)
        if (intent.resolveActivity(packageManager) == null) return null
        return try {
            val dir = File(getExternalFilesDir(Environment.DIRECTORY_PICTURES), "camera").apply { mkdirs() }
            val file = File(dir, "photo-" + SimpleDateFormat("yyyyMMdd-HHmmss", Locale.US).format(Date()) + ".jpg")
            cameraUri = FileProvider.getUriForFile(this, "$packageName.fileprovider", file)
            intent.putExtra(MediaStore.EXTRA_OUTPUT, cameraUri)
            intent.addFlags(Intent.FLAG_GRANT_WRITE_URI_PERMISSION or Intent.FLAG_GRANT_READ_URI_PERMISSION)
            intent
        } catch (e: Exception) {
            null
        }
    }

    override fun onSaveInstanceState(outState: Bundle) {
        super.onSaveInstanceState(outState)
        webView.saveState(outState)
    }

    override fun onPause() {
        super.onPause()
        webView.onPause()
    }

    override fun onResume() {
        super.onResume()
        webView.onResume()
    }

    override fun onDestroy() {
        speech.destroy()
        webView.destroy()
        super.onDestroy()
    }
}
