"use strict";
let editingId = null,
  ocrWorker = null,
  ocrGeneration = 0,
  photoUrls = [];
let ocrAbort = null;
let ocrOperation = null;
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
  if ($("runOcr").disabled) cancelOcr();
  editingId = set?.id || null;
  $("setName").value = set?.name || new Date().toLocaleDateString("sv-SE");
  $("wordDraft").value = set
    ? set.words
        .map((w) => [w.id, w.en, w.ko, w.aliases.join("|")].join("\t"))
        .join("\n")
    : "";
  $("confirmed").checked = false;
  $("ocrEngine").value = aiConfig() ? "claude" : "tesseract";
  $("editor").classList.remove("hidden");
  $("photos").value = "";
  $("camera").value = "";
  releasePhotos();
  $("ocrStatus").textContent = "";
  $("draftWarnings").textContent = "";
}
$("createSet").onclick = () => openEditor();
$("editSet").onclick = () => openEditor(sets.find((s) => s.id === activeSetId));
function cancelOcr() {
  ocrGeneration++;
  ocrAbort?.();
  ocrAbort = null;
  if (ocrWorker) {
    Promise.resolve(ocrWorker.terminate()).catch(() => {});
    ocrWorker = null;
  }
  $("cancelOcr").disabled = true;
  $("runOcr").disabled = false;
  $("ocrStatus").textContent =
    "인식을 취소했습니다. 직접 입력하거나 다시 시도하세요.";
}
$("cancelOcr").onclick = cancelOcr;
$("closeEditor").onclick = () => {
  cancelOcr();
  releasePhotos();
  $("editor").classList.add("hidden");
};
function preview(input) {
  if ($("runOcr").disabled) cancelOcr();
  releasePhotos();
  $("ocrStatus").textContent = input.files.length
    ? "사진을 선택했습니다. 아래 ‘사진에서 단어 추출’을 누르세요. 추출 후 원본과 비교하고 저장합니다."
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
        ipa: "",
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
      w.ipa = old.ipa;
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
// OCR assets are served by this site, so tablet networks need no third-party CDN.
const ocrBase = new URL("./vendor/ocr/", document.baseURI).href;
let tesseractLoading;
function loadTesseract() {
  if (window.Tesseract) return Promise.resolve();
  if (tesseractLoading) return tesseractLoading;
  tesseractLoading = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    const timer = setTimeout(
      () => fail("인식 도구 다운로드 시간이 초과됐습니다"),
      30000,
    );
    function fail(message) {
      clearTimeout(timer);
      script.remove();
      tesseractLoading = null;
      reject(Error(message));
    }
    script.src = ocrBase + "tesseract.min.js";
    script.onload = () => {
      clearTimeout(timer);
      window.Tesseract ? resolve() : fail("인식 도구를 불러오지 못했습니다");
    };
    script.onerror = () => fail("인식 도구 다운로드 실패");
    document.head.append(script);
  });
  return tesseractLoading;
}
async function prepareOcrPhoto(file) {
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
// ---- AI 사진 인식 (Claude API) ----
// API 키는 이 브라우저의 localStorage에만 저장하며 백업 JSON·다른 서버로 내보내지 않는다.
// 브라우저에서 직접 호출하므로 Anthropic이 요구하는 direct-browser-access 헤더를 보낸다.
const AI_STORAGE_KEY = "daily_vocab_ai_v1";
const AI_MODELS = ["claude-opus-5-5", "claude-sonnet-5-5", "claude-haiku-5-5"];
const CLAUDE_URL = "https://api.anthropic.com/v1/messages";
const CLAUDE_SYSTEM = `You read photos of pages from Korean English-vocabulary workbooks (영단어장) and extract every vocabulary entry on the page as JSON.
For each entry:
- number: the item number printed next to the word (for example 121). Use 0 when no number is printed.
- english: the English headword exactly as printed, without part-of-speech tags (v., n., adj.), symbols, or pronunciation.
- korean: the Korean meanings as printed, joined with " · " when the page lists several (for example "바치다 · 헌신하다"). Keep the meanings the page gives; do not add meanings of your own.
- aliases: short Korean answers a student might say or type that should count as correct for this word: each individual meaning from korean, plus natural stem forms without 다/하다 endings (for example "바치다" → "바치", "헌신하다" → "헌신"). Between 2 and 8 items, no duplicates.
Rules:
- Include only headword entries. Skip example sentences, derived-word lists, phrases, synonym sections, page headers, footers, and exercise questions.
- Read multi-column layouts one column at a time, top to bottom, left column first. Keep the page order.
- Transcribe exactly; never invent words that are not on the page. If an entry is cut off or illegible, skip it and mention it in note.
- note: one short Korean sentence about anything skipped or uncertain, or an empty string.`;
const CLAUDE_SCHEMA = {
  type: "object",
  properties: {
    words: {
      type: "array",
      items: {
        type: "object",
        properties: {
          number: { type: "integer" },
          english: { type: "string" },
          korean: { type: "string" },
          aliases: { type: "array", items: { type: "string" } },
        },
        required: ["number", "english", "korean", "aliases"],
        additionalProperties: false,
      },
    },
    note: { type: "string" },
  },
  required: ["words", "note"],
  additionalProperties: false,
};
function aiConfig() {
  try {
    const parsed = JSON.parse(localStorage.getItem(AI_STORAGE_KEY) || "null");
    if (parsed && typeof parsed.key === "string" && parsed.key.trim())
      return {
        key: parsed.key.trim(),
        model: AI_MODELS.includes(parsed.model) ? parsed.model : AI_MODELS[0],
      };
  } catch {}
  return null;
}
function storeAi(next) {
  try {
    localStorage.setItem(AI_STORAGE_KEY, JSON.stringify(next));
    return true;
  } catch {
    $("aiStatus").textContent =
      "저장 실패: 브라우저 저장 공간 또는 설정을 확인하세요.";
    return false;
  }
}
function renderAiSettings() {
  const config = aiConfig();
  $("aiModel").value = config?.model || AI_MODELS[0];
  $("aiKeyState").textContent = config
    ? "키 저장됨 · …" + config.key.slice(-4)
    : "키 없음";
  $("clearApiKey").disabled = !config;
  $("testApiKey").disabled = !config;
}
$("saveApiKey").onclick = () => {
  const key = $("apiKey").value.trim();
  if (!/^sk-ant-/.test(key) || key.length < 20) {
    $("aiStatus").textContent =
      "sk-ant-로 시작하는 Anthropic API 키를 붙여 넣으세요.";
    return;
  }
  if (!storeAi({ key, model: $("aiModel").value })) return;
  $("apiKey").value = "";
  renderAiSettings();
  $("ocrEngine").value = "claude";
  $("aiStatus").textContent =
    "API 키를 이 브라우저에 저장했습니다. 새 세트에서 사진을 올리고 ‘사진에서 단어 추출’을 누르면 AI가 읽습니다.";
};
$("clearApiKey").onclick = () => {
  localStorage.removeItem(AI_STORAGE_KEY);
  renderAiSettings();
  $("ocrEngine").value = "tesseract";
  $("aiStatus").textContent =
    "API 키를 삭제했습니다. 사진 인식은 기본 OCR로 동작합니다.";
};
$("aiModel").onchange = () => {
  const config = aiConfig();
  if (config && storeAi({ key: config.key, model: $("aiModel").value }))
    $("aiStatus").textContent = "모델을 바꿨습니다: " + $("aiModel").value;
};
async function claudePost(config, body, signal, beta) {
  const headers = {
    "content-type": "application/json",
    "x-api-key": config.key,
    "anthropic-version": "2023-06-01",
    "anthropic-dangerous-direct-browser-access": "true",
  };
  if (beta) headers["anthropic-beta"] = beta;
  let response;
  try {
    response = await fetch(CLAUDE_URL, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal,
    });
  } catch (e) {
    if (e?.name === "AbortError")
      throw Error("요청이 취소되었거나 시간이 초과됐습니다");
    throw Error("Anthropic 서버에 연결하지 못했습니다. 인터넷 연결을 확인하세요.");
  }
  let payload = null;
  try {
    payload = await response.json();
  } catch {}
  return { status: response.status, payload };
}
function describeClaudeError(status, payload) {
  const message = payload?.error?.message || "";
  const type = payload?.error?.type || "";
  if (status === 401)
    return "API 키가 올바르지 않습니다. 키를 다시 확인해 저장하세요.";
  if (status === 403)
    return "이 API 키로는 요청 권한이 없습니다. Anthropic 콘솔에서 키 권한을 확인하세요.";
  if (status === 404)
    return "선택한 모델을 사용할 수 없습니다. 다른 모델을 선택하세요.";
  if (status === 413)
    return "사진이 너무 커서 전송하지 못했습니다. 한 장씩 시도하세요.";
  if (status === 429)
    return "요청 또는 사용 한도를 넘었습니다. 잠시 후 다시 시도하거나 콘솔에서 한도·잔액을 확인하세요.";
  if (status === 529 || type === "overloaded_error")
    return "Anthropic 서버가 혼잡합니다. 잠시 후 다시 시도하세요.";
  if (status >= 500) return "Anthropic 서버 오류입니다. 잠시 후 다시 시도하세요.";
  return `API 오류 ${status}` + (message ? ": " + message : "");
}
// Opus/Sonnet: 정책 거부 시 서버가 대체 모델로 이어 주는 fallbacks를 기본으로 켠다.
// 계정에서 해당 베타를 쓸 수 없어 400이 오면 fallbacks 없이 한 번 더 보낸다.
async function callClaude(config, body, signal) {
  const useFallback = config.model !== "claude-haiku-5-5";
  let result = useFallback
    ? await claudePost(
        config,
        { ...body, fallbacks: "default" },
        signal,
        "server-side-fallback-2026-07-01",
      )
    : await claudePost(config, body, signal);
  if (
    useFallback &&
    result.status === 400 &&
    /fallback/i.test(result.payload?.error?.message || "")
  )
    result = await claudePost(config, body, signal);
  if (result.status !== 200 || !result.payload)
    throw Error(describeClaudeError(result.status, result.payload));
  return result.payload;
}
$("testApiKey").onclick = async () => {
  const config = aiConfig();
  if (!config) return;
  $("testApiKey").disabled = true;
  $("aiStatus").textContent = "Anthropic 서버에 연결을 확인하는 중…";
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30000);
  try {
    await callClaude(
      config,
      {
        model: config.model,
        max_tokens: 256,
        output_config: { effort: "low" },
        messages: [
          { role: "user", content: "연결 확인입니다. ‘확인’이라고만 답하세요." },
        ],
      },
      controller.signal,
    );
    $("aiStatus").textContent = "연결 성공 · " + config.model + " 사용 가능";
  } catch (e) {
    $("aiStatus").textContent = "연결 실패: " + e.message;
  } finally {
    clearTimeout(timer);
    $("testApiKey").disabled = false;
  }
};
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
async function recognizeWithClaude(config, image, signal) {
  const message = await callClaude(
    config,
    {
      model: config.model,
      max_tokens: 8192,
      system: CLAUDE_SYSTEM,
      output_config: {
        effort: "medium",
        format: { type: "json_schema", schema: CLAUDE_SCHEMA },
      },
      messages: [
        {
          role: "user",
          content: [
            {
              type: "image",
              source: { type: "base64", media_type: "image/jpeg", data: image },
            },
            {
              type: "text",
              text: "이 사진은 영단어장 페이지입니다. 페이지에 있는 모든 단어 항목을 JSON으로 추출하세요.",
            },
          ],
        },
      ],
    },
    signal,
  );
  if (message.stop_reason === "refusal")
    throw Error(
      "AI가 이 사진의 처리를 거부했습니다. 교재 페이지만 나오도록 다시 찍어 시도하세요.",
    );
  if (message.stop_reason === "max_tokens")
    throw Error("결과가 너무 길어 잘렸습니다. 페이지를 나누어 찍어 다시 시도하세요.");
  const text = (message.content || [])
    .filter((b) => b && b.type === "text")
    .map((b) => b.text)
    .join("");
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw Error("AI 응답을 해석하지 못했습니다. 다시 시도하세요.");
  }
  const clean = (s) => String(s ?? "").replace(/[\t\r\n]+/g, " ").trim();
  const words = (Array.isArray(data?.words) ? data.words : [])
    .map((w) => {
      const en = clean(w?.english),
        ko = clean(w?.korean);
      const aliases = [
        ...new Set(
          (Array.isArray(w?.aliases) ? w.aliases : [])
            .map(clean)
            .filter((a) => a && a !== ko),
        ),
      ].slice(0, 12);
      return {
        number: Number.isInteger(w?.number) && w.number > 0 ? w.number : 0,
        en,
        ko,
        aliases,
      };
    })
    .filter((w) => w.en && w.ko);
  const note = clean(data?.note);
  if (!words.length)
    throw Error(
      "사진에서 단어 항목을 찾지 못했습니다." +
        (note ? " " + note : "") +
        " 더 선명하게 찍어 다시 시도하세요.",
    );
  return { words, note };
}
// 추출 결과를 초안에 추가한다. 인쇄된 번호가 있으면 쓰고, 없거나 겹치면 이어서 번호를 매긴다.
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
    return [id, r.en, r.ko, (r.aliases || []).join("|")].join("\t");
  });
  $("wordDraft").value = [...existing, ...lines].join("\n");
  return lines.length;
}
$("runOcr").onclick = async () => {
  const files = [...$("photos").files, ...$("camera").files];
  if (
    !files.length ||
    files.length > 10 ||
    files.some((f) => !f.type.startsWith("image/") || f.size > 10 * 1024 * 1024)
  ) {
    $("ocrStatus").textContent =
      `사진 ${files.length}장을 선택했습니다. 한 번에 1~10장, 장당 최대 10MB의 이미지 파일을 선택하세요.`;
    return;
  }
  const engine = $("ocrEngine").value === "tesseract" ? "tesseract" : "claude";
  const config = engine === "claude" ? aiConfig() : null;
  if (engine === "claude" && !config) {
    $("ocrStatus").textContent =
      "AI 인식을 쓰려면 ‘AI 사진 인식 설정’에서 Claude API 키를 먼저 저장하세요. 키 없이 쓰려면 인식 방식을 ‘기본 OCR’로 바꾸세요.";
    $("aiSettings").open = true;
    $("aiSettings").scrollIntoView({ behavior: "smooth", block: "center" });
    return;
  }
  const generation = ++ocrGeneration;
  const operation = {};
  ocrOperation = operation;
  let worker, failure, timer;
  const controller = new AbortController();
  const interrupted = new Promise((_, reject) => {
    failure = (reason) => {
      controller.abort();
      reject(reason instanceof Error ? reason : Error(String(reason)));
    };
    ocrAbort = () => failure(Error("인식을 취소했습니다"));
  });
  function deadline(message, ms = 90000) {
    clearTimeout(timer);
    timer = setTimeout(
      () => failure(Error(message + " 시간이 초과됐습니다")),
      ms,
    );
  }
  const step = (promise) => Promise.race([promise, interrupted]);
  $("runOcr").disabled = true;
  $("cancelOcr").disabled = false;
  $("confirmed").checked = false;
  $("ocrStatus").textContent =
    engine === "claude"
      ? "AI 사진 인식을 시작합니다. 사진을 준비하는 중…"
      : "사진 인식을 시작합니다. 인식 도구를 준비하는 중… 처음에는 다운로드에 시간이 걸립니다.";
  try {
    if (engine === "claude") {
      const notes = [];
      for (let i = 0; i < files.length; i++) {
        $("ocrStatus").textContent =
          (i ? "" : "AI 사진 인식을 시작합니다. ") +
          `${i + 1}/${files.length}장 · 사진 크기를 조정하는 중…`;
        deadline("사진 준비", 30000);
        const photo = await step(prepareOcrPhoto(files[i]));
        const image = await step(canvasToBase64Jpeg(photo));
        photo.width = photo.height = 1;
        $("ocrStatus").textContent =
          `${i + 1}/${files.length}장 · AI가 단어를 읽는 중… (보통 10~40초) · 취소 후 직접 입력도 가능합니다.`;
        deadline("AI 인식", 120000);
        const result = await step(
          recognizeWithClaude(config, image, controller.signal),
        );
        if (generation !== ocrGeneration) return;
        const added = appendDraftRows(result.words);
        if (result.note) notes.push(result.note);
        $("ocrStatus").textContent =
          `${i + 1}/${files.length}장 인식 완료 · 단어 ${added}개 추가 · 아래 결과를 원본과 비교해 수정하고 확인란을 체크한 뒤 저장하세요.`;
      }
      if (notes.length)
        $("ocrStatus").textContent += " · AI 메모: " + notes.join(" ");
    } else {
      deadline("인식 도구 준비", 35000);
      await step(loadTesseract());
      if (generation !== ocrGeneration) return;
      $("ocrStatus").textContent = "영어·한글 인식 데이터를 준비하는 중…";
      deadline("인식 데이터 준비");
      const creating = Tesseract.createWorker("eng+kor", 1, {
        workerPath: ocrBase + "worker.min.js",
        corePath: ocrBase,
        langPath: ocrBase,
        errorHandler: failure,
        logger: (m) => {
          if (generation !== ocrGeneration) return;
          const labels = {
            "loading tesseract core": "인식 엔진 준비",
            "initializing tesseract": "인식 엔진 시작",
            "loading language traineddata": "영어·한글 데이터 다운로드",
            "initializing api": "인식 준비",
            "recognizing text": "사진에서 단어 인식",
          };
          $("ocrStatus").textContent =
            (labels[m.status] || "사진 인식 준비") +
            " " +
            Math.round((m.progress || 0) * 100) +
            "% · 취소 후 직접 입력도 가능합니다.";
        },
      });
      // A cancelled/expired startup may still finish; release its worker then.
      creating.then(
        (w) => {
          if (generation !== ocrGeneration)
            Promise.resolve(w.terminate()).catch(() => {});
        },
        () => {},
      );
      worker = await step(creating);
      ocrWorker = worker;
      for (let i = 0; i < files.length; i++) {
        $("ocrStatus").textContent =
          `${i + 1}/${files.length}장 · 사진 크기를 조정하는 중…`;
        deadline("사진 준비", 30000);
        const photo = await step(prepareOcrPhoto(files[i]));
        deadline("사진 인식", 120000);
        const { data } = await step(worker.recognize(photo));
        if (generation !== ocrGeneration) return;
        photo.width = photo.height = 1;
        appendDraftRows(
          parseDraft(data.text).map((w) => ({
            number: 0,
            en: w.en,
            ko: w.ko,
            aliases: [],
          })),
        );
        $("ocrStatus").textContent =
          `${i + 1}/${files.length}장 인식 완료 · 신뢰도 ${Math.round(data.confidence)}% · 아래 결과를 수정하고 확인란을 체크한 뒤 저장하세요.`;
      }
    }
    $("draftWarnings").textContent =
      "원본과 비교해 빈 뜻·중복·예문을 수정하고 누락 단어를 추가하세요. 추출 결과가 비어 있으면 직접 입력하거나 선명한 사진으로 재시도하세요.";
    $("wordDraft").scrollIntoView({ behavior: "smooth", block: "center" });
  } catch (e) {
    if (generation === ocrGeneration) {
      $("ocrStatus").textContent =
        "인식 실패: " +
        (e?.message || String(e)) +
        " · 인터넷 연결을 확인하고 한 장씩 재시도하세요. 아래에 단어와 뜻을 직접 입력해 저장할 수도 있습니다.";
      ocrGeneration++;
    }
  } finally {
    clearTimeout(timer);
    if (ocrWorker === worker) ocrWorker = null;
    if (ocrOperation === operation) {
      ocrOperation = null;
      ocrAbort = null;
      $("runOcr").disabled = false;
      $("cancelOcr").disabled = true;
    }
    if (worker) Promise.resolve(worker.terminate()).catch(() => {});
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
