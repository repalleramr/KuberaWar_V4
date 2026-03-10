const STORAGE_KEY = 'kubera-warhunt-v1-fix3';
const defaultSettings = {
  bankroll: 30000,
  targetDollar: 500,
  targetPercent: 1.67,
  stopLoss: 50000,
  min: 100,
  max: 3000,
  coin: 100,
  targetNum: 500,
  keypadMode: 'combined',
  maxSteps: 30,
  reserve: 20000,
  capRule: 'on'
};
const titles = { sangram:'⚔ SANGRAM', vyuha:'🛡 VYUHA', granth:'📜 GRANTH', drishti:'👁 DRISHTI', sopana:'🪜 SOPANA', yantra:'⚙ YANTRA', medha:'🧠 MEDHA' };

let deferredPrompt = null;
let historyStack = [];
let pending = { Y: null, K: null };

function q(id){ return document.getElementById(id); }
function fmtMoney(n){ return '₹ ' + Number(n || 0).toLocaleString('en-IN'); }
function clone(obj){ return JSON.parse(JSON.stringify(obj)); }

function freshNumber(){
  return { status:'I', step:0, ladder:1, activeAt:null, prevLoss:0, winningBet:0, lastNet:0 };
}
function createSide(){
  const s = {};
  for(let i=1;i<=9;i++) s[i] = freshNumber();
  return s;
}
function buildLadder(settings){
  const rows = [];
  let cumulative = 0;
  let bet = settings.min;
  for(let step=1; step<=settings.maxSteps; step++){
    if(step > 1){
      const prevLoss = rows[rows.length - 1].ifLoseTotal * -1;
      const prevBet = rows[rows.length - 1].bet;
      const canStay = (prevBet * 9) - prevLoss >= settings.targetNum;
      bet = canStay ? prevBet : Math.min(settings.max, prevBet * 2);
      bet = Math.ceil(bet / settings.coin) * settings.coin;
      bet = Math.min(settings.max, bet);
    }
    cumulative += bet;
    rows.push({
      step: `S${step}`,
      bet,
      winReturn: bet * 9,
      netProfit: (bet * 9) - cumulative,
      ifLoseTotal: -cumulative
    });
  }
  return rows;
}
function freshState(){
  const settings = { ...defaultSettings };
  return {
    settings,
    liveBankroll: settings.bankroll,
    currentChakra: 0,
    numbers: { Y: createSide(), K: createSide() },
    drishti: [],
    granth: [],
    currentKumbhId: null,
    summary: { totalAhuti: 0, maxExposure: 0 },
    ladder: buildLadder(settings),
    activeTab: 'sangram'
  };
}
function reviveState(raw){
  const base = freshState();
  const settings = { ...base.settings, ...(raw.settings || {}) };
  return {
    ...base,
    ...raw,
    settings,
    numbers: raw.numbers || base.numbers,
    summary: { ...base.summary, ...(raw.summary || {}) },
    ladder: Array.isArray(raw.ladder) && raw.ladder.length ? raw.ladder : buildLadder(settings),
    activeTab: raw.activeTab || 'sangram'
  };
}
function loadState(){
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if(!raw) return freshState();
    return reviveState(JSON.parse(raw));
  } catch {
    return freshState();
  }
}
let state = loadState();
function saveState(){ localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); }

function currentKumbh(){
  return state.granth.find(k => k.id === state.currentKumbhId) || null;
}
function ensureKumbh(){
  if(currentKumbh()) return currentKumbh();
  const id = (state.granth.at(-1)?.id || 0) + 1;
  const kumbh = { id, rows: [] };
  state.granth.push(kumbh);
  state.currentKumbhId = id;
  return kumbh;
}
function secondLadderBet(step){
  const start = Math.ceil((state.settings.max / 4) / state.settings.coin) * state.settings.coin;
  if(step <= 5) return start;
  if(step <= 10) return Math.min(state.settings.max, start * 2);
  if(step <= 15) return Math.min(state.settings.max, start * 3);
  return state.settings.max;
}
function currentBetFor(info){
  if(info.ladder === 2) return secondLadderBet(info.step || 1);
  return state.ladder[Math.max(0, (info.step || 1) - 1)]?.bet || state.settings.max;
}
function nextExposureTotal(){
  let total = 0;
  ['Y','K'].forEach(side => {
    for(let n=1;n<=9;n++){
      const info = state.numbers[side][n];
      if(info.status === 'A' || info.status === 'B') total += currentBetFor(info);
    }
  });
  return total;
}

