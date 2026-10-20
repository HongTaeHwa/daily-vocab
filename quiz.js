"use strict";
// quiz.js — 데이터 로드/이전, 화면(뷰) 전환, 시험 진행(쉬기·이어서·그만하기), 결과, 기록, 음성 인식.
// 세트 편집기는 editor.js, 세트 저장·사진 인식 요청·백업·보호자 설정은 sets.js 에 있다. 저장 키는 바꾸지 않는다(사용자 기록 호환).
const { $, setFeedback, modeLabels } = Shared; // shared.js
const SPEECH = window.SpeechRecognition || window.webkitSpeechRecognition;
const setsKey = "daily_vocab_sets_v2";
const historyKey = "daily_vocab_history_v2";
const SESSION_KEY = "daily_vocab_session_v1";
const PREFS_KEY = "daily_vocab_prefs_v1";
// 기본 예제 세트 (DAY04, 121~160)
let WORDS = [
 [121,'authority','권위 · 권한 · 당국','/əˈθɔːrəti/','어쏘러티','권위|권한|당국|권력|권위자|대가'],
 [122,'devote','바치다 · 헌신하다 · 기울이다','/dɪˈvoʊt/','디보우트','바치다|바치|헌신하다|헌신|기울이다|기울이'],
 [123,'indicate','나타내다 · 가리키다 · 보여주다','/ˈɪndɪkeɪt/','인디케이트','나타내다|나타내|가리키다|가리키|보여주다|보여주|표시하다|암시하다'],
 [124,'function','기능 · 역할 · 작용하다','/ˈfʌŋkʃən/','펑크션','기능|역할|작용하다|작용|기능하다'],
 [125,'interrupt','방해하다 · 중단시키다','/ˌɪntəˈrʌpt/','인터럽트','방해하다|방해|중단시키다|중단|끼어들다|가로막다'],
 [126,'strike','치다 · 부딪치다 · 파업 · 타격','/straɪk/','스트라이크','치다|때리다|부딪치다|파업|타격|공격|떠오르다'],
 [127,'evident','명백한 · 분명한','/ˈevɪdənt/','에비던트','명백한|명백하다|명백|분명한|분명하다|분명|뚜렷한'],
 [128,'output','생산량 · 산출량','/ˈaʊtpʊt/','아웃풋','생산량|생산|산출량|산출|생산물|출력|결과물'],
 [129,'violate','위반하다 · 어기다 · 침해하다','/ˈvaɪəleɪt/','바이얼레이트','위반하다|위반|어기다|어기|침해하다|침해|범하다'],
 [130,'declare','선언하다 · 발표하다 · 신고하다','/dɪˈkler/','디클레어','선언하다|선언|발표하다|발표|신고하다|신고|공표하다'],
 [131,'instant','즉각적인 · 즉시 · 찰나','/ˈɪnstənt/','인스턴트','즉각적인|즉각|즉시|찰나|순간|즉석의|인스턴트'],
 [132,'struggle','분투하다 · 버둥거리다 · 투쟁','/ˈstrʌɡəl/','스트러글','분투하다|분투|버둥거리다|버둥|투쟁|싸우다|고군분투하다'],
 [133,'induce','유도하다 · 설득하다 · 유발하다','/ɪnˈduːs/','인듀스','유도하다|유도|설득하다|설득|유발하다|유발|일으키다'],
 [134,'reveal','드러내다 · 누설하다 · 밝히다','/rɪˈviːl/','리빌','드러내다|드러내|누설하다|누설|밝히다|밝히|폭로하다|공개하다'],
 [135,'conceal','숨기다 · 감추다','/kənˈsiːl/','컨실','숨기다|숨기|감추다|감추|은폐하다|은폐'],
 [136,'dedicate','바치다 · 헌신하다','/ˈdedɪkeɪt/','데디케이트','바치다|바치|헌신하다|헌신|전념하다|전념'],
 [137,'addiction','중독','/əˈdɪkʃən/','어딕션','중독|중독증|의존증'],
 [138,'scarce','부족한 · 드문','/skers/','스케어스','부족한|부족하다|부족|드문|드물다|희귀한|희소한'],
 [139,'disturb','방해하다 · 어지럽히다','/dɪˈstɜːrb/','디스터브','방해하다|방해|어지럽히다|어지럽히|괴롭히다|귀찮게하다'],
 [140,'donation','기부 · 기증','/doʊˈneɪʃən/','도네이션','기부|기증|기부금|기증품'],
 [141,'disappear','사라지다','/ˌdɪsəˈpɪr/','디스어피어','사라지다|사라지|없어지다|없어지|자취를감추다'],
 [142,'vivid','생생한 · 선명한','/ˈvɪvɪd/','비비드','생생한|생생하다|생생|선명한|선명하다|선명|뚜렷한'],
 [143,'regard','여기다 · 간주하다 · 관심 · 존경 · 안부','/rɪˈɡɑːrd/','리가드','여기다|여기|간주하다|간주|관심|고려|존경|안부|인사'],
 [144,'disrupt','방해하다 · 지장을 주다','/dɪsˈrʌpt/','디스럽트','방해하다|방해|지장을주다|지장|혼란시키다|중단시키다|차질을빚게하다'],
 [145,'retire','은퇴하다 · 퇴직하다','/rɪˈtaɪər/','리타이어','은퇴하다|은퇴|퇴직하다|퇴직|물러나다'],
 [146,'enhance','높이다 · 강화하다 · 향상시키다','/ɪnˈhæns/','인핸스','높이다|높이|강화하다|강화|향상시키다|향상|개선하다'],
 [147,'adequate','적절한 · 충분한','/ˈædɪkwət/','애디쿼트','적절한|적절하다|적절|충분한|충분하다|충분|알맞은|적당한'],
 [148,'estimate','추정하다 · 평가하다 · 추정 · 견적서','/ˈestɪmeɪt/ (동사) · /ˈestɪmət/ (명사)','에스터메이트/에스터멋','추정하다|추정|평가하다|평가|견적|견적서|어림잡다|예측하다'],
 [149,'arrange','정리하다 · 준비하다 · 편곡하다','/əˈreɪndʒ/','어레인지','정리하다|정리|정돈하다|준비하다|준비|편곡하다|편곡|배열하다|배열|주선하다'],
 [150,'restrain','제지하다 · 억누르다 · 억제하다','/rɪˈstreɪn/','리스트레인','제지하다|제지|억누르다|억누르|억제하다|억제|자제하다|자제'],
 [151,'remarkable','주목할 만한 · 뛰어난','/rɪˈmɑːrkəbəl/','리마커블','주목할만한|주목할|뛰어난|뛰어나다|놀라운|훌륭한|특별한'],
 [152,'symptom','증상 · 징후','/ˈsɪmptəm/','심프텀','증상|징후|증세'],
 [153,'victim','피해자 · 희생자','/ˈvɪktɪm/','빅팀','피해자|희생자|피해입은사람'],
 [154,'empathy','공감 · 감정 이입','/ˈempəθi/','엠퍼씨','공감|감정이입|공감능력'],
 [155,'disaster','재해 · 재난','/dɪˈzæstər/','디재스터','재해|재난|참사|큰불행|대참사'],
 [156,'guardian','후견인 · 보호자 · 수호자','/ˈɡɑːrdiən/','가디언','후견인|보호자|수호자|법정보호자'],
 [157,'grab','붙잡다 · 낚아채다 · 잡아채기','/ɡræb/','그래브','붙잡다|붙잡|낚아채다|낚아채|잡아채다|잡아채|움켜잡다'],
 [158,'mindset','사고방식','/ˈmaɪndset/','마인드셋','사고방식|마음가짐|정신자세|생각하는방식'],
 [159,'indeed','사실은 · 정말 · 참으로','/ɪnˈdiːd/','인디드','사실은|사실|정말|참으로|실제로|진정으로'],
 [160,'hinder','방해하다 · 막다','/ˈhɪndər/','힌더','방해하다|방해|막다|막|저해하다|저해|가로막다|지장을주다']
].map(([id,en,ko,ipa,hangul,aliases])=>({id,en,ko,ipa,hangul,aliases:aliases.split('|')}));
const defaultWords = structuredClone(WORDS);
let sets = [{ id: "day04", name: "기본 예제 DAY04", words: defaultWords }];
let activeSetId = "day04";
let storageAvailable = true;
let cacheKey = "daily_vocab_missed_day04";
let lastMissed = [];
let mode = "read_meaning", queue = [], position = 0, results = [], question = {}, recognition = null, permissionPending = false;
let sessionMeta = null, historyRecords = [], sessionRunning = false;
let prefs = { mode: "read_meaning", range: "all", shuffle: true, setId: null, combo: { setIds: null, count: 20, pick: "random" } }; // combo.setIds null = 전체 세트

// ---- 저장 자료 읽기·이전 (검증 실패 시 덮어쓰지 않는다) ----
try {
  const raw = localStorage.getItem(setsKey);
  if (raw) {
    const parsed = JSON.parse(raw);
    // 세트가 하나도 없는 빈 배열도 정상이다(가족 기록함에 연결된 기기는 보호자가 보낸 세트만 쓴다).
    if (
      !Array.isArray(parsed) ||
      !parsed.every((s) => s && typeof s.id === "string" && typeof s.name === "string" && Array.isArray(s.words) && s.words.length &&
        s.words.every((w) => w && typeof w.en === "string" && typeof w.ko === "string" && Array.isArray(w.aliases)))
    )
      throw Error("세트 데이터 오류");
    sets = parsed;
  }
  if (!localStorage.getItem(historyKey)) {
    const old = localStorage.getItem("day04_wordtest_history_v1"), missed = localStorage.getItem("day04_wordtest_missed_v2");
    if (old || missed) {
      localStorage.setItem("daily_vocab_legacy_backup_v1", JSON.stringify({ history: old, missed }));
      const records = JSON.parse(old || "[]");
      if (!Array.isArray(records)) throw Error("이력 데이터 오류");
      const converted = records.map((r) => ({
        ...r, setId: "day04", setName: "기본 예제 DAY04",
        results: r.results.map((x) => {
          const word = defaultWords.find((w) => w.id === x.id);
          if (!word) throw Error("이력 단어 오류");
          return { ...x, word: structuredClone(word) };
        }),
      }));
      localStorage.setItem(historyKey, JSON.stringify(converted));
      localStorage.setItem("daily_vocab_missed_day04", missed || "[]");
    }
  }
} catch (e) {
  storageAvailable = false;
  $("setStatus").textContent = "저장 자료를 읽거나 이전하지 못했습니다. 기존 자료는 보존됩니다. JSON 백업 후 브라우저 저장 공간을 확인하세요.";
}
try {
  const saved = JSON.parse(localStorage.getItem(PREFS_KEY) || "null");
  if (saved && typeof saved === "object") prefs = { ...prefs, ...saved };
} catch {}
if (!modeLabels[prefs.mode]) prefs.mode = "read_meaning";
mode = prefs.mode;
// 세트가 없으면 activeSetId = null, WORDS = [] 이고 홈은 ‘아직 세트가 없어요’를 보여 준다.
activeSetId = sets.some((s) => s.id === prefs.setId) ? prefs.setId : sets[0]?.id ?? null;
WORDS = sets.find((s) => s.id === activeSetId)?.words || [];
cacheKey = "daily_vocab_missed_" + activeSetId;
function savePrefs(patch) {
  prefs = { ...prefs, ...patch };
  try { localStorage.setItem(PREFS_KEY, JSON.stringify(prefs)); } catch {}
}
function loadMissed() {
  try {
    const old = JSON.parse(localStorage.getItem(cacheKey) || "[]");
    lastMissed = Array.isArray(old) ? old.filter((n) => WORDS.some((w) => w.id === n)) : [];
  } catch { lastMissed = []; }
}
loadMissed();

