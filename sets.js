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
$("runOcr").onclick = async () => {
  const files = [...$("photos").files, ...$("camera").files];
  if (
    !files.length ||
    files.length > 6 ||
    files.some((f) => !f.type.startsWith("image/") || f.size > 10 * 1024 * 1024)
  ) {
    $("ocrStatus").textContent =
      "이미지를 1~6장 선택하세요. 장당 최대 10MB입니다.";
    return;
  }
  const generation = ++ocrGeneration;
  const operation = {};
  ocrOperation = operation;
  let worker, failure, timer;
  const interrupted = new Promise((_, reject) => {
    failure = (reason) =>
      reject(reason instanceof Error ? reason : Error(String(reason)));
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
    "사진 인식을 시작합니다. 인식 도구를 준비하는 중… 처음에는 다운로드에 시간이 걸립니다.";
  try {
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
    const lines = [];
    for (let i = 0; i < files.length; i++) {
      $("ocrStatus").textContent =
        `${i + 1}/${files.length}장 · 사진 크기를 조정하는 중…`;
      deadline("사진 준비", 30000);
      const photo = await step(prepareOcrPhoto(files[i]));
      deadline("사진 인식", 120000);
      const { data } = await step(worker.recognize(photo));
      if (generation !== ocrGeneration) return;
      photo.width = photo.height = 1;
      lines.push(
        ...parseDraft(data.text).map((w, j) =>
          [
            String(
              $("wordDraft")
                .value.split("\n")
                .filter((l) => l.trim()).length +
                j +
                1,
            ),
            w.en,
            w.ko,
            "",
          ].join("\t"),
        ),
      );
      $("wordDraft").value = [$("wordDraft").value, ...lines.splice(0)]
        .filter(Boolean)
        .join("\n");
      $("ocrStatus").textContent =
        `${i + 1}/${files.length}장 인식 완료 · 신뢰도 ${Math.round(data.confidence)}% · 아래 결과를 수정하고 확인란을 체크한 뒤 저장하세요.`;
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
