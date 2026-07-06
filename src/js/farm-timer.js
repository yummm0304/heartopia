(() => {
  "use strict";

  const STORAGE_KEY = "heartopia_farm_timers_v2";
  const ALARM_SOUND_KEY = "heartopia_farm_alarm_sound_v1";
  // The repeat cadence is intentionally fixed so the alert stays urgent without extra settings.
  const REPEAT_ALARM_INTERVAL_MS = 850;
  const BUILD_VERSION = "20260707-09";
  const ALERT_GRACE_MS = 90 * 1000;
  // Lead the visual bar slightly so it is never behind a weed marker once that time has arrived.
  const PROGRESS_LEAD_MS = 0;
  // When a timer is started from an already-remaining time, do not fire an
  // almost-immediate reminder for a stage the user has effectively joined after.
  const CONTINUE_STAGE_SKIP_WINDOW_MS = 60 * 1000;
  let audioContext = null;
  let audioArmed = false;
  const repeatingAlerts = new Map();
  const crops = [
    { id:"tomato", name:"토마토", ja:"トマト", minutes:15, icon:"🍅" },
    { id:"rice", name:"벼", ja:"米", minutes:20, icon:"🍚", isNew:true },
    { id:"pineapple", name:"파인애플", ja:"パイナップル", minutes:30, icon:"🍍" },
    { id:"tea", name:"찻잎", ja:"茶葉", minutes:45, icon:"🍃" },
    { id:"potato", name:"감자", ja:"ジャガイモ", minutes:60, icon:"🥔" },
    { id:"carrot", name:"당근", ja:"ニンジン", minutes:120, icon:"🥕" },
    { id:"wheat", name:"밀", ja:"小麦", minutes:240, icon:"🌾" },
    { id:"strawberry", name:"딸기", ja:"いちご", minutes:360, icon:"🍓" },
    { id:"eggplant", name:"가지", ja:"ナス", minutes:420, icon:"🍆" },
    { id:"lettuce", name:"양상추", ja:"レタス", minutes:480, icon:"🥬" },
    { id:"grape", name:"포도", ja:"ブドウ", minutes:600, icon:"🍇" },
    { id:"corn", name:"옥수수", ja:"トウモロコシ", minutes:720, icon:"🌽" },
    { id:"cacao", name:"카카오", ja:"カカオ", minutes:300, icon:"🍫" },
    { id:"avocado", name:"아보카도", ja:"アボカド", minutes:840, icon:"🥑" }
  ];

  const copy = {
    ko: {
      allowNotifications:"🔔 알림 허용", notificationsEnabled:"🔔 알림 켜짐", cannotNotify:"알림을 지원하지 않는 브라우저예요.",
      choosePrompt:"작물을 선택해 주세요.", cropDuration:"{name} · 수확까지 {time}", continuingDuration:"{name} · 총 {time} 중",
      plant:"작물 심기", continue:"이어서 시작", remainingRequired:"남은 시간을 1초 이상 입력해 주세요.",
      remainingTooLong:"입력한 시간이 작물 전체 성장 시간보다 길어요. 최대 {time}으로 적용했어요.",
      delete:"삭제", deleteConfirm:"이 작물을 삭제할까요?", clearConfirm:"진행 중인 작물을 모두 삭제할까요?",
      nextWeed:"🌱 다음 잡초 · {stage}", mature:"성숙됨! 잠시 후 마지막 잡초 제거", afterMature:"성숙 후 · 마지막 잡초 제거",
      harvestReady:"🌱 재배 완료!", harvestAt:"수확까지 {time}", matureTip:"✨ 성숙됨! 잠시 후 마지막 잡초 제거",
      justBefore:"성숙 직전", after:"성숙 후", noTimers:"아직 심은 작물이 없어요. 위에서 작물을 선택해 시작해 보세요."
    },
    ja: {
      allowNotifications:"🔔 通知を許可", notificationsEnabled:"🔔 通知オン", cannotNotify:"このブラウザは通知に対応していません。",
      choosePrompt:"作物を選んでください。", cropDuration:"{name} · 収穫まで {time}", continuingDuration:"{name} · 合計 {time} 中",
      plant:"作物を植える", continue:"続きから開始", remainingRequired:"残り時間を1秒以上入力してください。",
      remainingTooLong:"入力した時間が作物の成長時間より長いため、最大 {time} で設定しました。",
      delete:"削除", deleteConfirm:"この作物を削除しますか？", clearConfirm:"栽培中の作物をすべて削除しますか？",
      nextWeed:"🌱 次の雑草 · {stage}", mature:"成熟！最後の雑草を取りましょう", afterMature:"成熟後 · 最後の雑草を取る",
      harvestReady:"🌱 栽培完了！", harvestAt:"収穫まで {time}", matureTip:"✨ 成熟！最後の雑草を取りましょう",
      justBefore:"成熟直前", after:"成熟後", noTimers:"まだ植えた作物がありません。上から作物を選んで始めましょう。"
    }
  };

  const $ = (id) => document.getElementById(id);
  const cropGrid = $("crop-grid");
  const timerList = $("timer-list");
  const emptyState = $("empty-state");
  const plantButton = $("plant-button");
  const plantButtonLabel = $("plant-button-label");
  const modal = $("timer-modal");
  const modalContent = $("timer-modal-content");

  let selectedCropId = null;
  let timers = loadTimers();
  let activeModalId = null;

  function language() {
    return window.getSiteLanguage ? window.getSiteLanguage() : "ko";
  }
  function t(key) {
    const table = copy[language()] || copy.ko;
    return table[key] || copy.ko[key] || "";
  }
  function cropName(crop) {
    return language() === "ja" ? crop.ja : crop.name;
  }
  function esc(value) {
    return String(value ?? "").replace(/[&<>"']/g, c => ({
      "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;"
    }[c]));
  }
  function getCrop(id) {
    return crops.find(crop => crop.id === id);
  }
  function durationText(totalSeconds) {
    const seconds = Math.max(0, Math.round(totalSeconds));
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;
    const units = language() === "ja"
      ? { h:"時間", m:"分", s:"秒" }
      : { h:"시간", m:"분", s:"초" };
    if (hours) return minutes ? `${hours}${units.h} ${minutes}${units.m}` : `${hours}${units.h}`;
    if (minutes) return `${minutes}${units.m}`;
    return `${secs}${units.s}`;
  }
  function countdownText(ms) {
    const total = Math.max(0, Math.ceil(ms / 1000));
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    const s = total % 60;
    return h ? `${h}:${String(m).padStart(2,"0")}:${String(s).padStart(2,"0")}` : `${m}:${String(s).padStart(2,"0")}`;
  }
  function safeInt(value, max) {
    return Math.max(0, Math.min(max, Number.parseInt(value, 10) || 0));
  }
  function cleanTimers(value) {
    const unique = new Map();
    (Array.isArray(value) ? value : []).forEach(raw => {
      if (!raw || !raw.id || !raw.cropId || !getCrop(raw.cropId)) return;
      const crop = getCrop(raw.cropId);
      const durationMs = Number(raw.durationMs) || crop.minutes * 60000;
      const harvestAt = Number(raw.harvestAt) || ((Number(raw.plantedAt) || Date.now()) + durationMs);
      const plantedAt = Number(raw.plantedAt) || (harvestAt - durationMs);
      unique.set(raw.id, {
        id: raw.id,
        cropId: raw.cropId,
        plantedAt,
        harvestAt,
        durationMs,
        label: String(raw.label || ""),
        repeat: Boolean(raw.repeat),
        alarmActive: Boolean(raw.alarmActive),
        notifiedStages: raw.notifiedStages && typeof raw.notifiedStages === "object" ? raw.notifiedStages : {}
      });
    });
    return [...unique.values()].slice(-30);
  }
  function loadTimers() {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
      return cleanTimers(saved);
    } catch {
      return [];
    }
  }
  function saveTimers() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(timers));
    // Old v1 data must not revive deleted cards when revisiting this page.
    localStorage.removeItem("heartopia_farm_timers_v1");
  }
  function getHarvestAt(timer) { return Number(timer.harvestAt); }
  // Visual timeline: W1/W2 follow normal growth, W3 is the exact 0-second
  // maturity point, and the final W3→W4 window is deliberately widened so
  // the warning segment, the ellipsis, and W4 stay readable on every card.
  function timelineData() {
    return {
      w1: 31,
      w2: 61,
      w3: 75,
      warningEnd: 84,
      dots: 88.5,
      w4: 96
    };
  }
  function stageData(timer) {
    const harvest = getHarvestAt(timer);
    const planted = timer.plantedAt;
    const full = timer.durationMs;
    return [
      { id:"W1", at: planted + full / 3, label: `${Math.round(full / 180000)}${language()==="ja" ? "分" : "분"}` },
      { id:"W2", at: planted + full * 2 / 3, label: `${Math.round(full / 90000)}${language()==="ja" ? "分" : "분"}` },
      // W3 is exactly when the crop countdown reaches 0:00.
      { id:"W3", at: harvest, label: t("justBefore") },
      { id:"W4", at: harvest + 60000, label: t("after") }
    ];
  }
  function getAlarmSound() {
    return localStorage.getItem(ALARM_SOUND_KEY) || "bell";
  }
  function setAlarmSound(value) {
    localStorage.setItem(ALARM_SOUND_KEY, value);
  }
  function setAlarmStatus(message, state = "") {
    const status = $("alarm-status");
    if (!status) return;
    status.textContent = message || "";
    status.className = `farm-alarm-status${state ? ` is-${state}` : ""}`;
  }
  function ensureAudioContext() {
    const AudioCtor = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtor) return null;
    if (!audioContext) audioContext = new AudioCtor();
    return audioContext;
  }
  // Run inside a user gesture so later timer alerts are allowed to make sound.
  function primeAlarmAudio() {
    const context = ensureAudioContext();
    if (!context) return null;
    audioArmed = true;
    if (context.state === "suspended") context.resume().catch(() => {});
    return context;
  }
  async function unlockAlarmAudio() {
    const context = primeAlarmAudio();
    if (!context) return null;
    if (context.state !== "running") {
      try { await context.resume(); } catch (_) { return null; }
    }
    return context.state === "running" ? context : null;
  }
  function playTone(context, frequency, start, duration, type = "sine", volume = 0.12) {
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = type;
    oscillator.frequency.setValueAtTime(frequency, start);
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(volume, start + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
    oscillator.connect(gain).connect(context.destination);
    oscillator.start(start);
    oscillator.stop(start + duration + 0.03);
  }
  function playAlarm(sound = getAlarmSound()) {
    if (sound === "none") return false;
    const context = ensureAudioContext();
    // A timed alert still follows browser autoplay rules. It is enabled after
    // the user presses preview, changes a sound, or starts a timer.
    if (!audioArmed || !context || context.state !== "running") return false;
    const at = context.currentTime + 0.04;
    if (sound === "beep") {
      playTone(context, 880, at, 0.18, "square", 0.10);
      playTone(context, 880, at + 0.26, 0.18, "square", 0.10);
    } else if (sound === "chime") {
      playTone(context, 523.25, at, 0.48, "sine", 0.13);
      playTone(context, 659.25, at + 0.12, 0.52, "sine", 0.11);
      playTone(context, 783.99, at + 0.24, 0.58, "sine", 0.09);
    } else {
      playTone(context, 1046.5, at, 0.16, "sine", 0.15);
      playTone(context, 1318.5, at + 0.19, 0.22, "sine", 0.13);
      playTone(context, 1046.5, at + 0.46, 0.25, "sine", 0.14);
    }
    return true;
  }
  async function previewAlarm(sound = getAlarmSound()) {
    if (sound === "none") {
      setAlarmStatus(language() === "ja" ? "無音が選択されています。" : "무음이 선택되어 있어요.", "error");
      return false;
    }
    primeAlarmAudio();
    const context = await unlockAlarmAudio();
    if (!context || !playAlarm(sound)) {
      setAlarmStatus(language() === "ja" ? "ブラウザで音声がブロックされています。ページを一度タップしてからもう一度お試しください。" : "브라우저가 소리를 막고 있어요. 페이지를 한 번 누른 뒤 다시 시도해 주세요.", "error");
      return false;
    }
    setAlarmStatus(language() === "ja" ? "テスト音を再生しました。タイマーもこの音で通知します。" : "테스트 소리를 재생했어요. 타이머도 이 소리로 알려드려요.", "success");
    return true;
  }
  function notifyTimer(timer, stage) {
    const crop = getCrop(timer.cropId);
    if ("Notification" in window && Notification.permission === "granted") {
      try {
        new Notification(`🌱 ${cropName(crop)} · ${stage.id}`, {
          body: timer.label || (language() === "ja" ? "雑草を取りましょう。" : "잡초를 뽑을 시간이에요.")
        });
      } catch (_) {}
    }
  }
  function stopRepeatingAlert(timerId, persist = true) {
    const interval = repeatingAlerts.get(timerId);
    if (interval) clearInterval(interval);
    repeatingAlerts.delete(timerId);
    const timer = timers.find(item => item.id === timerId);
    if (timer && timer.alarmActive) {
      timer.alarmActive = false;
      if (persist) saveTimers();
    }
  }
  function startRepeatingAlert(timer) {
    stopRepeatingAlert(timer.id, false);
    if (!timer.repeat || getAlarmSound() === "none") return;
    timer.alarmActive = true;
    // Keep the warning tight: each bell phrase is about 0.7s, leaving only a brief gap.
    playAlarm();
    const interval = setInterval(() => playAlarm(), REPEAT_ALARM_INTERVAL_MS);
    repeatingAlerts.set(timer.id, interval);
    saveTimers();
  }
  function resumeActiveAlerts() {
    timers.filter(timer => timer.alarmActive && timer.repeat).forEach(timer => startRepeatingAlert(timer));
  }
  function checkTimerAlerts(initial = false) {
    const now = Date.now();
    let changed = false;
    timers.forEach(timer => {
      const notified = timer.notifiedStages || (timer.notifiedStages = {});
      stageData(timer).forEach(stage => {
        if (now < stage.at || notified[stage.id]) return;
        notified[stage.id] = true;
        changed = true;
        if (!initial && now - stage.at <= ALERT_GRACE_MS) {
          notifyTimer(timer, stage);
          if (timer.repeat) startRepeatingAlert(timer);
          else playAlarm();
        }
      });
    });
    if (changed) saveTimers();
  }
  function requestNotifications() {
    if (!("Notification" in window)) return;
    Notification.requestPermission().finally(renderNotificationButton);
  }
  function renderNotificationButton() {
    const button = $("notification-button");
    if (!("Notification" in window)) {
      button.textContent = t("cannotNotify");
      button.disabled = true;
      return;
    }
    if (Notification.permission === "granted") {
      button.textContent = t("notificationsEnabled");
      button.disabled = true;
    } else {
      button.textContent = t("allowNotifications");
      button.disabled = false;
    }
  }
  function renderCrops() {
    cropGrid.innerHTML = crops.map(crop => {
      const selected = crop.id === selectedCropId;
      return `<button class="farm-crop-card ${selected ? "is-selected" : ""}" type="button" data-crop="${esc(crop.id)}" aria-pressed="${selected}">
        ${crop.isNew ? '<span class="farm-new">NEW</span>' : ""}
        <span class="farm-crop-icon">${crop.icon}</span>
        <strong>${esc(cropName(crop))}</strong>
        <small>${esc(durationText(crop.minutes * 60))}</small>
      </button>`;
    }).join("");
    cropGrid.querySelectorAll("[data-crop]").forEach(button => {
      button.addEventListener("click", () => {
        selectedCropId = button.dataset.crop;
        renderCrops();
        refreshForm();
      });
    });
  }
  function setRemainingDefaults() {
    const crop = getCrop(selectedCropId);
    if (!crop) return;
    const total = crop.minutes * 60;
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    $("remaining-hours").value = h;
    $("remaining-minutes").value = m;
    $("remaining-seconds").value = 0;
  }
  function remainingSeconds() {
    const h = safeInt($("remaining-hours").value, 99);
    const m = safeInt($("remaining-minutes").value, 59);
    const s = safeInt($("remaining-seconds").value, 59);
    return h * 3600 + m * 60 + s;
  }
  function isRemainingMode() {
    return $("start-mode").checked;
  }
  function refreshForm() {
    const crop = getCrop(selectedCropId);
    const remaining = isRemainingMode();
    $("remaining-field").hidden = !remaining;

    if (!crop) {
      $("selected-crop-summary").textContent = t("choosePrompt");
      $("total-duration").textContent = "";
      plantButton.disabled = true;
      plantButtonLabel.textContent = t("plant");
      return;
    }

    const totalSeconds = crop.minutes * 60;
    $("total-duration").textContent = (language() === "ja" ? `合計 ${durationText(totalSeconds)} 中` : `총 ${durationText(totalSeconds)} 중`);
    $("selected-crop-summary").textContent = remaining
      ? t("continuingDuration").replace("{name}", cropName(crop)).replace("{time}", durationText(totalSeconds))
      : t("cropDuration").replace("{name}", cropName(crop)).replace("{time}", durationText(totalSeconds));
    plantButtonLabel.textContent = remaining ? t("continue") : t("plant");
    plantButton.disabled = false;
  }
  function onRemainingToggle() {
    if (isRemainingMode()) setRemainingDefaults();
    refreshForm();
  }
  function plant() {
    const crop = getCrop(selectedCropId);
    if (!crop) return;
    const fullSeconds = crop.minutes * 60;
    const usingRemaining = isRemainingMode();
    let remain = usingRemaining ? remainingSeconds() : fullSeconds;

    if (usingRemaining && remain < 1) {
      alert(t("remainingRequired"));
      return;
    }
    if (remain > fullSeconds) {
      alert(t("remainingTooLong").replace("{time}", durationText(fullSeconds)));
      remain = fullSeconds;
    }

    const now = Date.now();
    const durationMs = fullSeconds * 1000;
    const harvestAt = now + remain * 1000;
    const plantedAt = harvestAt - durationMs;
    // In "remaining time" mode the crop was planted before this timer was created.
    // Mark stages that are already passed — or less than a minute away — as handled,
    // so a timer started at e.g. 1:10 remaining does not ring again at 1:00 for W3.
    const notifiedStages = {};
    if (usingRemaining) {
      const skipUntil = now + CONTINUE_STAGE_SKIP_WINDOW_MS;
      const provisional = { plantedAt, harvestAt, durationMs };
      stageData(provisional).forEach(stage => {
        if (stage.at <= skipUntil) notifiedStages[stage.id] = true;
      });
    }
    const timer = {
      id: crypto.randomUUID ? crypto.randomUUID() : `${now}-${Math.random()}`,
      cropId: crop.id,
      plantedAt,
      harvestAt,
      durationMs,
      label: $("farm-label").value.trim(),
      repeat: $("repeat-alert").checked,
      alarmActive: false,
      notifiedStages
    };
    timers.unshift(timer);
    timers = timers.slice(0, 30);
    saveTimers();
    $("farm-label").value = "";
    renderTimers();
  }
  function timerState(timer) {
    const now = Date.now();
    const harvest = getHarvestAt(timer);
    const stages = stageData(timer);
    const w4 = stages[3];

    if (now >= w4.at) return { kind:"complete", time:0, next:null };
    if (now >= harvest) return { kind:"mature", time:w4.at - now, next:w4 };

    // Before harvest, show the next weed only while it is one of W1–W3.
    // Once W3 has passed, the prominent countdown must stay on the harvest
    // time itself; otherwise 12 seconds remaining looks like a false 1:12 timer.
    const nextGrowthStage = stages.slice(0, 3).find(stage => now < stage.at);
    if (nextGrowthStage) return { kind:"growing", time:nextGrowthStage.at - now, next:nextGrowthStage };
    return { kind:"harvestSoon", time:harvest - now, next:null };
  }
  function progressPercent(timer, now = Date.now()) {
    const timeline = timelineData();
    const harvest = getHarvestAt(timer);
    const w4At = harvest + 60000;

    // Before 0:00, the green bar grows normally and reaches W3 exactly at harvest.
    if (now <= harvest) {
      const grown = Math.max(0, now - timer.plantedAt);
      return Math.max(0, Math.min(timeline.w3, (grown / timer.durationMs) * timeline.w3));
    }

    // After W3, only the small red warning segment advances. It intentionally
    // stops before the ellipsis/W4 marker instead of filling the whole tail.
    const finalFraction = Math.max(0, Math.min(1, (now - harvest) / (w4At - harvest)));
    return timeline.w3 + finalFraction * (timeline.warningEnd - timeline.w3);
  }
  function renderTimerCard(timer, options = {}) {
    const crop = getCrop(timer.cropId);
    if (!crop) return "";

    const now = Date.now();
    const state = timerState(timer);
    const stages = stageData(timer);
    const timeline = timelineData(timer);
    const progress = progressPercent(timer, now);
    const alarmIsRepeating = Boolean(timer.alarmActive);

    let statusLine = "";
    if (state.kind === "growing") {
      statusLine = `<span class="farm-card-status">${esc(t("nextWeed").replace("{stage}", state.next.id))}</span>
                    <strong>${esc(countdownText(state.time))}</strong>`;
    } else if (state.kind === "harvestSoon") {
      statusLine = `<span class="farm-card-status">🌱 ${esc(language() === "ja" ? "収穫まで" : "수확까지")}</span>
                    <strong>${esc(countdownText(state.time))}</strong>`;
    } else if (state.kind === "mature") {
      statusLine = `<span class="farm-card-status farm-status-mature">${esc(t("nextWeed").replace("{stage}", "W4"))}</span>
                    <strong>${esc(countdownText(state.time))}</strong>
                    <em>✨ ${esc(language() === "ja" ? "成熟！少し後に最後の雑草を取りましょう" : "성숙됨! 잠시 후 마지막 잡초 제거")}</em>`;
    } else {
      statusLine = `<strong class="farm-complete-title">${esc(t("harvestReady"))}</strong>`;
    }

    const markers = stages.map(stage => {
      const passed = now >= stage.at;
      const current = state.next && state.next.id === stage.id;
      // W3 remains a green maturity marker. The red/orange warning begins
      // immediately to its right and leads toward W4.
      const warning = stage.id === "W4";
      const cls = `farm-marker farm-marker-${stage.id.toLowerCase()} ${warning ? "is-warning" : ""} ${passed ? "is-passed" : ""} ${current ? "is-current" : ""}`;
      const position = timeline[stage.id.toLowerCase()];
      return `<span class="${cls}" style="left:${position}%" title="${esc(`${stage.id} · ${stage.label}`)}"><i></i><b>${esc(stage.label)}</b></span>`;
    }).join("");
    // The dots are a deliberate visual gap after the red W3→W4 warning segment.
    const finalGapDots = `<span class="farm-final-gap-dots" style="left:${timeline.dots}%" aria-hidden="true">···</span>`;

    const chips = stages.map(stage => {
      const passed = now >= stage.at;
      return `<span class="farm-stage-chip ${passed ? "is-passed" : ""}">${passed ? "✓ " : ""}${stage.id}</span>`;
    }).join('<span class="farm-stage-dot">·</span>');

    const lowerRight = (state.kind === "complete" || state.kind === "harvestSoon") ? "" :
      `<span class="farm-harvest-note">${esc(t("harvestAt").replace("{time}", countdownText(Math.max(0, getHarvestAt(timer) - now))))}</span>`;

    return `<article class="farm-timer-card ${state.kind === "mature" ? "is-mature" : ""} ${state.kind === "complete" ? "is-complete" : ""}" data-timer="${esc(timer.id)}">
      <div class="farm-timer-top">
        <div class="farm-timer-title">
          <span class="farm-timer-icon">${crop.icon}</span>
          <div>
            <h3>${esc(timer.label || cropName(crop))}</h3>
            ${timer.label ? `<p class="farm-crop-subtitle">${esc(cropName(crop))}</p>` : ""}
          </div>
        </div>
        <button class="farm-delete" type="button" data-delete="${esc(timer.id)}" aria-label="${esc(t("delete"))}">🗑</button>
      </div>
      <div class="farm-timer-state">${statusLine}</div>
      <div class="farm-progress-line" aria-hidden="true">
        <span class="farm-progress-fill farm-progress-fill-green" style="width:${Math.min(progress, timeline.w3)}%"></span>
        <span class="farm-progress-fill farm-progress-fill-warning" style="left:${timeline.w3}%;width:${Math.max(0, progress - timeline.w3)}%"></span>
        ${markers}
        ${finalGapDots}
      </div>
      <div class="farm-card-bottom">
        <div class="farm-stage-chips">${chips}</div>
        <div class="farm-card-actions">${alarmIsRepeating ? `<button class="farm-alarm-ack" type="button" data-ack-alarm="${esc(timer.id)}">🔕 ${language() === "ja" ? "アラーム確認" : "알람 확인"}</button>` : ""}${lowerRight}</div>
      </div>
    </article>`;
  }
  function renderTimers() {
    timers = timers.filter(timer => getCrop(timer.cropId));
    saveTimers();
    timerList.innerHTML = timers.map(timer => renderTimerCard(timer)).join("");
    emptyState.hidden = timers.length > 0;
    $("clear-all-button").hidden = timers.length === 0;

    timerList.querySelectorAll("[data-delete]").forEach(button => {
      button.addEventListener("click", event => {
        event.stopPropagation();
        removeTimer(button.dataset.delete);
      });
    });
    timerList.querySelectorAll("[data-ack-alarm]").forEach(button => {
      button.addEventListener("click", event => {
        event.stopPropagation();
        stopRepeatingAlert(button.dataset.ackAlarm);
        renderTimers();
      });
    });
    timerList.querySelectorAll(".farm-timer-card").forEach(card => {
      card.addEventListener("click", event => {
        if (event.target.closest("[data-delete]")) return;
        openModal(card.dataset.timer);
      });
    });
    if (activeModalId) refreshModal();
  }
  function removeTimer(id) {
    // Single-card trash: delete immediately, without the browser confirmation popup.
    stopRepeatingAlert(id);
    timers = timers.filter(timer => timer.id !== id);
    saveTimers();
    if (activeModalId === id) closeModal();
    renderTimers();
  }
  function clearAll() {
    if (!timers.length || !confirm(t("clearConfirm"))) return;
    repeatingAlerts.forEach((_, id) => stopRepeatingAlert(id));
    timers = [];
    saveTimers();
    closeModal();
    renderTimers();
  }
  function openModal(id) {
    const timer = timers.find(item => item.id === id);
    if (!timer) return;
    activeModalId = id;
    refreshModal();
    modal.hidden = false;
    document.body.classList.add("farm-modal-open");
  }
  function closeModal() {
    activeModalId = null;
    modal.hidden = true;
    document.body.classList.remove("farm-modal-open");
  }
  function refreshModal() {
    const timer = timers.find(item => item.id === activeModalId);
    if (!timer) { closeModal(); return; }
    modalContent.innerHTML = renderTimerCard(timer, { compact:false });
    modalContent.querySelector(".farm-timer-card")?.classList.add("farm-modal-card");
    modalContent.querySelector("[data-delete]")?.addEventListener("click", () => removeTimer(timer.id));
    modalContent.querySelector("[data-ack-alarm]")?.addEventListener("click", event => {
      event.stopPropagation();
      stopRepeatingAlert(timer.id);
      renderTimers();
    });
  }
  function bindHelp() {
    const button = $("help-toggle");
    const body = $("help-body");
    button.addEventListener("click", () => {
      const open = button.getAttribute("aria-expanded") === "true";
      button.setAttribute("aria-expanded", String(!open));
      body.hidden = open;
    });
  }
  function init() {
    document.documentElement.dataset.farmTimerBuild = BUILD_VERSION;
    $("notification-button").addEventListener("click", requestNotifications);
    $("alarm-sound").value = getAlarmSound();
    $("alarm-sound").addEventListener("change", event => {
      setAlarmSound(event.target.value);
      previewAlarm(event.target.value);
    });
    $("test-alarm-button").addEventListener("click", () => previewAlarm());
    $("start-mode").addEventListener("change", onRemainingToggle);
    ["remaining-hours","remaining-minutes","remaining-seconds"].forEach(id => $(id).addEventListener("input", refreshForm));
    plantButton.addEventListener("click", () => {
      // Keep audio permission available for the scheduled weed notifications.
      primeAlarmAudio();
      plant();
    });
    $("clear-all-button").addEventListener("click", clearAll);
    $("modal-close").addEventListener("click", closeModal);
    modal.addEventListener("click", event => { if (event.target.matches("[data-close-modal]")) closeModal(); });
    bindHelp();

    document.addEventListener("site-language-changed", () => {
      renderNotificationButton();
      renderCrops();
      refreshForm();
      renderTimers();
    });

    saveTimers();
    renderNotificationButton();
    renderCrops();
    refreshForm();
    checkTimerAlerts(true);
    resumeActiveAlerts();
    renderTimers();
    // Frequent updates prevent the visible one-second progress-bar lag.
    setInterval(() => {
      checkTimerAlerts(false);
      renderTimers();
    }, 250);
  }
  document.addEventListener("DOMContentLoaded", init);
})();