// ---- 화면(뷰) 전환 ----
const VIEWS = ["home", "quiz", "finish", "editor", "lookup", "history", "settings"];
let currentView = "home";
function showView(name, options = {}) {
  if (!VIEWS.includes(name)) name = "home";
  if (sessionRunning && name !== "quiz") {
    pauseQuiz();
    return;
  }
  if (name !== currentView) $("setStatus").textContent = "";
  currentView = name;
  if (!options.fromHistory) {
    try {
      if (history.state?.view) history.pushState({ view: name }, "");
      else history.replaceState({ view: name }, "");
    } catch {}
  }
  for (const v of VIEWS) $(v).classList.toggle("active", v === name);
  document.body.classList.toggle("in-quiz", name === "quiz");
  for (const [tab, view] of [["tabHome", "home"], ["tabLookup", "lookup"], ["tabHistory", "history"], ["tabSettings", "settings"]]) {
    const active = view === name || (view === "home" && (name === "finish" || name === "editor"));
    $(tab).classList.toggle("active", active);
    $(tab).setAttribute("aria-current", active ? "page" : "false");
  }
  if (name === "history") renderHistory();
  if (name === "home") renderHome();
  if (name === "lookup" && typeof renderLookup === "function") renderLookup(); // sets.js (단어 찾기)
  window.scrollTo({ top: 0, behavior: "auto" });
  try { $(name).focus({ preventScroll: true }); } catch {}
}
// Android 뒤로 가기: 앱을 닫지 않고 화면만 되돌린다. 시험 중이면 쉬기로 처리한다.
// 끝난(또는 쉬는) 시험 화면과 닫힌 편집기로는 돌아가지 않고 홈으로 간다(시험 화면은 하단 탭이 없고 버튼이 동작하지 않아 갇힌 것처럼 보였다).
window.addEventListener("popstate", (e) => {
  if (sessionRunning) { pauseQuiz(); return; }
  let view = e.state?.view || "home";
  if (view === "quiz" || (view === "editor" && !window.editorOpen)) view = "home";
  showView(view, { fromHistory: true });
});
$("tabHome").addEventListener("click", () => showView("home"));
$("tabLookup").addEventListener("click", () => showView("lookup"));
$("tabHistory").addEventListener("click", () => showView("history"));
$("tabSettings").addEventListener("click", () => showView("settings"));
$("openSettings").addEventListener("click", () => showView("settings"));
$("seeHistory").addEventListener("click", () => {
  $("historyFilter").value = "all"; // 홈 ‘최근 결과’의 전체 보기: 모든 세트·오늘의 단어·종합 시험
  showView("history");
});

// ---- 세트·범위 ----
function wordNumberLabel(words) {
  const ids = words.map((w) => Number(w.id));
  if (!ids.length || !ids.every(Number.isInteger)) return "";
  const lo = Math.min(...ids), hi = Math.max(...ids);
  return lo === hi ? lo + "번" : lo + "~" + hi + "번";
}
function populateSets() {
  const empty = !sets.length;
  $("noSets").classList.toggle("hidden", !empty);
  $("setPicker").classList.toggle("hidden", empty);
  $("editSet").classList.toggle("hidden", empty);
  const select = $("setSelect");
  select.textContent = "";
  for (const set of sets) {
    const o = document.createElement("option");
    o.value = set.id;
    o.textContent = set.name + " · " + set.words.length + "단어";
    select.append(o);
  }
  select.value = activeSetId ?? "";
  renderHistoryFilter();
  const range = $("range");
  const previous = range.value;
  range.textContent = "";
  for (let i = -1; i < WORDS.length; i = i < 0 ? 0 : i + 10) {
    const o = document.createElement("option");
    o.value = i < 0 ? "all" : String(i);
    if (i < 0) o.textContent = "전체 " + WORDS.length + "단어";
    else {
      const chunk = WORDS.slice(i, i + 10);
      const numbers = wordNumberLabel(chunk);
      o.textContent = (numbers ? numbers + " " : i + 1 + "~" + Math.min(i + 10, WORDS.length) + "번째 ") + "(" + chunk.length + "단어)";
    }
    range.append(o);
  }
  const wanted = previous || prefs.range;
  range.value = [...range.options].some((o) => o.value === wanted) ? wanted : "all";
  refreshReview();
  renderSetSummary();
  renderCombo();
}
function selectSet(id) {
  if (!sets.some((s) => s.id === id)) id = sets[0]?.id ?? null;
  activeSetId = id;
  WORDS = sets.find((s) => s.id === id)?.words || [];
  cacheKey = "daily_vocab_missed_" + id;
  loadMissed();
  savePrefs({ setId: id });
  populateSets();
  renderHistory();
  renderHome();
}
$("setSelect").addEventListener("change", () => selectSet($("setSelect").value));
// 요약 기록: 서버에서 복원한 기록(restored, family.js)과 오래되어 줄인 기록(compacted, 아래 compactHistory). 단어별 결과가 없어 점수는 total/correct 필드를 쓴다(results 에는 틀린 단어만 있다).
function isSummaryRecord(record) {
  return record.restored === true || record.compacted === true;
}
function recordScore(record) {
  const summary = isSummaryRecord(record);
  const total = summary ? record.total : record.results.length;
  const correct = summary ? record.correct : record.results.filter((x) => x.pass).length;
  return { correct, total, pct: total ? Math.round((correct / total) * 100) : 0 };
}
// 요약 기록은 틀린 단어를 200개까지만 두고, 기록이 아주 많으면 가장 오래된 것부터 목록을 비운다. 그런 기록은 모름 개수·오답 번호를 다 알 수 없다.
function missedComplete(record) {
  const { correct, total } = recordScore(record);
  return record.results.filter((x) => !x.pass).length >= total - correct;
}
function renderSetSummary() {
  const mine = historyRecords.filter((r) => r.setId === activeSetId);
  const el = $("setSummary");
  if (!mine.length) { el.textContent = "아직 이 세트로 본 시험이 없어요. 아래에서 시작해 보세요!"; return; }
  const last = recordScore(mine[0]);
  el.textContent = `최근 ${last.pct}점 (${last.correct}/${last.total}${mine[0].partial ? " · 중단" : ""}) · 시험 ${mine.length}회 · 틀린 단어 ${lastMissed.length}개`;
}
function refreshReview() {
  $("start").disabled = sessionRunning || !WORDS.length; // 세트가 없으면 시작할 수 없다
  $("review").disabled = sessionRunning || lastMissed.length === 0;
  $("reviewCount").textContent = lastMissed.length ? `틀린 단어 ${lastMissed.length}개` : "틀린 단어 없음";
}
function shuffleArray(arr) {
  for (let i = arr.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [arr[i], arr[j]] = [arr[j], arr[i]]; }
  return arr;
}
function changeMode(m) {
  if (sessionRunning || !modeLabels[m]) return;
  stopRec();
  mode = m;
  savePrefs({ mode: m });
  document.querySelectorAll(".mode").forEach((b) => {
    const active = b.dataset.mode === m;
    b.classList.toggle("active", active);
    b.setAttribute("aria-pressed", String(active));
  });
}
document.querySelectorAll(".mode").forEach((b) => b.addEventListener("click", () => changeMode(b.dataset.mode)));
$("range").addEventListener("change", () => savePrefs({ range: $("range").value }));
$("shuffle").addEventListener("change", () => savePrefs({ shuffle: $("shuffle").checked }));