function showToast(title, text, kind=''){
  const layer = q('toastLayer');
  const el = document.createElement('div');
  el.className = `toast ${kind}`;
  el.innerHTML = `<div class="title">${title}</div><div>${text}</div>`;
  layer.appendChild(el);
  setTimeout(() => el.remove(), 3800);
}

function confirmAction(message){
  return window.confirm(message);
}

function injectKeyGlowStyles(){
  if(document.getElementById('kubera-keyglow-style')) return;
  const style = document.createElement('style');
  style.id = 'kubera-keyglow-style';
  style.textContent = `
    .tile {
      transition: border-color .15s ease, box-shadow .15s ease, transform .1s ease;
    }
    .tile.key-glow {
      border-color: rgba(246, 198, 107, 0.95) !important;
      box-shadow:
        0 0 0 1px rgba(246, 198, 107, 0.55),
        0 0 12px rgba(246, 198, 107, 0.45),
        0 0 22px rgba(246, 140, 0, 0.22),
        inset 0 0 10px rgba(246, 198, 107, 0.12);
      transform: scale(0.98);
    }
  `;
  document.head.appendChild(style);
}

function glowKey(el){
  if(!el) return;
  el.classList.remove('key-glow');
  void el.offsetWidth;
  el.classList.add('key-glow');
  setTimeout(() => el.classList.remove('key-glow'), 220);
}

