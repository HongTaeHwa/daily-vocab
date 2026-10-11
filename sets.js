"use strict";
let editingId = null,
  extractGeneration = 0,
  photoUrls = [];
let extractAbort = null;
let extractOperation = null;
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
    status(
      "저장 실패: 공간 또는 브라우저 설정을 확인하고 JSON으로 백업하세요.",
    );
    return false;
  }
}
function populateSets() {
  const select = $("setSelect");
  select.textContent = "";
  for (const set of sets) {
    const o = document.createElement("option");
    o.value = set.id;
    o.textContent = set.name + " · " + set.words.length + "단어";
    select.append(o);
  }
  select.value = activeSetId;
  const range = $("range");
  range.textContent = "";
  for (let i = -1; i < WORDS.length; i = i < 0 ? 0 : i + 10) {
    const o = document.createElement("option");
    o.value = i < 0 ? "all" : String(i);
    o.textContent =
      i < 0
        ? "전체 " + WORDS.length + "단어"
        : i + 1 + "~" + Math.min(i + 10, WORDS.length) + "번째 단어";
    range.append(o);
  }
  refreshReview();
}
function selectSet(id) {
  activeSetId = id;
  WORDS = sets.find((s) => s.id === id).words;
  cacheKey = "daily_vocab_missed_" + id;
  try {
    lastMissed = JSON.parse(localStorage.getItem(cacheKey) || "[]").filter(
      (id) => WORDS.some((w) => w.id === id),
    );
  } catch {
    lastMissed = [];
  }
  populateSets();
  renderHistory();
  $("quiz").style.display = "none";
  $("finish").style.display = "none";
}
$("setSelect").onchange = () => selectSet($("setSelect").value);
function releasePhotos() {
  photoUrls.forEach(URL.revokeObjectURL);
  photoUrls = [];
  $("photoPreview").textContent = "";
}
function openEditor(set) {
  if ($("extractWords").disabled) cancelExtract();
  editingId = set?.id || null;
  $("setName").value = set?.name || new Date().toLocaleDateString("sv-SE");
  $("wordDraft").value = set
    ? set.words
        .map((w) =>
          [w.id, w.en, w.ko, w.aliases.join("|"), ...(w.ipa ? [w.ipa] : [])].join("\t"),
        )
        .join("\n")
    : "";
  $("confirmed").checked = false;
  $("editor").classList.remove("hidden");
  $("photos").value = "";
  $("camera").value = "";
  releasePhotos();
  $("extractStatus").textContent = "";
  $("draftWarnings").textContent = "";
}
$("createSet").onclick = () => openEditor();
$("editSet").onclick = () => openEditor(sets.find((s) => s.id === activeSetId));
function cancelExtract() {
  extractGeneration++;
  extractAbort?.();
  extractAbort = null;
  $("cancelExtract").disabled = true;
  $("extractWords").disabled = false;
  $("extractStatus").textContent =
    "취소했습니다. 다시 시도하거나 아래에 직접 입력하세요.";
}
$("cancelExtract").onclick = cancelExtract;
$("closeEditor").onclick = () => {
  cancelExtract();
  releasePhotos();
  $("editor").classList.add("hidden");
};
function preview(input) {
  if ($("extractWords").disabled) cancelExtract();
  releasePhotos();
  $("extractStatus").textContent = input.files.length
    ? "사진을 선택했습니다. 아래 ‘사진에서 단어 가져오기’를 누르세요. 결과를 책과 비교해 고친 뒤 저장합니다."
    : "사진을 선택하세요.";
  for (const file of input.files) {
    const url = URL.createObjectURL(file);
    photoUrls.push(url);
    const img = document.createElement("img");
    img.src = url;
    img.alt = file.name;
    img.style.cssText =
      "max-width:100%;max-height:360px;object-fit:contain;margin:8px";
    $("photoPreview").append(img);
  }
}
$("photos").onchange = () => {
  $("camera").value = "";
  preview($("photos"));
};
$("camera").onchange = () => {
  $("photos").value = "";
  preview($("camera"));
};
function parseDraft(text) {
  const rows = text
    .split("\n")
    .filter((l) => l.trim())
    .map((line, i) => {
      let parts = line.split("\t");
      if (parts.length < 3) {
        const match = line
          .trim()
          .match(/^(?:(\d+)\s+)?([A-Za-z][A-Za-z '-]*?)\s+([가-힣].*)$/);
        parts = match
          ? [match[1] || String(i + 1), match[2], match[3], ""]
          : ["" + (i + 1), line, "", ""];
      }
      return {
        id: parts[0].trim(),
        en: parts[1].trim(),
        ko: parts[2].trim(),
        aliases: (parts[3] || "")
          .split("|")
          .map((x) => x.trim())
          .filter(Boolean),
        ipa: (parts[4] || "").trim(),
        hangul: "",
      };
    });
  return rows;
}
$("wordDraft").oninput = () => {
  $("confirmed").checked = false;
};
$("setName").oninput = () => {
  $("confirmed").checked = false;
};
$("saveSet").onclick = () => {
  if (sessionRunning) return;
  const name = $("setName").value.trim(),
    words = parseDraft($("wordDraft").value);
  const duplicates = words.filter((w, i) =>
    words
      .slice(0, i)
      .some((x) => x.id === w.id || x.en.toLowerCase() === w.en.toLowerCase()),
  );
  if (
    !name ||
    !words.length ||
    words.length > 2000 ||
    words.some((w) => !w.id || !w.en || !w.ko) ||
    duplicates.length
  ) {
    $("draftWarnings").textContent =
      "이름과 각 행의 번호·영어·뜻이 필요합니다. 중복 번호/단어를 수정하고 최대 2000개를 입력하세요.";
    return;
  }
  if (!$("confirmed").checked) {
    $("draftWarnings").textContent = "원본 비교 확인란을 체크하세요.";
    return;
  }
  const previous = sets.find((s) => s.id === editingId);
  for (const w of words) {
    const old = previous?.words.find(
      (x) => String(x.id) === w.id && x.en === w.en,
    );
    if (old) {
      w.id = old.id;
      w.ipa = w.ipa || old.ipa;
      w.hangul = old.hangul;
    }
  }
  const id = editingId || crypto.randomUUID();
  const set = { id, name, words };
  if (persistSets([...sets.filter((s) => s.id !== id), set])) {
    selectSet(id);
    $("editor").classList.add("hidden");
    releasePhotos();
    status("세트를 저장했습니다. 시험 방식과 범위를 선택하여 시작하세요.");
  }
};
$("deleteSet").onclick = () => {
  if (sets.length === 1) {
    status("마지막 세트는 삭제할 수 없습니다.");
    return;
  }
  if (
    confirm("세트를 삭제할까요? 시험 이력은 남습니다.") &&
    persistSets(sets.filter((s) => s.id !== activeSetId))
  )
    selectSet(sets[0].id);
};
function download(data, name) {
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }),
  );
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
            return [
              s.id,
              JSON.parse(
                localStorage.getItem("daily_vocab_missed_" + s.id) || "[]",
              ),
            ];
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
    const records = (data.history || []).map((r) => ({
      ...r,
      id: crypto.randomUUID(),
      setId: idMap.get(r.setId) || "import-deleted-" + r.setId,
    }));
    if (!persistHistory([...records, ...historyRecords]))
      status(
        "세트는 가져왔지만 이력 저장에 실패했습니다. 원본 JSON을 보관하세요.",
      );
    for (const s of data.sets) {
      const missed = data.missed?.[s.id];
      if (Array.isArray(missed))
        localStorage.setItem(
          "daily_vocab_missed_" + idMap.get(s.id),
          JSON.stringify(
            missed.filter((id) => s.words.some((w) => w.id === id)),
          ),
        );
    }
    selectSet(imported[0].id);
    status("세트를 복사하여 가져왔습니다. 기존 세트는 유지됩니다.");
  } catch (e) {
    status("가져오기 실패: " + e.message);
  } finally {
    $("importSets").value = "";
  }
};
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
// ---- AI 사진 인식 (Cloudflare Worker 프록시) ----
// 앱은 Worker 주소와 가족용 접속 코드만 저장한다. Anthropic API 키는 Worker 비밀값에만 있다.
// 설정은 이 브라우저의 localStorage에만 두고 백업 JSON·CSV로 내보내지 않는다.
const AI_STORAGE_KEY = "daily_vocab_ai_v2";
// 배포한 Worker 주소(예: https://daily-vocab-ai.xxx.workers.dev)를 넣으면 보호자는 접속 코드만 입력하면 된다.
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
    if (u.protocol === "https:" || (u.protocol === "http:" && local))
      return u.origin + u.pathname.replace(/\/+$/, "");
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
  $("aiStatus").textContent = "저장했습니다. ‘연결 확인’을 눌러 AI 서버가 응답하는지 확인해 보세요.";
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
  const existing = $("wordDraft")
    .value.split("\n")
    .filter((l) => l.trim());
  const used = new Set(existing.map((l) => l.split("\t")[0].trim()));
  let next = existing.length;
  const lines = rows.map((r) => {
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
  return lines.length;
}
$("extractWords").onclick = async () => {
  const files = [...$("photos").files, ...$("camera").files];
  if (
    !files.length ||
    files.length > 10 ||
    files.some((f) => !f.type.startsWith("image/") || f.size > 10 * 1024 * 1024)
  ) {
    $("extractStatus").textContent =
      `사진 ${files.length}장을 선택했습니다. 한 번에 1~10장, 장당 최대 10MB의 이미지 파일을 선택하세요.`;
    return;
  }
  const config = aiConfig();
  if (!config) {
    $("extractStatus").textContent =
      "먼저 ‘보호자 설정 · AI 연결’에서 AI 서버 주소와 접속 코드를 입력하세요.";
    $("aiSettings").open = true;
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
      $("extractStatus").textContent =
        (i ? "" : "사진에서 단어를 가져옵니다. ") +
        `${i + 1}/${files.length}장 · 사진 크기를 조정하는 중…`;
      deadline("사진 준비", 30000);
      const photo = await step(preparePhoto(files[i]));
      const image = await step(canvasToBase64Jpeg(photo));
      photo.width = photo.height = 1;
      $("extractStatus").textContent =
        `${i + 1}/${files.length}장 · AI가 단어를 읽는 중… (보통 10~40초) · 취소하고 직접 입력할 수도 있습니다.`;
      deadline("AI 인식", 120000);
      const result = await step(
        aiRequest(config, "/recognize", { image, mediaType: "image/jpeg" }, controller.signal),
      );
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
      $("extractStatus").textContent =
        `${i + 1}/${files.length}장 완료 · 단어 ${added}개 추가 · 책과 비교해 고친 뒤 확인란을 체크하고 저장하세요.`;
    }
    if (notes.length) $("extractStatus").textContent += " · AI 메모: " + notes.join(" ");
    $("draftWarnings").textContent =
      "책과 비교해 틀린 뜻·빠진 단어·중복을 고치세요. 결과가 비어 있으면 직접 입력하거나 더 선명한 사진으로 다시 시도하세요.";
    $("wordDraft").scrollIntoView({ behavior: "smooth", block: "center" });
  } catch (e) {
    if (generation === extractGeneration) {
      $("extractStatus").textContent =
        "단어를 가져오지 못했습니다: " +
        (e?.message || String(e)) +
        " · 인터넷 연결을 확인하고 한 장씩 다시 시도하세요. 아래에 직접 입력해 저장할 수도 있습니다.";
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
          if (
            worker.state === "installed" &&
            navigator.serviceWorker.controller
          )
            status(
              "새 버전이 준비됐습니다. 시험을 마친 후 앱을 닫고 다시 열어 주세요.",
            );
        });
      });
    })
    .catch(() =>
      status(
        "오프라인 앱 저장 실패. 인터넷 연결 상태에서는 사용할 수 있습니다.",
      ),
    );
populateSets();
renderAiSettings();

if (window.markVocabAppReady) window.markVocabAppReady();
