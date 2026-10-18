"use strict";
// sets.js — 세트 만들기·수정(단어 표 편집기, 이름 바꾸기, 사진 → AI 서버), 백업/가져오기, 보호자 설정(AI 연결), 설치·서비스워커.
// 시험 진행·기록·화면 전환은 quiz.js 에 있다. 보호자 설정(AI 연결) 동작은 바꾸지 않는다.
let editingId = null,
  extractGeneration = 0,
  photoUrls = [];
let extractAbort = null;
let extractOperation = null;
let draftTextMode = false;
let draftDirty = false;
let selectedFiles = [];
// AI 사전이 채운 칸: 영어(소문자) → { ko?: true, ipa?: true }. 이번 편집 중에만 노란 칸으로 표시한다.
let aiFilled = new Map();
const TABLE_LIMIT = 300;
window.editorOpen = false;
function draftWordCount() {
  return parseDraft($("wordDraft").value).length;
}
function confirmDiscardDraft() {
  if (!window.editorOpen || !draftDirty) return true;
  const n = draftWordCount();
  return confirm(n ? `저장하지 않은 단어 ${n}개가 사라져요. 그래도 나갈까요?` : "저장하지 않은 내용이 사라져요. 그래도 나갈까요?");
}
const status = (text) => {
  $("setStatus").textContent = text;
};
function persistSets(next) {
  if (!storageAvailable) {
    status("저장 자료 오류를 먼저 해결하세요. 기존 자료를 덮어쓰지 않습니다.");
    return false;
  }
  try {
    localStorage.setItem(setsKey, JSON.stringify(next));
    sets = next;
    return true;
  } catch (e) {
    status("저장 실패: 공간 또는 브라우저 설정을 확인하고 JSON으로 백업하세요.");
    return false;
  }
}

// ---- 세트 이름 바꾸기 ----
$("renameSet").onclick = () => {
  if (sessionRunning) return;
  const set = sets.find((s) => s.id === (editingId || activeSetId));
  if (!set) return;
  $("renameInput").value = set.name;
  $("renameBox").classList.remove("hidden");
  $("renameInput").focus();
  $("renameInput").select();
};
$("renameCancel").onclick = () => $("renameBox").classList.add("hidden");
$("renameSave").onclick = () => {
  if (sessionRunning) return;
  const name = $("renameInput").value.trim();
  if (!name || name.length > 120) {
    status("세트 이름을 1~120자로 입력하세요.");
    return;
  }
  const targetId = editingId || activeSetId;
  const next = sets.map((s) => (s.id === targetId ? { ...s, name, updatedAt: new Date().toISOString() } : s));
  if (!persistSets(next)) return;
  if (historyRecords.some((r) => r.setId === targetId && r.setName !== name))
    persistHistory(historyRecords.map((r) => (r.setId === targetId ? { ...r, setName: name } : r)));
  $("renameBox").classList.add("hidden");
  $("setName").value = name;
  populateSets();
  renderHome();
  renderHistory();
  if (typeof queueSetsSync === "function") queueSetsSync(); // family.js
  $("manageStatus").textContent = `이름을 ‘${name}’(으)로 바꿨어요.`;
  status(`이름을 ‘${name}’(으)로 바꿨어요.`);
};
$("renameInput").onkeydown = (e) => {
  if (e.key === "Enter") $("renameSave").click();
  if (e.key === "Escape") $("renameCancel").click();
};

// ---- 편집기 열기·닫기 ----
function releasePhotos() {
  photoUrls.forEach(URL.revokeObjectURL);
  photoUrls = [];
  $("photoPreview").textContent = "";
}
function openEditor(set) {
  if (window.editorOpen && (editingId || null) !== (set?.id || null) && !confirmDiscardDraft()) return;
  if ($("extractWords").disabled) cancelExtract();
  editingId = set?.id || null;
  selectedFiles = [];
  aiFilled = new Map();
  const target = window.editorForChild || null; // family.js: 보호자가 아이에게 보낼 세트를 만들거나 고치는 중
  $("manageBox").classList.toggle("hidden", !set || Boolean(target)); // 아이 세트의 이름 바꾸기·삭제는 아이들 화면에서 한다
  $("manageStatus").textContent = "";
  $("renameBox").classList.add("hidden");
  $("setName").value = set?.name || "새 세트 " + new Date().toLocaleDateString("sv-SE");
  $("setName").placeholder = "예: DAY 05 (161~200)";
  $("wordDraft").value = set
    ? set.words.map((w) => [w.id, w.en, w.ko, w.aliases.join("|"), ...(w.ipa ? [w.ipa] : [])].join("\t")).join("\n")
    : "";
  $("confirmed").checked = false;
  $("photos").value = "";
  $("camera").value = "";
  releasePhotos();
  $("extractStatus").textContent = set ? "" : "사진을 고르거나 찍은 뒤 ‘사진에서 단어 가져오기’를 누르세요. 직접 입력해도 돼요.";
  $("draftWarnings").textContent = "";
  $("editorTitle").textContent = (set ? "✏️ 세트 수정" : "➕ 새 세트 만들기") + (target ? ` → 🧒 ${target.name}에게 보내기` : "");
  window.editorOpen = true;
  setTextMode(false);
  draftDirty = false;
  showView("editor");
}
$("createSet").onclick = () => openEditor();
$("editSet").onclick = () => openEditor(sets.find((s) => s.id === activeSetId));
$("resumeEditor").onclick = () => {
  if (window.editorOpen) showView("editor");
};
function cancelExtract() {
  extractGeneration++;
  extractAbort?.();
  extractAbort = null;
  $("cancelExtract").disabled = true;
  $("extractWords").disabled = false;
  $("fillMeanings").disabled = false;
  $("extractStatus").textContent = "취소했습니다. 다시 시도하거나 아래에 직접 입력하세요.";
}
$("cancelExtract").onclick = cancelExtract;
function finishEditor() {
  window.editorOpen = false;
  draftDirty = false;
  selectedFiles = [];
  releasePhotos();
}
$("closeEditor").onclick = () => {
  if (!confirmDiscardDraft()) return;
  cancelExtract();
  finishEditor();
  if (window.editorForChild && typeof returnToChild === "function") return returnToChild(); // family.js: 보호자는 아이 상세로 돌아간다
  showView("home");
};
function renderPhotos(announce = false) {
  releasePhotos();
  if (announce)
    $("extractStatus").textContent = selectedFiles.length
      ? `사진을 선택했습니다 (${selectedFiles.length}장). ‘사진에서 단어 가져오기’를 누르세요.`
      : "사진을 선택하세요.";
  selectedFiles.forEach((file, index) => {
    const url = URL.createObjectURL(file);
    photoUrls.push(url);
    const box = document.createElement("div");
    box.className = "thumb-box";
    const img = document.createElement("img");
    img.src = url;
    img.alt = file.name;
    img.className = "thumb";
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "thumb-remove";
    remove.textContent = "✕";
    remove.setAttribute("aria-label", `${index + 1}번째 사진 빼기`);
    remove.addEventListener("click", () => {
      selectedFiles.splice(index, 1);
      renderPhotos(true);
    });
    box.append(img, remove);
    $("photoPreview").append(box);
  });
}
$("photos").onchange = () => {
  if ($("extractWords").disabled) cancelExtract();
  selectedFiles = [...$("photos").files];
  $("camera").value = "";
  renderPhotos(true);
};
$("camera").onchange = () => {
  if ($("extractWords").disabled) cancelExtract();
  selectedFiles = [...selectedFiles, ...$("camera").files].slice(0, 10);
  $("camera").value = "";
  renderPhotos(true);
};
$("pickPhotos").onclick = () => $("photos").click();
$("takePhoto").onclick = () => $("camera").click();