function renderBoards(){
  ['Y','K'].forEach(side => {
    const host = q(side === 'Y' ? 'boardY' : 'boardK');
    host.innerHTML = '';
    for(let i=1;i<=10;i++){
      const n = i === 10 ? 0 : i;
      const btn = document.createElement('button');
      const info = n === 0 ? null : state.numbers[side][n];
      const code = n === 0 ? '0' : statusCode(info);
      const metaClass = info?.step ? `step${Math.min(info.step,6)}` : '';
      btn.type = 'button';
      btn.className = `tile ${n===0 ? 'zero' : ''} ${info ? 'state-' + info.status : ''}`.trim();
      btn.dataset.side = side;
      btn.dataset.num = String(n);
      btn.innerHTML = `<div class="num">${n}</div><div class="meta ${metaClass}">${code}</div>`;
      btn.addEventListener('click', (e) => handleTap(side, n, e.currentTarget));
      host.appendChild(btn);
    }
  });
}
function statusCode(info){
  if(!info) return '0';
  if(info.status === 'A') return `S${info.step}`;
  if(info.status === 'B') return 'B';
  return info.status;
}
function renderVyuha(){
  ['Y','K'].forEach(side => {
    const host = q(side === 'Y' ? 'vyuhaY' : 'vyuhaK');
    host.innerHTML = '';
    for(let n=1;n<=9;n++){
      const info = state.numbers[side][n];
      const div = document.createElement('div');
      div.className = 'state-cell';
      div.innerHTML = `<div class="num">${n}</div><div class="meta">${statusCode(info)}</div>`;
      host.appendChild(div);
    }
  });
}
function formatNextAhuti(side){
  const groups = new Map();
  for(let n=1;n<=9;n++){
    const info = state.numbers[side][n];
    if(info.status === 'A' || info.status === 'B'){
      const bet = currentBetFor(info);
      if(!groups.has(bet)) groups.set(bet, []);
      const stepLabel = info.ladder === 2 ? `2S${info.step}` : `S${info.step}`;
      groups.get(bet).push(`${n}(${stepLabel})`);
    }
  }
  const parts = [...groups.entries()].sort((a,b) => b[0] - a[0]).map(([bet, arr]) => `${bet} on ${arr.join(' ')}`);
  return `${side} ${parts.join(' | ') || '-'}`;
}
function renderSangram(){
  q('bankValue').textContent = fmtMoney(state.liveBankroll);
  q('chakraValue').textContent = `Round : ${state.currentChakra}`;
  q('nextY').textContent = formatNextAhuti('Y');
  q('nextK').textContent = formatNextAhuti('K');
  q('nextT').textContent = `T ${nextExposureTotal()}`;
}
function renderGranth(){
  const host = q('granthList');
  host.innerHTML = '';
  const items = [...state.granth].reverse();
  if(!items.length){ host.innerHTML = '<div class="kumbh">No Kumbh history yet.</div>'; return; }
  items.forEach(k => {
    const wrap = document.createElement('div');
    wrap.className = 'kumbh';
    const rows = [...k.rows].reverse().map(r => `<tr><td>${r.chakra}</td><td>${r.y ?? '-'}</td><td>${r.k ?? '-'}</td><td>${r.ahuti}</td><td>${r.axyapatra}</td></tr>`).join('');
    wrap.innerHTML = `<div class="label">#${String(k.id).padStart(2,'0')} Kumbh</div><div class="table-wrap"><table><thead><tr><th>Chakra</th><th>Y</th><th>K</th><th>Āhuti</th><th>Axyapatra</th></tr></thead><tbody>${rows}</tbody></table></div>`;
    host.appendChild(wrap);
  });
}
function renderDrishti(){
  q('sumChakras').textContent = state.currentChakra;
  q('sumAhuti').textContent = state.summary.totalAhuti;
  q('sumProfit').textContent = state.liveBankroll - state.settings.bankroll;
  q('sumExposure').textContent = state.summary.maxExposure;
  const tbody = q('drishtiTable').querySelector('tbody');
  tbody.innerHTML = '';
  [...state.drishti].reverse().forEach(r => {
    const tr = document.createElement('tr');
    tr.innerHTML = `<td>${r.side}</td><td>${r.number}</td><td>${r.activationChakra}</td><td>${r.winChakra}</td><td>${r.steps}</td><td>${r.prevLoss}</td><td>${r.winBet}</td><td>${r.net}</td><td>${r.status}</td>`;
    tbody.appendChild(tr);
  });
}
function renderSopana(){
  const tbody = q('ladderTable').querySelector('tbody');
  tbody.innerHTML = '';
  state.ladder.forEach((row, idx) => {
    const tr = document.createElement('tr');
    tr.innerHTML = `<td>${row.step}</td><td><input type="number" data-ladder-index="${idx}" value="${row.bet}"></td><td>${row.winReturn}</td><td>${row.netProfit}</td><td>${row.ifLoseTotal}</td>`;
    tbody.appendChild(tr);
  });
}
function renderYantra(){
  const s = state.settings;
  q('setBankroll').value = s.bankroll;
  q('setTargetDollar').value = s.targetDollar;
  q('setTargetPercent').value = s.targetPercent;
  q('setStopLoss').value = s.stopLoss;
  q('setMin').value = s.min;
  q('setMax').value = s.max;
  q('setCoin').value = s.coin;
  q('setTargetNum').value = s.targetNum;
  q('setKeypadMode').value = s.keypadMode;
  q('setMaxSteps').value = s.maxSteps;
  q('setReserve').value = s.reserve;
  q('setCapRule').value = s.capRule;
}
function renderMedha(){
  const active = [];
  const cap = [];
  ['Y','K'].forEach(side => {
    for(let n=1;n<=9;n++){
      const info = state.numbers[side][n];
      if(info.status === 'A' || info.status === 'B') active.push(`${side}${n} ${info.ladder===2?'2S':'S'}${info.step}`);
      if(info.status === 'C') cap.push(`${side}${n}`);
    }
  });
  q('medhaPanel').innerHTML = `<div class="medha-item"><div class="label">Active Formation</div><div>${active.join(' | ') || 'None'}</div></div><div class="medha-item"><div class="label">CAP Numbers</div><div>${cap.join(' | ') || 'None'}</div></div>`;
}
function renderActiveTab(){
  document.querySelectorAll('.screen').forEach(s => s.classList.toggle('active', s.id === `screen-${state.activeTab}`));
  document.querySelectorAll('.nav').forEach(b => b.classList.toggle('active', b.dataset.target === state.activeTab));
  q('screenTitle').textContent = titles[state.activeTab] || titles.sangram;
}
function renderAll(){
  renderActiveTab();
  renderBoards();
  renderVyuha();
  renderSangram();
  renderGranth();
  renderDrishti();
  renderSopana();
  renderYantra();
  renderMedha();
  saveState();
}

