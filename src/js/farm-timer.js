(() => {
  const STORAGE_KEY = 'heartopia_farm_timers_v1';
  const crops = [
    {id:'tomato', name:'토마토', ja:'トマト', minutes:15},
    {id:'rice', name:'벼', ja:'米', minutes:20},
    {id:'pineapple', name:'파인애플', ja:'パイナップル', minutes:30},
    {id:'tea', name:'찻잎', ja:'茶葉', minutes:45},
    {id:'potato', name:'감자', ja:'ジャガイモ', minutes:60},
    {id:'carrot', name:'당근', ja:'ニンジン', minutes:120},
    {id:'wheat', name:'밀', ja:'小麦', minutes:240},
    {id:'cacao', name:'카카오', ja:'カカオ', minutes:300},
    {id:'strawberry', name:'딸기', ja:'いちご', minutes:360},
    {id:'eggplant', name:'가지', ja:'ナス', minutes:420},
    {id:'lettuce', name:'양상추', ja:'レタス', minutes:480},
    {id:'grape', name:'포도', ja:'ブドウ', minutes:600},
    {id:'corn', name:'옥수수', ja:'トウモロコシ', minutes:720},
    {id:'avocado', name:'아보카도', ja:'アボカド', minutes:840}
  ];

  const fallback = {
    ko: {
      allowNotifications:'🔔 알림 허용', notificationsEnabled:'🔔 알림 켜짐',
      selected:'선택됨', choosePrompt:'작물을 선택해 주세요.',
      cropDuration:'{name} · 수확까지 {time}', startNow:'지금 심기',
      remaining:'남은 시간', hour:'시간', minute:'분',
      alertTitle:'농장 타이머', stageMessage:'{name} · {stage} 잡초 시점이에요!',
      mature:'수확 시간이에요!', acknowledge:'확인', delete:'삭제',
      clearConfirm:'진행 중인 작물을 모두 삭제할까요?', deleteConfirm:'이 작물을 삭제할까요?',
      justNow:'방금', overdue:'수확 시간 지남', stageDone:'완료', stageWaiting:'대기',
      noPermission:'브라우저 알림이 차단되어 있어요.', cannotNotify:'이 브라우저에서는 알림을 지원하지 않아요.',
      planted:'심은 지', ready:'수확까지', complete:'수확 완료'
    },
    ja: {
      allowNotifications:'🔔 通知を許可', notificationsEnabled:'🔔 通知オン',
      selected:'選択中', choosePrompt:'作物を選んでください。',
      cropDuration:'{name} · 収穫まで {time}', startNow:'今植える',
      remaining:'残り時間', hour:'時間', minute:'分',
      alertTitle:'農場タイマー', stageMessage:'{name} · {stage} の雑草タイミングです！',
      mature:'収穫の時間です！', acknowledge:'確認', delete:'削除',
      clearConfirm:'進行中の作物をすべて削除しますか？', deleteConfirm:'この作物を削除しますか？',
      justNow:'たった今', overdue:'収穫時間を過ぎました', stageDone:'完了', stageWaiting:'待機',
      noPermission:'ブラウザ通知がブロックされています。', cannotNotify:'このブラウザは通知に対応していません。',
      planted:'植えてから', ready:'収穫まで', complete:'収穫完了'
    }
  };

  let selectedCropId = null;
  let timers = safeLoad();
  let alarmIntervals = new Map();
  let scheduledNotifications = new Map();

  const $ = (id) => document.getElementById(id);
  const cropGrid = $('crop-grid');
  const timerList = $('timer-list');
  const emptyState = $('empty-state');
  const plantButton = $('plant-button');

  function lang() { return window.getSiteLanguage ? window.getSiteLanguage() : 'ko'; }
  function tx(key) { return fallback[lang()][key] || key; }
  function nameOf(crop) { return lang() === 'ja' ? crop.ja : crop.name; }
  function durationText(minutes) {
    const h = Math.floor(minutes / 60), m = minutes % 60;
    const hourUnit = lang() === 'ja' ? '時間' : '시간';
    const minuteUnit = lang() === 'ja' ? '分' : '분';
    if (!h) return `${m}${minuteUnit}`;
    if (!m) return `${h}${hourUnit}`;
    return `${h}${hourUnit} ${m}${minuteUnit}`;
  }
  function formatCountdown(ms) {
    const sec = Math.max(0, Math.ceil(ms / 1000));
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    const s = sec % 60;
    return h ? `${h}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}` : `${m}:${String(s).padStart(2,'0')}`;
  }
  function formatClock(ms) {
    const sec = Math.max(0, Math.floor(ms / 1000));
    const h = String(Math.floor(sec / 3600)).padStart(2,'0');
    const m = String(Math.floor((sec % 3600) / 60)).padStart(2,'0');
    const s = String(sec % 60).padStart(2,'0');
    return `${h}:${m}:${s}`;
  }
  function safeLoad() {
    try {
      const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
      return Array.isArray(parsed) ? parsed.filter(x => x && x.id && x.cropId && x.plantedAt) : [];
    } catch { return []; }
  }
  function save() { localStorage.setItem(STORAGE_KEY, JSON.stringify(timers)); }
  function escapeHTML(value) {
    return String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  }
  function getCrop(id) { return crops.find(c => c.id === id); }
  function getHarvestAt(timer) {
    return Number(timer.harvestAt) || (timer.plantedAt + timer.durationMs);
  }
  function stageTimes(timer) {
    const total = timer.durationMs;
    return [
      {id:'W1', at:timer.plantedAt + total / 3},
      {id:'W2', at:timer.plantedAt + total * 2 / 3},
      {id:'W3', at:timer.plantedAt + Math.max(0, total - 60000)},
      {id:'W4', at:timer.plantedAt + total + 60000}
    ];
  }
  function notificationStatus() {
    const b = $('notification-button');
    if (!('Notification' in window)) { b.textContent = tx('cannotNotify'); b.disabled = true; return; }
    if (Notification.permission === 'granted') { b.textContent = tx('notificationsEnabled'); b.disabled = true; return; }
    b.textContent = tx('allowNotifications'); b.disabled = false;
  }
  async function requestNotifications() {
    if (!('Notification' in window)) return;
    const permission = await Notification.requestPermission();
    notificationStatus();
    if (permission !== 'granted') alert(tx('noPermission'));
  }
  const cropIcons = {
    tomato:'🍅', rice:'🍚', pineapple:'🍍', tea:'🍃', potato:'🥔', carrot:'🥕',
    wheat:'🌾', cacao:'🍫', strawberry:'🍓', eggplant:'🍆', lettuce:'🥬',
    grape:'🍇', corn:'🌽', avocado:'🥑'
  };

  function renderCrops() {
    cropGrid.innerHTML = crops.map(c => {
      const isSelected = c.id === selectedCropId;
      const newBadge = c.id === 'rice' ? `<span class="crop-new-badge">NEW</span>` : '';
      return `<button type="button" class="crop-choice crop-choice-v4 ${isSelected ? 'is-selected':''}" data-crop="${c.id}" aria-pressed="${isSelected}">
        ${newBadge}
        <span class="crop-choice-icon" aria-hidden="true">${cropIcons[c.id] || '🌱'}</span>
        <strong>${escapeHTML(nameOf(c))}</strong>
        <small>${durationText(c.minutes)}</small>
      </button>`;
    }).join('');
    cropGrid.querySelectorAll('[data-crop]').forEach(btn => btn.addEventListener('click', () => {
      selectedCropId = btn.dataset.crop;
      renderCrops();
      updateSelection();
    }));
  }
  function updateSelection() {
    const crop = getCrop(selectedCropId);
    const summary = $('selected-crop-summary');
    if (!crop) { summary.textContent = tx('choosePrompt'); plantButton.disabled = true; return; }
    summary.textContent = tx('cropDuration').replace('{name}', nameOf(crop)).replace('{time}', durationText(crop.minutes));
    plantButton.disabled = false;
  }
  function applyStartMode() {
    const isRemaining = $('start-mode').checked;
    $('remaining-field').hidden = !isRemaining;
  }
  function getRemainingMs() {
    const h = Math.min(99, Math.max(0, Number($('remaining-hours').value) || 0));
    const m = Math.min(59, Math.max(0, Number($('remaining-minutes').value) || 0));
    return (h * 60 + m) * 60000;
  }
  function refreshTimeInputLabels() {
    $('remaining-hours').setAttribute('aria-label', lang() === 'ja' ? '時間' : '시간');
    $('remaining-minutes').setAttribute('aria-label', lang() === 'ja' ? '分' : '분');
  }
  function plant() {
    const crop = getCrop(selectedCropId);
    if (!crop) return;
    const fullMs = crop.minutes * 60000;
    const usingRemainingTime = $('start-mode').checked;
    const enteredRemaining = usingRemainingTime ? getRemainingMs() : fullMs;

    if (usingRemainingTime && enteredRemaining <= 0) {
      alert(tx('remainingRequired'));
      return;
    }

    const remaining = Math.min(fullMs, enteredRemaining);
    if (usingRemainingTime && enteredRemaining > fullMs) {
      alert(tx('remainingTooLong').replace('{time}', durationText(crop.minutes)));
    }

    const now = Date.now();
    const plantedAt = now - (fullMs - remaining);
    const timer = {
      id: crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`,
      cropId: crop.id,
      plantedAt,
      harvestAt: now + remaining,
      durationMs: fullMs,
      label: $('farm-label').value.trim(),
      repeat: $('repeat-alert').checked,
      acknowledged: []
    };
    timers.unshift(timer);
    save();
    scheduleTimer(timer);
    renderTimers();
    $('farm-label').value = '';
  }
  function notificationFor(timer, stage) {
    const crop = getCrop(timer.cropId); if (!crop) return;
    const title = tx('alertTitle');
    const body = stage === 'HARVEST'
      ? `${nameOf(crop)} · ${tx('mature')}`
      : tx('stageMessage').replace('{name}',nameOf(crop)).replace('{stage}',stage);
    if ('Notification' in window && Notification.permission === 'granted') new Notification(title, {body, tag:`farm-${timer.id}-${stage}`});
    try { navigator.vibrate?.([180, 80, 180]); } catch {}
  }
  function scheduleTimer(timer) {
    clearSchedule(timer.id);
    if (timer.acknowledged?.includes('HARVEST')) return;
    const stages = [...stageTimes(timer), {id:'HARVEST', at: getHarvestAt(timer)}];
    const handles = [];
    stages.forEach(stage => {
      if (timer.acknowledged?.includes(stage.id)) return;
      const delay = stage.at - Date.now();
      if (delay > 0 && delay < 2147483647) handles.push(setTimeout(() => {
        notificationFor(timer, stage.id);
        if (timer.repeat) startRepeating(timer.id, stage.id);
        renderTimers();
      }, delay));
    });
    scheduledNotifications.set(timer.id, handles);
  }
  function clearSchedule(timerId) {
    (scheduledNotifications.get(timerId) || []).forEach(clearTimeout);
    scheduledNotifications.delete(timerId);
    const keyPrefix = `${timerId}:`;
    [...alarmIntervals.keys()].filter(k=>k.startsWith(keyPrefix)).forEach(k=>{ clearInterval(alarmIntervals.get(k)); alarmIntervals.delete(k); });
  }
  function startRepeating(timerId, stageId) {
    const key = `${timerId}:${stageId}`;
    if (alarmIntervals.has(key)) return;
    alarmIntervals.set(key, setInterval(() => {
      const timer = timers.find(t=>t.id===timerId);
      if (!timer || timer.acknowledged?.includes(stageId)) { clearInterval(alarmIntervals.get(key)); alarmIntervals.delete(key); return; }
      notificationFor(timer, stageId);
    }, 60000));
  }
  function acknowledge(timerId, stageId) {
    const timer = timers.find(t=>t.id === timerId); if (!timer) return;
    timer.acknowledged = [...new Set([...(timer.acknowledged || []), stageId])];
    save(); clearSchedule(timerId); scheduleTimer(timer); renderTimers();
  }
  function removeTimer(id) {
    if (!confirm(tx('deleteConfirm'))) return;
    clearSchedule(id); timers = timers.filter(t=>t.id !== id); save(); renderTimers();
  }
  function timerStatus(timer, stage) {
    const now = Date.now();
    if (timer.acknowledged?.includes(stage.id)) return 'done';
    if (now >= stage.at) return 'current';
    return 'waiting';
  }
  function stageText(timer, stage) {
    const diff = stage.at - Date.now();
    if (timerStatus(timer, stage) === 'done') return tx('stageDone');
    if (diff <= 0) return stage.id === 'HARVEST' ? tx('complete') : tx('acknowledge');
    return formatClock(diff);
  }
  function timelineLabels(timer) {
    const totalMinutes = Math.round(timer.durationMs / 60000);
    return {
      W1: `${Math.round(totalMinutes / 3)}${lang() === 'ja' ? '分' : '분'}`,
      W2: `${Math.round(totalMinutes * 2 / 3)}${lang() === 'ja' ? '分' : '분'}`,
      W3: tx('justBeforeMature'),
      W4: tx('afterMature')
    };
  }

  function stageIsPassed(timer, stage) {
    return Date.now() >= stage.at;
  }

  function nextTimelineStage(timer) {
    return stageTimes(timer).find(stage => Date.now() < stage.at) || null;
  }

  function clockAt(ms) {
    return new Date(ms).toLocaleTimeString(lang() === 'ja' ? 'ja-JP' : 'ko-KR', {
      hour: '2-digit', minute: '2-digit', hour12: false
    });
  }

  function renderTimers() {
    timers.sort((a,b) => a.plantedAt - b.plantedAt);
    timerList.innerHTML = '';
    emptyState.hidden = timers.length > 0;
    $('clear-all-button').hidden = timers.length === 0;

    timers.forEach(timer => {
      const crop = getCrop(timer.cropId);
      if (!crop) return;

      const harvestAt = getHarvestAt(timer);
      const now = Date.now();
      const remaining = harvestAt - now;
      const elapsed = Math.max(0, Math.min(timer.durationMs, now - timer.plantedAt));
      const progress = Math.max(0, Math.min(100, (elapsed / timer.durationMs) * 100));
      const stages = stageTimes(timer);
      const next = nextTimelineStage(timer);
      const completed = remaining <= 0;
      const labels = timelineLabels(timer);

      const stateLabel = completed
        ? tx('complete')
        : next
          ? tx('nextWeed').replace('{stage}', next.id)
          : tx('ready');
      const mainTime = completed ? '' : formatCountdown(next ? next.at - now : remaining);
      const footerText = completed
        ? tx('harvestReady')
        : tx('harvestAt').replace('{time}', clockAt(harvestAt));

      const card = document.createElement('article');
      card.className = `timer-card timer-card-progress ${completed ? 'is-complete' : ''}`;
      card.innerHTML = `
        <div class="timer-card-top">
          <div class="timer-crop-heading">
            <span class="timer-crop-icon" aria-hidden="true">${cropIcons[crop.id] || '🌱'}</span>
            <div>
              <div class="timer-name">${escapeHTML(nameOf(crop))}</div>
              ${timer.label ? `<div class="timer-label">${escapeHTML(timer.label)}</div>` : ''}
            </div>
          </div>
          <button type="button" data-delete class="timer-delete" aria-label="${escapeHTML(tx('delete'))}">🗑</button>
        </div>

        <div class="timeline-state">
          <span class="timeline-state-label">${escapeHTML(stateLabel)}</span>
          ${mainTime ? `<strong class="timeline-countdown">${escapeHTML(mainTime)}</strong>` : `<strong class="timeline-complete">${escapeHTML(tx('complete'))}</strong>`}
        </div>

        <div class="crop-timeline" role="img" aria-label="${escapeHTML(stateLabel)}">
          <div class="crop-track"><span class="crop-progress" style="width:${progress}%"></span></div>
          ${stages.map((stage, index) => {
            const pos = index === 0 ? 33.333 : index === 1 ? 66.667 : index === 2 ? 87.5 : 100;
            const isPassed = stageIsPassed(timer, stage);
            const isNext = next && next.id === stage.id;
            return `<div class="timeline-marker ${isPassed ? 'is-passed' : ''} ${isNext ? 'is-next' : ''}" style="left:${pos}%">
              <i></i><span>${escapeHTML(labels[stage.id])}</span>
            </div>`;
          }).join('')}
        </div>

        <div class="timeline-bottom">
          <div class="timeline-stage-chips">
            ${stages.map(stage => {
              const passed = stageIsPassed(timer, stage);
              return `<span class="stage-chip ${passed ? 'is-passed' : ''}">${passed ? '✓ ' : ''}${stage.id}</span>`;
            }).join('<b class="stage-dot">·</b>')}
          </div>
          <span class="harvest-clock">${escapeHTML(footerText)}</span>
        </div>
      `;

      card.querySelector('[data-delete]').addEventListener('click', () => removeTimer(timer.id));
      timerList.appendChild(card);
    });
  }
  function clearAll() {
    if (!timers.length || !confirm(tx('clearConfirm'))) return;
    timers.forEach(t => clearSchedule(t.id)); timers=[]; save(); renderTimers();
  }
  function tick() { renderTimers(); }
  function init() {
    $('notification-button').addEventListener('click', requestNotifications);
    $('help-toggle').addEventListener('click', () => {
      const body = $('help-body'), btn = $('help-toggle'), open = btn.getAttribute('aria-expanded') === 'true';
      btn.setAttribute('aria-expanded', String(!open)); body.hidden = open;
    });
    $('start-mode').addEventListener('change', applyStartMode);
    plantButton.addEventListener('click', plant);
    $('clear-all-button').addEventListener('click', clearAll);
    document.addEventListener('site-language-changed', () => {
      refreshTimeInputLabels();
      renderCrops();
      updateSelection();
      notificationStatus();
      renderTimers();
    });
    refreshTimeInputLabels();
    notificationStatus();
    renderCrops();
    updateSelection();
    applyStartMode();
    timers.forEach(scheduleTimer); renderTimers();
    setInterval(tick, 1000);
  }
  document.addEventListener('DOMContentLoaded', init);
})();