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
  $("manageBox").classList.toggle("hidden", !set);
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
  $("editorTitle").textContent = set ? "✏️ 세트 수정" : "➕ 새 세트 만들기";
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
  $("extractStatus").textContent = "취소했습니다. 다시 시도하거나 아래에 직접 입력하세요.";
}
$("cancelExtract").onclick = cancelExtract;
$("closeEditor").onclick = () => {
  if (!confirmDiscardDraft()) return;
  cancelExtract();
  releasePhotos();
  window.editorOpen = false;
  draftDirty = false;
  selectedFiles = [];
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
  const others = sets.filter((s) => s.id !== id);
  const index = sets.findIndex((s) => s.id === id);
  const next = index >= 0 ? [...sets.slice(0, index), set, ...sets.slice(index + 1)] : [...others, set];
  if (persistSets(next)) {
    if (previous && previous.name !== name && historyRecords.some((r) => r.setId === id))
      persistHistory(historyRecords.map((r) => (r.setId === id ? { ...r, setName: name } : r)));
    window.editorOpen = false;
    draftDirty = false;
    selectedFiles = [];
    releasePhotos();
    selectSet(id);
    showView("home");
    status(`‘${name}’ 세트를 저장했어요 (${words.length}단어). 아래에서 시험을 시작해 보세요.`);
  }
};
$("deleteSet").onclick = () => {
  const targetId = editingId || activeSetId;
  if (sets.length === 1) {
    $("manageStatus").textContent = "마지막 세트는 삭제할 수 없어요. 새 세트를 먼저 만들어 주세요.";
    return;
  }
  const set = sets.find((s) => s.id === targetId);
  if (confirm(`‘${set?.name}’ 세트를 삭제할까요? 단어는 사라지지만 시험 기록은 남아요.`) && persistSets(sets.filter((s) => s.id !== targetId))) {
    window.editorOpen = false;
    draftDirty = false;
    releasePhotos();
    selectSet(sets[0].id);
    showView("home");
    status("세트를 삭제했어요.");
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
    const imported = data.sets.map((s) => ({ ...s, id: idMap.get(s.id) }));
    if (!persistSets([...sets, ...imported])) return;
    const records = (data.history || []).map((r) => ({ ...r, id: crypto.randomUUID(), setId: idMap.get(r.setId) || "import-deleted-" + r.setId }));
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
  const passcode = typeof saved?.passcode === "string" ? saved.passcode.trim() : "";
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
  $("aiStatus").textContent =
    "저장했습니다. ‘연결 확인’을 눌러 AI 서버가 응답하는지 확인해 보세요." +
    (window.editorOpen ? " 편집 중이던 세트는 홈의 ‘편집 중인 세트로 돌아가기’에서 이어집니다." : "");
  renderHome();
};
$("clearAi").onclick = () => {
  localStorage.removeItem(AI_STORAGE_KEY);
  renderAiSettings();
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
  throw Error(describeAiError(response.status, payload));
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
// 가져온 단어를 초안에 추가한다. 인쇄된 번호가 있으면 쓰고, 없거나 겹치면 이어서 번호를 매긴다.
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
    return [id, r.en, r.ko, (r.aliases || []).join("|"), ...(r.ipa ? [r.ipa] : [])].join("\t");
  });
  $("wordDraft").value = [...existing, ...lines].join("\n");
  draftDirty = true;
  if (!draftTextMode) draftToTable();
  else updateWordCount(existing.length + lines.length);
  return lines.length;
}
$("extractWords").onclick = async () => {
  const files = selectedFiles.slice();
  if (!files.length || files.length > 10 || files.some((f) => !f.type.startsWith("image/") || f.size > 10 * 1024 * 1024)) {
    $("extractStatus").textContent = `사진 ${files.length}장을 선택했습니다. 한 번에 1~10장, 장당 최대 10MB의 이미지 파일을 선택하세요.`;
    return;
  }
  const config = aiConfig();
  if (!config) {
    $("extractStatus").textContent = "먼저 설정 → ‘보호자 설정 · AI 연결’에서 AI 서버 주소와 접속 코드를 입력하세요.";
    showView("settings");
    $("aiSettings").open = true;
    $("aiStatus").textContent = "사진 인식을 쓰려면 접속 코드를 저장해 주세요.";
    $("aiSettings").scrollIntoView({ behavior: "smooth", block: "center" });
    return;
  }
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
  function deadline(message, ms = 90000) {
    clearTimeout(timer);
    timer = setTimeout(() => failure(Error(message + " 시간이 초과됐습니다")), ms);
  }
  const step = (promise) => Promise.race([promise, interrupted]);
  $("extractWords").disabled = true;
  $("cancelExtract").disabled = false;
  $("confirmed").checked = false;
  $("extractStatus").textContent = "사진에서 단어를 가져옵니다. 사진을 준비하는 중…";
  try {
    const notes = [];
    for (let i = 0; i < files.length; i++) {
      $("extractStatus").textContent = (i ? "" : "사진에서 단어를 가져옵니다. ") + `${i + 1}/${files.length}장 · 사진 크기를 조정하는 중…`;
      deadline("사진 준비", 30000);
      const photo = await step(preparePhoto(files[i]));
      const image = await step(canvasToBase64Jpeg(photo));
      photo.width = photo.height = 1;
      $("extractStatus").textContent = `${i + 1}/${files.length}장 · AI가 단어를 읽는 중… (보통 10~40초) · 취소하고 직접 입력할 수도 있습니다.`;
      deadline("AI 인식", 120000);
      const result = await step(aiRequest(config, "/recognize", { image, mediaType: "image/jpeg" }, controller.signal));
      if (generation !== extractGeneration) return;
      const rows = (Array.isArray(result?.words) ? result.words : [])
        .map((w) => ({
          number: Number.isInteger(w?.number) && w.number > 0 ? w.number : 0,
          en: clean(w?.en),
          ko: clean(w?.ko),
          ipa: clean(w?.ipa),
          aliases: (Array.isArray(w?.aliases) ? w.aliases : []).map(clean).filter(Boolean),
        }))
        .filter((w) => w.en && w.ko);
      if (!rows.length) throw Error("사진에서 단어를 찾지 못했습니다. 더 선명하게 찍어 다시 시도하세요.");
      const added = appendDraftRows(rows);
      if (result.note) notes.push(clean(result.note));
      const skipped = appendDraftRows.skipped ? ` · 이미 있는 단어 ${appendDraftRows.skipped}개 건너뜀` : "";
      $("extractStatus").textContent = `${i + 1}/${files.length}장 완료 · 단어 ${added}개 추가${skipped} · 책과 비교해 고친 뒤 확인란을 체크하고 저장하세요.`;
      selectedFiles = selectedFiles.filter((f) => f !== files[i]);
    }
    renderPhotos();
    $("extractStatus").textContent = `${files.length}/${files.length}장 완료 · 책과 비교해 고친 뒤 확인란을 체크하고 저장하세요.`;
    if (notes.length) $("extractStatus").textContent += " · AI 메모: " + notes.join(" ");
    $("draftWarnings").textContent = "책과 비교해 틀린 뜻·빠진 단어·중복을 고치세요. 결과가 비어 있으면 직접 입력하거나 더 선명한 사진으로 다시 시도하세요.";
    $("wordTableWrap").scrollIntoView({ behavior: "smooth", block: "start" });
  } catch (e) {
    if (generation === extractGeneration) {
      const done = files.length - selectedFiles.filter((f) => files.includes(f)).length;
      $("extractStatus").textContent = "단어를 가져오지 못했습니다: " + (e?.message || String(e)) + (done ? ` · ${done}/${files.length}장까지는 가져왔어요. 남은 사진만 다시 시도하세요.` : " · 인터넷 연결을 확인하고 다시 시도하세요.") + " 아래에 직접 입력해 저장할 수도 있어요.";
      renderPhotos();
      extractGeneration++;
    }
  } finally {
    clearTimeout(timer);
    if (extractOperation === operation) {
      extractOperation = null;
      extractAbort = null;
      $("extractWords").disabled = false;
      $("cancelExtract").disabled = true;
    }
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

if (window.markVocabAppReady) window.markVocabAppReady();
