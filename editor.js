"use strict";
// editor.js — 세트 편집기 모듈 window.SetEditor (보호자 앱 개편 A단계에서 sets.js 에서 옮김). shared.js 다음에 불러온다.
// 편집기 DOM 은 mount 가 직접 만든다(index.html 에는 빈 <section id="editor"> 껍데기만). ID·클래스·문구는 테스트 계약이라 그대로 둔다.
// 표 ↔ 텍스트(#wordDraft) 양방향 동기화(300단어 넘으면 텍스트), 사진 고르기(바꿔치기)·촬영(누적 최대 10장)·썸네일 ✕, 순차 사진 인식,
// 빈 뜻·발음 AI 채우기(40개씩), AI 가 채운 칸 노란 표시(.ai-filled, 직접 고치면 해제), 저장 전 검증, 이름 바꾸기·삭제 상자, 읽기 전용(단어 보기)을 맡는다.
// 저장·이름 바꾸기·삭제·닫은 뒤 이동은 호출자 콜백이 정한다(아이 앱 sets.js: 기기에 저장 / 보호자: 아이에게 보내기).
//
// SetEditor.mount(host, {
//   ai,                 // { recognize(imageBase64, mediaType, signal) → {words, note}, define(words, signal) → {words, note} } | null,
//                       //   또는 그런 값을 돌려주는 함수(쓸 때마다 불러 그때의 설정을 쓴다). null 이면 onNeedAi(reason).
//   onSave(set),        // 검증을 통과한 {id, name, words, updatedAt}. 성공하면 호출자가 SetEditor.close() 하고 화면을 옮긴다.
//   onClose(),          // ‘닫기’(미저장 확인 → 진행 중 AI 작업 취소 → close) 뒤 어디로 갈지.
//   onRename?(set, name) → true | 문구 | false,  // 있으면 ‘이 세트 관리’ 상자에 이름 바꾸기. true 면 성공, 문구는 상자에 표시.
//   onDelete?(set) → true | 문구 | false,        // 있으면 ‘세트 삭제’. 성공하면 호출자가 close 와 화면 이동까지 한다.
//   guard?(action) → true | 문구 | false,        // "save" | "rename" | "delete" 전에 묻는다(아이 앱: 시험 중·세트 잠금). 문구면 보이고 멈춘다.
//   onNeedAi?(reason),  // AI 가 필요한데 ai 가 null 일 때(아이 앱: 설정 화면으로 안내).
// })
// SetEditor.open(set | null, { readOnly, readOnlyText, title, targetName }) → 열었으면 true(미저장 초안을 지키려고 취소하면 false).
//   targetName 이 있으면 제목에 ‘→ 🧒 N에게 보내기’를 붙이고 관리 상자를 숨긴다. readOnlyText 는 읽기 전용일 때 안내·저장 거절 문구.
// SetEditor.close() · isOpen() · isDirty() · confirmDiscard() · setStatus(text) · setWarning(text) · lockSave(on)
// window.editorOpen 은 아이 앱 호환용 사본(quiz.js 홈의 ‘편집 중인 세트로 돌아가기’ 등이 본다).
(function () {
  const { $, h, tidy: clean, parseDraft, WORD_PATTERN, preparePhoto, canvasToBase64Jpeg } = Shared;
  const TABLE_LIMIT = 300; // 이보다 많으면 표 대신 텍스트로 편집
  const DEFINE_BATCH = 40; // AI 사전에 한 번에 묻는 단어 수
  const MAX_PHOTOS = 10;

  let host = null, opts = {};
  let current = null; // 열어 둔 세트 {id, name} (새 세트면 null)
  let editorOpen = false, readOnly = false, readOnlyText = "";
  let draftTextMode = false, draftDirty = false;
  let selectedFiles = [], photoUrls = [];
  // AI 사전이 채운 칸: 영어(소문자) → { ko?: true, ipa?: true }. 이번 편집 중에만 노란 칸으로 표시한다.
  let aiFilled = new Map();
  let extractGeneration = 0, extractAbort = null, extractOperation = null;

  const toLine = (w) => [w.id, w.en, w.ko, (w.aliases || []).join("|"), ...(w.ipa ? [w.ipa] : [])].join("\t");
  const currentAi = () => (typeof opts.ai === "function" ? opts.ai() : opts.ai) || null;
  // guard 결과: true 면 진행, 문구면 show(문구) 뒤 멈춤, 그 밖이면 조용히 멈춤.
  function allowed(action, show) {
    const verdict = opts.guard ? opts.guard(action) : true;
    if (verdict === true) return true;
    if (typeof verdict === "string" && verdict) show(verdict);
    return false;
  }
  function setOpen(on) {
    editorOpen = on;
    window.editorOpen = on;
  }

  // ---- 마크업 ----
  function build() {
    const button = (id, cls, text, extra) => h("button", { type: "button", class: cls, id, ...extra }, text);
    return h(
      "div",
      { class: "card" },
      h("h2", { class: "section-title", id: "editorTitle" }, "➕ 새 세트 만들기"),
      h("label", { for: "setName" }, "세트 이름"),
      h("input", { id: "setName", type: "text", maxlength: 120, placeholder: "예: DAY 05 (161~200)" }),
      h(
        "div",
        { class: "photo-row", id: "photoRow" },
        button("pickPhotos", "btn", "🖼️ 사진 고르기"),
        h("input", { id: "photos", type: "file", accept: "image/*", multiple: true, hidden: true }),
        button("takePhoto", "btn", "📷 촬영 (여러 장 가능)"),
        h("input", { id: "camera", type: "file", accept: "image/*", capture: "environment", hidden: true }),
        button("extractWords", "btn primary", "✨ 사진에서 단어 가져오기"),
        button("cancelExtract", "btn outline", "취소", { disabled: true }),
      ),
      h(
        "p",
        { class: "muted", id: "photoHelp" },
        "최대 10장, 장당 10MB. AI가 번호·영어·뜻·발음·허용 답안을 정리해 줍니다. 영어 단어만 있는 사진이면 뜻과 발음은 AI 사전이 채워 줍니다(노란 칸). 책과 비교해 고친 뒤 저장하세요.",
      ),
      h("div", { id: "extractStatus", role: "status", class: "feedback info" }),
      h("div", { id: "photoPreview", class: "thumbs" }),
      h(
        "div",
        { class: "row-between", style: "margin-top:12px" },
        h("h3", { style: "margin:0;font-size:16px;color:var(--navy)" }, "단어 ", h("span", { id: "wordCount", class: "pill" }, "단어 없음")),
        h(
          "div",
          { class: "actionbar", style: "margin:0" },
          button("addRow", "btn small", "＋ 단어 추가"),
          button("fillMeanings", "btn small", "✨ 빈 뜻 AI로 채우기"),
          button("toggleDraftText", "btn outline small", "텍스트로 편집"),
        ),
      ),
      h(
        "div",
        { id: "wordTableWrap", class: "table-wrap" },
        h(
          "table",
          { id: "wordTable" },
          h("colgroup", null, ["c-num", "c-en", "c-ko", "c-alias", "c-ipa", "c-del"].map((c) => h("col", { class: c }))),
          h("thead", null, h("tr", null, ["번호", "영어", "뜻", "다른 정답 (쉼표로 구분)", "발음", ""].map((t) => h("th", null, t || null)))),
          h("tbody", { id: "wordTableBody" }),
        ),
      ),
      h("textarea", {
        id: "wordDraft",
        class: "hidden",
        rows: 10,
        "aria-label": "단어 텍스트 (한 줄에 번호, 영어, 뜻, 허용 답안, 발음; 탭으로 구분)",
        placeholder: "1\tapple\t사과\t사과|사과 열매",
      }),
      h("p", { id: "draftWarnings", role: "status", class: "feedback info" }),
      h("label", { class: "check", id: "confirmedRow" }, h("input", { id: "confirmed", type: "checkbox" }), " 책과 비교해서 확인했어요"),
      h(
        "div",
        { class: "actionbar" },
        button("saveSet", "btn primary", "저장", { style: "min-width:140px;min-height:54px;font-size:17px" }),
        button("closeEditor", "btn outline", "닫기"),
      ),
      h(
        "div",
        { id: "manageBox", class: "manage hidden" },
        h("h3", { style: "margin:0 0 8px;font-size:15px;color:var(--navy)" }, "🔧 이 세트 관리 (보호자)"),
        h(
          "div",
          { class: "actionbar", style: "margin-top:4px" },
          button("renameSet", "btn", "✏️ 이름 바꾸기"),
          button("deleteSet", "btn outline danger", "🗑 세트 삭제"),
        ),
        h(
          "div",
          { id: "renameBox", class: "rename hidden" },
          h("input", { id: "renameInput", type: "text", maxlength: 120, "aria-label": "새 세트 이름", placeholder: "새 이름" }),
          button("renameSave", "btn primary", "저장"),
          button("renameCancel", "btn outline", "취소"),
        ),
        h("div", { id: "manageStatus", class: "feedback info", role: "status" }),
      ),
    );
  }

  // ---- 열기·닫기 ----
  function confirmDiscard() {
    if (!editorOpen || !draftDirty) return true;
    const n = parseDraft($("wordDraft").value).length;
    return confirm(n ? `저장하지 않은 단어 ${n}개가 사라져요. 그래도 나갈까요?` : "저장하지 않은 내용이 사라져요. 그래도 나갈까요?");
  }
  function releasePhotos() {
    photoUrls.forEach(URL.revokeObjectURL);
    photoUrls = [];
    $("photoPreview").textContent = "";
  }
  function open(set = null, o = {}) {
    if (editorOpen && (current?.id || null) !== (set?.id || null) && !confirmDiscard()) return false;
    if ($("extractWords").disabled) cancelExtract();
    current = set ? { id: set.id, name: set.name } : null;
    selectedFiles = [];
    aiFilled = new Map();
    readOnly = Boolean(o.readOnly); // tableRow 가 본다: 칸은 읽기 전용, 삭제 버튼 없음
    readOnlyText = o.readOnlyText || "이 세트는 볼 수만 있어요.";
    // 이름 바꾸기·삭제는 기기에 있는 세트를 고칠 때만(다른 사람에게 보내는 세트는 그쪽 화면에서 관리한다)
    $("manageBox").classList.toggle("hidden", !set || Boolean(o.targetName) || readOnly || !(opts.onRename || opts.onDelete));
    $("renameSet").classList.toggle("hidden", !opts.onRename);
    $("deleteSet").classList.toggle("hidden", !opts.onDelete);
    $("manageStatus").textContent = "";
    $("renameBox").classList.add("hidden");
    $("setName").value = set?.name || "새 세트 " + new Date().toLocaleDateString("sv-SE");
    $("setName").placeholder = "예: DAY 05 (161~200)";
    $("wordDraft").value = set ? set.words.map(toLine).join("\n") : "";
    $("confirmed").checked = false;
    $("photos").value = "";
    $("camera").value = "";
    releasePhotos();
    $("extractStatus").textContent = readOnly ? readOnlyText : set ? "" : "사진을 고르거나 찍은 뒤 ‘사진에서 단어 가져오기’를 누르세요. 직접 입력해도 돼요.";
    $("draftWarnings").textContent = "";
    $("editorTitle").textContent = (o.title || (readOnly ? "📖 단어 보기" : set ? "✏️ 세트 수정" : "➕ 새 세트 만들기")) + (o.targetName ? ` → 🧒 ${o.targetName}에게 보내기` : "");
    setOpen(true);
    setTextMode(false);
    applyReadOnly(readOnly);
    draftDirty = false;
    return true;
  }
  // 읽기 전용(‘단어 보기’): 사진·AI·단어 추가·텍스트 편집·확인란·저장을 숨기고 이름과 표(텍스트)를 읽기 전용으로 둔다. 표의 칸·삭제 버튼은 tableRow 가 readOnly 를 본다.
  function applyReadOnly(on) {
    host.classList.toggle("readonly", on);
    for (const id of ["photoRow", "photoHelp", "fillMeanings", "toggleDraftText", "confirmedRow", "saveSet"]) $(id).classList.toggle("hidden", on);
    $("addRow").classList.toggle("hidden", on || draftTextMode);
    $("setName").readOnly = on;
    $("wordDraft").readOnly = on;
  }
  // 저장했거나 지운 뒤(호출자가 부른다)·닫기 버튼. 화면 이동은 하지 않는다.
  function close() {
    setOpen(false);
    readOnly = false;
    draftDirty = false;
    selectedFiles = [];
    releasePhotos();
  }
  function cancelExtract() {
    extractGeneration++;
    extractAbort?.();
    extractAbort = null;
    $("cancelExtract").disabled = true;
    $("extractWords").disabled = false;
    $("fillMeanings").disabled = false;
    $("extractStatus").textContent = "취소했습니다. 다시 시도하거나 아래에 직접 입력하세요.";
  }

  // ---- 사진 고르기·찍기 ----
  function renderPhotos(announce = false) {
    releasePhotos();
    if (announce)
      $("extractStatus").textContent = selectedFiles.length
        ? `사진을 선택했습니다 (${selectedFiles.length}장). ‘사진에서 단어 가져오기’를 누르세요.`
        : "사진을 선택하세요.";
    selectedFiles.forEach((file, index) => {
      const url = URL.createObjectURL(file);
      photoUrls.push(url);
      const remove = h("button", { type: "button", class: "thumb-remove", "aria-label": `${index + 1}번째 사진 빼기` }, "✕");
      remove.addEventListener("click", () => {
        selectedFiles.splice(index, 1);
        renderPhotos(true);
      });
      $("photoPreview").append(h("div", { class: "thumb-box" }, h("img", { src: url, alt: file.name, class: "thumb" }), remove));
    });
  }

  // ---- 초안(텍스트) ↔ 단어 표 ----
  function updateWordCount(n) {
    $("wordCount").textContent = n ? `${n}단어` : "단어 없음";
  }
  function tableRow(r = {}) {
    const tr = document.createElement("tr");
    const columns = [
      ["id", "num", "번호", ""],
      ["en", "en", "영어", "en"],
      ["ko", "ko", "뜻", "ko"],
      ["aliases", "alias", "허용 답안 (|로 구분)", "ko"],
      ["ipa", "ipa", "발음", "en"],
    ];
    const aiMarks = aiFilled.get(String(r.en || "").trim().toLowerCase()) || {};
    for (const [key, cls, placeholder, lang] of columns) {
      const td = document.createElement("td");
      const input = document.createElement(key === "id" ? "input" : "textarea");
      if (key === "id") input.type = "text";
      else input.rows = 1;
      input.className = "cell " + cls;
      input.placeholder = placeholder;
      input.autocomplete = "off";
      input.spellcheck = false;
      if (lang) input.lang = lang;
      input.value = key === "aliases" ? (r.aliases || []).join("|") : r[key] ?? "";
      input.dataset.key = key;
      if (readOnly) input.readOnly = true; // ‘단어 보기’
      input.addEventListener("input", tableToDraft);
      if (aiMarks[key]) {
        // AI 사전이 채운 칸은 직접 고칠 때까지 노란색으로 표시한다.
        input.classList.add("ai-filled");
        input.title = "AI 사전이 채운 내용이에요. 확인해 주세요.";
        input.addEventListener(
          "input",
          () => {
            input.classList.remove("ai-filled");
            input.title = "";
            delete aiMarks[key];
          },
          { once: true },
        );
      }
      // Enter는 줄바꿈 대신 아래 칸으로 이동(마지막 줄이면 새 단어 추가)
      input.addEventListener("keydown", (e) => {
        if (e.key !== "Enter" || e.isComposing) return;
        e.preventDefault();
        const next = tr.nextElementSibling?.querySelector(`[data-key="${key}"]`);
        if (next) next.focus();
        else if (!readOnly) $("addRow").click();
      });
      td.append(input);
      tr.append(td);
    }
    const td = document.createElement("td");
    const del = h("button", { type: "button", class: "btn outline small row-delete", "aria-label": "이 단어 삭제" }, "✕");
    del.addEventListener("click", () => {
      tr.remove();
      tableToDraft();
    });
    if (!readOnly) td.append(del); // ‘단어 보기’에는 삭제 버튼이 없다
    tr.append(td);
    return tr;
  }
  function draftToTable() {
    const rows = parseDraft($("wordDraft").value);
    updateWordCount(rows.length);
    if (rows.length > TABLE_LIMIT) {
      setTextMode(true);
      $("draftWarnings").textContent = `단어가 ${rows.length}개라 텍스트로 표시합니다.`;
      return;
    }
    const tbody = $("wordTableBody");
    tbody.textContent = "";
    for (const r of rows) tbody.append(tableRow(r));
    if (!rows.length)
      tbody.append(h("tr", { class: "empty-row" }, h("td", { colspan: 6 }, "아직 단어가 없어요. 사진에서 가져오거나 ‘＋ 단어 추가’를 누르세요.")));
  }
  function tableToDraft() {
    const lines = [];
    for (const tr of $("wordTableBody").querySelectorAll("tr")) {
      if (!tr.querySelector("[data-key]")) continue;
      const get = (k) => tr.querySelector(`[data-key="${k}"]`).value.replace(/[\t\r\n]+/g, " ").trim();
      const id = get("id"), en = get("en"), ko = get("ko"), ipa = get("ipa");
      const aliases = get("aliases").split(/[|,·]/).map((x) => x.trim()).filter(Boolean).join("|");
      if (!en && !ko && !aliases && !ipa) continue;
      lines.push([id, en, ko, aliases, ...(ipa ? [ipa] : [])].join("\t"));
    }
    $("wordDraft").value = lines.join("\n");
    $("confirmed").checked = false;
    draftDirty = true;
    updateWordCount(lines.length);
  }
  function setTextMode(on) {
    draftTextMode = on;
    $("wordDraft").classList.toggle("hidden", !on);
    $("wordTableWrap").classList.toggle("hidden", on);
    $("addRow").classList.toggle("hidden", on || readOnly);
    $("toggleDraftText").textContent = on ? "표로 편집" : "텍스트로 편집";
    if (!on) draftToTable();
  }
  function addRow() {
    if (draftTextMode || readOnly) return;
    $("wordTableBody").querySelector(".empty-row")?.remove();
    const ids = [...$("wordTableBody").querySelectorAll('[data-key="id"]')].map((i) => Number(i.value)).filter(Number.isInteger);
    const nextId = ids.length ? Math.max(...ids) + 1 : $("wordTableBody").children.length + 1;
    const tr = tableRow({ id: String(nextId) });
    $("wordTableBody").append(tr);
    tr.querySelector(".en").focus();
    $("confirmed").checked = false;
  }

  // ---- 저장 ----
  function save() {
    if (!allowed("save", setWarning)) return;
    if (readOnly) {
      setWarning(readOnlyText); // ‘단어 보기’는 저장하지 않는다(버튼이 숨어 있어도)
      return;
    }
    const name = $("setName").value.trim(),
      words = parseDraft($("wordDraft").value);
    const duplicates = words.filter((w, i) => words.slice(0, i).some((x) => x.id === w.id || x.en.toLowerCase() === w.en.toLowerCase()));
    if (!name) {
      setWarning("세트 이름을 입력하세요.");
      $("setName").focus();
      return;
    }
    const broken = words.findIndex((w) => !w.id || !w.en || !w.ko);
    if (!words.length || words.length > 2000 || broken >= 0 || duplicates.length) {
      if (!words.length) setWarning("단어가 없어요. 사진에서 가져오거나 ‘＋ 단어 추가’로 넣어 주세요.");
      else if (words.length > 2000) setWarning("단어는 최대 2000개까지 저장할 수 있어요.");
      else if (broken >= 0) {
        const w = words[broken];
        setWarning(`${broken + 1}번째 줄: ${!w.id ? "번호" : !w.en ? "영어" : "뜻"}이(가) 비어 있어요.`);
        if (!draftTextMode) $("wordTableBody").querySelectorAll("tr")[broken]?.scrollIntoView({ behavior: "smooth", block: "center" });
      } else {
        const d = duplicates[0];
        const at = words.findIndex((w) => w === d);
        setWarning(`${at + 1}번째 줄: ‘${d.en || d.id}’이(가) 앞의 단어와 번호나 영어가 겹쳐요.`);
        if (!draftTextMode) $("wordTableBody").querySelectorAll("tr")[at]?.scrollIntoView({ behavior: "smooth", block: "center" });
      }
      return;
    }
    if (!$("confirmed").checked) {
      setWarning("책과 비교해서 확인했으면 확인란을 체크해 주세요.");
      return;
    }
    return opts.onSave?.({ id: current?.id || crypto.randomUUID(), name, words, updatedAt: new Date().toISOString() });
  }

  // ---- 이름 바꾸기·삭제 (관리 상자) ----
  const manageStatus = (text) => ($("manageStatus").textContent = text);
  function startRename() {
    if (!current || !allowed("rename", () => {})) return;
    $("renameInput").value = current.name;
    $("renameBox").classList.remove("hidden");
    $("renameInput").focus();
    $("renameInput").select();
  }
  function saveRename() {
    if (!current || !opts.onRename || !allowed("rename", manageStatus)) return;
    const name = $("renameInput").value.trim();
    const result = opts.onRename({ ...current }, name);
    if (typeof result === "string" && result) manageStatus(result);
    if (result !== true) return;
    current.name = name;
    $("renameBox").classList.add("hidden");
    $("setName").value = name;
    manageStatus(`이름을 ‘${name}’(으)로 바꿨어요.`);
  }
  function deleteCurrent() {
    if (!current || !opts.onDelete || !allowed("delete", manageStatus)) return;
    const result = opts.onDelete({ ...current });
    if (typeof result === "string" && result) manageStatus(result);
  }

  // ---- AI 작업 공통(사진 인식·빈 뜻 채우기): 한 번에 하나만, 취소·시간 초과·버튼 잠금·늦은 결과 폐기 ----
  function requireAi(reason) {
    const ai = currentAi();
    if (ai) return ai;
    if (opts.onNeedAi) opts.onNeedAi(reason);
    else setStatus(reason);
    return null;
  }
  function startOperation(statusText) {
    const generation = ++extractGeneration;
    const operation = {};
    extractOperation = operation;
    let failure, timer;
    const controller = new AbortController();
    const interrupted = new Promise((_, reject) => {
      failure = (reason) => {
        controller.abort();
        reject(reason instanceof Error ? reason : Error(String(reason)));
      };
      extractAbort = () => failure(Error("취소했습니다"));
    });
    interrupted.catch(() => {});
    $("extractWords").disabled = true;
    $("fillMeanings").disabled = true;
    $("cancelExtract").disabled = false;
    $("confirmed").checked = false;
    $("extractStatus").textContent = statusText;
    return {
      signal: controller.signal,
      live: () => generation === extractGeneration,
      step: (promise) => Promise.race([promise, interrupted]),
      deadline(message, ms = 90000) {
        clearTimeout(timer);
        timer = setTimeout(() => failure(Error(message + " 시간이 초과됐습니다")), ms);
      },
      // 실패를 알린 뒤에는 늦게 도착하는 결과를 버린다.
      fail: () => {
        if (generation === extractGeneration) extractGeneration++;
      },
      end() {
        clearTimeout(timer);
        if (extractOperation !== operation) return;
        extractOperation = null;
        extractAbort = null;
        $("extractWords").disabled = false;
        $("fillMeanings").disabled = false;
        $("cancelExtract").disabled = true;
      },
    };
  }
  function markAiFilled(en, fields) {
    const key = String(en || "").trim().toLowerCase();
    if (!key) return;
    const marks = aiFilled.get(key) || {};
    for (const field of Object.keys(fields)) if (fields[field]) marks[field] = true;
    aiFilled.set(key, marks);
  }
  // 가져온 단어를 초안에 추가한다. 인쇄된 번호가 있으면 쓰고, 없거나 겹치면 이어서 번호를 매긴다. 이미 있는 영어 단어는 건너뛴다.
  // 사진에 뜻이 없어 AI가 채운 단어(generated)는 노란 칸으로 표시한다. 돌려주는 값: {added, skipped, generated}.
  function appendDraftRows(rows) {
    const existing = $("wordDraft").value.split("\n").filter((l) => l.trim());
    const used = new Set(existing.map((l) => l.split("\t")[0].trim()));
    const knownWords = new Set(existing.map((l) => (l.split("\t")[1] || "").trim().toLowerCase()).filter(Boolean));
    let next = existing.length;
    const fresh = rows.filter((r) => {
      const key = String(r.en || "").trim().toLowerCase();
      if (knownWords.has(key)) return false;
      knownWords.add(key);
      return true;
    });
    const lines = fresh.map((r) => {
      let id = r.number > 0 ? String(r.number) : "";
      if (!id || used.has(id)) {
        do next++;
        while (used.has(String(next)));
        id = String(next);
      }
      used.add(id);
      if (r.generated) markAiFilled(r.en, { ko: true, ipa: Boolean(r.ipa) });
      return toLine({ ...r, id });
    });
    $("wordDraft").value = [...existing, ...lines].join("\n");
    draftDirty = true;
    if (!draftTextMode) draftToTable();
    else updateWordCount(existing.length + lines.length);
    return { added: lines.length, skipped: rows.length - fresh.length, generated: fresh.filter((r) => r.generated).length };
  }
  async function extractWords() {
    const files = selectedFiles.slice();
    if (!files.length || files.length > MAX_PHOTOS || files.some((f) => !f.type.startsWith("image/") || f.size > 10 * 1024 * 1024)) {
      $("extractStatus").textContent = `사진 ${files.length}장을 선택했습니다. 한 번에 1~10장, 장당 최대 10MB의 이미지 파일을 선택하세요.`;
      return;
    }
    const ai = requireAi("사진 인식을 쓰려면 접속 코드를 저장해 주세요.");
    if (!ai) return;
    const op = startOperation("사진에서 단어를 가져옵니다. 사진을 준비하는 중…");
    try {
      const notes = [];
      let generatedTotal = 0;
      for (let i = 0; i < files.length; i++) {
        $("extractStatus").textContent = (i ? "" : "사진에서 단어를 가져옵니다. ") + `${i + 1}/${files.length}장 · 사진 크기를 조정하는 중…`;
        op.deadline("사진 준비", 30000);
        const photo = await op.step(preparePhoto(files[i]));
        const image = await op.step(canvasToBase64Jpeg(photo));
        photo.width = photo.height = 1;
        $("extractStatus").textContent = `${i + 1}/${files.length}장 · AI가 단어를 읽는 중… (보통 10~40초) · 취소하고 직접 입력할 수도 있습니다.`;
        op.deadline("AI 인식", 120000);
        const result = await op.step(ai.recognize(image, "image/jpeg", op.signal));
        if (!op.live()) return;
        const rows = (Array.isArray(result?.words) ? result.words : [])
          .map((w) => ({
            number: Number.isInteger(w?.number) && w.number > 0 ? w.number : 0,
            en: clean(w?.en),
            ko: clean(w?.ko),
            ipa: clean(w?.ipa),
            aliases: (Array.isArray(w?.aliases) ? w.aliases : []).map(clean).filter(Boolean),
            generated: w?.generated === true,
          }))
          .filter((w) => w.en && w.ko);
        if (!rows.length) throw Error("사진에서 단어를 찾지 못했습니다. 더 선명하게 찍어 다시 시도하세요.");
        const added = appendDraftRows(rows);
        if (result.note) notes.push(clean(result.note));
        generatedTotal += added.generated;
        const generated = added.generated ? ` (뜻 ${added.generated}개는 사진에 없어 AI 사전으로 채움)` : "";
        const skipped = added.skipped ? ` · 이미 있는 단어 ${added.skipped}개 건너뜀` : "";
        $("extractStatus").textContent = `${i + 1}/${files.length}장 완료 · 단어 ${added.added}개 추가${generated}${skipped} · 책과 비교해 고친 뒤 확인란을 체크하고 저장하세요.`;
        selectedFiles = selectedFiles.filter((f) => f !== files[i]);
      }
      renderPhotos();
      $("extractStatus").textContent =
        `${files.length}/${files.length}장 완료 · ` +
        (generatedTotal ? `뜻 ${generatedTotal}개는 사진에 없어 AI 사전으로 채웠어요(노란 칸) · ` : "") +
        "책과 비교해 고친 뒤 확인란을 체크하고 저장하세요.";
      if (notes.length) $("extractStatus").textContent += " · AI 메모: " + notes.join(" ");
      $("draftWarnings").textContent =
        (generatedTotal ? `사진에 뜻이 없던 단어 ${generatedTotal}개는 AI 사전이 뜻·발음을 채웠어요(노란 칸). 틀릴 수 있으니 사전과 비교해 확인하세요. ` : "") +
        "책과 비교해 틀린 뜻·빠진 단어·중복을 고치세요. 결과가 비어 있으면 직접 입력하거나 더 선명한 사진으로 다시 시도하세요.";
      $("wordTableWrap").scrollIntoView({ behavior: "smooth", block: "start" });
    } catch (e) {
      if (op.live()) {
        op.fail();
        const done = files.length - selectedFiles.filter((f) => files.includes(f)).length;
        $("extractStatus").textContent = "단어를 가져오지 못했습니다: " + (e?.message || String(e)) + (done ? ` · ${done}/${files.length}장까지는 가져왔어요. 남은 사진만 다시 시도하세요.` : " · 인터넷 연결을 확인하고 다시 시도하세요.") + " 아래에 직접 입력해 저장할 수도 있어요.";
        renderPhotos();
      }
    } finally {
      op.end();
    }
  }

  // ---- 빈 뜻·발음 채우기 (AI 사전) ----
  // 뜻이 비어 있는 단어는 뜻·허용 답안·발음을, 발음만 비어 있는 단어는 발음만 채운다. 이미 적힌 칸은 바꾸지 않는다.
  function fillDraftFrom(found) {
    const rows = parseDraft($("wordDraft").value);
    const counts = { ko: 0, ipa: 0 };
    const lines = rows.map((r) => {
      const hit = found.get(r.en.toLowerCase());
      if (hit) {
        if (!r.ko) {
          r.ko = hit.ko;
          if (!r.aliases.length) r.aliases = hit.aliases;
          markAiFilled(r.en, { ko: true });
          counts.ko++;
        }
        if (!r.ipa && hit.ipa) {
          r.ipa = hit.ipa;
          markAiFilled(r.en, { ipa: true });
          counts.ipa++;
        }
      }
      return toLine(r);
    });
    $("wordDraft").value = lines.join("\n");
    draftDirty = true;
    if (!draftTextMode) draftToTable();
    else updateWordCount(lines.length);
    return counts;
  }
  async function fillMeanings() {
    if ($("extractWords").disabled) return;
    const rows = parseDraft($("wordDraft").value);
    const targets = [...new Set(rows.filter((r) => r.en && (!r.ko || !r.ipa)).map((r) => r.en))];
    if (!rows.length) {
      $("extractStatus").textContent = "먼저 영어 단어를 넣어 주세요. 영어만 적어 두면 AI 사전이 뜻과 발음을 채워 줘요.";
      return;
    }
    if (!targets.length) {
      $("extractStatus").textContent = "빈 뜻·발음이 없어요. 뜻이나 발음 칸이 비어 있는 단어만 채웁니다.";
      return;
    }
    const odd = targets.find((w) => !WORD_PATTERN.test(w));
    if (odd) {
      $("extractStatus").textContent = `‘${odd}’은(는) 영어 단어로 보이지 않아요. 영어 칸을 확인해 주세요.`;
      return;
    }
    const ai = requireAi("뜻 채우기를 쓰려면 접속 코드를 저장해 주세요.");
    if (!ai) return;
    const batches = [];
    for (let i = 0; i < targets.length; i += DEFINE_BATCH) batches.push(targets.slice(i, i + DEFINE_BATCH));
    const op = startOperation(`AI 사전에서 단어 ${targets.length}개의 뜻·발음을 찾습니다…`);
    try {
      const counts = { ko: 0, ipa: 0 };
      const missing = [], notes = [];
      for (let i = 0; i < batches.length; i++) {
        $("extractStatus").textContent = (batches.length > 1 ? `${i + 1}/${batches.length}묶음 · ` : "") + `AI가 단어 ${batches[i].length}개의 뜻을 찾는 중… (보통 10~30초)`;
        op.deadline("AI 사전", 120000);
        let result;
        try {
          result = await op.step(ai.define(batches[i], op.signal));
        } catch (e) {
          if (e?.status === 404) throw Error("AI 서버가 아직 뜻 채우기를 지원하지 않아요. 보호자가 Worker를 새 버전으로 다시 배포하거나 설정의 서버 주소를 확인해 주세요.");
          throw e;
        }
        if (!op.live()) return;
        const found = new Map();
        for (const w of Array.isArray(result?.words) ? result.words : []) {
          const en = clean(w?.en).toLowerCase(), ko = clean(w?.ko);
          if (en && ko) found.set(en, { ko, ipa: clean(w?.ipa), aliases: (Array.isArray(w?.aliases) ? w.aliases : []).map(clean).filter(Boolean) });
        }
        const added = fillDraftFrom(found);
        counts.ko += added.ko;
        counts.ipa += added.ipa;
        missing.push(...batches[i].filter((w) => !found.has(w.toLowerCase())));
        if (result?.note) notes.push(clean(result.note));
      }
      $("extractStatus").textContent =
        `뜻 ${counts.ko}개 · 발음 ${counts.ipa}개를 AI 사전으로 채웠어요(노란 칸). 사전과 비교해 확인한 뒤 확인란을 체크하고 저장하세요.` +
        (missing.length ? ` · 못 찾은 단어: ${missing.join(", ")}` : "") +
        (notes.length ? " · AI 메모: " + notes.join(" ") : "");
      $("draftWarnings").textContent =
        counts.ko || counts.ipa
          ? "AI 사전이 채운 노란 칸은 틀릴 수 있어요. 교재나 사전과 비교해 고친 뒤 저장하세요."
          : "채운 칸이 없어요. 영어 철자를 확인해 주세요.";
      if (!draftTextMode) $("wordTableWrap").scrollIntoView({ behavior: "smooth", block: "start" });
    } catch (e) {
      if (op.live()) {
        op.fail();
        $("extractStatus").textContent = "뜻을 채우지 못했습니다: " + (e?.message || String(e)) + " 직접 입력해 저장할 수도 있어요.";
      }
    } finally {
      op.end();
    }
  }

  // ---- 상태 문구·저장 버튼 (호출자용) ----
  function setStatus(text) {
    $("extractStatus").textContent = text;
  }
  function setWarning(text) {
    $("draftWarnings").textContent = text;
  }
  function lockSave(on) {
    $("saveSet").disabled = Boolean(on);
  }

  // ---- 붙이기 ----
  function mount(target, options = {}) {
    if (host) throw Error("SetEditor 는 한 페이지에 하나만 붙인다");
    host = target;
    opts = options;
    host.textContent = "";
    host.append(build());
    // 버튼은 프로퍼티 처리기(onclick)로 단다: index.html 의 ‘앱 점검’이 #extractWords.onclick 이 연결됐는지 본다.
    $("photos").onchange = () => {
      if ($("extractWords").disabled) cancelExtract();
      selectedFiles = [...$("photos").files];
      $("camera").value = "";
      renderPhotos(true);
    };
    $("camera").onchange = () => {
      if ($("extractWords").disabled) cancelExtract();
      selectedFiles = [...selectedFiles, ...$("camera").files].slice(0, MAX_PHOTOS);
      $("camera").value = "";
      renderPhotos(true);
    };
    $("pickPhotos").onclick = () => $("photos").click();
    $("takePhoto").onclick = () => $("camera").click();
    $("extractWords").onclick = extractWords;
    $("cancelExtract").onclick = cancelExtract;
    $("fillMeanings").onclick = fillMeanings;
    $("toggleDraftText").onclick = () => setTextMode(!draftTextMode);
    $("addRow").onclick = addRow;
    $("wordDraft").oninput = () => {
      $("confirmed").checked = false;
      draftDirty = true;
      updateWordCount(parseDraft($("wordDraft").value).length);
    };
    $("setName").oninput = () => {
      $("confirmed").checked = false;
    };
    $("saveSet").onclick = save;
    $("closeEditor").onclick = () => {
      if (!confirmDiscard()) return;
      cancelExtract();
      close();
      opts.onClose?.();
    };
    $("renameSet").onclick = startRename;
    $("renameCancel").onclick = () => $("renameBox").classList.add("hidden");
    $("renameSave").onclick = saveRename;
    $("renameInput").onkeydown = (e) => {
      if (e.key === "Enter") $("renameSave").click();
      if (e.key === "Escape") $("renameCancel").click();
    };
    $("deleteSet").onclick = deleteCurrent;
  }

  window.editorOpen = false;
  window.SetEditor = Object.freeze({
    mount,
    open,
    close,
    isOpen: () => editorOpen,
    isDirty: () => editorOpen && draftDirty,
    confirmDiscard,
    setStatus,
    setWarning,
    lockSave,
  });
})();
