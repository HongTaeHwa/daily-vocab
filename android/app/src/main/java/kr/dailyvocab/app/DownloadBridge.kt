package kr.dailyvocab.app

import android.app.Activity
import android.content.ContentValues
import android.net.Uri
import android.os.Build
import android.os.Environment
import android.provider.MediaStore
import android.util.Base64
import android.webkit.JavascriptInterface
import android.webkit.MimeTypeMap
import android.widget.Toast
import androidx.annotation.RequiresApi
import java.io.ByteArrayOutputStream
import java.util.Locale

/**
 * 웹앱의 ‘전체 백업 JSON’(설정)·‘CSV 내려받기’(기록 탭)를 안드로이드 파일 저장으로 연결한다.
 * 웹앱은 Blob → URL.createObjectURL → <a download> → click() 으로 파일을 만드는데 WebView 는 blob: 주소를 내려받지 못하므로,
 * assets/bridge.js 가 click 을 가로채 Blob 을 base64 조각으로 여기에 넘긴다:
 *   begin(이름, MIME, base64 길이) → token(1 이상), append(token, 조각)… → finish(token). 실패하면 abort(token).
 * 조각으로 나누는 이유는 백업 JSON 이 수 MB 가 될 수 있어서다(상한 MAX_BYTES).
 * Android 10 이상은 MediaStore 로 ‘다운로드’ 폴더에 바로 저장하고(권한 불필요, 같은 이름은 OS 가 ‘(1)’을 붙임),
 * Android 8·9와 저장에 실패했을 때는 MainActivity 의 ‘다른 이름으로 저장’ 대화상자(ACTION_CREATE_DOCUMENT)로 넘긴다.
 */
class DownloadBridge(
    private val activity: Activity,
    private val saveWithDialog: (name: String, mime: String, bytes: ByteArray) -> Unit,
) {
    companion object {
        const val MAX_BYTES = 50L * 1024 * 1024
    }

    private class Pending(val token: Int, val name: String, val mime: String) {
        val bytes = ByteArrayOutputStream()
    }

    private var lastToken = 0
    private var pending: Pending? = null

    /** 내려받기 시작. 1 이상의 token 을 돌려주고 0이면 거절(너무 큼). 끝내지 않은 이전 내려받기는 버린다. */
    @JavascriptInterface
    @Synchronized
    fun begin(name: String, mime: String, base64Length: Int): Int {
        pending = null
        if (base64Length < 0 || base64Length.toLong() / 4 * 3 > MAX_BYTES) {
            toast(activity.getString(R.string.download_failed))
            return 0
        }
        val fileName = safeFileName(name)
        val next = Pending(++lastToken, fileName, mimeFor(fileName, mime))
        pending = next
        return next.token
    }

    /** base64 조각(길이는 4의 배수라 따로 풀 수 있다)을 이어 붙인다. false 면 JS 쪽이 abort 한다. */
    @JavascriptInterface
    @Synchronized
    fun append(token: Int, base64: String): Boolean {
        val current = pending ?: return false
        if (current.token != token) return false
        val chunk = try {
            Base64.decode(base64, Base64.DEFAULT)
        } catch (e: IllegalArgumentException) {
            null
        }
        if (chunk == null || current.bytes.size().toLong() + chunk.size > MAX_BYTES) {
            pending = null
            return false
        }
        current.bytes.write(chunk)
        return true
    }

    /** 조각을 모두 받았다. 저장은 이 스레드(WebView 의 JavaBridge 스레드)에서 하고 안내·대화상자는 UI 스레드로. */
    @JavascriptInterface
    fun finish(token: Int): Boolean {
        val done = synchronized(this) {
            val current = pending
            if (current == null || current.token != token) return false
            pending = null
            current
        }
        val bytes = done.bytes.toByteArray()
        var saved = false
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) saved = saveToDownloads(done.name, done.mime, bytes)
        if (saved) toast(activity.getString(R.string.download_saved, done.name))
        else activity.runOnUiThread { saveWithDialog(done.name, done.mime, bytes) }
        return true
    }

    /** JS 쪽이 중간에 실패했을 때(FileReader 오류, append 거절). token 이 맞지 않아도(0) 실패 안내는 한다. */
    @JavascriptInterface
    fun abort(token: Int) {
        synchronized(this) { if (pending?.token == token) pending = null }
        toast(activity.getString(R.string.download_failed))
    }

    // Android 10+: MediaStore 의 Downloads 테이블에 넣으면 권한 없이 ‘다운로드’ 폴더에 파일이 생긴다. 쓰는 동안 IS_PENDING 으로 숨긴다.
    @RequiresApi(Build.VERSION_CODES.Q)
    private fun saveToDownloads(name: String, mime: String, bytes: ByteArray): Boolean {
        val resolver = activity.contentResolver
        val values = ContentValues().apply {
            put(MediaStore.Downloads.DISPLAY_NAME, name)
            put(MediaStore.Downloads.MIME_TYPE, mime)
            put(MediaStore.Downloads.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS)
            put(MediaStore.Downloads.IS_PENDING, 1)
        }
        val uri: Uri = try {
            resolver.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values)
        } catch (e: Exception) {
            null
        } ?: return false
        return try {
            val stream = resolver.openOutputStream(uri) ?: throw IllegalStateException("no output stream")
            stream.use { it.write(bytes) }
            values.clear()
            values.put(MediaStore.Downloads.IS_PENDING, 0)
            resolver.update(uri, values, null, null)
            true
        } catch (e: Exception) {
            try {
                resolver.delete(uri, null, null)
            } catch (ignored: Exception) {
                // 반쯤 쓰인 항목을 지우지 못해도 어쩔 수 없다
            }
            false
        }
    }

    // MediaStore 는 "text/csv;charset=utf-8" 같은 파라미터가 붙은 MIME 을 받지 않고 확장자와 MIME 이 어긋나면 이름을 바꾸거나 거절하므로
    // 확장자에서 다시 구한다(.json → application/json, .csv → text/csv). 모르는 확장자면 Blob 의 종류(파라미터 제거)를 쓴다.
    private fun mimeFor(name: String, blobType: String): String {
        val ext = name.substringAfterLast('.', "").lowercase(Locale.US)
        val fromExt = if (ext.isEmpty()) null else MimeTypeMap.getSingleton().getMimeTypeFromExtension(ext)
        val base = blobType.substringBefore(';').trim().lowercase(Locale.US)
        return fromExt ?: base.ifEmpty { "application/octet-stream" }
    }

    // 경로 구분자·제어 문자를 빼고 빈 이름·숨김 파일(.으로 시작)을 막는다. 한글 이름은 그대로 둔다.
    private fun safeFileName(raw: String): String {
        var name = raw.trim().replace(Regex("[\\\\/:*?\"<>|\\p{Cntrl}]"), "_").trimStart('.').trim()
        if (name.isEmpty()) name = "download"
        if (name.length > 120) name = name.takeLast(120)
        return name
    }

    private fun toast(text: String) {
        activity.runOnUiThread { Toast.makeText(activity, text, Toast.LENGTH_LONG).show() }
    }
}