// ---- 종합 시험: 여러 세트를 묶어 한 번에 ----
// 홈의 #comboCard(세트 2개 이상일 때만). 단어마다 출처 세트를 _setId 로 붙여 뽑고(번호가 세트끼리 겹칠 수 있다), 기록은 setId "combo",
// 틀린 단어는 finishRecords 가 출처 세트별 오답 목록에 반영한다. 마지막 설정은 prefs.combo 에 남는다.
const COMBO_SET_ID = "combo";
const COMBO_COUNTS = [10, 20, 30, 50, 0]; // 0 = 전부
const COMBO_PICK_LABELS = { random: "무작위", missed: "틀린 단어 먼저", even: "세트별 골고루" };
function missedIdsOf(setId) {
  try {
    const v = JSON.parse(localStorage.getItem("daily_vocab_missed_" + setId) || "[]");
    return Array.isArray(v) ? v : [];
  } catch { return []; }
}
function comboSelectedIds() {
  return [...document.querySelectorAll("#comboSets input:checked")].map((i) => i.value).filter((id) => sets.some((s) => s.id === id));
}
function updateComboSummary() {
  const ids = comboSelectedIds();
  const total = sets.filter((s) => ids.includes(s.id)).reduce((n, s) => n + s.words.length, 0);
  $("comboSummary").textContent = ids.length ? `세트 ${ids.length}개 · ${total}단어` : "세트를 골라 주세요";
  $("comboStart").disabled = sessionRunning || !ids.length;
}
// 세트 목록이 바뀔 때(populateSets) 체크박스를 다시 그린다. 저장된 선택(prefs.combo.setIds, null = 전부)을 복원한다.
function renderCombo() {
  $("comboCard").classList.toggle("hidden", sets.length < 2);
  const saved = prefs.combo && typeof prefs.combo === "object" ? prefs.combo : {};
  const chosen = Array.isArray(saved.setIds) ? saved.setIds : null;
  const box = $("comboSets");
  box.textContent = "";
  for (const s of sets) {
    const label = document.createElement("label");
    const input = document.createElement("input");
    input.type = "checkbox";
    input.value = s.id;
    input.checked = chosen ? chosen.includes(s.id) : true;
    input.disabled = sessionRunning;
    input.addEventListener("change", updateComboSummary);
    const name = document.createElement("span");
    name.textContent = s.name;
    const small = document.createElement("small");
    small.textContent = `${s.words.length}단어`;
    label.append(input, name, small);
    box.append(label);
  }
  const count = $("comboCount");
  if (!count.options.length) for (const n of COMBO_COUNTS) { const o = document.createElement("option"); o.value = String(n); o.textContent = n ? `${n}문제` : "전부"; count.append(o); }
  count.value = String(COMBO_COUNTS.includes(saved.count) ? saved.count : 20);
  $("comboPick").value = COMBO_PICK_LABELS[saved.pick] ? saved.pick : "random";
  updateComboSummary();
}
// 뽑기: 무작위 / 틀린 단어 먼저(각 세트의 오답 목록에 있는 단어부터, 모자라면 나머지) / 세트별 골고루(세트를 번갈아 가며).
function buildComboPool(setIds, count, pick) {
  const tagged = sets.filter((s) => setIds.includes(s.id)).map((s) => ({ set: s, words: s.words.map((w) => ({ ...w, _setId: s.id })) }));
  const all = tagged.flatMap((t) => t.words);
  const limit = count > 0 ? Math.min(count, all.length) : all.length;
  if (pick === "missed") {
    const first = tagged.flatMap((t) => { const m = missedIdsOf(t.set.id); return t.words.filter((w) => m.includes(w.id)); });
    const rest = all.filter((w) => !first.includes(w));
    return [...shuffleArray(first.slice()), ...shuffleArray(rest.slice())].slice(0, limit);
  }
  if (pick === "even") {
    const queues = tagged.map((t) => shuffleArray(t.words.slice())).filter((q) => q.length);
    const out = [];
    for (let i = 0; out.length < limit && queues.some((q) => q.length); i++) {
      const q = queues[i % queues.length];
      if (q.length) out.push(q.shift());
    }
    return out;
  }
  return shuffleArray(all.slice()).slice(0, limit);
}
function startCombo(settings) {
  if (sessionRunning) return false;
  const setIds = (settings.setIds || sets.map((s) => s.id)).filter((id) => sets.some((s) => s.id === id));
  if (!setIds.length) { $("comboStatus").textContent = "세트를 하나 이상 골라 주세요."; return false; }
  const pick = COMBO_PICK_LABELS[settings.pick] ? settings.pick : "random";
  const pool = buildComboPool(setIds, settings.count, pick);
  if (!pool.length) { $("comboStatus").textContent = "고른 세트에 단어가 없어요."; return false; }
  $("comboStatus").textContent = "";
  return newSession(false, pool, { setId: COMBO_SET_ID, setName: `종합 시험 (세트 ${setIds.length}개)` }, {
    rangeLabel: `세트 ${setIds.length}개 · ${pool.length}문제 · ${COMBO_PICK_LABELS[pick]}`,
    shuffle: false, // 뽑은 순서(틀린 단어 먼저·골고루)를 지킨다. 무작위는 이미 섞여 있다.
    combo: { setIds, count: settings.count, pick },
  });
}
$("comboStart").addEventListener("click", () => {
  const ids = comboSelectedIds();
  const count = Number($("comboCount").value);
  const pick = $("comboPick").value;
  savePrefs({ combo: { setIds: ids.length === sets.length ? null : ids, count, pick } }); // 전부 골랐으면 null: 나중에 생긴 세트도 포함
  startCombo({ setIds: ids, count, pick });
});

// ---- 홈 ----
function renderHome() {
  renderResumeCard();
  if (typeof renderDailyCard === "function") renderDailyCard(); // family.js: 오늘의 단어 카드
  renderSetSummary();
  $("resumeEditor").classList.toggle("hidden", !window.editorOpen || currentView === "editor");
  // 최근 결과는 세트와 상관없이 최근 3개(오늘의 단어·종합 시험 포함). 지금 세트의 요약은 위 #setSummary 에 있다.
  const recent = historyRecords.slice(0, 3);
  const list = $("recentResults");
  list.textContent = "";
  if (!recent.length) { list.textContent = "최근 결과가 여기에 표시됩니다."; return; }
  for (const r of recent) {
    const s = recordScore(r);
    const row = document.createElement("div");
    row.className = "recent-row";
    const score = document.createElement("strong");
    score.textContent = s.pct + "점";
    const meta = document.createElement("span");
    meta.textContent = `${r.setName} · ${s.correct}/${s.total} · ${modeLabels[r.mode]} · ${new Date(r.completedAt).toLocaleDateString("ko-KR")}${r.partial ? " · 중단" : ""}`;
    row.append(score, meta);
    list.append(row);
  }
}

// ---- 진행 중 시험 저장(쉬기·이어서) ----
function sessionSnapshot() {
  return { meta: sessionMeta, mode, queue, position, results, pausedAt: new Date().toISOString() };
}
function saveSessionState() {
  if (!sessionRunning || !sessionMeta) return false;
  try {
    localStorage.setItem(SESSION_KEY, JSON.stringify(sessionSnapshot()));
    return true;
  } catch {
    return false;
  }
}
function clearSessionState() {
  try { localStorage.removeItem(SESSION_KEY); } catch {}
}
function loadSessionState() {
  try {
    const s = JSON.parse(localStorage.getItem(SESSION_KEY) || "null");
    if (
      s && s.meta && typeof s.meta.id === "string" && modeLabels[s.mode] && Array.isArray(s.queue) && s.queue.length &&
      s.queue.every((w) => w && typeof w.en === "string" && typeof w.ko === "string" && Array.isArray(w.aliases)) &&
      Number.isInteger(s.position) && s.position >= 0 && s.position < s.queue.length && Array.isArray(s.results)
    )
      return s;
  } catch {}
  return null;
}
function renderResumeCard() {
  const saved = loadSessionState();
  const card = $("resumeCard");
  card.classList.toggle("hidden", !saved || sessionRunning);
  if (!saved) return;
  $("resumeText").textContent = `${saved.meta.setName} · ${modeLabels[saved.mode]} · ${saved.position}/${saved.queue.length}문제 풀었어요`;
}
function resumeSession() {
  const saved = loadSessionState();
  if (!saved || sessionRunning) return;
  stopRec();
  sessionMeta = saved.meta;
  mode = saved.mode;
  changeMode(mode);
  queue = saved.queue;
  position = saved.position;
  results = saved.results;
  sessionMeta.resumedAt = Date.now();
  sessionRunning = true;
  setSettingsLocked(true);
  showView("quiz");
  displayQuestion();
}
function discardSession() {
  const saved = loadSessionState();
  if (!saved) return;
  if (!confirm(saved.results.length ? `쉬고 있던 시험을 그만둘까요? 푼 ${saved.results.length}문제는 ‘중단’ 기록으로 남아요.` : "쉬고 있던 시험을 지울까요?")) return;
  abandonSavedSession();
  renderHome();
}
function accumulateActive() {
  if (!sessionMeta) return;
  if (sessionMeta.resumedAt) sessionMeta.activeMs = (sessionMeta.activeMs || 0) + Math.max(0, Date.now() - sessionMeta.resumedAt);
  sessionMeta.resumedAt = null;
}
function pauseQuiz() {
  if (!sessionRunning) return;
  stopQuestionTimer();
  stopRec();
  // 채점까지 끝난 문제는 쉬기 전에 결과로 넣어 두어 이어서 할 때 다시 풀 수 없게 한다.
  if (question.w && question.answerChecked && (mode !== "read_meaning" || question.readChecked)) {
    recordCurrentResult();
    position++;
    if (position >= queue.length) { complete(); return; }
  }
  accumulateActive();
  if (!saveSessionState()) {
    sessionMeta.resumedAt = Date.now();
    displayQuestion();
    alert("쉬기 저장에 실패했어요. 브라우저 저장 공간을 확인하거나, 시험을 끝까지 푼 뒤 쉬어 주세요.");
    return;
  }
  sessionRunning = false;
  setSettingsLocked(false);
  showView("home");
  $("setStatus").textContent = "쉬는 중이에요. 위의 ‘이어서 하기’로 다시 시작할 수 있어요.";
  notifyQuizEnded();
}
// 쉬어 둔 시험을 버릴 때도 푼 문제가 있으면 ‘중단’ 기록으로 남긴다(그만하기와 같은 규칙).
function abandonSavedSession() {
  const saved = loadSessionState();
  if (!saved) return;
  if (saved.results.length) {
    sessionMeta = saved.meta; // 기록의 방식은 sessionMeta.mode 를 쓴다. 전역 mode 는 바꾸지 않는다(새로 시작할 시험이 쉬던 시험의 방식으로 바뀌지 않게)
    queue = saved.queue;
    results = saved.results;
    sessionMeta.saved = false;
    finishRecords(true);
  }
  clearSessionState();
}
function stopQuiz() {
  if (!sessionRunning) { stopQuestionTimer(); return; }
  const graded = Boolean(question.w && question.answerChecked && (mode !== "read_meaning" || question.readChecked));
  const answered = results.length + (graded ? 1 : 0);
  if (!confirm(answered ? `시험을 그만할까요? 지금까지 푼 ${answered}문제는 ‘중단’ 기록으로 남아요.` : "시험을 그만할까요?")) return; // 취소하면 제한 시간은 그대로 흐른다
  stopQuestionTimer();
  stopRec();
  if (graded) recordCurrentResult();
  accumulateActive();
  sessionRunning = false;
  setSettingsLocked(false);
  clearSessionState();
  if (answered) {
    const missed = finishRecords(true);
    showResult(missed, true);
  } else showView("home");
  notifyQuizEnded();
}
$("resumeQuiz").addEventListener("click", resumeSession);
$("discardSession").addEventListener("click", discardSession);
$("pauseQuiz").addEventListener("click", pauseQuiz);
$("backSettings").addEventListener("click", stopQuiz);