function startPrayoga(){
  state.currentKumbhId = null;
  const kumbh = ensureKumbh();
  state.activeTab = 'sangram';
  renderAll();
  showToast('SANGRAM AARAMBHA', `#${String(kumbh.id).padStart(2,'0')} Kumbh ready`);
}
function clearCurrentSession(){
  if(!confirmAction('Clear current Kumbh?\n\nOK = clear and start new Kumbh\nCancel = keep current session')) return;
  state.liveBankroll = state.settings.bankroll;
  state.currentChakra = 0;
  state.numbers = { Y: createSide(), K: createSide() };
  state.drishti = [];
  state.summary = { totalAhuti: 0, maxExposure: 0 };
  pending = { Y: null, K: null };
  state.currentKumbhId = null;
  const kumbh = ensureKumbh();
  state.activeTab = 'sangram';
  renderAll();
  showToast('KUMBHA SHUDDHI', `#${String(kumbh.id).padStart(2,'0')} Kumbh started`);
}
function recordSnapshot(){
  historyStack.push(JSON.stringify(state));
  if(historyStack.length > 20) historyStack.shift();
}
function undoLast(){
  const prev = historyStack.pop();
  if(!prev) return;
  state = reviveState(JSON.parse(prev));
  renderAll();
  showToast('CHAKRA PUNARAVRITTI', 'Last chakra reverted');
}

function handleTap(side, num, el){
  glowKey(el);
  if(state.settings.keypadMode === 'combined'){
    pending[side] = num;
    const other = side === 'Y' ? 'K' : 'Y';
    if(pending.Y !== null && pending.K !== null){
      processRound('both', { Y: pending.Y, K: pending.K });
      pending = { Y: null, K: null };
    }
  } else {
    processRound(side, num);
  }
}

function processRound(mode, payload){
  recordSnapshot();
  const kumbh = ensureKumbh();
  const exposure = nextExposureTotal();
  const notes = [];
  const round = { y: null, k: null };

  if(mode === 'both'){
    round.y = payload.Y; round.k = payload.K;
    processSide('Y', payload.Y, notes);
    processSide('K', payload.K, notes);
  } else if(mode === 'Y'){
    round.y = payload;
    processSide('Y', payload, notes);
  } else if(mode === 'K'){
    round.k = payload;
    processSide('K', payload, notes);
  }

  state.currentChakra += 1;
  if(exposure > 0){
    state.liveBankroll -= exposure;
    state.summary.totalAhuti += exposure;
    state.summary.maxExposure = Math.max(state.summary.maxExposure, exposure);
  }
  notes.filter(n => n.type === 'win').forEach(n => { state.liveBankroll += n.returnAmount; });
  kumbh.rows.push({ chakra: state.currentChakra, y: round.y, k: round.k, ahuti: exposure, axyapatra: state.liveBankroll });

  if(state.liveBankroll <= state.settings.bankroll - state.settings.stopLoss || state.liveBankroll < state.settings.reserve){
    showToast('TREASURY WARNING', 'Axyapatra approaching Raksha Rekha', 'warn');
  }
  notes.forEach(n => {
    if(n.type === 'win') showToast('VIJAY DARSHANA', `${n.side}${n.number} won at ${n.label} | Āhuti ${n.bet} | Net ${n.net > 0 ? '+' : ''}${n.net}`, 'win');
    if(n.type === 'capreturn') showToast('CAP RETURNED', `${n.side}${n.number} now B → second ladder from next chakra`, 'cap');
    if(n.type === 'cap') showToast('REKHA BANDHA', `${n.side}${n.number} entered CAP`, 'warn');
  });
  renderAll();
}