// ---- 초안(텍스트) ↔ 단어 표 ----
function parseDraft(text) {
  const rows = text
    .split("\n")
    .filter((l) => l.trim())
    .map((line, i) => {
      let parts = line.split("\t");
      if (parts.length < 3) {
        const match = line.trim().match(/^(?:(\d+)\s+)?([A-Za-z][A-Za-z '-]*?)\s+([가-힣].*)$/);
        parts = match ? [match[1] || String(i + 1), match[2], match[3], ""] : ["" + (i + 1), line, "", ""];
      }
      return {
        id: parts[0].trim(),
        en: parts[1].trim(),
        ko: parts[2].trim(),
        aliases: (parts[3] || "").split("|").map((x) => x.trim()).filter(Boolean),
        ipa: (parts[4] || "").trim(),
        hangul: "",
      };
    });
  return rows;
}
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
      else $("addRow").click();
    });
    td.append(input);
    tr.append(td);
  }
  const td = document.createElement("td");
  const del = document.createElement("button");
  del.type = "button";
  del.className = "btn outline small row-delete";
  del.textContent = "✕";
  del.setAttribute("aria-label", "이 단어 삭제");
  del.addEventListener("click", () => {
    tr.remove();
    tableToDraft();
  });
  td.append(del);
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
  if (!rows.length) {
    const tr = document.createElement("tr");
    tr.className = "empty-row";
    const td = document.createElement("td");
    td.colSpan = 6;
    td.textContent = "아직 단어가 없어요. 사진에서 가져오거나 ‘＋ 단어 추가’를 누르세요.";
    tr.append(td);
    tbody.append(tr);
  }
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
  $("addRow").classList.toggle("hidden", on);
  $("toggleDraftText").textContent = on ? "표로 편집" : "텍스트로 편집";
  if (!on) draftToTable();
}
$("toggleDraftText").onclick = () => setTextMode(!draftTextMode);
$("addRow").onclick = () => {
  if (draftTextMode) return;
  $("wordTableBody").querySelector(".empty-row")?.remove();
  const ids = [...$("wordTableBody").querySelectorAll('[data-key="id"]')].map((i) => Number(i.value)).filter(Number.isInteger);
  const nextId = ids.length ? Math.max(...ids) + 1 : $("wordTableBody").children.length + 1;
  const tr = tableRow({ id: String(nextId) });
  $("wordTableBody").append(tr);
  tr.querySelector(".en").focus();
  $("confirmed").checked = false;
};
$("wordDraft").oninput = () => {
  $("confirmed").checked = false;
  draftDirty = true;
  updateWordCount(parseDraft($("wordDraft").value).length);
};
$("setName").oninput = () => {
  $("confirmed").checked = false;
};

// ---- 저장·삭제 ----
$("saveSet").onclick = () => {
  if (sessionRunning) return;
  const name = $("setName").value.trim(),
    words = parseDraft($("wordDraft").value);
  const duplicates = words.filter((w, i) => words.slice(0, i).some((x) => x.id === w.id || x.en.toLowerCase() === w.en.toLowerCase()));
  if (!name) {
    $("draftWarnings").textContent = "세트 이름을 입력하세요.";
    $("setName").focus();
    return;
  }
  const broken = words.findIndex((w) => !w.id || !w.en || !w.ko);
  if (!words.length || words.length > 2000 || broken >= 0 || duplicates.length) {
    if (!words.length) $("draftWarnings").textContent = "단어가 없어요. 사진에서 가져오거나 ‘＋ 단어 추가’로 넣어 주세요.";
    else if (words.length > 2000) $("draftWarnings").textContent = "단어는 최대 2000개까지 저장할 수 있어요.";
    else if (broken >= 0) {
      const w = words[broken];
      $("draftWarnings").textContent = `${broken + 1}번째 줄: ${!w.id ? "번호" : !w.en ? "영어" : "뜻"}이(가) 비어 있어요.`;
      if (!draftTextMode) $("wordTableBody").querySelectorAll("tr")[broken]?.scrollIntoView({ behavior: "smooth", block: "center" });
    } else {
      const d = duplicates[0];
      const at = words.findIndex((w) => w === d);
      $("draftWarnings").textContent = `${at + 1}번째 줄: ‘${d.en || d.id}’이(가) 앞의 단어와 번호나 영어가 겹쳐요.`;
      if (!draftTextMode) $("wordTableBody").querySelectorAll("tr")[at]?.scrollIntoView({ behavior: "smooth", block: "center" });
    }
    return;
  }
  if (!$("confirmed").checked) {
    $("draftWarnings").textContent = "책과 비교해서 확인했으면 확인란을 체크해 주세요.";
    return;
  }
  const previous = sets.find((s) => s.id === editingId);
  for (const w of words) {
    const old = previous?.words.find((x) => String(x.id) === w.id && x.en === w.en);
    if (old) {
      w.id = old.id;
      w.ipa = w.ipa || old.ipa;
      w.hangul = old.hangul;
    }
  }
  const id = editingId || crypto.randomUUID();
  const set = { id, name, words, updatedAt: new Date().toISOString() };
  if (window.editorForChild && typeof sendSetToChild === "function") return sendSetToChild(set); // family.js: 보호자 → 아이의 세트로 서버에 보낸다
  const others = sets.filter((s) => s.id !== id);
  const index = sets.findIndex((s) => s.id === id);
  const next = index >= 0 ? [...sets.slice(0, index), set, ...sets.slice(index + 1)] : [...others, set];
  if (persistSets(next)) {
    if (previous && previous.name !== name && historyRecords.some((r) => r.setId === id))
      persistHistory(historyRecords.map((r) => (r.setId === id ? { ...r, setName: name } : r)));
    finishEditor();
    selectSet(id);
    showView("home");
    status(`‘${name}’ 세트를 저장했어요 (${words.length}단어). 아래에서 시험을 시작해 보세요.`);
    if (typeof queueSetsSync === "function") queueSetsSync(); // family.js: 연결된 아이의 다른 기기·보호자에게도 같은 세트가 가도록
  }
};
// 마지막 세트도 지울 수 있다(세트 0개 허용). 연결된 아이 기기면 다른 기기에서도 지워진다(family.js 묘비).
$("deleteSet").onclick = () => {
  const targetId = editingId || activeSetId;
  const set = sets.find((s) => s.id === targetId);
  if (!set) return;
  const linked = typeof isLinked === "function" && isLinked();
  const question = linked
    ? `‘${set.name}’ 세트를 삭제할까요? 같은 아이로 연결된 다른 기기에서도 사라져요. 시험 기록은 남아요.`
    : `‘${set.name}’ 세트를 삭제할까요? 단어는 사라지지만 시험 기록은 남아요.`;
  if (confirm(question) && persistSets(sets.filter((s) => s.id !== targetId))) {
    if (typeof noteSetDeleted === "function") noteSetDeleted(targetId);
    finishEditor();
    selectSet(sets[0]?.id ?? null);
    showView("home");
    status(sets.length ? "세트를 삭제했어요." : "세트를 모두 지웠어요. 새 세트를 만들거나 보호자가 보내 주면 여기에 나타나요.");
    if (typeof queueSetsSync === "function") queueSetsSync();
  }
};

