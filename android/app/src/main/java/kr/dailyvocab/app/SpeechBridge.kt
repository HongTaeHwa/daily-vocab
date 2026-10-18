package kr.dailyvocab.app

import android.Manifest
import android.app.Activity
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Bundle
import android.speech.RecognitionListener
import android.speech.RecognizerIntent
import android.speech.SpeechRecognizer
import android.speech.tts.TextToSpeech
import android.webkit.JavascriptInterface
import android.webkit.WebView
import androidx.core.content.ContextCompat
import org.json.JSONObject
import java.util.Locale

/**
 * 웹앱의 SpeechRecognition(음성 인식)·speechSynthesis(발음 듣기)를 안드로이드 기본 음성 인식기·TTS로 연결한다.
 * JS 쪽 어댑터는 assets/bridge.js 에 있다. 이벤트는 window.__androidSpeechEvent({type, text|code}) 로 보낸다.
 *   type: "start" | "result"(text) | "error"(code: Web Speech API 오류 문자열) | "end"
 */
class SpeechBridge(
    private val activity: Activity,
    private val webView: WebView,
    private val requestMic: () -> Unit,
) : RecognitionListener, TextToSpeech.OnInitListener {
    private var recognizer: SpeechRecognizer? = null
    private var pendingLang: String? = null
    private var tts: TextToSpeech? = TextToSpeech(activity, this)
    private var ttsReady = false
    private var pendingSpeech: Triple<String, String, Float>? = null

    @JavascriptInterface
    fun isAvailable(): Boolean = SpeechRecognizer.isRecognitionAvailable(activity)

    @JavascriptInterface
    fun start(lang: String) {
        activity.runOnUiThread {
            if (ContextCompat.checkSelfPermission(activity, Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
                pendingLang = lang
                requestMic()
            } else startInternal(lang)
        }
    }

    @JavascriptInterface
    fun stop() {
        activity.runOnUiThread { recognizer?.stopListening() }
    }

    @JavascriptInterface
    fun abort() {
        activity.runOnUiThread {
            recognizer?.cancel()
            emit("error", "aborted")
            emit("end")
        }
    }

    @JavascriptInterface
    fun speak(text: String, lang: String, rate: Float) {
        activity.runOnUiThread {
            val engine = tts ?: return@runOnUiThread
            if (!ttsReady) {
                pendingSpeech = Triple(text, lang, rate)
                return@runOnUiThread
            }
            engine.setLanguage(Locale.forLanguageTag(lang))
            engine.setSpeechRate(rate.coerceIn(0.5f, 2f))
            engine.speak(text, TextToSpeech.QUEUE_FLUSH, null, "daily-vocab")
        }
    }

    @JavascriptInterface
    fun stopSpeaking() {
        activity.runOnUiThread { tts?.stop() }
    }

    /** MainActivity 가 RECORD_AUDIO 권한 결과를 받으면 부른다. */
    fun onPermissionResult(granted: Boolean) {
        val lang = pendingLang ?: return
        pendingLang = null
        if (granted) startInternal(lang)
        else {
            emit("error", "not-allowed")
            emit("end")
        }
    }

    private fun startInternal(lang: String) {
        if (!SpeechRecognizer.isRecognitionAvailable(activity)) {
            emit("error", "service-not-allowed")
            emit("end")
            return
        }
        recognizer?.destroy()
        recognizer = SpeechRecognizer.createSpeechRecognizer(activity).also { it.setRecognitionListener(this) }
        val intent = Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH).apply {
            putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
            putExtra(RecognizerIntent.EXTRA_LANGUAGE, lang)
            putExtra(RecognizerIntent.EXTRA_LANGUAGE_PREFERENCE, lang)
            putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 1)
            putExtra(RecognizerIntent.EXTRA_CALLING_PACKAGE, activity.packageName)
        }
        recognizer?.startListening(intent)
    }

    private fun emit(type: String, value: String? = null) {
        val json = JSONObject().put("type", type)
        if (value != null) json.put(if (type == "result") "text" else "code", value)
        activity.runOnUiThread {
            webView.evaluateJavascript("window.__androidSpeechEvent && window.__androidSpeechEvent($json)", null)
        }
    }

    override fun onInit(status: Int) {
        ttsReady = status == TextToSpeech.SUCCESS
        pendingSpeech?.let { (text, lang, rate) ->
            pendingSpeech = null
            if (ttsReady) speak(text, lang, rate)
        }
    }

    override fun onReadyForSpeech(params: Bundle?) = emit("start")
    override fun onBeginningOfSpeech() {}
    override fun onRmsChanged(rmsdB: Float) {}
    override fun onBufferReceived(buffer: ByteArray?) {}
    override fun onEndOfSpeech() {}

    override fun onError(error: Int) {
        val code = when (error) {
            SpeechRecognizer.ERROR_INSUFFICIENT_PERMISSIONS -> "not-allowed"
            SpeechRecognizer.ERROR_AUDIO -> "audio-capture"
            SpeechRecognizer.ERROR_NETWORK, SpeechRecognizer.ERROR_NETWORK_TIMEOUT -> "network"
            SpeechRecognizer.ERROR_NO_MATCH, SpeechRecognizer.ERROR_SPEECH_TIMEOUT -> "no-speech"
            SpeechRecognizer.ERROR_LANGUAGE_NOT_SUPPORTED, SpeechRecognizer.ERROR_LANGUAGE_UNAVAILABLE -> "language-not-supported"
            else -> "aborted"
        }
        emit("error", code)
        emit("end")
    }

    override fun onResults(results: Bundle?) {
        val text = results?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)?.firstOrNull()?.trim().orEmpty()
        if (text.isNotEmpty()) emit("result", text)
        emit("end")
    }

    override fun onPartialResults(partialResults: Bundle?) {}
    override fun onEvent(eventType: Int, params: Bundle?) {}

    fun destroy() {
        recognizer?.destroy()
        recognizer = null
        tts?.stop()
        tts?.shutdown()
        tts = null
    }
}