// ---- 시험 ----
function newSession(missedOnly = false, snapshot = null, source = null, options = {}) {
  if (sessionRunning) return false;
  if (loadSessionState()) {
    if (!confirm("쉬고 있던 시험이 있어요. 그만두고 새로 시작할까요? 이어서 하려면 ‘취소’를 누른 뒤 ‘이어서 하기’를 누르세요.")) return false;
    abandonSavedSession();
  }
  stopRec();
  const startNum = options.rangeValue ?? $("range").value;
  let pool = snapshot || (missedOnly ? WORDS.filter((w) => lastMissed.includes(w.id)) : startNum === "all" ? WORDS : WORDS.slice(Number(startNum), Number(startNum) + 10));
  if (!pool.length) return false;
  const shuffle = options.shuffle ?? $("shuffle").checked;
  queue = shuffle ? shuffleArray(pool.slice()) : pool.slice();
  results = [];
  position = 0;
  sessionRunning = true;
  setSettingsLocked(true);
  const rangeLabel = missedOnly ? "오답 복습" : options.rangeLabel || $("range").selectedOptions[0]?.textContent || "전체";
  sessionMeta = {
    id: crypto.randomUUID(), setId: source?.setId || activeSetId,
    setName: source?.setName || sets.find((s) => s.id === activeSetId)?.name || "이력 복습",
    mode, range: rangeLabel, rangeValue: missedOnly ? "missed" : startNum, shuffle,
    combo: options.combo || null, // 종합 시험 설정 {setIds, count, pick} — ‘같은 범위 다시’가 같은 설정으로 다시 뽑는다
    daily: typeof options.daily === "string" ? options.daily : null, // 오늘의 단어(family.js)로 시작한 시험이면 그 날짜
    startedAt: new Date().toISOString(), saved: false, activeMs: 0, resumedAt: Date.now(),
  };
  clearSessionState();
  showView("quiz");
  displayQuestion();
  saveSessionState();
  return true;
}
function normEn(s) { return String(s || "").toLowerCase().normalize("NFKC").replace(/[^a-z]/g, ""); }
// 뜻 비교 전에 ‘…을/를’, ‘~에게’, ‘-에’ 같은 자리표시 조사와 괄호 설명, 문장 앞의 조사를 뗀다(책의 ‘…을 제출하다’와 답 ‘제출하다’가 같도록).
const KO_PARTICLES = "에게서|에게|한테서|한테|으로|에서|부터|까지|께서|께|을|를|이|가|은|는|에|와|과|로|의"; // 긴 조사가 먼저(정규식 대안은 왼쪽부터 맞춘다)
const KO_PLACEHOLDER = new RegExp(`(?:…|\\.{2,}|~|-|_+|\\([^)]*\\)|\\[[^\\]]*\\])\\s*(?:${KO_PARTICLES})?\\s*`, "g");
const KO_LEADING_PARTICLE = new RegExp(`^\\s*(?:${KO_PARTICLES})\\s+`);
function stripKoPlaceholders(s) { return String(s || "").replace(KO_PLACEHOLDER, " ").replace(KO_LEADING_PARTICLE, ""); }
function normKo(s) {
  return stripKoPlaceholders(s).toLowerCase().normalize("NFKC").replace(/[\s\p{P}\p{S}]/gu, "")
    .replace(/(라는뜻입니다|라는뜻이에요|이라는뜻입니다|이에요|입니다|이라는뜻|뜻이에요|뜻입니다|뜻이야|거예요|겁니다)$/g, "");
}
// 뜻 채점(기기 안): ① 뜻·허용 답안과 글자 그대로 같음 ② 답이 뜻으로 끝나는 짧은 합성어(몸무게 ↔ 무게, 두 글자 이내 차이).
// 그래도 다르면 grade()가 AI 2차 채점(sets.js judgeMeaning)에 ‘같은 뜻인지’ 묻는다.
function correctKo(spoken, w) {
  const ans = normKo(spoken);
  if (!ans) return false;
  return [...w.aliases, ...w.ko.split(/[·,;|]/)].map(normKo).filter(Boolean)
    .some((x) => x === ans || (x.length >= 2 && ans.length > x.length && ans.length - x.length <= 2 && ans.endsWith(x)));
}
// 영어 읽기 채점: 인식된 말에 그 단어(구면 단어들이 차례로)가 있거나, 글자만 남겨 같으면 통과. 대문자(Christmas)·구(give up)·하이픈(e-mail)도.
function correctEn(spoken, w) {
  const target = String(w.en || "").toLowerCase().split(/[^a-z]+/).filter(Boolean);
  if (!target.length) return false;
  const said = String(spoken || "").toLowerCase().split(/[^a-z]+/).filter(Boolean);
  for (let i = 0; i + target.length <= said.length; i++) if (target.every((t, j) => said[i + j] === t)) return true;
  return normEn(spoken) === normEn(w.en);
}

// ---- 음성 인식 ----
const permissionHelp = "Chrome → 설정 → 사이트 설정 → 마이크에서 이 사이트를 허용하고, Android 설정 → 애플리케이션 → Chrome → 권한 → 마이크 및 기기의 마이크 접근 스위치를 확인하세요.";
function micReason(code) {
  return ({
    "not-allowed": "마이크 접근이 거부됐습니다. " + permissionHelp,
    "service-not-allowed": "음성 인식 서비스가 차단됐습니다. Chrome에서 HTTPS 주소를 직접 열고 기기·관리자 정책을 확인하세요. 권한 허용만으로 해결되지 않을 수 있습니다.",
    "no-speech": "음성이 들리지 않았습니다. 마이크와의 거리를 확인하고 다시 눌러 말해 주세요.",
    network: "음성 인식 서버에 연결하지 못했습니다. 인터넷 연결을 확인하세요. 계속 실패하면 키보드 🎤 또는 직접 입력을 이용하세요.",
    "audio-capture": "마이크를 사용할 수 없습니다. 다른 녹음·통화 앱을 닫고 기기의 마이크 접근 스위치를 확인하세요.",
    "language-not-supported": "선택한 언어의 음성 인식을 지원하지 않습니다. 키보드 🎤 또는 직접 입력을 이용하세요.",
    aborted: "음성 인식이 중지됐습니다.",
  })[code] || "음성 인식 오류: " + code + " · 다시 시도하거나 직접 입력하세요.";
}
function micContextError() {
  if (["file:", "content:"].includes(location.protocol) || !window.isSecureContext) return "다운로드 파일 대신 배포된 HTTPS 웹주소를 Chrome에서 직접 열어 주세요.";
  if (window.self !== window.top) return "미리보기 화면을 벗어나 HTTPS 웹주소를 Chrome에서 직접 열어 주세요.";
  return "";
}
function refreshMicEnvironment() {
  const problem = micContextError();
  $("micEnvironment").textContent = (problem || "안전한 연결이 확인됐습니다.") + "\n" + (SPEECH ? "음성 인식 기능이 감지됐습니다. ① 권한 요청 후 ② 음성 인식 시험으로 확인하세요." : "이 브라우저는 웹 음성 인식을 지원하지 않습니다. Chrome 또는 직접 입력을 이용하세요.");
  $("micEnvironment").className = "mic-diagnosis" + (problem || !SPEECH ? " warn" : "");
}
function startRecognition(lang, out, button, onTranscript) {
  if (permissionPending) { setFeedback(out, "info", "먼저 마이크 권한 요청 창에서 허용 또는 차단을 선택해 주세요."); return; }
  if (recognition) { stopRec(); setFeedback(out, "info", "음성 인식을 중지했습니다. 원하는 마이크 버튼을 다시 눌러 주세요."); return; }
  const problem = micContextError();
  if (problem || !SPEECH) { setFeedback(out, "bad", problem || "이 브라우저는 웹 음성 인식을 지원하지 않습니다. 키보드 🎤 또는 직접 입력을 이용하세요."); return; }
  let rec;
  try { rec = new SPEECH(); } catch (e) { setFeedback(out, "bad", "음성 인식을 시작할 수 없습니다. Chrome에서 다시 시도하세요."); return; }
  recognition = rec; rec.lang = lang; rec.continuous = false; rec.interimResults = false; rec.maxAlternatives = 1;
  let received = false, endedWithError = false;
  const timer = setTimeout(() => { if (recognition === rec) { stopRec(); setFeedback(out, "bad", "음성 인식 응답이 없습니다. 권한 창과 인터넷 연결을 확인한 뒤 다시 시도하세요."); } }, 30000);
  rec.cleanup = () => { clearTimeout(timer); button.classList.remove("listening"); button.removeAttribute("aria-busy"); $("micStop").disabled = true; };
  setFeedback(out, "info", "마이크 시작 중… 권한 창이 나타나면 허용해 주세요.");
  button.setAttribute("aria-busy", "true");
  $("micStop").disabled = false;
  rec.onstart = () => { if (recognition !== rec) return; button.classList.add("listening"); setFeedback(out, "info", "듣는 중… " + (lang === "ko-KR" ? "한국어로" : "영어로") + " 말해 주세요."); };
  rec.onresult = (e) => { if (recognition !== rec) return; const transcript = e.results?.[e.resultIndex || 0]?.[0]?.transcript?.trim() || ""; if (!transcript) return; received = true; onTranscript(transcript); };
  rec.onerror = (e) => { if (recognition !== rec) return; endedWithError = true; setFeedback(out, "bad", micReason(e.error)); };
  rec.onend = () => { if (recognition !== rec) return; recognition = null; rec.cleanup(); if (!received && !endedWithError) setFeedback(out, "info", "인식된 말 없이 종료됐습니다. 다시 말하거나 입력칸에 직접 입력하세요."); };
  try { window.speechSynthesis?.cancel(); rec.start(); } catch (e) { recognition = null; rec.cleanup(); setFeedback(out, "bad", "음성 인식 시작 실패 (" + e.name + "). 권한을 확인한 뒤 다시 눌러 주세요."); }
}
function testMicrophone() { startRecognition("ko-KR", $("micTestResult"), $("micTest"), (text) => setFeedback($("micTestResult"), "good", "✓ 음성 인식 성공! 인식 내용: " + text)); }
// Only a user click requests permission. Release the stream before speech recognition.
async function requestMicPermission() {
  const out = $("micPermitResult"), button = $("micPermit");
  if (permissionPending) return;
  const problem = micContextError();
  if (problem || !navigator.mediaDevices?.getUserMedia) { setFeedback(out, "bad", problem || "마이크 권한 요청을 지원하지 않습니다. Chrome의 HTTPS 주소에서 열어 주세요."); return; }
  stopRec(); permissionPending = true; button.disabled = true;
  setFeedback(out, "info", "Chrome 마이크 권한 확인 중… 창에서 「허용」을 눌러 주세요. 창이 없으면 사이트 권한 설정을 확인하세요.");
  let media;
  try {
    media = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
    setFeedback(out, "good", "✓ 마이크 접근 권한을 확인했습니다. 이제 「② 음성 인식 시험」을 눌러 주세요. 음성 인식 서비스는 별도로 확인합니다.");
  } catch (err) {
    const name = err?.name || "UnknownError";
    const messages = { NotAllowedError: "마이크 권한이 거부됐습니다. " + permissionHelp, PermissionDeniedError: "마이크 권한이 거부됐습니다. " + permissionHelp, NotFoundError: "사용 가능한 마이크를 찾지 못했습니다. 기기의 마이크 연결을 확인하세요.", NotReadableError: "마이크를 사용할 수 없습니다. 녹음·통화 앱을 닫고 기기의 마이크 접근 스위치를 확인하세요.", SecurityError: "브라우저 또는 기기 정책이 마이크 접근을 차단했습니다. Chrome에서 HTTPS 주소를 직접 열고 관리자 설정을 확인하세요.", AbortError: "마이크 연결이 중단됐습니다. 다시 시도해 주세요." };
    setFeedback(out, "bad", messages[name] || "마이크 권한 확인 실패 (" + name + "). Chrome에서 다시 시도하세요.");
  } finally { if (media) media.getTracks().forEach((track) => track.stop()); permissionPending = false; button.disabled = false; }
}
refreshMicEnvironment();
$("micPermit").addEventListener("click", requestMicPermission);
$("micTest").addEventListener("click", testMicrophone);
$("micStop").addEventListener("click", () => { stopRec(); setFeedback($("micTestResult"), "info", "음성 인식을 중지했습니다."); });
document.addEventListener("visibilitychange", () => {
  if (document.hidden) { stopRec(); if (sessionRunning) { accumulateActive(); saveSessionState(); } }
  else if (sessionRunning && sessionMeta && !sessionMeta.resumedAt) sessionMeta.resumedAt = Date.now();
});
window.addEventListener("pagehide", () => { stopRec(); if (sessionRunning) { accumulateActive(); saveSessionState(); } });

