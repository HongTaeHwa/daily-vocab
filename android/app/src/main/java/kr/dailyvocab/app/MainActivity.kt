package kr.dailyvocab.app

import android.Manifest
import android.annotation.SuppressLint
import android.content.Intent
import android.content.pm.PackageManager
import android.content.res.Configuration
import android.graphics.Bitmap
import android.graphics.Typeface
import android.net.Uri
import android.os.Bundle
import android.os.Environment
import android.provider.MediaStore
import android.util.TypedValue
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.view.WindowManager
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.TextView
import android.widget.Toast
import android.webkit.MimeTypeMap
import android.webkit.PermissionRequest
import android.webkit.URLUtil
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
import org.json.JSONObject

/**
 * 매일 영단어 웹앱(https://hongtaehwa.github.io/daily-vocab/)을 WebView로 여는 갤럭시용 앱.
 * 하는 일은 다섯뿐이다.
 *  1. FLAG_SECURE — 이 앱 화면에서는 스크린샷·화면 녹화·서클 투 서치가 동작하지 않는다(다른 앱에는 영향 없음).
 *  2. 화면 분할 차단 — 매니페스트 resizeableActivity=false + 멀티윈도우(분할·팝업 화면)가 감지되면 웹앱을 가리고 안내만 보여 준다.
 *  3. 음성 인식·TTS 브리지 — WebView에는 Web Speech API가 없어 안드로이드 기본 인식기/TTS를 연결한다(SpeechBridge + assets/bridge.js).
 *  4. 사진 선택·촬영과 JSON 가져오기의 파일 선택(입력의 accept 를 따름), 마이크 권한, 뒤로 가기, 아이 전용 링크 열기.
 *  5. 파일 내려받기 — 웹앱의 ‘전체 백업 JSON’·‘CSV 내려받기’(blob: 주소)를 ‘다운로드’ 폴더에 저장한다(DownloadBridge + assets/bridge.js, v1.4).
 * 세트·기록·가족 기록함·오늘의 단어는 모두 웹앱 그대로다(앱은 웹앱 주소만 안다).
 */
class MainActivity : AppCompatActivity() {
    companion object {
        const val APP_URL = "https://hongtaehwa.github.io/daily-vocab/"
        const val APP_HOST = "hongtaehwa.github.io"
        const val UA_SUFFIX = " DailyVocabApp/" + BuildConfig.VERSION_NAME // 웹앱이 기기 종류를 ‘Android 태블릿(앱)’으로 표시하는 데 쓴다
    }

    private lateinit var webView: WebView
    private lateinit var splitGuard: View
    private lateinit var speech: SpeechBridge
    private var fileCallback: ValueCallback<Array<Uri>>? = null
    private var cameraUri: Uri? = null
    private var pendingWebPermission: PermissionRequest? = null
    private var pendingSave: ByteArray? = null // ‘다른 이름으로 저장’ 대화상자가 돌아올 때까지 들고 있는 파일 내용

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