// ---- 백업·가져오기 ----
function download(data, name) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
$("exportSets").onclick = () =>
  download(
    {
      version: 2,
      sets,
      history: historyRecords,
      missed: Object.fromEntries(
        sets.map((s) => {
          try {
            return [s.id, JSON.parse(localStorage.getItem("daily_vocab_missed_" + s.id) || "[]")];
          } catch {
            return [s.id, []];
          }
        }),
      ),
    },
    "매일영단어-백업.json",
  );
$("importSets").onchange = async () => {
  try {
    const file = $("importSets").files[0];
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) throw Error("5MB 이하 JSON만 가능합니다");
    const data = JSON.parse(await file.text());
    if (
      data.version !== 2 ||
      !Array.isArray(data.sets) ||
      !data.sets.length ||
      data.sets.length > 100 ||
      !data.sets.every(
        (s) =>
          s &&
          typeof s.id === "string" &&
          typeof s.name === "string" &&
          s.name.length <= 120 &&
          Array.isArray(s.words) &&
          s.words.length > 0 &&
          s.words.length <= 2000 &&
          s.words.every(
            (w) =>
              w &&
              ["string", "number"].includes(typeof w.id) &&
              typeof w.en === "string" &&
              w.en.trim() &&
              typeof w.ko === "string" &&
              w.ko.trim() &&
              Array.isArray(w.aliases) &&
              w.aliases.every((a) => typeof a === "string"),
          ) &&
          new Set(s.words.map((w) => String(w.id))).size === s.words.length,
      ) ||
      new Set(data.sets.map((s) => s.id)).size !== data.sets.length ||
      !Array.isArray(data.history || []) ||
      !(data.history || []).every(validRecord)
    )
      throw Error("백업 형식 또는 단어/이력이 올바르지 않습니다");
    const idMap = new Map(data.sets.map((s) => [s.id, crypto.randomUUID()]));
    const importedAt = new Date().toISOString();
    const imported = data.sets.map((s) => ({ ...s, id: idMap.get(s.id), updatedAt: importedAt })); // 새 수정 시각: 연결된 아이의 다른 기기에도 올라가도록
    if (!persistSets([...sets, ...imported])) return;
    if (typeof queueSetsSync === "function") queueSetsSync(); // family.js
    // 보통 기록은 복사본이라 새 id를 받는다. 서버에서 복원한 요약 기록(restored)은 id를 그대로 두고 이미 있으면 건너뛰어, 뒤에 다시 복원해도 같은 시험이 두 번 생기지 않게 한다.
    const existing = new Set(historyRecords.map((r) => r.id));
    const records = (data.history || [])
      .filter((r) => !(r.restored === true && existing.has(r.id)))
      .map((r) => ({ ...r, id: r.restored === true ? r.id : crypto.randomUUID(), setId: idMap.get(r.setId) || "import-deleted-" + r.setId }));
    const merged = [...records, ...historyRecords].sort((a, b) => Date.parse(b.completedAt) - Date.parse(a.completedAt));
    if (!persistHistory(merged)) status("세트는 가져왔지만 이력 저장에 실패했습니다. 원본 JSON을 보관하세요.");
    let missedFailed = 0;
    for (const s of data.sets) {
      const missed = data.missed?.[s.id];
      if (!Array.isArray(missed)) continue;
      try {
        localStorage.setItem("daily_vocab_missed_" + idMap.get(s.id), JSON.stringify(missed.filter((id) => s.words.some((w) => w.id === id))));
      } catch {
        missedFailed++;
      }
    }
    selectSet(imported[0].id);
    if (missedFailed) status("틀린 단어 목록 일부를 저장하지 못했어요. 저장 공간을 확인하세요.");
    $("backupStatus").textContent = `세트 ${imported.length}개를 복사해 가져왔어요. 기존 세트는 그대로예요.`;
    status("가져온 세트를 선택했어요.");
  } catch (e) {
    $("backupStatus").textContent = "가져오기 실패: " + e.message;
  } finally {
    $("importSets").value = "";
  }
};

// ---- 사진 준비 ----
async function preparePhoto(file) {
  const image = await createImageBitmap(file);
  try {
    const scale = Math.min(1, 2000 / Math.max(image.width, image.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(image.width * scale));
    canvas.height = Math.max(1, Math.round(image.height * scale));
    canvas.getContext("2d").drawImage(image, 0, 0, canvas.width, canvas.height);
    return canvas;
  } finally {
    image.close();
  }
}
function canvasToBase64Jpeg(canvas) {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (!blob) return reject(Error("사진 변환 실패"));
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result).split(",")[1] || "");
        reader.onerror = () => reject(Error("사진 변환 실패"));
        reader.readAsDataURL(blob);
      },
      "image/jpeg",
      0.92,
    );
  });
}

