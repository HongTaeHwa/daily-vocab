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

// ---- 내려받기: <a download> + blob: 주소를 안드로이드 저장(DownloadBridge.kt, window.AndroidDownload)으로 ----
// 웹앱의 ‘전체 백업 JSON’(sets.js download)과 ‘CSV 내려받기’(quiz.js exportHistory)는 Blob → URL.createObjectURL → <a download> → click()
// 으로 파일을 만드는데, WebView 는 blob: 주소를 내려받지 못한다(DownloadListener 는 주소 문자열만 받고 내용은 렌더러 안에 있다).
// 그래서 Blob 을 붙들어 두었다가 click 을 가로채 base64 조각으로 안드로이드에 넘긴다. 웹앱 코드는 바꾸지 않는다.
(function () {
  if (!window.AndroidDownload || window.__dailyVocabDownloadBridge) return;
  window.__dailyVocabDownloadBridge = true;

  var CHUNK = 512 * 1024; // base64 글자 수. 4의 배수라 조각마다 따로 풀 수 있다.
  var blobs = new Map(); // blob: 주소 → Blob (revoke 될 때까지)
  var createObjectURL = URL.createObjectURL;
  var revokeObjectURL = URL.revokeObjectURL;
  URL.createObjectURL = function (obj) {
    var url = createObjectURL.call(URL, obj);
    if (obj instanceof Blob) blobs.set(url, obj);
    return url;
  };
  URL.revokeObjectURL = function (url) {
    blobs.delete(url);
    return revokeObjectURL.call(URL, url);
  };

  function send(blob, name) {
    var reader = new FileReader();
    reader.onload = function () {
      var dataUrl = String(reader.result || "");
      var at = dataUrl.indexOf(";base64,");
      var base64 = at >= 0 ? dataUrl.slice(at + 8) : "";
      var token = window.AndroidDownload.begin(String(name || ""), String(blob.type || ""), base64.length);
      if (!(token > 0)) return;
      for (var i = 0; i < base64.length; i += CHUNK) {
        if (!window.AndroidDownload.append(token, base64.slice(i, i + CHUNK))) {
          window.AndroidDownload.abort(token);
          return;
        }
      }
      window.AndroidDownload.finish(token);
    };
    reader.onerror = function () { window.AndroidDownload.abort(0); };
    reader.readAsDataURL(blob);
  }
  function fetchAndSend(url, name) {
    fetch(url)
      .then(function (response) { return response.blob(); })
      .then(function (blob) { send(blob, name); })
      .catch(function () { window.AndroidDownload.abort(0); });
  }

  // download 속성이 있고 blob:/data: 주소면 여기서 저장한다(true). 그 밖(http(s) 등)은 원래대로 둔다.
  function handle(anchor) {
    if (!anchor || !anchor.hasAttribute("download")) return false;
    var href = String(anchor.href || "");
    if (href.indexOf("blob:") !== 0 && href.indexOf("data:") !== 0) return false;
    var name = (anchor.getAttribute("download") || "").trim() || "download";
    var blob = blobs.get(href);
    if (blob) send(blob, name);
    else fetchAndSend(href, name);
    return true;
  }

  var click = HTMLElement.prototype.click;
  HTMLAnchorElement.prototype.click = function () {
    if (handle(this)) return;
    return click.apply(this, arguments);
  };
  document.addEventListener("click", function (event) {
    if (event.defaultPrevented) return;
    var target = event.target;
    var anchor = target && target.closest ? target.closest("a[download]") : null;
    if (anchor && handle(anchor)) event.preventDefault();
  }, true);

  // MainActivity 의 DownloadListener 가 blob:/data: 주소를 받았을 때(어댑터를 거치지 않은 경로) 같은 길로 저장한다.
  window.__dailyVocabDownload = function (url, name) {
    fetchAndSend(String(url || ""), String(name || "download"));
  };
})();
