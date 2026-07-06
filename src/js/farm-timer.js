(() => {
  'use strict';

  const STORAGE_KEY = 'heartopia_farm_timers_v2';
  const LEGACY_STORAGE_KEY = 'heartopia_farm_timers_v1';
  const ALARM_SOUND_KEY = 'heartopia_farm_alarm_sound_v1';
  const REPEAT_INTERVAL_MS = 800;
  const ALERT_WINDOW_MS = 90_000;
  const RENDER_INTERVAL_MS = 500;
  const MAX_TIMERS = 30;

  const CROPS = [
    { id: 'tomato', name: '토마토', ja: 'トマト', minutes: 15, icon: '🍅' },
    { id: 'rice', name: '벼', ja: '米', minutes: 20, icon: '🍚', isNew: true },
    { id: 'pineapple', name: '파인애플', ja: 'パイナップル', minutes: 30, icon: '🍍' },
    { id: 'tea', name: '찻잎', ja: '茶葉', minutes: 45, icon: '🍃' },
    { id: 'potato', name: '감자', ja: 'ジャガイモ', minutes: 60, icon: '🥔' },
    { id: 'carrot', name: '당근', ja: 'ニンジン', minutes: 120, icon: '🥕' },
    { id: 'wheat', name: '밀', ja: '小麦', minutes: 240, icon: '🌾' },
    { id: 'strawberry', name: '딸기', ja: 'いちご', minutes: 360, icon: '🍓' },
    { id: 'eggplant', name: '가지', ja: 'ナス', minutes: 420, icon: '🍆' },
    { id: 'lettuce', name: '양상추', ja: 'レタス', minutes: 480, icon: '🥬' },
    { id: 'grape', name: '포도', ja: 'ブドウ', minutes: 600, icon: '🍇' },
    { id: 'corn', name: '옥수수', ja: 'トウモロコシ', minutes: 720, icon: '🌽' },
    { id: 'cacao', name: '카카오', ja: 'カカオ', minutes: 300, icon: '🍫' },
    { id: 'avocado', name: '아보카도', ja: 'アボカド', minutes: 840, icon: '🥑' }
  ];

  const COPY = {
    ko: {
      allowNotifications: '🔔 알림 허용',
      notificationsEnabled: '🔔 알림 켜짐',
      cannotNotify: '알림을 지원하지 않는 브라우저예요.',
      choosePrompt: '작물을 선택해 주세요.',
      cropDuration: '{name} · 수확까지 {time}',
      continuingDuration: '{name} · 총 {time} 중',
      plant: '작물 심기',
      continue: '이어서 시작',
      remainingRequired: '남은 시간을 1초 이상 입력해 주세요.',
      remainingTooLong: '입력한 시간이 작물 전체 성장 시간보다 길어요. 최대 {time}으로 적용했어요.',
      delete: '삭제',
      clearConfirm: '진행 중인 작물을 모두 삭제할까요?',
      nextWeed: '🌱 다음 잡초 · {stage}',
      harvestReady: '🌱 재배 완료!',
      harvestAt: '수확까지 {time}',
      matureTip: '✨ 성숙됨! 잠시 후 마지막 잡초 제거',
      justBefore: '성숙 직전',
      after: '성숙 후'
    },
    ja: {
      allowNotifications: '🔔 通知を許可',
      notificationsEnabled: '🔔 通知オン',
      cannotNotify: 'このブラウザは通知に対応していません。',
      choosePrompt: '作物を選んでください。',
      cropDuration: '{name} · 収穫まで {time}',
      continuingDuration: '{name} · 合計 {time} 中',
      plant: '作物を植える',
      continue: '続きから開始',
      remainingRequired: '残り時間を1秒以上入力してください。',
      remainingTooLong: '入力した時間が作物の成長時間より長いため、最大 {time}で設定しました。',
      delete: '削除',
      clearConfirm: '栽培中の作物をすべて削除しますか？',
      nextWeed: '🌱 次の雑草 · {stage}',
      harvestReady: '🌱 栽培完了！',
      harvestAt: '収穫まで {time}',
      matureTip: '✨ 成熟！少し後に最後の雑草を取りましょう',
      justBefore: '成熟直前',
      after: '成熟後'
    }
  };

  const $ = (id) => document.getElementById(id);
  const cropGrid = $('crop-grid');
  const timerList = $('timer-list');
  const emptyState = $('empty-state');
  const plantButton = $('plant-button');
  const plantButtonLabel = $('plant-button-label');
  const modal = $('timer-modal');
  const modalContent = $('timer-modal-content');

  let selectedCropId = null;
  let timers = loadTimers();
  let activeModalId = null;
  let audioContext = null;
  let audioUnlocked = false;
  const repeatingAlarms = new Map();

  function language() {
    return window.getSiteLanguage?.() || 'ko';
  }

  function text(key) {
    return (COPY[language()] || COPY.ko)[key] || COPY.ko[key] || '';
  }

  function cropName(crop) {
    return language() === 'ja' ? crop.ja : crop.name;
  }

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, (char) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[char]));
  }

  function getCrop(cropId) {
    return CROPS.find((crop) => crop.id === cropId);
  }

  function durationText(totalSeconds) {
    const seconds = Math.max(0, Math.round(totalSeconds));
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;
    const unit = language() === 'ja' ? { h: '時間', m: '分', s: '秒' } : { h: '시간', m: '분', s: '초' };

    if (hours) return minutes ? `${hours}${unit.h} ${minutes}${unit.m}` : `${hours}${unit.h}`;
    if (minutes) return `${minutes}${unit.m}`;
    return `${secs}${unit.s}`;
  }

  function countdownText(milliseconds) {
    const total = Math.max(0, Math.ceil(milliseconds / 1000));
    const hours = Math.floor(total / 3600);
    const minutes = Math.floor((total % 3600) / 60);
    const seconds = total % 60;
    return hours
      ? `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
      : `${minutes}:${String(seconds).padStart(2, '0')}`;
  }

  function clampInteger(value, max) {
    return Math.max(0, Math.min(max, Number.parseInt(value, 10) || 0));
  }

  function timerId() {
    return window.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }

  function normalizeTimers(rawTimers) {
    const unique = new Map();

    for (const raw of Array.isArray(rawTimers) ? rawTimers : []) {
      const crop = getCrop(raw?.cropId);
      if (!raw?.id || !crop) continue;

      const durationMs = Number(raw.durationMs) || crop.minutes * 60_000;
      const plantedAt = Number(raw.plantedAt) || Date.now();
      const harvestAt = Number(raw.harvestAt) || plantedAt + durationMs;

      unique.set(raw.id, {
        id: String(raw.id),
        cropId: crop.id,
        plantedAt: harvestAt - durationMs,
        harvestAt,
        durationMs,
        label: String(raw.label || '').slice(0, 30),
        repeat: Boolean(raw.repeat),
        alarmActive: Boolean(raw.alarmActive),
        notifiedStages: raw.notifiedStages && typeof raw.notifiedStages === 'object' ? raw.notifiedStages : {}
      });
    }

    return [...unique.values()].slice(-MAX_TIMERS);
  }

  function loadTimers() {
    try {
      return normalizeTimers(JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]'));
    } catch {
      return [];
    }
  }

  function saveTimers() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(timers));
    localStorage.removeItem(LEGACY_STORAGE_KEY);
  }

  function stagesFor(timer) {
    const { plantedAt, harvestAt, durationMs } = timer;
    const minute = 60_000;
    const units = language() === 'ja' ? '分' : '분';

    return [
      { id: 'W1', at: plantedAt + durationMs / 3, label: `${Math.round(durationMs / 180_000)}${units}` },
      { id: 'W2', at: plantedAt + (durationMs * 2) / 3, label: `${Math.round(durationMs / 90_000)}${units}` },
      { id: 'W3', at: harvestAt - minute, label: text('justBefore') },
      { id: 'W4', at: harvestAt + minute, label: text('after') }
    ];
  }

  function timelineFor(timer) {
    const stages = stagesFor(timer);
    const start = timer.plantedAt;
    const end = stages.at(-1).at;
    const width = Math.max(1, end - start);
    const positionOf = (at) => Math.max(0, Math.min(100, ((at - start) / width) * 100));

    return {
      start,
      end,
      positions: Object.fromEntries(stages.map((stage) => [stage.id, positionOf(stage.at)]))
    };
  }

  function progressPercent(timer, now = Date.now()) {
    const timeline = timelineFor(timer);
    const raw = Math.max(0, Math.min(100, ((now - timeline.start) / (timeline.end - timeline.start)) * 100));
    const latestPassed = stagesFor(timer).filter((stage) => now >= stage.at).at(-1);

    // Once a weed moment has passed, the fill is visually just beyond its marker.
    if (!latestPassed) return raw;
    return Math.min(100, Math.max(raw, timeline.positions[latestPassed.id] + 0.25));
  }

  function timerState(timer, now = Date.now()) {
    const stages = stagesFor(timer);
    const harvestAt = timer.harvestAt;
    const w4 = stages[3];

    if (now >= w4.at) return { kind: 'complete', next: null, remainingMs: 0 };
    if (now >= harvestAt) return { kind: 'mature', next: w4, remainingMs: w4.at - now };

    const next = stages.find((stage) => now < stage.at) || w4;
    return { kind: 'growing', next, remainingMs: next.at - now };
  }

  function getAlarmSound() {
    return localStorage.getItem(ALARM_SOUND_KEY) || 'bell';
  }

  function setAlarmSound(value) {
    localStorage.setItem(ALARM_SOUND_KEY, value);
  }

  function setAlarmStatus(message, state = '') {
    const status = $('alarm-status');
    if (!status) return;
    status.textContent = message;
    status.className = `farm-alarm-status${state ? ` is-${state}` : ''}`;
  }

  function getAudioContext() {
    const Constructor = window.AudioContext || window.webkitAudioContext;
    if (!Constructor) return null;
    if (!audioContext) audioContext = new Constructor();
    return audioContext;
  }

  async function unlockAudio() {
    const context = getAudioContext();
    if (!context) return null;

    try {
      if (context.state === 'suspended') await context.resume();
      audioUnlocked = context.state === 'running';
      return audioUnlocked ? context : null;
    } catch {
      audioUnlocked = false;
      return null;
    }
  }

  function tone(context, frequency, startAt, duration, type = 'sine', volume = 0.12) {
    const oscillator = context.createOscillator();
    const gain = context.createGain();

    oscillator.type = type;
    oscillator.frequency.setValueAtTime(frequency, startAt);
    gain.gain.setValueAtTime(0.0001, startAt);
    gain.gain.exponentialRampToValueAtTime(volume, startAt + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, startAt + duration);
    oscillator.connect(gain).connect(context.destination);
    oscillator.start(startAt);
    oscillator.stop(startAt + duration + 0.03);
  }

  function playAlarm(sound = getAlarmSound()) {
    if (sound === 'none' || !audioUnlocked) return false;
    const context = getAudioContext();
    if (!context || context.state !== 'running') return false;

    const at = context.currentTime + 0.03;
    if (sound === 'beep') {
      tone(context, 880, at, 0.16, 'square', 0.10);
      tone(context, 880, at + 0.22, 0.16, 'square', 0.10);
    } else if (sound === 'chime') {
      tone(context, 523.25, at, 0.40, 'sine', 0.13);
      tone(context, 659.25, at + 0.12, 0.45, 'sine', 0.11);
      tone(context, 783.99, at + 0.24, 0.50, 'sine', 0.09);
    } else {
      tone(context, 1046.5, at, 0.14, 'sine', 0.15);
      tone(context, 1318.5, at + 0.17, 0.20, 'sine', 0.13);
      tone(context, 1046.5, at + 0.41, 0.22, 'sine', 0.14);
    }
    return true;
  }

  async function previewAlarm(sound = getAlarmSound()) {
    if (sound === 'none') {
      setAlarmStatus(language() === 'ja' ? '無音が選択されています。' : '무음이 선택되어 있어요.', 'error');
      return;
    }

    const context = await unlockAudio();
    if (!context || !playAlarm(sound)) {
      setAlarmStatus(language() === 'ja' ? 'ブラウザで音声がブロックされています。ページを一度タップしてからもう一度お試しください。' : '브라우저가 소리를 막고 있어요. 페이지를 한 번 누른 뒤 다시 시도해 주세요.', 'error');
      return;
    }

    setAlarmStatus(language() === 'ja' ? 'テスト音を再生しました。' : '테스트 소리를 재생했어요.', 'success');
  }

  function notify(timer, stage) {
    const crop = getCrop(timer.cropId);
    if (!crop || !('Notification' in window) || Notification.permission !== 'granted') return;

    try {
      new Notification(`🌱 ${cropName(crop)} · ${stage.id}`, {
        body: timer.label || (language() === 'ja' ? '雑草を取りましょう。' : '잡초를 뽑을 시간이에요.')
      });
    } catch {
      // Browser notification failures are non-fatal.
    }
  }

  function stopRepeatingAlarm(timerId, persist = true) {
    const interval = repeatingAlarms.get(timerId);
    if (interval) clearInterval(interval);
    repeatingAlarms.delete(timerId);

    const timer = timers.find((item) => item.id === timerId);
    if (timer && timer.alarmActive) {
      timer.alarmActive = false;
      if (persist) saveTimers();
    }
  }

  function startRepeatingAlarm(timer) {
    stopRepeatingAlarm(timer.id, false);
    if (!timer.repeat || getAlarmSound() === 'none') return;

    timer.alarmActive = true;
    playAlarm();
    repeatingAlarms.set(timer.id, window.setInterval(() => playAlarm(), REPEAT_INTERVAL_MS));
    saveTimers();
  }

  function resumeVisibleAlarmStates() {
    for (const timer of timers) {
      if (timer.alarmActive && timer.repeat) startRepeatingAlarm(timer);
    }
  }

  function checkAlerts(initialLoad = false) {
    const now = Date.now();
    let changed = false;

    for (const timer of timers) {
      const notified = timer.notifiedStages || (timer.notifiedStages = {});
      for (const stage of stagesFor(timer)) {
        if (notified[stage.id] || now < stage.at) continue;
        notified[stage.id] = true;
        changed = true;

        if (!initialLoad && now - stage.at <= ALERT_WINDOW_MS) {
          notify(timer, stage);
          if (timer.repeat) startRepeatingAlarm(timer);
          else playAlarm();
        }
      }
    }

    if (changed) saveTimers();
  }

  function requestNotifications() {
    if ('Notification' in window) Notification.requestPermission().finally(renderNotificationButton);
  }

  function renderNotificationButton() {
    const button = $('notification-button');
    if (!button) return;

    if (!('Notification' in window)) {
      button.textContent = text('cannotNotify');
      button.disabled = true;
    } else if (Notification.permission === 'granted') {
      button.textContent = text('notificationsEnabled');
      button.disabled = true;
    } else {
      button.textContent = text('allowNotifications');
      button.disabled = false;
    }
  }

  function renderCrops() {
    cropGrid.innerHTML = CROPS.map((crop) => {
      const selected = crop.id === selectedCropId;
      return `<button class="farm-crop-card ${selected ? 'is-selected' : ''}" type="button" data-crop="${escapeHtml(crop.id)}" aria-pressed="${selected}">
        ${crop.isNew ? '<span class="farm-new">NEW</span>' : ''}
        <span class="farm-crop-icon">${crop.icon}</span>
        <strong>${escapeHtml(cropName(crop))}</strong>
        <small>${escapeHtml(durationText(crop.minutes * 60))}</small>
      </button>`;
    }).join('');

    cropGrid.querySelectorAll('[data-crop]').forEach((button) => {
      button.addEventListener('click', () => {
        selectedCropId = button.dataset.crop;
        renderCrops();
        refreshForm();
      });
    });
  }

  function setRemainingDefaults() {
    const crop = getCrop(selectedCropId);
    if (!crop) return;

    const seconds = crop.minutes * 60;
    $('remaining-hours').value = Math.floor(seconds / 3600);
    $('remaining-minutes').value = Math.floor((seconds % 3600) / 60);
    $('remaining-seconds').value = 0;
  }

  function remainingSeconds() {
    return clampInteger($('remaining-hours').value, 99) * 3600
      + clampInteger($('remaining-minutes').value, 59) * 60
      + clampInteger($('remaining-seconds').value, 59);
  }

  function remainingMode() {
    return $('start-mode').checked;
  }

  function refreshForm() {
    const crop = getCrop(selectedCropId);
    const useRemaining = remainingMode();
    $('remaining-field').hidden = !useRemaining;

    if (!crop) {
      $('selected-crop-summary').textContent = text('choosePrompt');
      $('total-duration').textContent = '';
      plantButton.disabled = true;
      plantButtonLabel.textContent = text('plant');
      return;
    }

    const totalSeconds = crop.minutes * 60;
    $('total-duration').textContent = language() === 'ja' ? `合計 ${durationText(totalSeconds)} 中` : `총 ${durationText(totalSeconds)} 중`;
    $('selected-crop-summary').textContent = (useRemaining ? text('continuingDuration') : text('cropDuration'))
      .replace('{name}', cropName(crop))
      .replace('{time}', durationText(totalSeconds));
    plantButtonLabel.textContent = useRemaining ? text('continue') : text('plant');
    plantButton.disabled = false;
  }

  function createTimer() {
    const crop = getCrop(selectedCropId);
    if (!crop) return;

    const fullSeconds = crop.minutes * 60;
    let remaining = remainingMode() ? remainingSeconds() : fullSeconds;

    if (remainingMode() && remaining < 1) {
      alert(text('remainingRequired'));
      return;
    }
    if (remaining > fullSeconds) {
      alert(text('remainingTooLong').replace('{time}', durationText(fullSeconds)));
      remaining = fullSeconds;
    }

    const now = Date.now();
    const durationMs = fullSeconds * 1000;
    timers.unshift({
      id: timerId(),
      cropId: crop.id,
      plantedAt: now + remaining * 1000 - durationMs,
      harvestAt: now + remaining * 1000,
      durationMs,
      label: $('farm-label').value.trim(),
      repeat: $('repeat-alert').checked,
      alarmActive: false,
      notifiedStages: {}
    });
    timers = timers.slice(0, MAX_TIMERS);
    saveTimers();
    $('farm-label').value = '';
    renderTimers();
  }

  function renderTimerCard(timer) {
    const crop = getCrop(timer.cropId);
    if (!crop) return '';

    const now = Date.now();
    const stages = stagesFor(timer);
    const timeline = timelineFor(timer);
    const state = timerState(timer, now);
    const progress = state.kind === 'complete' ? 100 : progressPercent(timer, now);

    let status = '';
    if (state.kind === 'complete') {
      status = `<strong class="farm-complete-title">${escapeHtml(text('harvestReady'))}</strong>`;
    } else if (state.kind === 'mature') {
      status = `<span class="farm-card-status farm-status-mature">${escapeHtml(text('nextWeed').replace('{stage}', 'W4'))}</span>
        <strong>${escapeHtml(countdownText(state.remainingMs))}</strong>
        <em>${escapeHtml(text('matureTip'))}</em>`;
    } else {
      status = `<span class="farm-card-status">${escapeHtml(text('nextWeed').replace('{stage}', state.next.id))}</span>
        <strong>${escapeHtml(countdownText(state.remainingMs))}</strong>`;
    }

    const markers = stages.map((stage) => {
      const passed = now >= stage.at;
      const current = state.next?.id === stage.id;
      const position = timeline.positions[stage.id];
      return `<span class="farm-marker farm-marker-${stage.id.toLowerCase()} ${passed ? 'is-passed' : ''} ${current ? 'is-current' : ''}" style="left:${position}%">
        <i></i><b>${escapeHtml(stage.label)}</b>
      </span>`;
    }).join('');

    const chips = stages.map((stage) => {
      const passed = now >= stage.at;
      return `<span class="farm-stage-chip ${passed ? 'is-passed' : ''}">${passed ? '✓ ' : ''}${stage.id}</span>`;
    }).join('<span class="farm-stage-dot">·</span>');

    const remainingHarvest = state.kind === 'complete'
      ? ''
      : `<span class="farm-harvest-note">${escapeHtml(text('harvestAt').replace('{time}', countdownText(Math.max(0, timer.harvestAt - now))))}</span>`;

    const acknowledge = timer.alarmActive
      ? `<button class="farm-alarm-ack" type="button" data-ack-alarm="${escapeHtml(timer.id)}">🔕 ${language() === 'ja' ? 'アラーム確認' : '알람 확인'}</button>`
      : '';

    return `<article class="farm-timer-card ${state.kind === 'mature' ? 'is-mature' : ''} ${state.kind === 'complete' ? 'is-complete' : ''}" data-timer="${escapeHtml(timer.id)}">
      <div class="farm-timer-top">
        <div class="farm-timer-title">
          <span class="farm-timer-icon">${crop.icon}</span>
          <div>
            <h3>${escapeHtml(timer.label || cropName(crop))}</h3>
            ${timer.label ? `<p class="farm-crop-subtitle">${escapeHtml(cropName(crop))}</p>` : ''}
          </div>
        </div>
        <button class="farm-delete" type="button" data-delete="${escapeHtml(timer.id)}" aria-label="${escapeHtml(text('delete'))}">🗑</button>
      </div>
      <div class="farm-timer-state">${status}</div>
      <div class="farm-progress-line" style="--w3-position:${timeline.positions.W3}%" aria-hidden="true">
        <span class="farm-progress-fill" style="width:${progress}%"></span>
        ${markers}
      </div>
      <div class="farm-card-bottom">
        <div class="farm-stage-chips">${chips}</div>
        <div class="farm-card-actions">${acknowledge}${remainingHarvest}</div>
      </div>
    </article>`;
  }

  function bindTimerCardEvents(root) {
    root.querySelectorAll('[data-delete]').forEach((button) => {
      button.addEventListener('click', (event) => {
        event.stopPropagation();
        removeTimer(button.dataset.delete);
      });
    });

    root.querySelectorAll('[data-ack-alarm]').forEach((button) => {
      button.addEventListener('click', (event) => {
        event.stopPropagation();
        stopRepeatingAlarm(button.dataset.ackAlarm);
        renderTimers();
      });
    });
  }

  function renderTimers() {
    timers = timers.filter((timer) => getCrop(timer.cropId));
    saveTimers();

    timerList.innerHTML = timers.map(renderTimerCard).join('');
    emptyState.hidden = timers.length > 0;
    $('clear-all-button').hidden = timers.length === 0;
    bindTimerCardEvents(timerList);

    timerList.querySelectorAll('.farm-timer-card').forEach((card) => {
      card.addEventListener('click', (event) => {
        if (event.target.closest('button')) return;
        openModal(card.dataset.timer);
      });
    });

    if (activeModalId) refreshModal();
  }

  function removeTimer(id) {
    stopRepeatingAlarm(id);
    timers = timers.filter((timer) => timer.id !== id);
    saveTimers();
    if (activeModalId === id) closeModal();
    renderTimers();
  }

  function clearAll() {
    if (!timers.length || !confirm(text('clearConfirm'))) return;
    for (const id of [...repeatingAlarms.keys()]) stopRepeatingAlarm(id, false);
    timers = [];
    saveTimers();
    closeModal();
    renderTimers();
  }

  function openModal(id) {
    if (!timers.some((timer) => timer.id === id)) return;
    activeModalId = id;
    refreshModal();
    modal.hidden = false;
    document.body.classList.add('farm-modal-open');
  }

  function closeModal() {
    activeModalId = null;
    modal.hidden = true;
    document.body.classList.remove('farm-modal-open');
  }

  function refreshModal() {
    const timer = timers.find((item) => item.id === activeModalId);
    if (!timer) {
      closeModal();
      return;
    }

    modalContent.innerHTML = renderTimerCard(timer);
    const card = modalContent.querySelector('.farm-timer-card');
    card?.classList.add('farm-modal-card');
    bindTimerCardEvents(modalContent);
  }

  function bindHelp() {
    const button = $('help-toggle');
    const body = $('help-body');
    button.addEventListener('click', () => {
      const open = button.getAttribute('aria-expanded') === 'true';
      button.setAttribute('aria-expanded', String(!open));
      body.hidden = open;
    });
  }

  function bindEvents() {
    $('notification-button').addEventListener('click', requestNotifications);
    $('alarm-sound').value = getAlarmSound();
    $('alarm-sound').addEventListener('change', (event) => {
      setAlarmSound(event.target.value);
      previewAlarm(event.target.value);
    });
    $('test-alarm-button').addEventListener('click', () => previewAlarm());
    $('start-mode').addEventListener('change', () => {
      if (remainingMode()) setRemainingDefaults();
      refreshForm();
    });
    ['remaining-hours', 'remaining-minutes', 'remaining-seconds'].forEach((id) => {
      $(id).addEventListener('input', refreshForm);
    });
    plantButton.addEventListener('click', async () => {
      await unlockAudio();
      createTimer();
    });
    $('clear-all-button').addEventListener('click', clearAll);
    $('modal-close').addEventListener('click', closeModal);
    modal.addEventListener('click', (event) => {
      if (event.target.matches('[data-close-modal]')) closeModal();
    });

    document.addEventListener('site-language-changed', () => {
      renderNotificationButton();
      renderCrops();
      refreshForm();
      renderTimers();
    });
  }

  function init() {
    bindEvents();
    bindHelp();
    saveTimers();
    renderNotificationButton();
    renderCrops();
    refreshForm();
    checkAlerts(true);
    resumeVisibleAlarmStates();
    renderTimers();

    window.setInterval(() => {
      checkAlerts(false);
      renderTimers();
    }, RENDER_INTERVAL_MS);
  }

  document.addEventListener('DOMContentLoaded', init);
})();