// ---- AI 사진 인식 (Cloudflare Worker 프록시) — 보호자 설정 동작은 변경하지 않는다 ----
// 앱은 Worker 주소와 가족용 접속 코드만 저장한다. Anthropic API 키는 Worker 비밀값에만 있다.
// 설정은 이 브라우저의 localStorage에만 두고 백업 JSON·CSV로 내보내지 않는다.
const AI_STORAGE_KEY = "daily_vocab_ai_v2";
// 배포한 Worker 주소. 보호자는 접속 코드만 입력하면 된다.
const AI_SERVER_DEFAULT = "https://daily-vocab-ai.reonwipe.workers.dev";
try {
  localStorage.removeItem("daily_vocab_ai_v1"); // 이전 버전이 기기에 저장했던 API 키 제거
} catch {}
const clean = (s) => String(s ?? "").replace(/[\t\r\n]+/g, " ").trim();
function normalizeServer(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  try {
    const u = new URL(raw);
    const local = ["localhost", "127.0.0.1"].includes(u.hostname);
    if (u.protocol === "https:" || (u.protocol === "http:" && local)) return u.origin + u.pathname.replace(/\/+$/, "");
  } catch {}
  return null;
}
function savedAi() {
  try {
    const parsed = JSON.parse(localStorage.getItem(AI_STORAGE_KEY) || "null");
    if (parsed && typeof parsed === "object") return parsed;
  } catch {}
  return null;
}
function aiConfig() {
  const saved = savedAi();
  const server = normalizeServer(saved?.server || AI_SERVER_DEFAULT);
  // 보호자 폰은 AI 연결에 코드를 따로 넣지 않아도 보호자 코드로 사진 인식·AI 사전을 쓴다(Worker가 보호자 코드를 가족 코드가 통하는 곳에 모두 허용).
  const passcode = (typeof saved?.passcode === "string" ? saved.passcode.trim() : "") || (typeof family === "object" && family?.parentCode) || "";
  return server && passcode ? { server, passcode } : null;
}
function storeAi(next) {
  try {
    localStorage.setItem(AI_STORAGE_KEY, JSON.stringify(next));
    return true;
  } catch {
    $("aiStatus").textContent = "저장 실패: 브라우저 저장 공간 또는 설정을 확인하세요.";
    return false;
  }
}
function renderAiSettings() {
  const config = aiConfig();
  $("aiServer").value = savedAi()?.server || AI_SERVER_DEFAULT;
  $("aiPasscode").value = "";
  $("aiState").textContent = config ? "연결 설정됨" : "설정 필요";
  $("clearAi").disabled = !config;
  $("testAi").disabled = !config;
}
$("saveAi").onclick = () => {
  const server = normalizeServer($("aiServer").value);
  const passcode = $("aiPasscode").value.trim() || savedAi()?.passcode || "";
  if (!server) {
    $("aiStatus").textContent = "AI 서버 주소를 https:// 로 시작하는 Worker 주소로 입력하세요.";
    return;
  }
  if (passcode.length < 4) {
    $("aiStatus").textContent = "접속 코드를 4자 이상 입력하세요.";
    return;
  }
  if (!storeAi({ server, passcode })) return;
  renderAiSettings();
  if (typeof onAiSettingsSaved === "function") onAiSettingsSaved(); // family.js: 설정 갱신 + 링크로 받아 둔 아이 코드 자동 연결
  $("aiStatus").textContent =
    "저장했습니다. ‘연결 확인’을 눌러 AI 서버가 응답하는지 확인해 보세요." +
    (window.editorOpen ? " 편집 중이던 세트는 홈의 ‘편집 중인 세트로 돌아가기’에서 이어집니다." : "");
  renderHome();
};
$("clearAi").onclick = () => {
  localStorage.removeItem(AI_STORAGE_KEY);
  renderAiSettings();
  if (typeof renderFamilySettings === "function") renderFamilySettings();
  $("aiStatus").textContent = "AI 연결 설정을 삭제했습니다.";
};
function describeAiError(status, payload) {
  const message = typeof payload?.message === "string" ? payload.message : "";
  if (status === 401) return "접속 코드가 맞지 않습니다. 보호자 설정에서 다시 입력하세요.";
  if (status === 403) return "이 주소에서는 AI 서버를 쓸 수 없습니다. 보호자가 Worker의 ALLOWED_ORIGINS를 확인해 주세요.";
  if (status === 404) return "AI 서버 주소가 올바르지 않습니다. 보호자 설정을 확인하세요.";
  if (message) return message;
  if (status === 429) return "요청이 너무 많습니다. 잠시 후 다시 시도하세요.";
  return `AI 서버 오류 ${status}`;
}
async function aiRequest(config, path, body, signal) {
  let response;
  try {
    response = await fetch(config.server + path, {
      method: "POST",
      headers: { "content-type": "application/json", "x-app-passcode": config.passcode },
      body: JSON.stringify(body),
      signal,
    });
  } catch (e) {
    if (e?.name === "AbortError") throw Error("요청이 취소되었거나 시간이 초과됐습니다");
    throw Error("AI 서버에 연결하지 못했습니다. 인터넷 연결과 서버 주소를 확인하세요.");
  }
  let payload = null;
  try {
    payload = await response.json();
  } catch {}
  if (response.status === 200 && payload) return payload;
  const error = Error(describeAiError(response.status, payload));
  error.status = response.status;
  throw error;
}
$("testAi").onclick = async () => {
  const config = aiConfig();
  if (!config) return;
  $("testAi").disabled = true;
  $("aiStatus").textContent = "AI 서버에 연결을 확인하는 중…";
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30000);
  try {
    const result = await aiRequest(config, "/ping", {}, controller.signal);
    $("aiStatus").textContent = "연결 성공" + (result?.model ? " · " + result.model : "");
  } catch (e) {
    $("aiStatus").textContent = "연결 실패: " + e.message;
  } finally {
    clearTimeout(timer);
    $("testAi").disabled = false;
  }
};
function markAiFilled(en, fields) {
  const key = String(en || "").trim().toLowerCase();
  if (!key) return;
  const marks = aiFilled.get(key) || {};
  for (const field of Object.keys(fields)) if (fields[field]) marks[field] = true;
  aiFilled.set(key, marks);
}
// 가져온 단어를 초안에 추가한다. 인쇄된 번호가 있으면 쓰고, 없거나 겹치면 이어서 번호를 매긴다.
// 사진에 뜻이 없어 AI가 채운 단어(generated)는 노란 칸으로 표시한다.
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
  appendDraftRows.skipped = rows.length - fresh.length;
  const lines = fresh.map((r) => {
    let id = r.number > 0 ? String(r.number) : "";
    if (!id || used.has(id)) {
      do next++;
      while (used.has(String(next)));
      id = String(next);
    }
    used.add(id);
    if (r.generated) markAiFilled(r.en, { ko: true, ipa: Boolean(r.ipa) });
    return [id, r.en, r.ko, (r.aliases || []).join("|"), ...(r.ipa ? [r.ipa] : [])].join("\t");
  });
  appendDraftRows.generated = fresh.filter((r) => r.generated).length;
  $("wordDraft").value = [...existing, ...lines].join("\n");
  draftDirty = true;
  if (!draftTextMode) draftToTable();
  else updateWordCount(existing.length + lines.length);
  return lines.length;
}
// ---- 2차 채점(quiz.js의 grade가 부른다): 책의 뜻과 글자가 다른 답을 AI가 ‘같은 뜻인지’ 판정 ----
// AI 서버가 설정된 기기에서, 기기 채점이 오답인 답에 대해서만 부른다. 실패·시간 초과(8초)·옛 Worker(404)면 null → 오답 그대로.
const GRADE_TIMEOUT_MS = 8000;
async function judgeMeaning(word, answer) {
  const config = aiConfig();
  if (!config) return null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), GRADE_TIMEOUT_MS);
  try {
    const result = await aiRequest(config, "/grade", { en: word.en, ko: word.ko, aliases: word.aliases.slice(0, 30), answer: String(answer).slice(0, 100) }, controller.signal);
    if (typeof result?.accept !== "boolean") return null;
    return { accept: result.accept, reason: typeof result.reason === "string" ? result.reason.slice(0, 60) : "" };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
judgeMeaning.available = () => Boolean(aiConfig()) && navigator.onLine !== false;

// ---- AI 작업 공통(사진 인식·빈 뜻 채우기): 한 번에 하나만, 취소·시간 초과·버튼 잠금 ----
// 사전에 물어볼 수 있는 영어: 영문자로 시작하는 단어·짧은 구(공백, 마침표, 하이픈, 아포스트로피, 40자 이하). Worker와 같은 규칙.
const WORD_PATTERN = /^[A-Za-z][A-Za-z .'’-]{0,39}$/;
const DEFINE_BATCH = 40;
function requireAiConfig(reason) {
  const config = aiConfig();
  if (config) return config;
  $("extractStatus").textContent = "먼저 설정 → ‘보호자 설정 · AI 연결’에서 AI 서버 주소와 접속 코드를 입력하세요.";
  showView("settings");
  $("aiSettings").open = true;
  $("aiStatus").textContent = reason;
  $("aiSettings").scrollIntoView({ behavior: "smooth", block: "center" });
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
$("extractWords").onclick = async () => {
  const files = selectedFiles.slice();
  if (!files.length || files.length > 10 || files.some((f) => !f.type.startsWith("image/") || f.size > 10 * 1024 * 1024)) {
    $("extractStatus").textContent = `사진 ${files.length}장을 선택했습니다. 한 번에 1~10장, 장당 최대 10MB의 이미지 파일을 선택하세요.`;
    return;
  }
  const config = requireAiConfig("사진 인식을 쓰려면 접속 코드를 저장해 주세요.");
  if (!config) return;
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
      const result = await op.step(aiRequest(config, "/recognize", { image, mediaType: "image/jpeg" }, op.signal));
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
      generatedTotal += appendDraftRows.generated;
      const generated = appendDraftRows.generated ? ` (뜻 ${appendDraftRows.generated}개는 사진에 없어 AI 사전으로 채움)` : "";
      const skipped = appendDraftRows.skipped ? ` · 이미 있는 단어 ${appendDraftRows.skipped}개 건너뜀` : "";
      $("extractStatus").textContent = `${i + 1}/${files.length}장 완료 · 단어 ${added}개 추가${generated}${skipped} · 책과 비교해 고친 뒤 확인란을 체크하고 저장하세요.`;
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
};

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
    return [r.id, r.en, r.ko, r.aliases.join("|"), ...(r.ipa ? [r.ipa] : [])].join("\t");
  });
  $("wordDraft").value = lines.join("\n");
  draftDirty = true;
  if (!draftTextMode) draftToTable();
  else updateWordCount(lines.length);
  return counts;
}
$("fillMeanings").onclick = async () => {
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
  const config = requireAiConfig("뜻 채우기를 쓰려면 접속 코드를 저장해 주세요.");
  if (!config) return;
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
        result = await op.step(aiRequest(config, "/define", { words: batches[i] }, op.signal));
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
};