// ---- 화면 이탈 기록: 문제를 푸는 동안 앱이 가려지거나 다른 앱으로 나간 횟수·시간. 기록에 남아 보호자 폰에 ⚠️로 표시된다. ----
// 1초 미만(권한 창·알림 깜빡임)과 마이크 버튼 직후 2초 안에 시작된 가림(권한 요청 창)은 세지 않는다. 채점이 끝난 문제에서의 이탈도 세지 않는다.
const AWAY_MIN_MS = 1000;
const AWAY_MIC_GRACE_MS = 2000;
let awaySince = 0, lastMicPressAt = 0;
function awayStart() {
  if (awaySince || !sessionRunning || !question.w || question.answerChecked || Date.now() - lastMicPressAt < AWAY_MIC_GRACE_MS) return;
  awaySince = Date.now();
}
function awayEnd() {
  if (!awaySince) return;
  const ms = Date.now() - awaySince;
  awaySince = 0;
  if (ms < AWAY_MIN_MS || !sessionRunning || !sessionMeta || !question.w) return;
  question.away = (question.away || 0) + 1;
  question.awayMs = (question.awayMs || 0) + ms;
  sessionMeta.awayCount = (sessionMeta.awayCount || 0) + 1;
  sessionMeta.awayMs = (sessionMeta.awayMs || 0) + ms;
  saveSessionState();
}
document.addEventListener("visibilitychange", () => (document.hidden ? awayStart() : awayEnd()));
window.addEventListener("blur", awayStart);
window.addEventListener("focus", awayEnd);

// ---- 문제당 제한 시간: 보호자가 보호자 앱에서 정한 초(family.js의 childTimeLimitSec, 0이면 없음). 시간이 지나면 모름 처리. ----
// 마감은 절대 시각이라 앱 밖에 나가 있어도 시간이 흐른다(인터넷 검색 방지). 채점이 끝나면 멈춘다.
let questionTimer = null;
function stopQuestionTimer() {
  if (questionTimer) { clearInterval(questionTimer); questionTimer = null; }
  $("timeLeft").classList.add("hidden");
}
function startQuestionTimer() {
  stopQuestionTimer();
  const limit = typeof childTimeLimitSec === "function" ? childTimeLimitSec() : 0;
  if (!limit || !sessionRunning || !question.w) return;
  question.deadline = Date.now() + limit * 1000;
  const el = $("timeLeft");
  el.classList.remove("hidden");
  const tick = () => {
    if (!sessionRunning || question.answerChecked || !question.deadline) { stopQuestionTimer(); return; }
    const left = Math.max(0, Math.ceil((question.deadline - Date.now()) / 1000));
    el.textContent = "⏱ " + left + "초";
    el.classList.toggle("urgent", left <= 5);
    if (left > 0) return;
    const timedOut = question;
    question.timedOut = true;
    sessionMeta.timeouts = (sessionMeta.timeouts || 0) + 1;
    markUnknown();
    if (question === timedOut) {
      el.classList.remove("hidden"); el.textContent = "⏱ 0초"; el.classList.add("urgent");
      setFeedback($("answerFeedback"), "bad", "⏱ 시간이 다 됐어요. 모르는 단어로 기록돼요. 정답을 보고 다음으로 넘어가세요.");
    }
  };
  tick();
  questionTimer = setInterval(tick, 250);
}
// 시험 화면의 글자는 선택·복사·길게 누르기 메뉴(선택 → 번역)를 막는다. CSS의 user-select:none 과 함께 동작한다.
for (const type of ["contextmenu", "copy", "cut", "dragstart"]) document.querySelector(".word-box").addEventListener(type, (e) => e.preventDefault());

