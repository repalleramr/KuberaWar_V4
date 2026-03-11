const STORAGE_KEY = 'kubera-warhunt-v4';
const defaultSettings = {
  bankroll: 30000,
  targetDollar: 500,
  targetPercent: 1.67,
  stopLoss: 50000,
  min: 100,
  max: 3000,
  coin: 100,
  targetNum: 500,
  doubleLadder: 'off',
  keypadMode: 'combined',
  maxSteps: 30,
  reserve: 20000,
  capRule: 'on'
};
const titles = { sangram:'⚔ SANGRAM', vyuha:'🛡 VYUHA', granth:'📜 GRANTH', drishti:'👁 DRISHTI', sopana:'🪜 SOPANA', yantra:'⚙ YANTRA', medha:'🧠 MEDHA' };
let deferredPrompt = null;
let historyStack = [];
let pending = { Y: null, K: null };
let clearConfirmResolver = null;

const q = id => document.getElementById(id);
const fmtMoney = n => '₹ ' + Number(n || 0).toLocaleString('en-IN');
const clone = obj => JSON.parse(JSON.stringify(obj));
function freshNumber(){ return { status:'I', step:0, ladder:1, activeAt:null, prevLoss:0, winningBet:0, lastNet:0, pendingSecond:false }; }
function createSide(){ const s={}; for(let i=1;i<=9;i++) s[i]=freshNumber(); return s; }
function roundUpToCoin(value, coin){ return Math.max(coin, Math.ceil(value / coin) * coin); }
function csvEscape(v){ const s=String(v ?? ''); return /[",\n]/.test(s) ? '"' + s.replace(/"/g,'""') + '"' : s; }
function parseCsvLine(line){ const out=[]; let cur=''; let inQuotes=false; for(let i=0;i<line.length;i++){ const ch=line[i]; if(ch==='"'){ if(inQuotes && line[i+1]==='"'){ cur+='"'; i++; } else inQuotes=!inQuotes; } else if(ch===',' && !inQuotes){ out.push(cur); cur=''; } else cur+=ch; } out.push(cur); return out; }

function askClearKumbh(){
  return new Promise(resolve=>{
    clearConfirmResolver = resolve;
    q('confirmOverlay').classList.remove('hidden');
    q('confirmOverlay').setAttribute('aria-hidden','false');
    q('confirmOkBtn').focus();
  });
}
function closeClearKumbh(answer){
  q('confirmOverlay').classList.add('hidden');
  q('confirmOverlay').setAttribute('aria-hidden','true');
  if(clearConfirmResolver){ const resolve=clearConfirmResolver; clearConfirmResolver=null; resolve(answer); }
}

function buildLadder(settings){
  const rows = [];
  let previousLoss = 0;
  let bet = roundUpToCoin(settings.min, settings.coin);
  let currentLevel = bet;
  for(let step=1; step<=settings.maxSteps; step++){
    bet = Math.min(settings.max, roundUpToCoin(bet, settings.coin));
    const winReturn = bet * 9;
    rows.push({
      step: `S${step}`,
      bet,
      winReturn,
      netProfit: winReturn - (previousLoss + bet),
      ifLoseTotal: -(previousLoss + bet)
    });
    previousLoss += bet;
    if(step < settings.maxSteps){
      const hits = ((bet * 8) - previousLoss) >= settings.targetNum;
      if(!hits){
        if(settings.doubleLadder === 'on'){
          currentLevel = Math.min(settings.max, roundUpToCoin(currentLevel * 2, settings.coin));
          bet = currentLevel;
        } else {
          let probe = bet;
          while((((probe * 8) - previousLoss) < settings.targetNum) && probe < settings.max){
            probe = Math.min(settings.max, roundUpToCoin(probe + settings.coin, settings.coin));
          }
          bet = probe;
          currentLevel = bet;
        }
      } else {
        bet = currentLevel;
      }
    }
  }
  return rows;
}
function buildSecondLadder(settings, ladder){
  const base = Math.abs(ladder.at(-1)?.ifLoseTotal || 0);
  const rows=[];
  let secondLoss=0;
  let bet = roundUpToCoin(Math.max(settings.coin, settings.max / 4), settings.coin);
  for(let step=1; step<=Math.min(settings.maxSteps, 15); step++){
    if(step<=5) bet = roundUpToCoin(Math.max(settings.coin, settings.max/4), settings.coin);
    else if(step<=10) bet = roundUpToCoin(Math.min(settings.max, (settings.max/2)), settings.coin);
    else bet = roundUpToCoin(settings.max, settings.coin);
    secondLoss += bet;
    rows.push({
      step:`2S${step}`,
      bet,
      winReturn: bet*9,
      netProfit:(bet*9)-(base+secondLoss),
      ifLoseTotal:-(base+secondLoss)
    });
  }
  return rows;
}

function freshState(){
  const settings={...defaultSettings};
  const ladder=buildLadder(settings);
  return {
    settings,
    liveBankroll: settings.bankroll,
    currentChakra: 0,
    numbers:{Y:createSide(),K:createSide()},
    drishti:[],
    granth:[],
    currentKumbhId:null,
    summary:{totalAhuti:0,maxExposure:0},
    ladder,
    secondLadder:buildSecondLadder(settings, ladder),
    activeTab:'sangram',
    lastResult:'-',
    analyzerData:{ rows:[] }
  };
}
function reviveState(raw){
  const base=freshState();
  const settings={...base.settings,...(raw.settings||{})};
  if(!Number.isFinite(Number(settings.stopLoss)) || Number(settings.stopLoss)<=0) settings.stopLoss=50000;
  const ladder=Array.isArray(raw.ladder)&&raw.ladder.length?raw.ladder:buildLadder(settings);
  return {
    ...base,
    ...raw,
    settings,
    numbers: raw.numbers || base.numbers,
    summary:{...base.summary,...(raw.summary||{})},
    ladder,
    secondLadder:Array.isArray(raw.secondLadder)&&raw.secondLadder.length?raw.secondLadder:buildSecondLadder(settings, ladder),
    activeTab:raw.activeTab||'sangram',
    analyzerData:raw.analyzerData||{rows:[]}
  };
}
function loadState(){ try{ const raw=localStorage.getItem(STORAGE_KEY); return raw?reviveState(JSON.parse(raw)):freshState(); }catch{ return freshState(); } }
let state=loadState();
function saveState(){ localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); }
function currentKumbh(){ return state.granth.find(k=>k.id===state.currentKumbhId) || null; }
function ensureKumbh(){ if(currentKumbh()) return currentKumbh(); const id=(state.granth.at(-1)?.id||0)+1; const k={id,rows:[]}; state.granth.push(k); state.currentKumbhId=id; return k; }

function currentBetForInfo(info, ladder=state.ladder, secondLadder=state.secondLadder, settings=state.settings){
  if(info.ladder===2) return secondLadder[Math.max(0,(info.step||1)-1)]?.bet || settings.max;
  return ladder[Math.max(0,(info.step||1)-1)]?.bet || settings.max;
}
function nextExposureTotal(numbers=state.numbers, ladder=state.ladder, secondLadder=state.secondLadder, settings=state.settings){
  let total=0;
  ['Y','K'].forEach(side=>{ for(let n=1;n<=9;n++){ const info=numbers[side][n]; if(info.status==='A'||info.status==='B') total += currentBetForInfo(info, ladder, secondLadder, settings); } });
  return total;
}

function simulateSession(rows, settings=state.settings, ladder=state.ladder, secondLadder=state.secondLadder){
  const sim={
    currentChakra:0,
    liveBankroll:settings.bankroll,
    numbers:{Y:createSide(),K:createSide()},
    drishti:[],
    summary:{totalAhuti:0,maxExposure:0},
    lastResult:'-',
    rowsDisplay:[]
  };
  function pushDrishti(rec){ sim.drishti.push(rec); }
  function resolveNumber(side,num){
    const info=sim.numbers[side][num];
    if(info.status==='C'){ info.status='B'; info.ladder=2; info.step=1; info.pendingSecond=false; return; }
    if(info.status==='I'){ info.status='A'; info.step=1; info.ladder=1; info.activeAt=sim.currentChakra; info.prevLoss=0; return; }
    const bet=currentBetForInfo(info, ladder, secondLadder, settings);
    const totalReturn=bet*9;
    const net=(bet*8)-info.prevLoss;
    sim.liveBankroll += totalReturn;
    info.winningBet=bet; info.lastNet=net;
    pushDrishti({ side, number:num, activationChakra:info.activeAt ?? sim.currentChakra, winChakra:sim.currentChakra, steps:info.step, prevLoss:info.prevLoss, winBet:bet, net, status: info.ladder===2?'WIN-2':'WIN' });
    info.status='L';
  }
  function advanceAfterLoss(side){
    for(let n=1;n<=9;n++){
      const info=sim.numbers[side][n];
      if(info.status!=='A' && info.status!=='B') continue;
      const bet=currentBetForInfo(info, ladder, secondLadder, settings);
      info.prevLoss += bet;
      info.step += 1;
      if(info.ladder===1){
        const prevBet = ladder[Math.max(0, info.step-2)]?.bet || settings.max;
        const nextBet = ladder[Math.max(0, info.step-1)]?.bet || settings.max;
        if(((nextBet>=settings.max && prevBet>=settings.max && settings.capRule==='on') || info.step>settings.maxSteps)){
          info.status='C';
          pushDrishti({ side, number:n, activationChakra:info.activeAt ?? '-', winChakra:'-', steps:Math.min(info.step-1, settings.maxSteps), prevLoss:info.prevLoss, winBet:'-', net:-info.prevLoss, status:'CAP' });
        } else info.status='A';
      } else {
        if(info.step>secondLadder.length) info.step=secondLadder.length;
        info.status='B';
      }
    }
  }
  function processSide(side, num){
    if(num===null || num===undefined || num==='-' || num==='') return;
    const val=Number(num);
    if(val===0){ advanceAfterLoss(side); return; }
    const info=sim.numbers[side][val];
    if(info.status==='L'){ advanceAfterLoss(side); return; }
    advanceAfterLoss(side);
    resolveNumber(side,val);
  }
  rows.forEach(raw=>{
    sim.currentChakra += 1;
    const hasY = raw.y!==undefined && raw.y!==null && raw.y!=='-';
    const hasK = raw.k!==undefined && raw.k!==null && raw.k!=='-';
    let exposure=0;
    if(hasY && hasK){
      exposure = nextExposureTotal(sim.numbers, ladder, secondLadder, settings);
    } else if(hasY || hasK){
      const side = hasY ? 'Y' : 'K';
      for(let n=1;n<=9;n++){
        const info=sim.numbers[side][n];
        if(info.status==='A'||info.status==='B') exposure += currentBetForInfo(info, ladder, secondLadder, settings);
      }
    }
    sim.liveBankroll -= exposure;
    sim.summary.totalAhuti += exposure;
    sim.summary.maxExposure = Math.max(sim.summary.maxExposure, exposure);
    if(hasY) processSide('Y', raw.y);
    if(hasK) processSide('K', raw.k);
    sim.lastResult = hasY && hasK ? `Round ${sim.currentChakra}: Y ${raw.y} | K ${raw.k}` : `Round ${sim.currentChakra}: ${hasY?'Y':'K'} ${hasY?raw.y:raw.k}`;
    sim.rowsDisplay.push({ chakra:sim.currentChakra, y:hasY?Number(raw.y):'-', k:hasK?Number(raw.k):'-', ahuti:exposure, axyapatra:sim.liveBankroll });
  });
  return sim;
}

function rebuildFromRawResults(){
  const sim = simulateSession(currentKumbh()?.rows || []);
  state.liveBankroll = sim.liveBankroll;
  state.currentChakra = sim.currentChakra;
  state.numbers = sim.numbers;
  state.drishti = sim.drishti;
  state.summary = sim.summary;
  state.lastResult = sim.lastResult;
}

function showToast(title,text,kind=''){
  const layer=q('toastLayer'); const el=document.createElement('div'); el.className=`toast ${kind}`; el.innerHTML=`<div class="title">${title}</div><div>${text}</div>`; layer.appendChild(el); setTimeout(()=>el.remove(),3600);
}
function glowKey(el){ if(!el) return; el.classList.remove('key-glow'); void el.offsetWidth; el.classList.add('key-glow'); setTimeout(()=>el.classList.remove('key-glow'),220); }
function statusCode(info){ if(!info) return '0'; if(info.status==='A') return `S${info.step}`; if(info.status==='B') return `2S${info.step}`; return info.status; }

function renderBoards(){
  ['Y','K'].forEach(side=>{
    const host=q(side==='Y'?'boardY':'boardK'); host.innerHTML='';
    for(let i=1;i<=10;i++){
      const n=i===10?0:i; const info=n===0?null:state.numbers[side][n]; const code=n===0?'0':statusCode(info); const metaClass=info?.step?`step${Math.min(info.step,6)}`:'';
      const btn=document.createElement('button'); btn.type='button'; btn.className=`tile ${n===0?'zero':''} ${info?'state-'+info.status:''}`.trim(); btn.dataset.side=side; btn.dataset.num=String(n);
      btn.innerHTML=`<div class="num">${n}</div><div class="meta ${metaClass}">${code}</div>`;
      btn.addEventListener('click',e=>handleTap(side,n,e.currentTarget));
      host.appendChild(btn);
    }
  });
}
function renderVyuha(){ ['Y','K'].forEach(side=>{ const host=q(side==='Y'?'vyuhaY':'vyuhaK'); host.innerHTML=''; for(let n=1;n<=9;n++){ const info=state.numbers[side][n]; const d=document.createElement('div'); d.className='state-cell'; d.innerHTML=`<div class="num">${n}</div><div class="meta">${statusCode(info)}</div>`; host.appendChild(d);} }); }
function formatNextAhuti(side){ const groups=new Map(); for(let n=1;n<=9;n++){ const info=state.numbers[side][n]; if(info.status==='A'||info.status==='B'){ const bet=currentBetForInfo(info); if(!groups.has(bet)) groups.set(bet,[]); groups.get(bet).push(`${n}(${info.ladder===2?'2S':'S'}${info.step})`); } } const parts=[...groups.entries()].sort((a,b)=>b[0]-a[0]).map(([bet,arr])=>`${bet} on ${arr.join(' ')}`); return `${side} ${parts.join(' | ') || '-'}`; }
function renderSangram(){ q('bankValue').textContent=fmtMoney(state.liveBankroll); q('chakraValue').textContent=`Round : ${state.currentChakra}`; q('nextY').textContent=formatNextAhuti('Y') + (pending.Y!==null?`  • Sel ${pending.Y}`:''); q('nextK').textContent=formatNextAhuti('K') + (pending.K!==null?`  • Sel ${pending.K}`:''); q('nextT').textContent=`T ${nextExposureTotal()}`; q('lastResultValue').textContent=state.lastResult || '-'; }
function renderGranth(){
  const host=q('granthList'); host.innerHTML='';
  const sel=q('deleteKumbhSelect'); if(sel){ sel.innerHTML='<option value="">Select Kumbh</option>'; [...state.granth].forEach(k=>{ const op=document.createElement('option'); op.value=String(k.id); op.textContent=`#${String(k.id).padStart(2,'0')} Kumbh`; sel.appendChild(op); }); }
  const items=[...state.granth].reverse();
  if(!items.length){ host.innerHTML='<div class="kumbh">No Kumbh history yet.</div>'; return; }
  items.forEach(k=>{
    const wrap=document.createElement('div'); wrap.className='kumbh';
    const sim=simulateSession(k.rows || []);
    const rows=[...sim.rowsDisplay].reverse().map(r=>`<tr><td>${r.chakra}</td><td>${r.y ?? '-'}</td><td>${r.k ?? '-'}</td><td>${r.ahuti}</td><td>${r.axyapatra}</td></tr>`).join('');
    wrap.innerHTML=`<div class="label">#${String(k.id).padStart(2,'0')} Kumbh</div><div class="table-wrap compact-table"><table><thead><tr><th>Chakra</th><th>Y</th><th>K</th><th>Āhuti</th><th>Axyapatra</th></tr></thead><tbody>${rows}</tbody></table></div>`;
    host.appendChild(wrap);
  });
}
function renderDrishti(){ q('sumChakras').textContent=Math.max(0,state.currentChakra); q('sumAhuti').textContent=state.summary.totalAhuti; q('sumProfit').textContent=state.liveBankroll-state.settings.bankroll; q('sumExposure').textContent=state.summary.maxExposure; const tbody=q('drishtiTable').querySelector('tbody'); tbody.innerHTML=''; [...state.drishti].reverse().forEach(r=>{ const tr=document.createElement('tr'); tr.innerHTML=`<td>${r.side}</td><td>${r.number}</td><td>${r.activationChakra}</td><td>${r.winChakra}</td><td>${r.steps}</td><td>${r.prevLoss}</td><td>${r.winBet}</td><td>${r.net}</td><td>${r.status}</td>`; tbody.appendChild(tr); }); }
function buildPreviewRows(bets, prefix='S', baseLoss=0){ let cumulative=0; return bets.map((bet,idx)=>{ cumulative += bet; return { step:`${prefix}${idx+1}`, bet, winReturn:bet*9, netProfit:(bet*9)-(baseLoss+cumulative), ifLoseTotal:-(baseLoss+cumulative) }; }); }
function renderSopana(){
  const tbody=q('ladderTable').querySelector('tbody'); tbody.innerHTML='';
  const preview1=getEditableLadderPreview();
  preview1.forEach((row,idx)=>{ const tr=document.createElement('tr'); tr.innerHTML=`<td>${row.step}</td><td><input class="ladder-bet-input" type="number" data-ladder-index="${idx}" inputmode="numeric" enterkeyhint="next" value="${row.bet}"></td><td>${row.winReturn}</td><td>${row.netProfit}</td><td>${row.ifLoseTotal}</td>`; tbody.appendChild(tr); });
  const secondBody=q('secondLadderTable').querySelector('tbody'); secondBody.innerHTML='';
  const preview2=getEditableSecondLadderPreview(preview1);
  preview2.forEach((row,idx)=>{ const tr=document.createElement('tr'); tr.innerHTML=`<td>${row.step}</td><td><input class="ladder-bet-input" type="number" data-second-ladder-index="${idx}" inputmode="numeric" enterkeyhint="next" value="${row.bet}"></td><td>${row.winReturn}</td><td>${row.netProfit}</td><td>${row.ifLoseTotal}</td>`; secondBody.appendChild(tr); });
}
function renderYantra(){ const s=state.settings; q('setBankroll').value=s.bankroll; q('setTargetDollar').value=s.targetDollar; q('setTargetPercent').value=s.targetPercent; q('setStopLoss').value=s.stopLoss; q('setMin').value=s.min; q('setMax').value=s.max; q('setCoin').value=s.coin; q('setTargetNum').value=s.targetNum; q('setDoubleLadder').value=s.doubleLadder||'off'; q('setKeypadMode').value=s.keypadMode; q('setMaxSteps').value=s.maxSteps; q('setReserve').value=s.reserve; q('setCapRule').value=s.capRule; }
function computeExpectedBankrollFor(rows, min, max){
  const settings={...state.settings, min, max, coin:min};
  const ladder=buildLadder(settings); const second=buildSecondLadder(settings, ladder);
  const sim=simulateSession(rows, settings, ladder, second);
  const futureRisk = estimateWorstCaseAdditionalLoss(sim.numbers, settings, ladder, second);
  return { currentLive:sim.liveBankroll, futureRisk, required:Math.max(0, futureRisk - sim.liveBankroll), safeBankroll: sim.liveBankroll + futureRisk };
}
function estimateWorstCaseAdditionalLoss(numbers, settings, ladder, secondLadder){
  let total=0;
  ['Y','K'].forEach(side=>{
    for(let n=1;n<=9;n++){
      const info=numbers[side][n];
      if(info.status==='A'){
        for(let s=info.step; s<=settings.maxSteps; s++) total += ladder[Math.max(0,s-1)]?.bet || settings.max;
      } else if(info.status==='B'){
        for(let s=info.step; s<=secondLadder.length; s++) total += secondLadder[Math.max(0,s-1)]?.bet || settings.max;
      }
    }
  });
  return total;
}
function renderMedha(){
  const active=[]; const cap=[];
  ['Y','K'].forEach(side=>{ for(let n=1;n<=9;n++){ const info=state.numbers[side][n]; if(info.status==='A'||info.status==='B') active.push(`${side}${n} ${info.ladder===2?'2S':'S'}${info.step}`); if(info.status==='C') cap.push(`${side}${n}`);} });
  const srcRows = state.analyzerData.rows?.length ? state.analyzerData.rows : (currentKumbh()?.rows || []);
  const currentEst = computeExpectedBankrollFor(srcRows, state.ladder[0]?.bet || state.settings.min, state.settings.max);
  const t100 = computeExpectedBankrollFor(srcRows, 100, 3000);
  const t500 = computeExpectedBankrollFor(srcRows, 500, 10000);
  const t1000 = computeExpectedBankrollFor(srcRows, 1000, 60000);
  const resultTokens = srcRows.map(r=>`${r.y ?? '-'}|${r.k ?? '-'}`).join(' , ') || 'No analyzer results';
  q('medhaPanel').innerHTML=`
    <div class="medha-item"><div class="label">Active Formation</div><div>${active.join(' | ') || 'None'}</div></div>
    <div class="medha-item"><div class="label">CAP Numbers</div><div>${cap.join(' | ') || 'None'}</div></div>
    <div class="medha-item"><div class="toolbar"><div class="label">Analyzer</div><div class="btn-row"><button id="importAnalyzerBtn" type="button">Import Results</button><button id="eraseAnalyzerBtn" class="warn" type="button">Erase</button><input id="importAnalyzerFile" type="file" accept="application/json,.json,.csv,text/csv" hidden></div></div><div class="compact-results">${resultTokens}</div></div>
    <div class="medha-item"><div class="label">Expected Bankroll - Current Ladder</div><div>Future risk ${fmtMoney(currentEst.futureRisk)} | Needed now ${fmtMoney(currentEst.required)} | Safe ${fmtMoney(currentEst.safeBankroll)}</div></div>
    <div class="medha-item"><div class="label">100 - 3000 Table</div><div>Future risk ${fmtMoney(t100.futureRisk)} | Needed now ${fmtMoney(t100.required)} | Safe ${fmtMoney(t100.safeBankroll)}</div></div>
    <div class="medha-item"><div class="label">500 - 10000 Table</div><div>Future risk ${fmtMoney(t500.futureRisk)} | Needed now ${fmtMoney(t500.required)} | Safe ${fmtMoney(t500.safeBankroll)}</div></div>
    <div class="medha-item"><div class="label">1000 - 60000 Table</div><div>Future risk ${fmtMoney(t1000.futureRisk)} | Needed now ${fmtMoney(t1000.required)} | Safe ${fmtMoney(t1000.safeBankroll)}</div></div>`;
  q('importAnalyzerBtn')?.addEventListener('click', ()=>q('importAnalyzerFile').click());
  q('importAnalyzerFile')?.addEventListener('change', importAnalyzerFile);
  q('eraseAnalyzerBtn')?.addEventListener('click', ()=>{ state.analyzerData={rows:[]}; renderAll(); showToast('ANALYZER ERASED','Imported analyzer data cleared'); });
}
function renderActiveTab(){ document.querySelectorAll('.screen').forEach(s=>s.classList.toggle('active',s.id===`screen-${state.activeTab}`)); document.querySelectorAll('.nav').forEach(b=>b.classList.toggle('active',b.dataset.target===state.activeTab)); q('screenTitle').textContent=titles[state.activeTab]||titles.sangram; }
function renderAll(){ rebuildFromRawResults(); renderActiveTab(); renderBoards(); renderVyuha(); renderSangram(); renderGranth(); renderDrishti(); renderSopana(); renderYantra(); renderMedha(); saveState(); }

function startPrayoga(){ if(state.currentChakra!==0 || currentKumbh()?.rows?.length){ state.currentKumbhId=null; } const kumbh=ensureKumbh(); state.activeTab='sangram'; renderAll(); showToast('SANGRAM AARAMBHA', `#${String(kumbh.id).padStart(2,'0')} Kumbh ready`); }
async function clearCurrentSession(){ if(!(await askClearKumbh())) return; state.currentKumbhId=null; pending={Y:null,K:null}; const kumbh=ensureKumbh(); state.activeTab='sangram'; renderAll(); showToast('KUMBHA SHUDDHI',`#${String(kumbh.id).padStart(2,'0')} Kumbh ready`); }
function recordSnapshot(){ historyStack.push(JSON.stringify(state)); if(historyStack.length>80) historyStack.shift(); }
function undoLast(){ const prev=historyStack.pop(); if(!prev) return; const tab=state.activeTab; state=reviveState(JSON.parse(prev)); pending={Y:null,K:null}; if(tab==='granth') state.activeTab='granth'; renderAll(); showToast('CHAKRA PUNARAVRITTI','Last chakra reverted'); }

function addResultRow(row){ recordSnapshot(); ensureKumbh().rows.push(row); renderAll(); }
function handleTap(side,num,el){
  glowKey(el);
  if(state.settings.keypadMode==='combined'){
    pending[side]=num;
    renderSangram();
    if(pending.Y!==null && pending.K!==null){ addResultRow({ y: pending.Y, k: pending.K }); pending={Y:null,K:null}; }
  } else {
    addResultRow(side==='Y' ? { y:num, k:'-' } : { y:'-', k:num });
  }
}
function switchTab(target){ state.activeTab=target; renderActiveTab(); saveState(); }
function setupTabs(){ document.querySelectorAll('.nav').forEach(btn=>btn.addEventListener('click',()=>switchTab(btn.dataset.target))); }
function recalcTargetLink(source){ const bankroll=Number(q('setBankroll').value)||defaultSettings.bankroll; if(source==='dollar') q('setTargetPercent').value=((Number(q('setTargetDollar').value||0)/bankroll)*100).toFixed(2); if(source==='percent') q('setTargetDollar').value=Math.round((bankroll*Number(q('setTargetPercent').value||0))/100); }

async function saveBlob(blob, suggestedName, types){
  try{
    if(window.showSaveFilePicker){
      const handle = await window.showSaveFilePicker({ suggestedName, types });
      const writable = await handle.createWritable();
      await writable.write(blob); await writable.close(); return true;
    }
  }catch(err){ if(err?.name==='AbortError') return false; }
  const url=URL.createObjectURL(blob); const a=document.createElement('a'); a.href=url; a.download=suggestedName; a.click(); setTimeout(()=>URL.revokeObjectURL(url), 700); return true;
}
function granthCsvContent(){ const rows=['Kumbh,Chakra,Y,K,Ahuti,Axyapatra']; state.granth.forEach(k=>{ const sim=simulateSession(k.rows||[]); sim.rowsDisplay.forEach(r=>rows.push([`#${String(k.id).padStart(2,'0')} Kumbh`,r.chakra,r.y,r.k,r.ahuti,r.axyapatra].map(csvEscape).join(','))); }); return rows.join('\n'); }
function drishtiCsvContent(){ const rows=['Side,Number,ActivationChakra,WinChakra,StepsToWin,PreviousLoss,WinningBet,NetProfitLoss,Status']; state.drishti.forEach(r=>rows.push([r.side,r.number,r.activationChakra,r.winChakra,r.steps,r.prevLoss,r.winBet,r.net,r.status].map(csvEscape).join(','))); return rows.join('\n'); }
async function exportDrishtiCsv(){ const ok=await saveBlob(new Blob([drishtiCsvContent()],{type:'text/csv'}),'drishti.csv',[{description:'CSV',accept:{'text/csv':['.csv']}}]); if(ok) showToast('DRISHTI EXPORTED','CSV saved'); }
function parseRowsFromText(text, filename=''){
  const lower = filename.toLowerCase();
  if(lower.endsWith('.json')){
    const parsed=JSON.parse(text);
    if(Array.isArray(parsed)){
      if(parsed.length && parsed[0]?.rows) return parsed.flatMap(k=>k.rows.map(r=>({ y:r.y, k:r.k })));
      return parsed.map(r=>({ y:r.y ?? r.Y ?? r.resultY ?? '-', k:r.k ?? r.K ?? r.resultK ?? '-' }));
    }
    return [];
  }
  const lines=text.trim().split(/\r?\n/).filter(Boolean);
  const data=lines.slice(1);
  const out=[];
  data.forEach(line=>{
    const cells=parseCsvLine(line);
    if(cells.length>=6 && /kumbh/i.test(lines[0])) out.push({ y:cells[2], k:cells[3] });
    else if(cells.length>=2) out.push({ y:cells[0], k:cells[1] });
    else if(cells.length===1 && cells[0].includes('|')){ const [y,k]=cells[0].split('|'); out.push({y,k}); }
  });
  return out.filter(r=>r.y!=='' || r.k!=='');
}
function importDrishtiCsv(e){ const file=e.target.files[0]; if(!file) return; file.text().then(text=>{ state.drishti=parseCsvLine?text.trim().split(/\r?\n/).slice(1).filter(Boolean).map(line=>{ const [side,number,activationChakra,winChakra,steps,prevLoss,winBet,net,status]=parseCsvLine(line); return {side,number,activationChakra,winChakra,steps,prevLoss,winBet,net,status}; }):[]; renderAll(); showToast('DRISHTI LOADED','CSV imported'); }); e.target.value=''; }
async function exportGranthJson(){ const ok=await saveBlob(new Blob([JSON.stringify(state.granth,null,2)],{type:'application/json'}),'granth.json',[{description:'JSON',accept:{'application/json':['.json']}}]); if(ok) showToast('GRANTH EXPORTED','JSON saved'); }
async function exportGranthCsv(){ const ok=await saveBlob(new Blob([granthCsvContent()],{type:'text/csv'}),'granth.csv',[{description:'CSV',accept:{'text/csv':['.csv']}}]); if(ok) showToast('GRANTH EXPORTED','CSV saved'); }
function rebuildImportedGranth(rows){
  state.granth=[]; state.currentKumbhId=null;
  const k=ensureKumbh();
  rows.forEach(r=>k.rows.push({ y:r.y==='-'?'-':Number(r.y), k:r.k==='-'?'-':Number(r.k) }));
}
function importGranthFile(e){ const file=e.target.files[0]; if(!file) return; file.text().then(text=>{ if(file.name.toLowerCase().endsWith('.json')){ const parsed=JSON.parse(text); if(Array.isArray(parsed) && parsed.length && parsed[0]?.rows){ state.granth = parsed.map((k,idx)=>({ id:k.id || idx+1, rows:(k.rows||[]).map(r=>({ y:r.y, k:r.k })) })); state.currentKumbhId=state.granth.at(-1)?.id || null; } else { rebuildImportedGranth(parseRowsFromText(text,file.name)); } } else { rebuildImportedGranth(parseRowsFromText(text,file.name)); } renderAll(); showToast('GRANTH LOADED','Imported and recalculated with current ladder'); }); e.target.value=''; }
async function exportLadderCsv(){ const rows=['Ladder,Step,Bet']; state.ladder.forEach((r,idx)=>rows.push(['1',idx+1,r.bet].join(','))); state.secondLadder.forEach((r,idx)=>rows.push(['2',idx+1,r.bet].join(','))); const ok=await saveBlob(new Blob([rows.join('\n')],{type:'text/csv'}),'sopana-ladder.csv',[{description:'CSV',accept:{'text/csv':['.csv']}}]); if(ok) showToast('SOPANA SAVED','Ladder CSV saved'); }
function importLadderCsv(e){ const file=e.target.files[0]; if(!file) return; file.text().then(text=>{ const lines=text.trim().split(/\r?\n/).slice(1); const first=[]; const second=[]; lines.forEach(line=>{ const [ladderNo, step, bet]=parseCsvLine(line); if(String(ladderNo)==='1') first[Number(step)-1]=Number(bet)||0; if(String(ladderNo)==='2') second[Number(step)-1]=Number(bet)||0; }); if(first.some(Boolean)) state.ladder=buildPreviewRows(first.map(v=>Math.max(state.settings.coin, Number(v)||state.settings.coin))); if(second.some(Boolean)) state.secondLadder=buildPreviewRows(second.map(v=>Math.max(state.settings.coin, Number(v)||state.settings.coin)), '2S', Math.abs(state.ladder.at(-1)?.ifLoseTotal||0)); renderAll(); showToast('SOPANA LOADED','Ladder CSV loaded'); }); e.target.value=''; }
function buildPdfFromLines(lines){
  const esc=s=>String(s).replace(/\\/g,'\\\\').replace(/\(/g,'\\(').replace(/\)/g,'\\)');
  const content=[]; let y=800; content.push('BT /F1 10 Tf 40 820 Td (KUBERA DRISHTI REPORT) Tj ET');
  lines.forEach(line=>{ content.push(`BT /F1 9 Tf 40 ${y} Td (${esc(line).slice(0,160)}) Tj ET`); y-=14; if(y<40) y=800; });
  const stream=content.join('\n');
  const objs=[];
  objs.push('1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj');
  objs.push('2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj');
  objs.push('3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >> endobj');
  objs.push('4 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> endobj');
  objs.push(`5 0 obj << /Length ${stream.length} >> stream\n${stream}\nendstream endobj`);
  let pdf='%PDF-1.4\n'; const offsets=[0]; objs.forEach(obj=>{ offsets.push(pdf.length); pdf+=obj+'\n'; }); const xrefPos=pdf.length; pdf+=`xref\n0 ${objs.length+1}\n0000000000 65535 f \n`; for(let i=1;i<offsets.length;i++) pdf+=`${String(offsets[i]).padStart(10,'0')} 00000 n \n`; pdf+=`trailer << /Size ${objs.length+1} /Root 1 0 R >>\nstartxref\n${xrefPos}\n%%EOF`; return new Blob([pdf],{type:'application/pdf'});
}
async function exportDrishtiPdf(){ const lines=['Side | No | Act | Win | Steps | Prev Loss | Win Bet | Net | Status']; state.drishti.forEach(r=>lines.push(`${r.side} | ${r.number} | ${r.activationChakra} | ${r.winChakra} | ${r.steps} | ${r.prevLoss} | ${r.winBet} | ${r.net} | ${r.status}`)); const ok=await saveBlob(buildPdfFromLines(lines),'drishti-report.pdf',[{description:'PDF',accept:{'application/pdf':['.pdf']}}]); if(ok) showToast('PDF EXPORTED','Adobe-compatible PDF saved'); }
function getEditableLadderPreview(){ const inputs=[...document.querySelectorAll('[data-ladder-index]')]; if(!inputs.length) return state.ladder; const bets=inputs.map((inp,idx)=>Math.max(state.settings.coin, Number(inp.value)||state.ladder[idx]?.bet||state.settings.coin)); return buildPreviewRows(bets); }
function getEditableSecondLadderPreview(firstPreview){ const inputs=[...document.querySelectorAll('[data-second-ladder-index]')]; if(!inputs.length) return state.secondLadder; const bets=inputs.map((inp,idx)=>Math.max(state.settings.coin, Number(inp.value)||state.secondLadder[idx]?.bet||state.settings.coin)); return buildPreviewRows(bets,'2S',Math.abs((firstPreview||state.ladder).at(-1)?.ifLoseTotal||0)); }
function saveEditableLadders(){ state.ladder=getEditableLadderPreview(); state.secondLadder=getEditableSecondLadderPreview(state.ladder); renderAll(); showToast('SOPANA SAVED','1st and 2nd ladders updated'); }
function resetEditableLadders(){ state.ladder=buildLadder(state.settings); state.secondLadder=buildSecondLadder(state.settings,state.ladder); renderAll(); showToast('SOPANA RESET','Default ladders restored'); }
function liveRefreshLadderPreview(){ const first=getEditableLadderPreview(); const second=getEditableSecondLadderPreview(first); const rows=q('ladderTable').querySelectorAll('tbody tr'); first.forEach((row,idx)=>{ const tds=rows[idx]?.children; if(!tds) return; tds[2].textContent=row.winReturn; tds[3].textContent=row.netProfit; tds[4].textContent=row.ifLoseTotal; }); const rows2=q('secondLadderTable').querySelectorAll('tbody tr'); second.forEach((row,idx)=>{ const tds=rows2[idx]?.children; if(!tds) return; tds[2].textContent=row.winReturn; tds[3].textContent=row.netProfit; tds[4].textContent=row.ifLoseTotal; }); }
function importAnalyzerFile(e){ const file=e.target.files[0]; if(!file) return; file.text().then(text=>{ state.analyzerData={ rows: parseRowsFromText(text, file.name).map(r=>({ y:r.y==='-'?'-':Number(r.y), k:r.k==='-'?'-':Number(r.k) })) }; renderAll(); showToast('ANALYZER LOADED','Imported results recalculated with current ladder'); }); e.target.value=''; }

function setupControls(){
  q('prayogaBtn').addEventListener('click', startPrayoga);
  q('kumbhaBtn').addEventListener('click', clearCurrentSession);
  q('undoBtn').addEventListener('click', undoLast);
  q('historyUndoBtn').addEventListener('click', undoLast);
  q('setTargetDollar').addEventListener('input', ()=>recalcTargetLink('dollar'));
  q('setTargetPercent').addEventListener('input', ()=>recalcTargetLink('percent'));
  q('setBankroll').addEventListener('input', ()=>recalcTargetLink('dollar'));
  q('applyYantraBtn').addEventListener('click', ()=>{
    const s=state.settings;
    s.bankroll=Number(q('setBankroll').value)||30000;
    s.targetDollar=Number(q('setTargetDollar').value)||500;
    s.targetPercent=Number(q('setTargetPercent').value)||1.67;
    s.stopLoss=Number(q('setStopLoss').value)||50000;
    s.min=Number(q('setMin').value)||100;
    s.max=Number(q('setMax').value)||3000;
    s.coin=Number(q('setCoin').value)||100;
    s.targetNum=Number(q('setTargetNum').value)||500;
    s.doubleLadder=q('setDoubleLadder').value;
    s.keypadMode=q('setKeypadMode').value;
    s.maxSteps=Number(q('setMaxSteps').value)||30;
    s.reserve=Number(q('setReserve').value)||20000;
    s.capRule=q('setCapRule').value;
    state.ladder=buildLadder(s);
    state.secondLadder=buildSecondLadder(s, state.ladder);
    renderAll();
    showToast('YANTRA APPLIED','Previous and future rounds recalculated');
  });
  q('saveLadderBtn').addEventListener('click', saveEditableLadders);
  q('resetLadderBtn').addEventListener('click', resetEditableLadders);
  q('exportLadderBtn').addEventListener('click', exportLadderCsv);
  q('loadLadderBtn').addEventListener('click', ()=>q('loadLadderFile').click());
  q('loadLadderFile').addEventListener('change', importLadderCsv);
  document.addEventListener('input', e=>{ const el=e.target; if(el instanceof HTMLInputElement && el.matches('[data-ladder-index],[data-second-ladder-index]')) liveRefreshLadderPreview(); });
  document.addEventListener('keydown', e=>{ const el=e.target; if(!(el instanceof HTMLInputElement)) return; if(!el.matches('[data-ladder-index],[data-second-ladder-index]')) return; if(e.key==='Enter'){ e.preventDefault(); const isSecond=el.hasAttribute('data-second-ladder-index'); const current=Number(isSecond?el.dataset.secondLadderIndex:el.dataset.ladderIndex); const selector=isSecond?`[data-second-ladder-index="${current+1}"]`:`[data-ladder-index="${current+1}"]`; const next=document.querySelector(selector); if(next){ next.focus(); next.select(); } else el.blur(); } });
  document.addEventListener('focusin', e=>{ const el=e.target; if(el instanceof HTMLInputElement && el.matches('[data-ladder-index],[data-second-ladder-index]')) setTimeout(()=>el.select(),0); });
  q('exportCsvBtn').addEventListener('click', exportDrishtiCsv);
  q('exportPdfBtn').addEventListener('click', exportDrishtiPdf);
  q('loadCsvBtn').addEventListener('click', ()=>q('loadCsvFile').click());
  q('loadCsvFile').addEventListener('change', importDrishtiCsv);
  q('exportGranthBtn').addEventListener('click', exportGranthJson);
  q('exportHistoryCsvBtn').addEventListener('click', exportGranthCsv);
  q('importGranthBtn').addEventListener('click', ()=>q('importGranthFile').click());
  q('importGranthFile').addEventListener('change', importGranthFile);
  q('deleteGranthBtn').addEventListener('click', ()=>{ const id=Number(q('deleteKumbhSelect').value); if(!id){ showToast('SELECT KUMBH','Choose one Kumbh to delete','warn'); return; } state.granth=state.granth.filter(k=>k.id!==id).map((k,idx)=>({ ...k, id: idx+1 })); if(state.currentKumbhId===id) state.currentKumbhId=state.granth.at(-1)?.id || null; renderAll(); showToast('KUMBH DELETED','Selected Kumbh removed'); });
  q('confirmCancelBtn').addEventListener('click', ()=>closeClearKumbh(false));
  q('confirmOkBtn').addEventListener('click', ()=>closeClearKumbh(true));
  q('confirmOverlay').addEventListener('click', e=>{ if(e.target===q('confirmOverlay')) closeClearKumbh(false); });
  document.addEventListener('keydown', e=>{ if(q('confirmOverlay').classList.contains('hidden')) return; if(e.key==='Escape') closeClearKumbh(false); });
}
function setupInstall(){ window.addEventListener('beforeinstallprompt',e=>{ e.preventDefault(); deferredPrompt=e; q('installBtn').classList.remove('hidden'); }); q('installBtn').addEventListener('click', async()=>{ if(!deferredPrompt) return; deferredPrompt.prompt(); await deferredPrompt.userChoice; deferredPrompt=null; q('installBtn').classList.add('hidden'); }); }

if('serviceWorker' in navigator){ window.addEventListener('load',()=>navigator.serviceWorker.register('./service-worker.js').catch(()=>{})); }
setupTabs(); setupControls(); setupInstall(); renderAll();
