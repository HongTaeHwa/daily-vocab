// 매일 영단어 갤럭시용 앱: 페이지 스크립트보다 먼저 실행되어(WebViewCompat.addDocumentStartJavaScript)
// WebView에 없는 Web Speech API를 안드로이드 브리지(window.AndroidSpeech, SpeechBridge.kt)로 채운다.
// quiz.js 는 window.SpeechRecognition / speechSynthesis 만 쓰므로 웹앱 코드는 바꾸지 않아도 된다.
(function () {
  if (!window.AndroidSpeech || window.__dailyVocabBridge) return;
  window.__dailyVocabBridge = true;

  // ---- 음성 인식: SpeechRecognition 의 부분 집합(lang, start/stop/abort, onstart/onresult/onerror/onend) ----
  function AndroidSpeechRecognition() {
    this.lang = "en-US";
    this.continuous = false;
    this.interimResults = false;
    this.maxAlternatives = 1;
    this.onstart = this.onresult = this.onerror = this.onend = null;
  }
  AndroidSpeechRecognition.active = null;
  AndroidSpeechRecognition.prototype.start = function () {
    if (AndroidSpeechRecognition.active) throw new DOMException("recognition already started", "InvalidStateError");
    AndroidSpeechRecognition.active = this;
    window.AndroidSpeech.start(String(this.lang || "en-US"));
  };
  AndroidSpeechRecognition.prototype.stop = function () {
    if (AndroidSpeechRecognition.active === this) window.AndroidSpeech.stop();
  };
  AndroidSpeechRecognition.prototype.abort = function () {
    if (AndroidSpeechRecognition.active === this) window.AndroidSpeech.abort();
  };
  window.__androidSpeechEvent = function (e) {
    var rec = AndroidSpeechRecognition.active;
    if (!rec || !e) return;
    if (e.type === "start") {
      if (rec.onstart) rec.onstart({ type: "start" });
    } else if (e.type === "result") {
      var alternative = { transcript: String(e.text || ""), confidence: 1 };
      var result = [alternative];
      result.isFinal = true;
      result.item = function (i) { return this[i]; };
      var results = [result];
      results.item = function (i) { return this[i]; };
      if (rec.onresult) rec.onresult({ type: "result", resultIndex: 0, results: results });
    } else if (e.type === "error") {
      if (rec.onerror) rec.onerror({ type: "error", error: String(e.code || "aborted"), message: "" });
    } else if (e.type === "end") {
      AndroidSpeechRecognition.active = null;
      if (rec.onend) rec.onend({ type: "end" });
    }
  };
  try {
    Object.defineProperty(window, "SpeechRecognition", { value: AndroidSpeechRecognition, configurable: true, writable: true });
    Object.defineProperty(window, "webkitSpeechRecognition", { value: AndroidSpeechRecognition, configurable: true, writable: true });
  } catch (err) {
    window.SpeechRecognition = AndroidSpeechRecognition;
    window.webkitSpeechRecognition = AndroidSpeechRecognition;
  }

  // ---- 발음 듣기: speechSynthesis 를 안드로이드 TTS로 ----
  function AndroidUtterance(text) {
    this.text = text == null ? "" : String(text);
    this.lang = "en-US";
    this.rate = 1;
    this.pitch = 1;
    this.volume = 1;
    this.voice = null;
    this.onend = this.onerror = this.onstart = null;
  }
  var synth = {
    pending: false,
    speaking: false,
    paused: false,
    speak: function (u) {
      if (!u) return;
      window.AndroidSpeech.speak(String(u.text || ""), String(u.lang || "en-US"), Number(u.rate) || 1);
    },
    cancel: function () { window.AndroidSpeech.stopSpeaking(); },
    pause: function () {},
    resume: function () {},
    getVoices: function () { return []; },
    addEventListener: function () {},
    removeEventListener: function () {},
    onvoiceschanged: null,
  };
  try {
    Object.defineProperty(window, "SpeechSynthesisUtterance", { value: AndroidUtterance, configurable: true, writable: true });
    Object.defineProperty(window, "speechSynthesis", { value: synth, configurable: true, writable: true });
  } catch (err) {
    window.SpeechSynthesisUtterance = AndroidUtterance;
    window.speechSynthesis = synth;
  }
})();