    // 내려받기 폴백: ‘다른 이름으로 저장’(ACTION_CREATE_DOCUMENT)에서 고른 위치에 pendingSave 를 쓴다.
    private val saveDialog = registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { result ->
        val bytes = pendingSave
        pendingSave = null
        val uri = result.data?.data
        if (result.resultCode != RESULT_OK || uri == null || bytes == null) return@registerForActivityResult
        val ok = writeTo(uri, bytes)
        Toast.makeText(this, if (ok) R.string.download_saved_as else R.string.download_failed, Toast.LENGTH_LONG).show()
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
        // 웹앱 위에 화면 분할 안내 가림막을 겹쳐 둔다(평소에는 숨김).
        val frame = FrameLayout(this)
        frame.addView(root, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
        splitGuard = buildSplitGuard()
        frame.addView(splitGuard, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
        setContentView(frame)
        applyMultiWindowGuard(isInMultiWindowMode)
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
        webView.addJavascriptInterface(DownloadBridge(this, ::saveWithDialog), "AndroidDownload")

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

            // 세트 만들기의 사진 선택(<input accept="image/*">)·촬영(capture), 설정의 JSON 가져오기(<input accept="application/json">).
            // 입력의 accept 를 따른다: 사진이면 전처럼 사진·카메라, 그 밖이면 요청한 종류를 기본으로 하되 */* 도 함께 허용해
            // 파일 관리자가 .json 을 text/plain 등으로 보고해도 고를 수 있게 한다(내용 검사는 웹앱이 한다).
            override fun onShowFileChooser(view: WebView, callback: ValueCallback<Array<Uri>>, params: FileChooserParams): Boolean {
                fileCallback?.onReceiveValue(null)
                fileCallback = callback
                val mimeTypes = acceptedMimeTypes(params.acceptTypes)
                val imagesOnly = mimeTypes.all { it.startsWith("image/") }
                val pick = Intent(Intent.ACTION_GET_CONTENT).apply {
                    addCategory(Intent.CATEGORY_OPENABLE)
                    if (imagesOnly) {
                        type = "image/*"
                    } else {
                        type = mimeTypes.first()
                        putExtra(Intent.EXTRA_MIME_TYPES, (mimeTypes + "*/*").toTypedArray())
                    }
                    putExtra(Intent.EXTRA_ALLOW_MULTIPLE, params.mode == FileChooserParams.MODE_OPEN_MULTIPLE)
                }
                val camera = if (imagesOnly) cameraIntent() else null
                val title = getString(if (imagesOnly) R.string.choose_photo else R.string.choose_file)
                val intent = when {
                    params.isCaptureEnabled && camera != null -> camera
                    else -> Intent.createChooser(pick, title).apply {
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

        // 내려받기: 웹앱의 blob: 내려받기는 bridge.js 가 click 단계에서 가로채므로 여기까지 오지 않는 것이 보통이다.
        // 그래도 blob:/data: 주소가 오면(어댑터를 거치지 않은 경로) 어댑터의 저장 함수로 되돌리고, http(s) 주소는 바깥 링크처럼 브라우저로 넘긴다.
        // (DownloadManager 는 Android 8·9에서 저장 권한이 필요하고 앱에 http 내려받기가 없어 쓰지 않는다.)
        webView.setDownloadListener { url, _, contentDisposition, mimeType, _ ->
            if (url.startsWith("blob:") || url.startsWith("data:")) {
                val name = URLUtil.guessFileName(url, contentDisposition, mimeType)
                val script = "window.__dailyVocabDownload && window.__dailyVocabDownload(" + JSONObject.quote(url) + ", " + JSONObject.quote(name) + ")"
                webView.evaluateJavascript(script, null)
            } else {
                try {
                    startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url)))
                } catch (e: Exception) {
                    Toast.makeText(this, R.string.download_failed, Toast.LENGTH_LONG).show()
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

    // <input accept="…"> 의 항목을 MIME 종류로 바꾼다(".json" → application/json). 비어 있으면 사진으로 본다.
    private fun acceptedMimeTypes(accept: Array<String>?): List<String> {
        val types = (accept ?: emptyArray()).map { it.trim().lowercase(Locale.US) }.filter { it.isNotEmpty() }.map {
            if (it.startsWith(".")) MimeTypeMap.getSingleton().getMimeTypeFromExtension(it.substring(1)) ?: "*/*" else it
        }
        return if (types.isEmpty()) listOf("image/*") else types.distinct()
    }

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

    // DownloadBridge 가 MediaStore 로 저장하지 못할 때(Android 8·9, 저장 실패): 시스템 ‘다른 이름으로 저장’ 대화상자(기본 위치 다운로드)로 넘긴다.
    private fun saveWithDialog(name: String, mime: String, bytes: ByteArray) {
        pendingSave = bytes
        val intent = Intent(Intent.ACTION_CREATE_DOCUMENT).apply {
            addCategory(Intent.CATEGORY_OPENABLE)
            type = mime
            putExtra(Intent.EXTRA_TITLE, name)
        }
        try {
            saveDialog.launch(intent)
        } catch (e: Exception) {
            pendingSave = null
            Toast.makeText(this, R.string.download_failed, Toast.LENGTH_LONG).show()
        }
    }

    // 문서 제공자에 따라 "wt"(비우고 쓰기)를 지원하지 않는 곳이 있어 "w"로 한 번 더 시도한다.
    private fun writeTo(uri: Uri, bytes: ByteArray): Boolean {
        for (mode in arrayOf("wt", "w")) {
            try {
                val stream = contentResolver.openOutputStream(uri, mode) ?: continue
                stream.use { it.write(bytes) }
                return true
            } catch (e: Exception) {
                // 다음 모드로
            }
        }
        return false
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
        applyMultiWindowGuard(isInMultiWindowMode)
    }

    // ---- 화면 분할(멀티윈도우) 차단 ----
    // 분할 화면·팝업 화면에서는 옆에 브라우저나 AI 앱을 띄워 답을 찾을 수 있으므로 쓰지 못하게 한다.
    // 매니페스트의 resizeableActivity=false 로 대부분 막히지만 Android 12+ 큰 화면(태블릿)은 OS가 분할을 강제할 수 있어 여기서 한 번 더 막는다:
    // 멀티윈도우가 감지되면 WebView를 숨기고(페이지에는 visibilitychange(hidden)가 전달되어 웹앱이 ‘화면 이탈’로 기록한다) 안내 가림막만 보여 준다.
    // 다시 전체 화면이 되면 그대로 이어서 쓸 수 있다(시험 중이던 제한 시간은 계속 흐른다).
    override fun onMultiWindowModeChanged(isInMultiWindowMode: Boolean, newConfig: Configuration) {
        super.onMultiWindowModeChanged(isInMultiWindowMode, newConfig)
        applyMultiWindowGuard(isInMultiWindowMode)
    }

    private fun applyMultiWindowGuard(on: Boolean) {
        splitGuard.visibility = if (on) View.VISIBLE else View.GONE
        webView.visibility = if (on) View.INVISIBLE else View.VISIBLE
    }

    private fun buildSplitGuard(): View {
        val density = resources.displayMetrics.density
        val pad = (28 * density).toInt()
        val white = ContextCompat.getColor(this, R.color.white)
        val title = TextView(this).apply {
            text = getString(R.string.split_blocked_title)
            setTextColor(white)
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 24f)
            typeface = Typeface.DEFAULT_BOLD
            gravity = Gravity.CENTER
        }
        val body = TextView(this).apply {
            text = getString(R.string.split_blocked_body)
            setTextColor(white)
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 17f)
            gravity = Gravity.CENTER
            setPadding(0, (12 * density).toInt(), 0, 0)
        }
        return LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER
            setBackgroundColor(ContextCompat.getColor(this@MainActivity, R.color.navy))
            setPadding(pad, pad, pad, pad)
            isClickable = true // 뒤의 WebView로 터치가 가지 않게
            visibility = View.GONE
            addView(title, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT))
            addView(body, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT))
        }
    }

    override fun onDestroy() {
        speech.destroy()
        webView.destroy()
        super.onDestroy()
    }
}