// ---- 문제 표시·채점 ----
function displayQuestion() {
  $("sessionScope").textContent = sessionMeta.setName + " · " + sessionMeta.range;
  const w = queue[position];
  question = { w, unknown: false, readChecked: false, readPass: false, readSkipped: false, answerChecked: false, answerPass: false, voiceRecognized: "" };
  startQuestionTimer();
  $("progressText").textContent = `${position + 1} / ${queue.length}`;
  $("scoreText").textContent = `정답 ${results.filter((x) => x.pass).length} · 오답 ${results.filter((x) => !x.pass).length}`;
  $("progressBar").style.width = `${(position / queue.length) * 100}%`;
  $("wordNum").textContent = w.id;
  $("promptWord").textContent = mode === "ko_en" ? w.ko : w.en;
  $("promptWord").className = mode === "ko_en" ? "meaning" : "word";
  $("promptHint").textContent = mode === "ko_en" ? "뜻을 보고 영어로 써 보세요" : mode === "read_meaning" ? "① 영어로 읽기 → ② 한국어 뜻 말하기" : "한국어 뜻을 말하거나 입력하세요";
  $("readStep").classList.toggle("hidden", mode !== "read_meaning");
  $("readInput").value = ""; $("readInput").disabled = false; $("checkRead").disabled = false;
  $("readTitle").textContent = mode === "ko_en" ? "1. 영어로 말하기 (선택)" : "1. 영어로 읽기";
  $("readInstruction").textContent = mode === "ko_en" ? "영어 단어를 생각해서 말해 보세요. 철자는 아래에서 채점해요." : "마이크를 누르고 영어 단어를 읽어 보세요.";
  $("parentConfirm").textContent = "✓ 소리 내어 읽었어요";
  $("hear").classList.toggle("hidden", mode === "ko_en");
  $("spellingArea").classList.toggle("hidden", mode !== "ko_en");
  $("spellingGuide").classList.toggle("hidden", mode !== "ko_en");
  $("micSpelling").disabled = false; $("penInput").disabled = false;
  $("answerTitle").textContent = mode === "ko_en" ? "2. 영어 스펠링" : mode === "en_ko" ? "한국어 뜻 맞히기" : "2. 한국어 뜻 말하기";
  $("answerInstruction").textContent = mode === "ko_en" ? "알파벳으로 말하거나 키보드·S펜으로 쓰세요. 대소문자는 상관없어요." : "말하거나 입력한 뒤 정답 확인을 누르세요.";
  $("micKoArea").classList.toggle("hidden", mode === "ko_en");
  $("answerInput").lang = mode === "ko_en" ? "en" : "ko";
  $("answerVoiceGuide").classList.toggle("hidden", mode === "ko_en");
  $("answerInput").placeholder = mode === "ko_en" ? "영어 철자 입력" : "한국어 뜻 입력";
  $("answerInput").value = ""; $("answerInput").disabled = false; $("check").disabled = false; $("unknown").disabled = false;
  $("unknown").classList.remove("hidden");
  $("parentConfirm").disabled = false; $("micEnglish").disabled = false; $("micKorean").disabled = false;
  $("readFeedback").className = "feedback info";
  $("readFeedback").textContent = mode === "ko_en" ? "말하기는 건너뛰어도 돼요." : "아직 읽기 확인 전";
  $("answerFeedback").className = "feedback info";
  $("answerFeedback").textContent = "답을 말하거나 입력해 보세요.";
  $("answerReveal").style.display = "none"; $("answerReveal").textContent = "";
  $("next").disabled = true;
  $("next").textContent = position + 1 === queue.length ? "결과 보기 →" : "다음 →";
  question.readSelf = false;
  if (!SPEECH) $("readFeedback").textContent = "이 브라우저에는 음성 인식이 없어요. 보호자 확인 또는 입력으로 채점해요.";
}
function setRead(pass, spoken, skipped = false, self = false) {
  if (question.unknown) return;
  question.readChecked = true;
  question.readSelf = self;
  $("readInput").value = spoken || $("readInput").value;
  $("checkRead").disabled = pass || skipped;
  question.readPass = pass; question.readSkipped = skipped; question.voiceRecognized = spoken || "";
  setFeedback($("readFeedback"), pass ? "good" : skipped ? "info" : "bad", skipped ? "말하기는 건너뛰었어요." : pass ? (self ? "✓ 소리 내어 읽었어요 (직접 확인)" : `✓ 영어 읽기 확인${spoken ? " · 인식: " + spoken : ""}`) : `✕ 인식된 말: ${spoken || "(없음)"} · 다시 말하거나 ‘소리 내어 읽었어요’를 누르세요.`);
  updateNext();
}
function showAnswer() {
  const w = question.w, parent = $("answerReveal");
  parent.style.display = "block"; parent.textContent = "";
  const label = document.createElement("strong");
  label.textContent = `정답: ${w.en} — ${w.ko}`;
  const detail = document.createElement("div");
  detail.className = "ipa";
  detail.textContent = w.ipa ? `발음 ${w.ipa}${w.hangul ? " · 한글 참고 발음: " + w.hangul : ""}` : "";
  parent.append(label, detail);
}
function normalizeSpelling(value) { const text = String(value).normalize("NFKC").trim().toLowerCase(); return /^[a-z](?:[\s,.-]+[a-z])+$/.test(text) ? text.replace(/[\s,.-]/g, "") : text; }
function decodeSpelling(transcript) {
  const names = { a: "a", ay: "a", aye: "a", b: "b", bee: "b", be: "b", c: "c", see: "c", sea: "c", d: "d", dee: "d", e: "e", ee: "e", f: "f", eff: "f", g: "g", gee: "g", h: "h", aitch: "h", haitch: "h", i: "i", eye: "i", j: "j", jay: "j", k: "k", kay: "k", l: "l", el: "l", ell: "l", m: "m", em: "m", n: "n", en: "n", o: "o", oh: "o", p: "p", pee: "p", q: "q", cue: "q", queue: "q", r: "r", are: "r", ar: "r", s: "s", ess: "s", t: "t", tee: "t", tea: "t", u: "u", you: "u", v: "v", vee: "v", w: "w", x: "x", ex: "x", y: "y", why: "y", z: "z", zee: "z", zed: "z", 에이: "a", 비: "b", 씨: "c", 시: "c", 디: "d", 이: "e", 에프: "f", 지: "g", 에이치: "h", 아이: "i", 제이: "j", 케이: "k", 엘: "l", 엠: "m", 엔: "n", 오: "o", 피: "p", 큐: "q", 알: "r", 아르: "r", 에스: "s", 티: "t", 유: "u", 브이: "v", 더블유: "w", 엑스: "x", 와이: "y", 지드: "z", 제트: "z" };
  const tokens = String(transcript).normalize("NFKC").toLowerCase().replace(/double[ -]+(?:u|you|yoo)/g, "w").replace(/[.,!?;:]/g, " ").trim().split(/[\s-]+/).filter(Boolean);
  if (!tokens.length) return { text: "", unresolved: true };
  if (tokens.length === 1 && !names[tokens[0]]) return { text: tokens[0], unresolved: true };
  const unresolved = tokens.some((token) => !names[token]);
  return { text: unresolved ? transcript : tokens.map((token) => names[token]).join(""), unresolved };
}
function listenSpelling() {
  if (!sessionRunning || mode !== "ko_en" || question.answerChecked) return;
  lastMicPressAt = Date.now();
  const target = question;
  startRecognition("en-US", $("answerFeedback"), $("micSpelling"), (transcript) => {
    if (question !== target) return;
    const decoded = decodeSpelling(transcript);
    $("answerInput").value = decoded.text;
    setFeedback($("answerFeedback"), "info", "인식된 말: " + transcript + " · " + (decoded.unresolved ? "알파벳을 확실하게 변환하지 못했습니다. 입력칸의 철자를 직접 수정해 주세요." : "철자: " + decoded.text.toUpperCase() + " · 확인·수정한 뒤 정답 확인을 누르세요."));
  });
}
$("micSpelling").addEventListener("click", listenSpelling);
$("penInput").addEventListener("click", () => { if (!$("answerInput").disabled) $("answerInput").focus(); });
function grade(input, origin = "type") {
  if (!sessionRunning || question.answerChecked || question.aiPending) return;
  stopRec();
  const w = question.w, value = String(input || "").trim();
  if (!value) { setFeedback($("answerFeedback"), "bad", "답을 먼저 입력하거나 말해 주세요."); return; }
  stopQuestionTimer(); // 답을 냈으므로 제한 시간은 멈춘다(AI가 확인하는 동안에도)
  $("answerInput").value = value; $("answerInput").disabled = true; $("check").disabled = true; $("micSpelling").disabled = true; $("penInput").disabled = true;
  $("unknown").disabled = true; $("micKorean").disabled = true;
  const pass = mode === "ko_en" ? normalizeSpelling(value) === normalizeSpelling(w.en) : correctKo(value, w);
  // 뜻이 글자 그대로는 다를 때만 AI에게 ‘같은 뜻인지’ 묻는다(sets.js judgeMeaning: AI 서버가 설정된 기기에서만, 실패하면 null → 오답 유지).
  if (!pass && mode !== "ko_en" && typeof judgeMeaning === "function" && judgeMeaning.available()) {
    const target = question;
    question.aiPending = true;
    setFeedback($("answerFeedback"), "info", `내 답${origin === "speech" ? "(음성)" : ""}: ${value} · 책의 뜻과 글자가 달라요. AI가 같은 뜻인지 확인하는 중…`);
    judgeMeaning(w, value).then((verdict) => {
      if (question !== target || !sessionRunning) return; // 그사이 쉬기·그만하기로 문제가 바뀌었으면 버린다
      question.aiPending = false;
      finishGrade(pass, value, origin, verdict);
    });
    return;
  }
  finishGrade(pass, value, origin, null);
}
// 채점 확정. verdict 는 AI 2차 채점 결과({accept, reason}) 또는 null(기기 채점만).
function finishGrade(localPass, value, origin, verdict) {
  const w = question.w;
  const pass = localPass || verdict?.accept === true;
  question.answerChecked = true; question.answerPass = pass;
  if (!localPass && pass) { question.aiPass = true; sessionMeta.aiPass = (sessionMeta.aiPass || 0) + 1; learnAlias(w, value); }
  const aiNote = verdict ? ` · AI 판정: ${verdict.reason || (pass ? "같은 뜻으로 인정" : "다른 뜻")}` : "";
  setFeedback($("answerFeedback"), pass ? "good" : "bad", `${pass ? "✓ 정답!" : "✕ 아쉬워요"} · 내 답${origin === "speech" ? "(음성)" : ""}: ${value}${aiNote}${!pass ? " · 아래 정답을 확인하세요." : ""}${!pass && mode === "ko_en" ? " · 틀린 위치: " + Array.from(w.en).map((c, i) => (normalizeSpelling(value)[i] === c ? "✓" : c)).join(" ") + (value.length > w.en.length ? " (추가 글자 있음)" : "") : ""}`);
  showAnswer(); updateNext();
  if (!$("next").disabled) $("next").focus({ preventScroll: true });
}
// AI가 인정한 답은 그 단어의 허용 답안에 넣어 둔다: 다음부터는 기기에서 바로 정답이고, 같은 아이의 다른 기기에도 세트 동기화로 전해진다.
function learnAlias(w, value) {
  const alias = value.replace(/\s+/g, " ").trim().slice(0, 60);
  const set = sets.find((s) => s.id === (w._setId || sessionMeta?.setId)); // 종합 시험이면 단어의 출처 세트
  if (!alias || !set) return; // 오늘의 단어·기록 복습처럼 세트가 아닌 시험은 건너뛴다
  const word = set.words.find((x) => x.id === w.id && x.en === w.en);
  if (!word || word.aliases.some((a) => normKo(a) === normKo(alias))) return;
  const updated = { ...set, words: set.words.map((x) => (x === word ? { ...x, aliases: [...x.aliases, alias] } : x)), updatedAt: new Date().toISOString() };
  if (typeof persistSets !== "function" || !persistSets(sets.map((s) => (s.id === set.id ? updated : s)))) return;
  if (activeSetId === set.id) WORDS = updated.words;
  w.aliases = [...w.aliases, alias];
  if (typeof queueSetsSync === "function") queueSetsSync(); // family.js
}
function markUnknown() {
  if (!question.w || question.unknown) return;
  stopRec();
  stopQuestionTimer();
  question.unknown = true; question.answerChecked = true; question.answerPass = false; question.readChecked = true; question.readPass = false;
  $("unknown").disabled = true;
  ["answerInput", "check", "readInput", "checkRead", "micEnglish", "micKorean", "micSpelling", "penInput", "parentConfirm"].forEach((id) => ($(id).disabled = true));
  setFeedback($("answerFeedback"), "info", "모르는 단어로 표시했어요. 틀린 단어로 기록되고 복습에 들어가요.");
  showAnswer(); updateNext();
}
$("unknown").addEventListener("click", markUnknown);
function updateNext() {
  $("next").disabled = !(question.answerChecked && (mode !== "read_meaning" || question.readChecked));
  if (question.answerChecked && mode === "read_meaning" && !question.unknown) {
    if (!question.readChecked) setFeedback($("readFeedback"), "info", question.answerPass ? "뜻은 맞았어요! 위에서 영어 읽기까지 확인하면 다음으로 넘어가요." : "위에서 영어 읽기도 확인해 주세요.");
    else if (question.answerPass && !question.readPass) {
      setFeedback($("readFeedback"), "bad", "뜻은 맞았어요! 읽기가 ✕라서 이대로 넘어가면 오답이에요. 다시 읽거나 ‘소리 내어 읽었어요’를 누르세요.");
      $("next").textContent = "읽기 ✕ · 오답으로 넘어가기 →";
    }
  }
}
function stopRec() {
  const rec = recognition; recognition = null;
  if (rec) { rec.cleanup?.(); try { rec.abort(); } catch (_) {} }
  document.querySelectorAll(".btn.mic").forEach((el) => el.classList.remove("listening"));
  $("micStop").disabled = true;
  window.speechSynthesis?.cancel();
}
function listen(lang, kind) {
  if (!sessionRunning || !question.w || question.unknown || (question.answerChecked && kind === "ko")) return;
  lastMicPressAt = Date.now();
  const targetQuestion = question;
  startRecognition(lang, kind === "en" ? $("readFeedback") : $("answerFeedback"), kind === "en" ? $("micEnglish") : $("micKorean"), (transcript) => {
    if (question !== targetQuestion) return;
    const input = kind === "en" ? $("readInput") : $("answerInput");
    input.value = transcript;
    if (kind === "en") $("checkRead").disabled = false;
    setFeedback(kind === "en" ? $("readFeedback") : $("answerFeedback"), "info", "인식된 말: " + transcript + " · 잘못 인식된 글자를 수정한 뒤 " + (kind === "en" ? "읽기 채점" : "정답 확인") + "을 눌러 주세요.");
  });
}
function speak() {
  stopRec();
  const w = question.w;
  if (!("speechSynthesis" in window)) { alert("이 브라우저에는 음성 읽기 기능이 없습니다."); return; }
  const synth = window.speechSynthesis; synth.cancel();
  const u = new SpeechSynthesisUtterance(w.en); u.lang = "en-US"; u.rate = 0.82; u.pitch = 1;
  const v = synth.getVoices().find((v) => v.lang.toLowerCase().startsWith("en-us"));
  if (v) u.voice = v;
  synth.speak(u);
}
function recordCurrentResult() {
  const spokenCount = mode === "ko_en" ? !question.readChecked || question.readSkipped || question.readPass : question.readPass;
  const pass = question.answerPass && (mode !== "read_meaning" || spokenCount);
  results.push({ id: question.w.id, word: structuredClone(question.w), pass: question.unknown ? false : pass, unknown: question.unknown, ...(question.readSelf ? { self: true } : {}), ...(question.away ? { away: question.away, awayMs: question.awayMs || 0 } : {}), ...(question.timedOut ? { timeout: true } : {}), ...(question.aiPass ? { ai: true } : {}) });
  question = { ...question, answerChecked: false };
}
function advance() {
  if (!sessionRunning || $("next").disabled) return;
  stopRec();
  recordCurrentResult();
  position++;
  if (position >= queue.length) { complete(); return; }
  saveSessionState();
  displayQuestion();
  window.scrollTo({ top: 0, behavior: "smooth" });
}
function finishRecords(partial) {
  saveSession(partial);
  const missed = results.filter((x) => !x.pass).map((x) => x.id);
  // 종합 시험: 단어마다 붙은 출처 세트(_setId)별로 그 세트의 오답 목록에 반영한다(이번에 푼 단어는 결과로 갱신, 안 푼 단어는 그대로).
  if (sessionMeta.setId === COMBO_SET_ID) {
    const bySet = new Map();
    for (const x of results) {
      const sid = x.word?._setId;
      if (!sid || !sets.some((s) => s.id === sid)) continue;
      if (!bySet.has(sid)) bySet.set(sid, []);
      bySet.get(sid).push(x);
    }
    for (const [sid, list] of bySet) {
      const tested = list.map((x) => x.id);
      const merged = [...new Set([...missedIdsOf(sid).filter((id) => !tested.includes(id)), ...list.filter((x) => !x.pass).map((x) => x.id)])];
      try { localStorage.setItem("daily_vocab_missed_" + sid, JSON.stringify(merged)); } catch (_) { setFeedback($("historyStatus"), "bad", "오답 저장 실패. JSON 백업을 이용하세요."); }
      if (sid === activeSetId) lastMissed = merged;
    }
  }
  // 틀린 단어는 시험을 본 세트에 저장한다(지금 선택된 세트와 다를 수 있다). 이번에 푼 단어만 결과로 바꾸고 풀지 않은 단어의 오답은 남긴다
  // (범위 시험·기록에서 다시 풀기를 끝내도 다른 범위의 틀린 단어가 지워지지 않게. 전체를 푼 시험은 결과와 같다).
  else if (sets.some((s) => s.id === sessionMeta.setId)) {
    const setKey = "daily_vocab_missed_" + sessionMeta.setId;
    let previous = [];
    try { previous = JSON.parse(localStorage.getItem(setKey) || "[]"); } catch {}
    if (!Array.isArray(previous)) previous = [];
    const merged = [...new Set([...previous.filter((id) => !results.some((x) => x.id === id)), ...missed])];
    try { localStorage.setItem(setKey, JSON.stringify(merged)); } catch (_) { setFeedback($("historyStatus"), "bad", "오답 저장 실패. JSON 백업을 이용하세요."); }
    if (sessionMeta.setId === activeSetId) lastMissed = merged;
  }
  refreshReview();
  return missed;
}
// 시험이 끝나거나(완료·그만하기) 쉴 때, sessionRunning 을 끈 뒤 family.js 에 알린다:
// 시험 중 미뤄 둔 세트 동기화(learnAlias 가 허용 답안을 넣어 세트가 바뀐 경우)를 바로 올린다.
function notifyQuizEnded() {
  if (typeof onQuizEnded === "function") onQuizEnded(); // family.js
}
function complete() {
  stopQuestionTimer();
  accumulateActive();
  sessionRunning = false;
  setSettingsLocked(false);
  const missed = finishRecords(false);
  clearSessionState();
  showResult(missed, false);
  notifyQuizEnded();
}
function showResult(missed, partial) {
  const correct = results.filter((x) => x.pass).length;
  const pct = Math.round((correct / results.length) * 100);
  const seconds = Math.max(0, Math.round((sessionMeta.activeMs || 0) / 1000));
  $("finishTitle").textContent = partial ? `여기까지 ${results.length}문제 풀었어요` : "시험 완료!";
  $("finalScore").textContent = `${correct} / ${results.length}`;
  $("finalDesc").textContent = missed.length ? `정답률 ${pct}% · 틀린 단어 ${missed.length}개를 한 번 더 복습해 봐요.` : "모든 단어 정답! 정말 잘했어요 🎉";
  $("finalEmoji").textContent = partial ? "⏹" : pct === 100 ? "🏆" : pct >= 80 ? "🏅" : pct >= 50 ? "💪" : "🌱";
  $("finalStats").textContent = `${sessionMeta.setName} · ${modeLabels[mode]} · ${sessionMeta.range}${partial ? " (중단)" : ""} · ${Math.floor(seconds / 60)}분 ${seconds % 60}초`;
  const list = $("missedList");
  list.textContent = "";
  for (const x of results.filter((r) => !r.pass)) {
    const li = document.createElement("li");
    li.textContent = `${x.word.id}. ${x.word.en} — ${x.word.ko}${x.unknown ? " (모름)" : ""}`;
    list.append(li);
  }
  $("missedBox").classList.toggle("hidden", !missed.length);
  $("retryMissed").classList.toggle("hidden", !missed.length);
  $("retryMissed").disabled = !missed.length;
  $("againSame").classList.toggle("primary", !missed.length);
  $("againSame").disabled = sessionMeta.rangeValue === "missed" || (!sessionMeta.combo && sessionMeta.setId !== activeSetId);
  showView("finish");
}