function processSide(side, result, notes){
  if(result === 0 || result == null){ applyZero(side, notes); return; }
  const hit = state.numbers[side][result];

  if(hit.status === 'L') { /* locked number behaves as zero silently */ applyZero(side, notes); return; }

  if(hit.status === 'I'){
    hit.status = 'A';
    hit.step = 1;
    hit.ladder = 1;
    hit.activeAt = state.currentChakra + 1;
    hit.prevLoss = 0;
    hit.winningBet = 0;
    hit.lastNet = 0;
  } else if(hit.status === 'A' || hit.status === 'B'){
    const bet = currentBetFor(hit);
    const spent = hit.prevLoss + bet;
    const returnAmount = bet * 9;
    const net = returnAmount - spent;
    const label = hit.ladder === 2 ? `2S${hit.step}` : `S${hit.step}`;
    hit.status = 'L';
    hit.winningBet = bet;
    hit.lastNet = net;
    state.drishti.push({ side, number: result, activationChakra: hit.activeAt ?? '-', winChakra: state.currentChakra + 1, steps: hit.step, prevLoss: hit.prevLoss, winBet: bet, net, status: 'WIN' });
    notes.push({ type:'win', side, number:result, step:hit.step, label, bet, net, returnAmount });
  } else if(hit.status === 'C'){
    hit.status = 'B';
    hit.ladder = 2;
    hit.step = 1;
    hit.activeAt = state.currentChakra + 1;
    hit.prevLoss = 0;
    notes.push({ type:'capreturn', side, number:result });
  }

  for(let n=1;n<=9;n++){
    if(n === result) continue;
    const info = state.numbers[side][n];
    if(info.status === 'A' || info.status === 'B') loseStep(side, n, info, notes);
  }
}
function applyZero(side, notes){
  for(let n=1;n<=9;n++){
    const info = state.numbers[side][n];
    if(info.status === 'A' || info.status === 'B') loseStep(side, n, info, notes);
  }
}
function loseStep(side, n, info, notes){
  const bet = currentBetFor(info);
  info.prevLoss += bet;
  info.step += 1;
  if(info.ladder === 1){
    if(info.step > state.settings.maxSteps || (bet >= state.settings.max && state.settings.capRule === 'on')){
      info.status = 'C';
      info.step = state.settings.maxSteps;
      state.drishti.push({ side, number:n, activationChakra: info.activeAt ?? '-', winChakra:'-', steps: state.settings.maxSteps, prevLoss: info.prevLoss, winBet:'-', net: -info.prevLoss, status:'CAP' });
      notes.push({ type:'cap', side, number:n });
    }
  } else {
    if(info.step > 15) info.step = 15;
    info.status = 'B';
  }
}

