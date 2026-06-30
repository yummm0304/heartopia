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
    if (!h) return `${m}${lang()==='ja' ? '分' : '분'}`;
    if (!m) return `${h}${lang()==='ja' ? '시간' : '時間'}`;
    return `${h}${lang()==='ja' ? '시간' : '時間'} ${m}${lang()==='ja' ? '분' : '分'}`;
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
  function renderCrops() {
    cropGrid.innerHTML = crops.map(c => `<button type="button" class="crop-choice ${c.id === selectedCropId ? 'is-selected':''}" data-crop="${c.id}" aria-pressed="${c.id === selectedCropId}">
      <strong>${escapeHTML(nameOf(c))}</strong><small>${durationText(c.minutes)}</small></button>`).join('');
    cropGrid.querySelectorAll('[data-crop]').forEach(btn => btn.addEventListener('click', () => {
      selectedCropId = btn.dataset.crop; renderCrops(); updateSelection();
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
    $('remaining-field').hidden = $('start-mode').value !== 'remaining';
  }
  function getRemainingMs() {
    const h = Math.max(0, Number($('remaining-hours').value) || 0);
    const m = Math.min(59, Math.max(0, Number($('remaining-minutes').value) || 0));
    return (h*60+m)*60000;
  }
  function plant() {
    const crop = getCrop(selectedCropId);
    if (!crop) return;
    const fullMs = crop.minutes * 60000;
    const remaining = $('start-mode').value === 'remaining' ? getRemainingMs() : fullMs;
    if (remaining <= 0) { alert(tx('choosePrompt')); return; }
    const plantedAt = Date.now() - (fullMs - Math.min(fullMs, remaining));
    const timer = {
      id: crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`,
      cropId: crop.id, plantedAt, durationMs: fullMs,
      label: $('farm-label').value.trim(), repeat: $('repeat-alert').checked,
      acknowledged: []
    };
    timers.unshift(timer); save(); scheduleTimer(timer); renderTimers();
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
    const stages = [...stageTimes(timer), {id:'HARVEST', at: timer.plantedAt + timer.durationMs}];
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
  function renderTimers() {
    timers.sort((a,b)=>a.plantedAt-b.plantedAt);
    timerList.innerHTML = '';
    emptyState.hidden = timers.length > 0;
    $('clear-all-button').hidden = timers.length === 0;
    timers.forEach(timer => {
      const crop = getCrop(timer.cropId); if (!crop) return;
      const harvestAt = timer.plantedAt + timer.durationMs;
      const remaining = harvestAt - Date.now();
      const headline = remaining >= 0 ? `${tx('ready')} ${formatClock(remaining)}` : tx('overdue');
      const stages = stageTimes(timer);
      const card = document.createElement('article');
      card.className = 'timer-card';
      card.innerHTML = `<div class="timer-card-top">
          <div><div class="timer-name">${escapeHTML(nameOf(crop))}</div>${timer.label ? `<div class="timer-label">${escapeHTML(timer.label)}</div>` : ''}</div>
          <div class="timer-countdown">${escapeHTML(headline)}</div>
        </div>
        <div class="stage-list">
          ${stages.map(stage => {
            const status = timerStatus(timer, stage);
            return `<button type="button" class="stage is-${status}" data-ack="${stage.id}" ${status === 'waiting' ? 'disabled':''}>
              <strong>${stage.id}</strong><span>${escapeHTML(stageText(timer, stage))}</span>
            </button>`;
          }).join('')}
        </div>
        <div class="timer-actions">
          <button type="button" data-delete class="delete">${escapeHTML(tx('delete'))}</button>
        </div>`;
      card.querySelectorAll('[data-ack]').forEach(btn => btn.addEventListener('click', () => acknowledge(timer.id, btn.dataset.ack)));
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
    document.addEventListener('site-language-changed', () => { renderCrops(); updateSelection(); notificationStatus(); renderTimers(); });
    notificationStatus(); renderCrops(); updateSelection(); applyStartMode();
    timers.forEach(scheduleTimer); renderTimers();
    setInterval(tick, 1000);
  }
  document.addEventListener('DOMContentLoaded', init);
})();