// ---- 기록 ----
// 기록 형식. 보통 기록은 results 에 단어별 결과가 있고, 요약 기록(restored·compacted: true)은 total/correct 로 점수를 두고 results 에는 틀린 단어만 둔다(비어 있을 수 있음).
// childId(있으면)는 이 시험을 본 아이(가족 기록함에 연결된 기기, family.js recordChildId) — 다른 아이로 다시 연결해도 그 아이에게 보내지 않는다.
function validRecord(r) {
  if (!(r && typeof r.id === "string" && Number.isFinite(Date.parse(r.completedAt)) && modeLabels[r.mode] && typeof r.range === "string" && Array.isArray(r.results) && r.results.length <= 2000)) return false;
  if (!r.results.every((x) => x.word && typeof x.word.en === "string" && typeof x.word.ko === "string" && Array.isArray(x.word.aliases) && typeof x.pass === "boolean" && typeof x.unknown === "boolean")) return false;
  if (isSummaryRecord(r)) return Number.isInteger(r.total) && r.total >= 1 && r.total <= 2000 && Number.isInteger(r.correct) && r.correct >= 0 && r.correct <= r.total;
  return r.results.length > 0;
}
// 기록 용량: 보통 기록은 단어 객체를 통째로 담아 40단어 시험 하나가 약 7.4K자다. localStorage 한도(아이폰 약 2.6M자·Chrome 약 5M자)에 닿으면
// 기록·세트·쉬는 시험·가족 기록함 저장이 모두 실패하므로, 기록을 저장할 때마다(persistHistory)와 앱을 열 때 오래된 기록을 줄인다.
//  · 최신 HISTORY_FULL_COUNT 개(합쳐 HISTORY_FULL_CHARS 자까지)는 그대로 둔다.
//  · 그보다 오래된 보통 기록은 요약 기록(compacted: true)으로 바꾼다: 점수는 total/correct, results 는 틀린 단어만(최대 200개, 복원 기록과 같은 모양).
//    기록 탭·CSV·틀린 단어 다시 풀기·가족 기록함 전송은 그대로 되고, 맞힌 단어 목록만 없어진다. ‘서버에서 복원’ 표시는 붙지 않는다.
//  · 그래도 기록 전체가 HISTORY_MAX_CHARS 자를 넘으면 가장 오래된 요약 기록부터 틀린 단어 목록을 비운다(점수·날짜·방식은 남는다).
const HISTORY_FULL_COUNT = 200, HISTORY_FULL_CHARS = 600000, HISTORY_MAX_CHARS = 1500000, SUMMARY_MISSED_LIMIT = 200;
function summarizeRecord(r) {
  const { correct, total } = recordScore(r);
  return { ...r, compacted: true, total, correct, results: r.results.filter((x) => !x.pass).slice(0, SUMMARY_MISSED_LIMIT) };
}
// 바뀐 것이 없으면 받은 배열을 그대로 돌려준다.
function compactHistory(list) {
  let changed = false, full = true, chars = 0;
  const sizes = [];
  const out = list.map((r, i) => {
    let next = r, size = JSON.stringify(r).length;
    if (!isSummaryRecord(r)) {
      if (i > 0 && (i >= HISTORY_FULL_COUNT || chars + size > HISTORY_FULL_CHARS)) full = false; // 가장 최근 기록은 언제나 그대로
      if (!full) {
        next = summarizeRecord(r);
        size = JSON.stringify(next).length;
        changed = true;
      }
    }
    sizes.push(size);
    chars += size;
    return next;
  });
  for (let i = out.length - 1; i > 0 && chars > HISTORY_MAX_CHARS; i--) {
    if (!isSummaryRecord(out[i]) || !out[i].results.length) continue;
    out[i] = { ...out[i], results: [] };
    chars += JSON.stringify(out[i]).length - sizes[i];
    changed = true;
  }
  return changed ? out : list;
}
try {
  const saved = JSON.parse(localStorage.getItem(historyKey) || "[]");
  if (Array.isArray(saved)) {
    historyRecords = saved.filter(validRecord);
    // 이 기능 전에 쌓인 기록도 앱을 열 때 한 번 줄여 둔다. 읽지 못한 기록이 섞여 있거나 다른 저장 자료가 깨졌으면 원본을 보호하려고 쓰지 않는다.
    const compacted = compactHistory(historyRecords);
    if (compacted !== historyRecords && storageAvailable && historyRecords.length === saved.length) {
      try { localStorage.setItem(historyKey, JSON.stringify(compacted)); historyRecords = compacted; } catch {}
    }
  }
} catch (_) { setFeedback($("historyStatus"), "bad", "저장된 기록을 읽지 못했습니다. 새 시험 기록부터 저장합니다."); }
// quiet: 뒤에서 하는 저장(family.js 의 기록 주인 표시)이라 기록 탭에 안내를 띄우지 않는다.
function persistHistory(next, options = {}) {
  if (!storageAvailable) { if (!options.quiet) setFeedback($("historyStatus"), "bad", "저장 자료 오류로 원본을 보호합니다. JSON으로 백업하세요."); return false; }
  next = compactHistory(next);
  try {
    localStorage.setItem(historyKey, JSON.stringify(next));
    historyRecords = next;
    if (!options.quiet) setFeedback($("historyStatus"), "good", "기록을 이 브라우저에 저장했습니다.");
    renderHistory();
    return true;
  } catch (_) { if (!options.quiet) setFeedback($("historyStatus"), "bad", "기록 저장에 실패했습니다. 저장 공간이나 브라우저 설정을 확인하세요. 현재 기록은 CSV로 내려받을 수 있습니다."); return false; }
}
function saveSession(partial = false) {
  if (!sessionMeta || sessionMeta.saved) return;
  sessionMeta.saved = true;
  const childId = typeof recordChildId === "function" ? recordChildId() : ""; // family.js: 가족 기록함에 연결된 아이
  const record = { id: sessionMeta.id, setId: sessionMeta.setId, setName: sessionMeta.setName, mode: sessionMeta.mode, range: sessionMeta.range, startedAt: sessionMeta.startedAt, completedAt: new Date().toISOString(), activeMs: Math.max(0, Math.round(sessionMeta.activeMs || 0)), ...(childId ? { childId } : {}), ...(sessionMeta.daily ? { daily: sessionMeta.daily } : {}), ...(sessionMeta.awayCount ? { awayCount: sessionMeta.awayCount, awayMs: sessionMeta.awayMs || 0 } : {}), ...(sessionMeta.timeouts ? { timeouts: sessionMeta.timeouts } : {}), ...(sessionMeta.aiPass ? { aiPass: sessionMeta.aiPass } : {}), results: results.map((x) => ({ ...x })) };
  if (partial) record.partial = true;
  const next = [record, ...historyRecords];
  if (!persistHistory(next)) { historyRecords = next; renderHistory(); }
  if (typeof queueFamilySync === "function") queueFamilySync(record); // family.js: 보호자에게 기록 보내기(켜져 있을 때만)
}
// 기록 탭의 세트 필터: 처음에는 ‘전체 세트’(오늘의 단어·종합 시험·지운 세트 기록까지 모두). 세트마다, 그리고 기록이 있을 때만 ‘오늘의 단어’·‘종합 시험’.
// 홈에서 세트를 바꿔도 필터는 따라가지 않는다(지금 세트로 본 시험이 없으면 기록 탭이 비어 보여 기록이 사라진 것처럼 보였다).
const HISTORY_DAILY = "@daily", HISTORY_COMBO = "@combo"; // 세트 id 와 겹치지 않는 필터 값
const isDailyRecord = (r) => typeof r.setId === "string" && r.setId.startsWith("daily:");
function renderHistoryFilter() {
  const filter = $("historyFilter");
  const options = [["all", "전체 세트"], ...sets.map((s) => [s.id, s.name])];
  if (historyRecords.some(isDailyRecord)) options.push([HISTORY_DAILY, "📬 오늘의 단어"]);
  if (historyRecords.some((r) => r.setId === COMBO_SET_ID)) options.push([HISTORY_COMBO, "📝 종합 시험"]);
  const keep = filter.value || "all";
  const key = JSON.stringify(options);
  if (filter.dataset.key !== key) {
    filter.dataset.key = key;
    filter.textContent = "";
    for (const [value, label] of options) {
      const o = document.createElement("option");
      o.value = value;
      o.textContent = label;
      filter.append(o);
    }
  }
  filter.value = options.some(([value]) => value === keep) ? keep : "all";
}
function historyFilterValue() {
  return $("historyFilter").value || "all";
}
function filteredHistory() {
  const filter = historyFilterValue();
  if (filter === "all") return historyRecords;
  if (filter === HISTORY_DAILY) return historyRecords.filter(isDailyRecord);
  if (filter === HISTORY_COMBO) return historyRecords.filter((r) => r.setId === COMBO_SET_ID);
  return historyRecords.filter((r) => r.setId === filter);
}
// 보이는 기록이 없을 때: 다른 세트에는 있으면 ‘전체 세트 보기’, 기기에 하나도 없고 가족 기록함에 연결돼 있으면 서버에서 가져오기(다른 기기에서 본 시험).
function renderEmptyHistory(list) {
  const text = document.createElement("p");
  const actions = document.createElement("div");
  actions.className = "actionbar";
  if (historyRecords.length) {
    text.textContent = `이 세트로 본 시험은 아직 없어요. 전체 세트에는 시험 ${historyRecords.length}회가 있어요.`;
    const all = document.createElement("button");
    all.type = "button"; all.className = "btn soft"; all.id = "showAllHistory"; all.textContent = "전체 세트 보기";
    all.addEventListener("click", () => { $("historyFilter").value = "all"; renderHistory(); });
    actions.append(all);
  } else {
    text.textContent = "아직 이 기기에서 본 시험이 없어요.";
    if (typeof restoreReady === "function" && restoreReady()) { // family.js: 가족 기록함에 연결된 기기
      text.textContent += " 다른 기기에서 본 시험은 서버에서 가져올 수 있어요.";
      const fetchBtn = document.createElement("button");
      fetchBtn.type = "button"; fetchBtn.className = "btn soft"; fetchBtn.id = "historyRestore"; fetchBtn.textContent = "☁️ 서버 기록 가져오기";
      fetchBtn.disabled = sessionRunning;
      fetchBtn.addEventListener("click", async () => {
        fetchBtn.disabled = true;
        setFeedback($("historyStatus"), "info", "서버에 보낸 기록을 가져오는 중…");
        const added = await restoreRecords({ force: true, manual: true });
        if (added === 0) setFeedback($("historyStatus"), "info", "서버에도 가져올 기록이 없어요.");
        else if (added === null) setFeedback($("historyStatus"), "bad", "기록을 가져오지 못했어요. 인터넷 연결을 확인하고 다시 눌러 주세요.");
        if (document.body.contains(fetchBtn)) fetchBtn.disabled = false;
      });
      actions.append(fetchBtn);
    }
  }
  list.append(text);
  if (actions.childElementCount) list.append(actions);
}
function renderHistory() {
  const list = $("historyList");
  list.textContent = "";
  renderHistoryFilter();
  $("exportHistory").disabled = !historyRecords.length;
  $("clearHistory").disabled = !historyRecords.length;
  const records = filteredHistory();
  if (records.length) {
    const avg = Math.round(records.reduce((sum, r) => sum + recordScore(r).pct, 0) / records.length);
    $("historySummary").textContent = `시험 ${records.length}회 · 평균 ${avg}점 · 최근 ${recordScore(records[0]).pct}점`;
  } else $("historySummary").textContent = "";
  if (!records.length) { renderEmptyHistory(list); return; }
  for (const record of records) {
    const { correct, total, pct } = recordScore(record);
    const unknown = record.results.filter((x) => x.unknown).length;
    const entry = document.createElement("article");
    entry.className = "history-entry";
    const head = document.createElement("div");
    head.className = "history-head";
    const score = document.createElement("span");
    score.className = "history-score";
    score.textContent = correct + " / " + total + " · " + pct + "점" + (record.partial ? " · 중단" : "");
    const remove = document.createElement("button");
    remove.type = "button"; remove.className = "btn outline small"; remove.textContent = "삭제";
    remove.setAttribute("aria-label", new Date(record.completedAt).toLocaleString("ko-KR") + " 시험 기록 삭제");
    remove.addEventListener("click", () => { if (confirm("이 시험 기록을 삭제할까요?")) persistHistory(historyRecords.filter((x) => x.id !== record.id)); });
    head.append(score, remove);
    const meta = document.createElement("p");
    meta.className = "history-meta";
    meta.textContent = new Date(record.completedAt).toLocaleString("ko-KR") + " · " + record.setName + " · " + modeLabels[record.mode] + " · " + record.range + (record.restored ? " · ☁️ 서버에서 복원" : "");
    const counts = document.createElement("p");
    counts.textContent = "정답 " + correct + " · 오답 " + (total - correct) + (missedComplete(record) ? " (모름 " + unknown + "개 포함)" : "") + (record.awayCount ? " · ⚠️ 화면 이탈 " + record.awayCount + "회" : "") + (record.timeouts ? " · ⏱ 시간 초과 " + record.timeouts + "개" : "") + (record.aiPass ? " · 🤖 AI 인정 " + record.aiPass + "개" : "");
    entry.append(head, meta, counts);
    const missed = record.results.filter((x) => !x.pass);
    if (missed.length) {
      const details = document.createElement("details"), summary = document.createElement("summary"), words = document.createElement("p"), retry = document.createElement("button");
      summary.textContent = "틀린 단어 " + missed.length + "개 보기";
      words.textContent = missed.map((x) => x.word.id + ". " + x.word.en + " — " + x.word.ko + (x.unknown ? " [모름]" : "")).join(" · ");
      retry.type = "button"; retry.className = "btn soft history-retry"; retry.disabled = sessionRunning; retry.textContent = "이 시험의 틀린 단어 다시 풀기";
      retry.addEventListener("click", () => {
        if (sessionRunning) return;
        const previousMode = mode;
        changeMode(record.mode);
        if (!newSession(true, missed.map((x) => structuredClone(x.word)), record)) changeMode(previousMode);
      });
      details.append(summary, words, retry);
      entry.append(details);
    }
    list.append(entry);
  }
}
$("historyFilter").addEventListener("change", renderHistory);
function setSettingsLocked(locked) {
  ["range", "shuffle", "start", "review", "setSelect", "createSet", "editSet", "deleteSet", "renameSet", "saveSet", "importSets", "comboCount", "comboPick"].forEach((id) => ($(id).disabled = locked));
  document.querySelectorAll(".mode, #comboSets input").forEach((button) => (button.disabled = locked));
  updateComboSummary();
  refreshReview();
  $("retryMissed").disabled = locked || !lastMissed.length;
  document.querySelectorAll(".history-retry").forEach((button) => (button.disabled = locked));
}
function exportHistory() {
  if (!historyRecords.length) return;
  const rows = [["완료 날짜", "세트", "시험 방식", "범위", "정답", "전체", "점수", "모름 개수", "오답 번호", "모름 번호", "중단", "비고"], ...historyRecords.map((r) => {
    const s = recordScore(r);
    return [new Date(r.completedAt).toLocaleString("ko-KR"), r.setName, modeLabels[r.mode], r.range, s.correct, s.total, s.pct, r.results.filter((x) => x.unknown).length, r.results.filter((x) => !x.pass).map((x) => x.id).join(" "), r.results.filter((x) => x.unknown).map((x) => x.id).join(" "), r.partial ? "중단" : "", [r.restored ? "서버에서 복원" : "", missedComplete(r) ? "" : "틀린 단어 일부 생략"].filter(Boolean).join(" · ")];
  })];
  const csv = "﻿" + rows.map((row) => row.map((value) => '"' + String(value).replace(/"/g, '""') + '"').join(",")).join("\r\n");
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url; a.download = "매일영단어_시험기록_" + new Date().toISOString().slice(0, 10) + ".csv"; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
$("exportHistory").addEventListener("click", exportHistory);
$("clearHistory").addEventListener("click", () => {
  const linked = typeof isLinked === "function" && isLinked(); // family.js: 가족 기록함에 연결된 기기
  if (!confirm("전체 시험 기록을 삭제할까요? 삭제 전에 CSV로 내려받을 수 있습니다." + (linked ? " 보호자에게 보낸 서버 사본은 남고, 설정 → 가족 기록함의 ‘서버 기록 다시 가져오기’로 되살릴 수 있어요." : ""))) return;
  if (persistHistory([]) && typeof noteHistoryCleared === "function") noteHistoryCleared(); // 일부러 지운 기록을 다음 실행 때 자동으로 되살리지 않는다
});

// ---- 버튼 연결 ----
$("start").addEventListener("click", () => newSession());
$("review").addEventListener("click", () => newSession(true));
$("retryMissed").addEventListener("click", () => {
  const missedWords = results.filter((x) => !x.pass).map((x) => structuredClone(x.word));
  if (!missedWords.length || !sessionMeta) return;
  newSession(true, missedWords, { setId: sessionMeta.setId, setName: sessionMeta.setName });
});
$("againSame").addEventListener("click", () => {
  if (!sessionMeta) return;
  if (sessionMeta.combo) { startCombo(sessionMeta.combo); return; } // 종합 시험: 같은 세트·문제 수·뽑는 방법으로 다시 뽑는다
  newSession(false, null, null, { rangeValue: sessionMeta.rangeValue, rangeLabel: sessionMeta.range, shuffle: sessionMeta.shuffle });
});
$("newTest").addEventListener("click", () => showView("home"));
$("micEnglish").addEventListener("click", () => listen("en-US", "en"));
$("micKorean").addEventListener("click", () => listen("ko-KR", "ko"));
$("hear").addEventListener("click", speak);
$("parentConfirm").addEventListener("click", () => setRead(true, "", false, true));
$("check").addEventListener("click", () => grade($("answerInput").value));
$("checkRead").addEventListener("click", () => { stopRec(); const value = $("readInput").value.trim(); if (!value) { setFeedback($("readFeedback"), "bad", "영어 읽기 인식 결과를 먼저 입력하세요."); return; } setRead(correctEn(value, question.w), value); });
$("readInput").addEventListener("keydown", (e) => { if (e.isComposing || e.keyCode === 229) return; if (e.key === "Enter") $("checkRead").click(); });
$("next").addEventListener("click", advance);
$("answerInput").addEventListener("keydown", (e) => { if (e.isComposing || e.keyCode === 229) return; if (e.key === "Enter") { if (!$("check").disabled) grade($("answerInput").value); else if (!$("next").disabled) advance(); } });

// ---- 초기 화면 ----
Shared.watchViewport(); // 화면 키보드가 떠 있거나 확대된 동안 하단 탭을 숨긴다(화면 가운데로 떠오르지 않게)
changeMode(mode);
$("shuffle").checked = prefs.shuffle !== false;
populateSets();
renderHistory();
showView("home");