// ---- 설치·서비스워커 ----
let installPrompt;
window.addEventListener("beforeinstallprompt", (e) => {
  e.preventDefault();
  installPrompt = e;
  $("installApp").classList.remove("hidden");
});
$("installApp").onclick = async () => {
  if (installPrompt) {
    await installPrompt.prompt();
    installPrompt = null;
    $("installApp").classList.add("hidden");
  }
};
if ("serviceWorker" in navigator)
  navigator.serviceWorker
    .register("./sw.js")
    .then((reg) => {
      reg.addEventListener("updatefound", () => {
        const worker = reg.installing;
        worker?.addEventListener("statechange", () => {
          if (worker.state === "installed" && navigator.serviceWorker.controller)
            status("새 버전이 준비됐습니다. 시험을 마친 후 앱을 닫고 다시 열어 주세요.");
        });
      });
    })
    .catch(() => ($("backupStatus").textContent = "오프라인용 앱 저장은 이 브라우저에서 지원되지 않아요. 인터넷 연결 상태에서는 그대로 쓸 수 있어요."));
renderAiSettings();
renderHome();
// ---- 단어 찾기 (🔍 찾기 탭): AI 사전으로 뜻·발음·예문을 보여 주고 ‘찾아본 단어’ 세트에 넣는다 ----
// 저장 키 daily_vocab_lookups_v1 = [{en, ko, ipa, pos, aliases, examples:[{en,ko}], similar, note, firstAt, lastAt, count}] (최신순, 최대 500, 이 기기에만).
// 찾아본 단어 세트: id "lookup", 이름 ‘찾아본 단어’. 보통 세트라 시험·틀린 단어 복습·세트 동기화·보호자 화면에 그대로 보인다.
// 같은 단어를 다시 찾으면 AI를 부르지 않고 저장된 결과를 보여 주며 횟수만 올린다. 시험 중에는 탭이 숨어 쓸 수 없다.
const LOOKUPS_KEY = "daily_vocab_lookups_v1";
const LOOKUP_SET_ID = "lookup";
const LOOKUP_SET_NAME = "찾아본 단어";
const LOOKUP_LIMIT = 500;
const LOOKUP_TIMEOUT_MS = 30000;
const lookupKey = (en) => String(en || "").trim().toLowerCase();
function readLookups() {
  try {
    const saved = JSON.parse(localStorage.getItem(LOOKUPS_KEY) || "[]");
    return Array.isArray(saved) ? saved.filter((x) => x && typeof x.en === "string" && typeof x.ko === "string").slice(0, LOOKUP_LIMIT) : [];
  } catch {
    return [];
  }
}
let lookups = readLookups();
let lookupBusy = false;
let currentLookup = null;
function writeLookups() {
  try {
    localStorage.setItem(LOOKUPS_KEY, JSON.stringify(lookups));
  } catch {}
}
function rememberLookup(entry) {
  const key = lookupKey(entry.en), now = new Date().toISOString();
  const existing = lookups.find((x) => lookupKey(x.en) === key);
  const next = existing
    ? { ...existing, ...entry, firstAt: existing.firstAt || now, lastAt: now, count: (existing.count || 1) + 1 }
    : { ...entry, firstAt: now, lastAt: now, count: 1 };
  lookups = [next, ...lookups.filter((x) => lookupKey(x.en) !== key)].slice(0, LOOKUP_LIMIT);
  writeLookups();
  return next;
}
// 찾은 단어를 ‘찾아본 단어’ 세트에 넣는다(세트가 없으면 만들고, 이미 있는 단어면 그대로). 돌려주는 값: {number, added, failed?}.
function addToLookupSet(entry) {
  const existing = sets.find((s) => s.id === LOOKUP_SET_ID);
  const words = existing ? existing.words : [];
  const found = words.find((w) => lookupKey(w.en) === lookupKey(entry.en));
  if (found) return { number: found.id, added: false };
  const nextId = words.reduce((m, w) => Math.max(m, Number.isInteger(Number(w.id)) ? Number(w.id) : 0), 0) + 1;
  const aliases = entry.aliases?.length ? entry.aliases : entry.ko.split(/[·,;|]/).map((s) => s.trim()).filter(Boolean);
  const word = { id: nextId, en: entry.en, ko: entry.ko, ipa: entry.ipa || "", hangul: "", aliases };
  const set = { id: LOOKUP_SET_ID, name: existing?.name || LOOKUP_SET_NAME, words: [...words, word], updatedAt: new Date().toISOString() };
  if (!persistSets(existing ? sets.map((s) => (s.id === LOOKUP_SET_ID ? set : s)) : [...sets, set])) return { number: nextId, added: false, failed: true };
  if (!activeSetId) selectSet(LOOKUP_SET_ID); // 세트가 하나도 없던 기기: 이 세트가 첫 세트가 된다
  else {
    if (activeSetId === LOOKUP_SET_ID) WORDS = set.words;
    populateSets();
  }
  if (typeof queueSetsSync === "function") queueSetsSync(); // family.js: 연결된 아이의 다른 기기·보호자 폰에도
  return { number: nextId, added: true };
}
function speakEnglish(text) {
  if (!("speechSynthesis" in window)) {
    setFeedback($("lookupStatus"), "bad", "이 브라우저에는 음성 읽기 기능이 없어요.");
    return;
  }
  const synth = window.speechSynthesis;
  synth.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.lang = "en-US";
  u.rate = 0.85;
  const v = synth.getVoices().find((x) => x.lang.toLowerCase().startsWith("en-us"));
  if (v) u.voice = v;
  synth.speak(u);
}
function lookupSetNumber(en) {
  return sets.find((s) => s.id === LOOKUP_SET_ID)?.words.find((w) => lookupKey(w.en) === lookupKey(en))?.id ?? null;
}
function renderLookupResult(entry, saved) {
  currentLookup = entry;
  $("lookupResult").classList.remove("hidden");
  $("lookupWord").textContent = entry.en + (entry.pos ? ` (${entry.pos})` : "");
  $("lookupIpa").textContent = entry.ipa ? `발음 /${entry.ipa}/` : "";
  $("lookupMeaning").textContent = entry.ko;
  const ul = $("lookupExamples");
  ul.textContent = "";
  for (const ex of entry.examples || []) {
    const li = document.createElement("li");
    li.textContent = ex.en;
    const ko = document.createElement("small");
    ko.textContent = ex.ko;
    li.append(ko);
    ul.append(li);
  }
  $("lookupSimilar").textContent = entry.similar?.length ? "비슷한 말: " + entry.similar.join(", ") : "";
  $("lookupNote").textContent = entry.note || "";
  const saveText = saved.failed
    ? `‘${LOOKUP_SET_NAME}’ 세트에 저장하지 못했어요. 저장 공간을 확인하세요.`
    : saved.added
      ? `‘${LOOKUP_SET_NAME}’ 세트에 ${saved.number}번으로 넣었어요. 홈에서 이 세트로 시험을 볼 수 있어요.`
      : `‘${LOOKUP_SET_NAME}’ 세트 ${saved.number ?? "?"}번에 이미 있어요 · ${entry.count || 1}번째 찾기`;
  setFeedback($("lookupSaved"), saved.failed ? "bad" : "good", saveText);
}
// 찾기 탭을 열 때와 목록이 바뀔 때. 최근 50개만 그린다.
function renderLookup() {
  $("lookupCount").textContent = lookups.length + "개";
  $("lookupQuiz").disabled = sessionRunning || !sets.some((s) => s.id === LOOKUP_SET_ID && s.words.length);
  const box = $("lookupRecent");
  box.textContent = "";
  renderTutorHistory();
  if (!lookups.length) {
    box.textContent = "아직 찾아본 단어가 없어요. 위에서 단어를 찾으면 여기에 쌓여요.";
    return;
  }
  for (const x of lookups.slice(0, 50)) {
    const row = document.createElement("div");
    row.className = "lookup-row";
    const main = document.createElement("div");
    main.className = "row-main";
    const en = document.createElement("strong");
    en.textContent = x.en;
    const ko = document.createElement("span");
    ko.textContent = x.ko;
    const meta = document.createElement("small");
    meta.textContent = (x.ipa ? `/${x.ipa}/ · ` : "") + `${x.count || 1}번 · ${new Date(x.lastAt).toLocaleDateString("ko-KR")}`;
    main.append(en, ko, meta);
    main.addEventListener("click", () => {
      $("lookupInput").value = x.en;
      renderLookupResult(x, { number: lookupSetNumber(x.en), added: false });
      window.scrollTo({ top: 0, behavior: "smooth" });
    });
    row.append(main);
    if (x.examples?.length) {
      const d = document.createElement("details"), s = document.createElement("summary");
      s.textContent = "예문 보기";
      d.append(s);
      for (const ex of x.examples) {
        const p = document.createElement("p");
        p.textContent = ex.en;
        const k = document.createElement("small");
        k.textContent = " — " + ex.ko;
        p.append(k);
        d.append(p);
      }
      row.append(d);
    }
    box.append(row);
  }
}
async function lookupWord(raw) {
  if (lookupBusy) return;
  const word = String(raw || "").trim().replace(/\s+/g, " ");
  const out = $("lookupStatus");
  if (!word) {
    setFeedback(out, "bad", "찾을 영어 단어를 입력하거나 말해 주세요.");
    return;
  }
  if (!WORD_PATTERN.test(word)) {
    setFeedback(out, "bad", "영어 단어나 짧은 구만 찾을 수 있어요(영문자로 시작, 40자 이하).");
    return;
  }
  const cached = lookups.find((x) => lookupKey(x.en) === lookupKey(word));
  if (cached) {
    const entry = rememberLookup(cached);
    renderLookupResult(entry, addToLookupSet(entry));
    setFeedback(out, "info", "전에 찾아본 단어라 바로 보여 줘요.");
    renderLookup();
    return;
  }
  const config = aiConfig();
  if (!config) {
    setFeedback(out, "bad", "AI 사전을 쓰려면 보호자가 설정 → ‘보호자 설정 · AI 연결’에서 접속 코드를 저장해야 해요.");
    return;
  }
  lookupBusy = true;
  $("lookupGo").disabled = true;
  setFeedback(out, "info", `‘${word}’을(를) AI 사전에서 찾는 중…`);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), LOOKUP_TIMEOUT_MS);
  try {
    const r = await aiRequest(config, "/lookup", { word }, controller.signal);
    const ko = typeof r?.ko === "string" ? clean(r.ko) : "";
    if (!r?.found || !ko) {
      const suggestion = typeof r?.suggestion === "string" ? clean(r.suggestion) : "";
      $("lookupResult").classList.add("hidden");
      if (suggestion && WORD_PATTERN.test(suggestion)) $("lookupInput").value = suggestion; // 철자 제안을 입력칸에 넣어 ‘찾기’만 누르면 되게
      setFeedback(out, "bad", `‘${word}’의 뜻을 찾지 못했어요.` + (suggestion ? ` 혹시 ‘${suggestion}’인가요? 입력칸에 넣어 두었으니 ‘찾기’를 눌러 보세요.` : " 철자를 확인해 주세요.") + (r?.note ? " " + clean(r.note) : ""));
      return;
    }
    const entry = rememberLookup({
      en: clean(r.en) || word,
      ko,
      ipa: clean(r.ipa),
      pos: clean(r.pos),
      aliases: (Array.isArray(r.aliases) ? r.aliases : []).map(clean).filter(Boolean).slice(0, 10),
      examples: (Array.isArray(r.examples) ? r.examples : []).filter((e) => e && typeof e.en === "string" && typeof e.ko === "string").map((e) => ({ en: clean(e.en), ko: clean(e.ko) })).filter((e) => e.en && e.ko).slice(0, 3),
      similar: (Array.isArray(r.similar) ? r.similar : []).map(clean).filter(Boolean).slice(0, 4),
      note: clean(r.note),
    });
    renderLookupResult(entry, addToLookupSet(entry));
    setFeedback(out, "good", `‘${entry.en}’을(를) 찾았어요.`);
    renderLookup();
  } catch (e) {
    setFeedback(out, "bad", "찾지 못했어요: " + (e?.message || e) + (e?.status === 404 ? " 보호자가 Worker를 새 버전으로 다시 배포해 주세요." : ""));
  } finally {
    clearTimeout(timer);
    lookupBusy = false;
    $("lookupGo").disabled = false;
  }
}
$("lookupGo").onclick = () => lookupWord($("lookupInput").value);
$("lookupInput").addEventListener("keydown", (e) => {
  if (e.isComposing || e.keyCode === 229) return;
  if (e.key === "Enter") lookupWord($("lookupInput").value);
});
$("lookupMic").onclick = () =>
  startRecognition("en-US", $("lookupStatus"), $("lookupMic"), (transcript) => {
    $("lookupInput").value = transcript;
    lookupWord(transcript);
  });