function switchTab(target){
  state.activeTab = target;
  renderActiveTab();
  saveState();
}
function setupTabs(){
  document.querySelectorAll('.nav').forEach(btn => btn.addEventListener('click', () => switchTab(btn.dataset.target)));
}
function recalcTargetLink(source){
  const bankroll = Number(q('setBankroll').value) || defaultSettings.bankroll;
  if(source === 'dollar') q('setTargetPercent').value = ((Number(q('setTargetDollar').value || 0) / bankroll) * 100).toFixed(2);
  if(source === 'percent') q('setTargetDollar').value = Math.round((bankroll * Number(q('setTargetPercent').value || 0)) / 100);
}
function setupControls(){
  q('prayogaBtn').addEventListener('click', startPrayoga);
  q('kumbhaBtn').addEventListener('click', clearCurrentSession);
  q('undoBtn').addEventListener('click', undoLast);
  q('setTargetDollar').addEventListener('input', () => recalcTargetLink('dollar'));
  q('setTargetPercent').addEventListener('input', () => recalcTargetLink('percent'));
  q('setBankroll').addEventListener('input', () => recalcTargetLink('dollar'));
  q('applyYantraBtn').addEventListener('click', () => {
    const s = state.settings;
    s.bankroll = Number(q('setBankroll').value) || 30000;
    s.targetDollar = Number(q('setTargetDollar').value) || 500;
    s.targetPercent = Number(q('setTargetPercent').value) || 1.67;
    s.stopLoss = Number(q('setStopLoss').value) || 50000;
    s.min = Number(q('setMin').value) || 100;
    s.max = Number(q('setMax').value) || 3000;
    s.coin = Number(q('setCoin').value) || 100;
    s.targetNum = Number(q('setTargetNum').value) || 500;
    s.keypadMode = q('setKeypadMode').value;
    s.maxSteps = Number(q('setMaxSteps').value) || 30;
    s.reserve = Number(q('setReserve').value) || 20000;
    s.capRule = q('setCapRule').value;
    state.ladder = buildLadder(s);
    renderAll();
    showToast('YANTRA APPLIED', 'Settings saved');
  });
  q('saveLadderBtn').addEventListener('click', () => {
    let cumulative = 0;
    document.querySelectorAll('[data-ladder-index]').forEach(inp => {
      const i = Number(inp.dataset.ladderIndex);
      const bet = Math.max(state.settings.coin, Number(inp.value) || 0);
      cumulative += bet;
      state.ladder[i] = { step:`S${i+1}`, bet, winReturn: bet * 9, netProfit: (bet * 9) - cumulative, ifLoseTotal: -cumulative };
    });
    renderAll();
    showToast('SOPANA SAVED', 'Editable ladder updated');
  });
  q('resetLadderBtn').addEventListener('click', () => {
    state.ladder = buildLadder(state.settings);
    renderAll();
    showToast('SOPANA RESET', 'Default ladder restored');
  });
  q('exportCsvBtn').addEventListener('click', exportDrishtiCsv);
  q('loadCsvBtn').addEventListener('click', () => q('loadCsvFile').click());
  q('loadCsvFile').addEventListener('change', importDrishtiCsv);
  q('exportGranthBtn').addEventListener('click', exportGranthJson);
  q('importGranthBtn').addEventListener('click', () => q('importGranthFile').click());
  q('importGranthFile').addEventListener('change', importGranthJson);
  q('deleteGranthBtn').addEventListener('click', () => {
    state.granth = [];
    state.currentKumbhId = null;
    renderAll();
    showToast('GRANTH PURGED', 'All Kumbh history removed');
  });
}
function exportDrishtiCsv(){
  const header = 'Side,Number,ActivationChakra,WinChakra,StepsToWin,PreviousLoss,WinningBet,NetProfitLoss,Status\n';
  const rows = state.drishti.map(r => [r.side,r.number,r.activationChakra,r.winChakra,r.steps,r.prevLoss,r.winBet,r.net,r.status].join(',')).join('\n');
  downloadFile('drishti.csv', header + rows, 'text/csv');
}
function importDrishtiCsv(e){
  const file = e.target.files[0];
  if(!file) return;
  file.text().then(text => {
    state.drishti = text.trim().split(/\r?\n/).slice(1).filter(Boolean).map(line => {
      const [side,number,activationChakra,winChakra,steps,prevLoss,winBet,net,status] = line.split(',');
      return { side, number, activationChakra, winChakra, steps, prevLoss, winBet, net, status };
    });
    renderAll();
    showToast('DRISHTI LOADED', 'CSV imported');
  });
  e.target.value = '';
}
function exportGranthJson(){
  downloadFile('granth.json', JSON.stringify(state.granth, null, 2), 'application/json');
}
function importGranthJson(e){
  const file = e.target.files[0];
  if(!file) return;
  file.text().then(text => {
    state.granth = JSON.parse(text);
    state.currentKumbhId = state.granth.at(-1)?.id || null;
    renderAll();
    showToast('GRANTH LOADED', 'History imported');
  });
  e.target.value = '';
}
function downloadFile(name, content, type){
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 500);
}
function setupInstall(){
  window.addEventListener('beforeinstallprompt', e => {
    e.preventDefault();
    deferredPrompt = e;
    q('installBtn').classList.remove('hidden');
  });
  q('installBtn').addEventListener('click', async () => {
    if(!deferredPrompt) return;
    deferredPrompt.prompt();
    await deferredPrompt.userChoice;
    deferredPrompt = null;
    q('installBtn').classList.add('hidden');
  });
  if('serviceWorker' in navigator){
    window.addEventListener('load', () => navigator.serviceWorker.register('./service-worker.js').catch(() => {}));
  }
}

injectKeyGlowStyles();
setupInstall();
setupTabs();
setupControls();
ensureKumbh();
renderAll();
showToast('READY', 'Kubera Warhunt loaded');
