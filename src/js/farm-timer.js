(() => {
  "use strict";

  const STORAGE_KEY = "heartopia_farm_timers_v2";
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
    { id:"teaPowder", name:"찻잎", ja:"茶葉", minutes:45, icon:"🍵" },
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
      nextWeed:"🌱 다음 잡초 · {stage}", mature:"성숙! 마지막 잡초를 제거하세요", afterMature:"성숙 후 · 마지막 잡초 제거",
      harvestReady:"🌱 재배 완료!", harvestAt:"수확까지 {time}", matureTip:"✨ 성숙! 잡초 후 마지막 잡초 제거",
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
  function loadTimers() {
    const arrays = [];
    for (const key of [STORAGE_KEY, "heartopia_farm_timers_v1"]) {
      try {
        const parsed = JSON.parse(localStorage.getItem(key) || "[]");
        if (Array.isArray(parsed)) arrays.push(...parsed);
      } catch {}
    }
    const unique = new Map();
    arrays.forEach(raw => {
      if (!raw || !raw.id || !raw.cropId) return;
      const crop = getCrop(raw.cropId);
      if (!crop) return;
      const durationMs = Number(raw.durationMs) || crop.minutes * 60000;
      const harvestAt = Number(raw.harvestAt) || ((Number(raw.plantedAt) || Date.now()) + durationMs);
      const plantedAt = Number(raw.plantedAt) || (harvestAt - durationMs);
      unique.set(raw.id, {
        id: raw.id, cropId: raw.cropId, plantedAt, harvestAt, durationMs,
        label: String(raw.label || ""), repeat: Boolean(raw.repeat)
      });
    });
    return [...unique.values()].slice(-30);
  }
  function saveTimers() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(timers));
  }
  function getHarvestAt(timer) { return Number(timer.harvestAt); }
  function stageData(timer) {
    const harvest = getHarvestAt(timer);
    const planted = timer.plantedAt;
    const full = timer.durationMs;
    return [
      { id:"W1", at: planted + full / 3, label: `${Math.round(full / 180000)}${language()==="ja" ? "分" : "분"}` },
      { id:"W2", at: planted + full * 2 / 3, label: `${Math.round(full / 90000)}${language()==="ja" ? "分" : "분"}` },
      { id:"W3", at: harvest - 60000, label: t("justBefore") },
      { id:"W4", at: harvest + 60000, label: t("after") }
    ];
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
    const timer = {
      id: crypto.randomUUID ? crypto.randomUUID() : `${now}-${Math.random()}`,
      cropId: crop.id,
      plantedAt,
      harvestAt,
      durationMs,
      label: $("farm-label").value.trim(),
      repeat: $("repeat-alert").checked
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
    if (now >= stages[3].at) return { kind:"after", label:t("afterMature"), time: now - stages[3].at };
    if (now >= harvest) return { kind:"mature", label:t("mature"), time: now - harvest };
    const next = stages.find(stage => now < stage.at) || { id:"HARVEST", at:harvest };
    return { kind:"growing", label:t("nextWeed").replace("{stage}", next.id), time: next.at - now, next };
  }
  function progressPercent(timer) {
    const full = timer.durationMs;
    return Math.max(0, Math.min(100, ((Date.now() - timer.plantedAt) / full) * 100));
  }
  function renderTimerCard(timer, options = {}) {
    const crop = getCrop(timer.cropId);
    if (!crop) return "";
    const state = timerState(timer);
    const stages = stageData(timer);
    const now = Date.now();
    const compact = Boolean(options.compact);
    const progress = progressPercent(timer);
    const statusLine = state.kind === "growing"
      ? `<span class="farm-card-status">${esc(state.label)}</span><strong>${esc(countdownText(state.time))}</strong>`
      : state.kind === "mature"
        ? `<span class="farm-card-status farm-status-mature">${esc(t("mature"))}</span><strong>${esc(countdownText(Math.max(0, stages[3].at - now)))}</strong><em>${esc(t("matureTip"))}</em>`
        : `<span class="farm-card-status farm-status-after">${esc(t("afterMature"))}</span><strong>${esc(countdownText(Math.max(0, now - stages[3].at)) )}</strong><em>${esc(t("harvestReady"))}</em>`;

    const markers = stages.map((stage, index) => {
      const passed = now >= stage.at;
      const current = state.kind === "growing" && state.next?.id === stage.id;
      const pos = [33.333, 66.666, 87.5, 100][index];
      return `<span class="farm-marker ${passed ? "is-passed" : ""} ${current ? "is-current" : ""}" style="left:${pos}%">
        <i></i><b>${esc(stage.label)}</b>
      </span>`;
    }).join("");

    const chips = stages.map(stage => {
      const passed = now >= stage.at;
      return `<span class="farm-stage-chip ${passed ? "is-passed" : ""}">${passed ? "✓ " : ""}${stage.id}</span>`;
    }).join('<span class="farm-stage-dot">·</span>');

    return `<article class="farm-timer-card ${state.kind === "mature" ? "is-mature" : ""} ${state.kind === "after" ? "is-after" : ""}" data-timer="${esc(timer.id)}">
      <div class="farm-timer-top">
        <div class="farm-timer-title">
          <span class="farm-timer-icon">${crop.icon}</span>
          <div><h3>${esc(cropName(crop))}</h3>${timer.label ? `<p>${esc(timer.label)}</p>` : ""}</div>
        </div>
        <button class="farm-delete" type="button" data-delete="${esc(timer.id)}" aria-label="${esc(t("delete"))}">🗑</button>
      </div>
      <div class="farm-timer-state">${statusLine}</div>
      <div class="farm-progress-line" aria-hidden="true">
        <span class="farm-progress-fill" style="width:${progress}%"></span>
        ${markers}
      </div>
      <div class="farm-card-bottom">
        <div class="farm-stage-chips">${chips}</div>
        <span class="farm-harvest-note">${state.kind === "growing" ? esc(t("harvestAt").replace("{time}", countdownText(getHarvestAt(timer) - now))) : esc(t("harvestReady"))}</span>
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
    timerList.querySelectorAll(".farm-timer-card").forEach(card => {
      card.addEventListener("click", event => {
        if (event.target.closest("[data-delete]")) return;
        openModal(card.dataset.timer);
      });
    });
    if (activeModalId) refreshModal();
  }
  function removeTimer(id) {
    if (!confirm(t("deleteConfirm"))) return;
    timers = timers.filter(timer => timer.id !== id);
    saveTimers();
    if (activeModalId === id) closeModal();
    renderTimers();
  }
  function clearAll() {
    if (!timers.length || !confirm(t("clearConfirm"))) return;
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
    $("notification-button").addEventListener("click", requestNotifications);
    $("start-mode").addEventListener("change", onRemainingToggle);
    ["remaining-hours","remaining-minutes","remaining-seconds"].forEach(id => $(id).addEventListener("input", refreshForm));
    plantButton.addEventListener("click", plant);
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

    renderNotificationButton();
    renderCrops();
    refreshForm();
    renderTimers();
    setInterval(renderTimers, 1000);
  }
  document.addEventListener("DOMContentLoaded", init);
})();