$("lookupHear").onclick = () => currentLookup && speakEnglish(currentLookup.en);
$("lookupQuiz").onclick = () => {
  if (sessionRunning || !sets.some((s) => s.id === LOOKUP_SET_ID)) return;
  selectSet(LOOKUP_SET_ID);
  showView("home");
  status(`‘${LOOKUP_SET_NAME}’ 세트를 골랐어요. 방식과 범위를 고르고 ▶ 시작을 누르세요.`);
};

// ---- 문제 물어보기 (🔍 찾기 탭): 문제지 사진 + 도움 종류 → Worker /tutor → 요약·해석·풀이·어법·정답(접힘)·단어 후보 ----
// 저장 키 daily_vocab_tutor_v1 = [{id, kind, question, problem, summary, translation, steps, grammar, answer, checked, words, note, askedAt}] (최신순, 최대 100, 이 기기에만).
// 사진은 읽는 동안만 전송하고 저장하지 않는다. 연결된 아이 기기는 요청에 child.id 를 넣어 Worker가 질문 요약(사진 없음)을 보호자용으로 남긴다.
const TUTOR_KEY = "daily_vocab_tutor_v1";
const TUTOR_LIMIT = 100;
const TUTOR_TIMEOUT_MS = 120000;
const TUTOR_KIND_LABELS = { explain: "풀이 설명", translate: "해석", grammar: "어법 설명", check: "내 답 확인", ask: "직접 질문" };
function readTutorHistory() {
  try {
    const saved = JSON.parse(localStorage.getItem(TUTOR_KEY) || "[]");
    return Array.isArray(saved) ? saved.filter((x) => x && typeof x.id === "string" && typeof x.askedAt === "string").slice(0, TUTOR_LIMIT) : [];
  } catch {
    return [];
  }
}
let tutorHistory = readTutorHistory();
let tutorFile = null, tutorKind = "explain", tutorAbort = null, tutorPreviewUrl = "";
function writeTutorHistory() {
  try {
    localStorage.setItem(TUTOR_KEY, JSON.stringify(tutorHistory));
  } catch {}
}
function setTutorFile(file) {
  tutorFile = file || null;
  if (tutorPreviewUrl) {
    URL.revokeObjectURL(tutorPreviewUrl);
    tutorPreviewUrl = "";
  }
  const box = $("tutorPreview");
  box.textContent = "";
  if (!tutorFile) return;
  tutorPreviewUrl = URL.createObjectURL(tutorFile);
  const img = document.createElement("img");
  img.className = "thumb";
  img.src = tutorPreviewUrl;
  img.alt = "문제 사진";
  box.append(img);
  setFeedback($("tutorStatus"), "info", "사진을 선택했어요. 도움 종류를 고르고 ‘물어보기’를 누르세요.");
}
$("tutorPick").onclick = () => $("tutorPhoto").click();
$("tutorShoot").onclick = () => $("tutorCamera").click();
$("tutorPhoto").onchange = () => {
  setTutorFile($("tutorPhoto").files[0]);
  $("tutorPhoto").value = "";
};
$("tutorCamera").onchange = () => {
  setTutorFile($("tutorCamera").files[0]);
  $("tutorCamera").value = "";
};
document.querySelectorAll(".tutor-kinds .kind").forEach((b) =>
  b.addEventListener("click", () => {
    tutorKind = b.dataset.kind;
    document.querySelectorAll(".tutor-kinds .kind").forEach((x) => {
      const on = x === b;
      x.classList.toggle("active", on);
      x.setAttribute("aria-pressed", String(on));
    });
  }),
);
function renderTutorAnswer(a) {
  $("tutorAnswer").classList.remove("hidden");
  $("tutorProblem").textContent = [a.problem, TUTOR_KIND_LABELS[a.kind] || a.kind, a.question ? `질문: ${a.question}` : ""].filter(Boolean).join(" · ");
  $("tutorSummary").textContent = a.summary || "";
  $("tutorTranslationBox").classList.toggle("hidden", !a.translation);
  $("tutorTranslation").textContent = a.translation || "";
  const ol = $("tutorSteps");
  ol.textContent = "";
  for (const s of a.steps || []) {
    const li = document.createElement("li");
    li.textContent = s;
    ol.append(li);
  }
  $("tutorGrammarBox").classList.toggle("hidden", !(a.grammar || []).length);
  const ul = $("tutorGrammar");
  ul.textContent = "";
  for (const g of a.grammar || []) {
    const li = document.createElement("li");
    li.textContent = g;
    ul.append(li);
  }
  $("tutorChecked").classList.toggle("hidden", !a.checked);
  $("tutorChecked").textContent = a.checked || "";
  $("tutorAnswerBox").open = false; // 정답은 접어 둔다: 먼저 생각하고 연다
  $("tutorAnswerText").textContent = a.answer || "";
  const chips = $("tutorWords");
  chips.textContent = "";
  for (const w of a.words || []) {
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = "chip";
    const inSet = lookupSetNumber(w.en) !== null;
    chip.textContent = `${w.en} — ${w.ko}${inSet ? " ✓" : ""}`;
    chip.disabled = inSet;
    chip.addEventListener("click", () => {
      const entry = rememberLookup({ en: w.en, ko: w.ko, ipa: "", pos: "", aliases: [], examples: [], similar: [], note: "" });
      const saved = addToLookupSet(entry);
      chip.textContent = `${w.en} — ${w.ko} ✓`;
      chip.disabled = true;
      renderLookup();
      setFeedback($("tutorStatus"), "good", `‘${w.en}’을(를) ‘${LOOKUP_SET_NAME}’ 세트 ${saved.number}번에 넣었어요.`);
    });
    chips.append(chip);
  }
  if (!(a.words || []).length) chips.textContent = "어려운 단어 후보가 없어요.";
  $("tutorNote").textContent = a.note || "";
}
function renderTutorHistory() {
  $("tutorCount").textContent = tutorHistory.length + "개";
  const box = $("tutorHistory");
  box.textContent = "";
  if (!tutorHistory.length) {
    box.textContent = "아직 물어본 문제가 없어요.";
    return;
  }
  for (const h of tutorHistory.slice(0, 30)) {
    const row = document.createElement("div");
    row.className = "lookup-row";
    const main = document.createElement("div");
    main.className = "row-main";
    const title = document.createElement("strong");
    title.textContent = h.problem || "(문제)";
    const kind = document.createElement("span");
    kind.textContent = (TUTOR_KIND_LABELS[h.kind] || h.kind) + (h.question ? ` · ${h.question}` : "");
    const meta = document.createElement("small");
    meta.textContent = new Date(h.askedAt).toLocaleString("ko-KR", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });
    main.append(title, kind, meta);
    main.addEventListener("click", () => {
      renderTutorAnswer(h);
      $("tutorAnswer").scrollIntoView({ behavior: "smooth", block: "start" });
    });
    row.append(main);
    box.append(row);
  }
}
async function askTutor() {
  if (tutorAbort) return;
  const out = $("tutorStatus");
  if (!tutorFile) {
    setFeedback(out, "bad", "먼저 문제 사진을 고르거나 찍어 주세요.");
    return;
  }
  const config = aiConfig();
  if (!config) {
    setFeedback(out, "bad", "AI 선생님을 쓰려면 보호자가 설정 → ‘보호자 설정 · AI 연결’에서 접속 코드를 저장해야 해요.");
    return;
  }
  const question = $("tutorQuestion").value.trim().slice(0, 300);
  const kind = question && tutorKind === "explain" ? "ask" : tutorKind;
  const controller = new AbortController();
  let timedOut = false;
  tutorAbort = () => controller.abort();
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, TUTOR_TIMEOUT_MS);
  $("tutorAsk").disabled = true;
  $("tutorCancel").disabled = false;
  setFeedback(out, "info", "사진을 읽고 설명을 만드는 중… (10~30초 걸려요)");
  try {
    const image = await canvasToBase64Jpeg(await preparePhoto(tutorFile));
    if (controller.signal.aborted) throw Error("취소");
    const linked = typeof isLinked === "function" && isLinked() && typeof family === "object" && family?.childId;
    const r = await aiRequest(config, "/tutor", { image, mediaType: "image/jpeg", kind, question, ...(linked ? { child: { id: family.childId } } : {}) }, controller.signal);
    const entry = {
      id: crypto.randomUUID(),
      kind: typeof r.kind === "string" ? r.kind : kind,
      question,
      problem: clean(r.problem),
      summary: clean(r.summary),
      translation: typeof r.translation === "string" ? r.translation.trim() : "",
      steps: (Array.isArray(r.steps) ? r.steps : []).map(clean).filter(Boolean),
      grammar: (Array.isArray(r.grammar) ? r.grammar : []).map(clean).filter(Boolean),
      answer: clean(r.answer),
      checked: clean(r.checked),
      words: (Array.isArray(r.words) ? r.words : []).filter((w) => w && typeof w.en === "string" && typeof w.ko === "string").map((w) => ({ en: clean(w.en), ko: clean(w.ko) })).filter((w) => w.en && w.ko),
      note: clean(r.note),
      askedAt: new Date().toISOString(),
    };
    tutorHistory = [entry, ...tutorHistory].slice(0, TUTOR_LIMIT);
    writeTutorHistory();
    renderTutorAnswer(entry);
    renderTutorHistory();
    setFeedback(out, "good", "설명을 준비했어요. 먼저 풀이를 읽고 답을 정한 뒤 ‘정답 보기’를 열어 보세요.");
    $("tutorAnswer").scrollIntoView({ behavior: "smooth", block: "start" });
  } catch (e) {
    setFeedback(
      out,
      "bad",
      timedOut
        ? "시간이 너무 오래 걸려 멈췄어요. 문제 하나만 나오게 찍어 다시 시도해 주세요."
        : controller.signal.aborted
          ? "취소했어요."
          : "설명을 만들지 못했어요: " + (e?.message || e) + (e?.status === 404 ? " 보호자가 Worker를 새 버전으로 다시 배포해 주세요." : ""),
    );
  } finally {
    clearTimeout(timer);
    tutorAbort = null;
    $("tutorAsk").disabled = false;
    $("tutorCancel").disabled = true;
  }
}
$("tutorAsk").onclick = askTutor;
$("tutorCancel").onclick = () => tutorAbort?.();

if (typeof initFamily === "function") initFamily(); // family.js: 가족 기록함(아이 이름·기록 보내기·아이들 탭)

if (window.markVocabAppReady) window.markVocabAppReady();
