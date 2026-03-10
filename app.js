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
function statusCode(info){ if(!info) return '0'; if(info.status==='A') return `S${info.step}`; if(info.status==='B') return `2S${info.step}`; return info.status; }

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

function buildSecondLadder(settings, firstLadder){
  const rows = [];
  const capLossBase = Math.abs(firstLadder.at(-1)?.ifLoseTotal || 0);
  let previousSecondLoss = 0;
  let currentLevel = roundUpToCoin(settings.max / 4, settings.coin);
  for(let step=1; step<=15; step++){
    let bet = currentLevel;
    if(step === 6) currentLevel = Math.min(settings.max, roundUpToCoin(currentLevel * 2, settings.coin));
    if(step === 11) currentLevel = Math.min(settings.max, roundUpToCoin(currentLevel + roundUpToCoin(settings.max / 4, settings.coin), settings.coin));
    if(step > 15) currentLevel = settings.max;
    bet = Math.min(settings.max, roundUpToCoin(bet, settings.coin));
    const winReturn = bet * 9;
    const fullLossPath = capLossBase + previousSecondLoss + bet;
    rows.push({ step:`2S${step}`, bet, winReturn, netProfit: winReturn - fullLossPath, ifLoseTotal: -fullLossPath });
    previousSecondLoss += bet;
  }
  return rows;
}

function freshState(){
  const settings = { ...defaultSettings };
  const ladder = buildLadder(settings);
  return {
    settings,
    liveBankroll: settings.bankroll,
    currentChakra: 0,
    numbers: { Y: createSide(), K: createSide() },
    drishti: [],
    granth: [],
    currentKumbhId: null,
    summary: { totalAhuti: 0, maxExposure: 0 },
    ladder,
    secondLadder: buildSecondLadder(settings, ladder),
    activeTab: 'sangram',
    lastResult: '-'
  };
}

function reviveState(raw){
  const base = freshState();
  const settings = { ...base.settings, ...(raw.settings || {}) };
  if(!Number.isFinite(Number(settings.stopLoss)) || Number(settings.stopLoss) <= 0) settings.stopLoss = base.settings.stopLoss;
  const ladder = Array.isArray(raw.ladder) && raw.ladder.length ? raw.ladder : buildLadder(settings);
  const secondLadder = Array.isArray(raw.secondLadder) && raw.secondLadder.length ? raw.secondLadder : buildSecondLadder(settings, ladder);
  return {
    ...base,
    ...raw,
    settings,
    numbers: raw.numbers || base.numbers,
    summary: { ...base.summary, ...(raw.summary || {}) },
    ladder,
    secondLadder,
    activeTab: raw.activeTab || 'sangram',
    lastResult: raw.lastResult || '-'
  };
}
function loadState(){ try{ const raw = localStorage.getItem(STORAGE_KEY); return raw ? reviveState(JSON.parse(raw)) : freshState(); } catch { return freshState(); } }
let state = loadState();
function saveState(){ localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); }
function currentKumbh(){ return state.granth.find(k => k.id === state.currentKumbhId) || null; }
function ensureKumbh(){ if(currentKumbh()) return currentKumbh(); const id = (state.granth.at(-1)?.id || 0) + 1; const k={ id, rows:[] }; state.granth.push(k); state.currentKumbhId=id; return k; }

function currentBetFor(info){
  if(info.ladder===2) return state.secondLadder[Math.max(0,(info.step||1)-1)]?.bet || state.settings.max;
  return state.ladder[Math.max(0,(info.step||1)-1)]?.bet || state.settings.max;
}
function nextExposureTotal(){ let total=0; ['Y','K'].forEach(side=>{ for(let n=1;n<=9;n++){ const info=state.numbers[side][n]; if(info.status==='A' || info.status==='B') total += currentBetFor(info); }}); return total; }

function showToast(title,text,kind=''){
  const layer=q('toastLayer'); const el=document.createElement('div'); el.className=`toast ${kind}`; el.innerHTML=`<div class="title">${title}</div><div>${text}</div>`; layer.appendChild(el); setTimeout(()=>el.remove(),3600);
}
function glowKey(el){ if(!el) return; el.classList.remove('key-glow'); void el.offsetWidth; el.classList.add('key-glow'); setTimeout(()=>el.classList.remove('key-glow'),220); }

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
function openExportOverlay(){ q('exportOverlay').classList.remove('hidden'); q('exportOverlay').setAttribute('aria-hidden','false'); }
function closeExportOverlay(){ q('exportOverlay').classList.add('hidden'); q('exportOverlay').setAttribute('aria-hidden','true'); }

function renderBoards(){
  ['Y','K'].forEach(side=>{
    const host=q(side==='Y'?'boardY':'boardK'); host.innerHTML='';
    for(let i=1;i<=10;i++){
      const n=i===10?0:i; const info=n===0?null:state.numbers[side][n]; const code=n===0?'0':statusCode(info); const metaClass=info?.step?`step${Math.min(info.step,6)}`:'';
      const btn=document.createElement('button');
      btn.type='button'; btn.className=`tile ${n===0?'zero':''} ${info?'state-'+info.status:''}`.trim(); btn.dataset.side=side; btn.dataset.num=String(n);
      btn.innerHTML=`<div class="num">${n}</div><div class="meta ${metaClass}">${code}</div>`;
      btn.addEventListener('click',e=>handleTap(side,n,e.currentTarget));
      host.appendChild(btn);
    }
  });
}
function renderVyuha(){ ['Y','K'].forEach(side=>{ const host=q(side==='Y'?'vyuhaY':'vyuhaK'); host.innerHTML=''; for(let n=1;n<=9;n++){ const info=state.numbers[side][n]; const d=document.createElement('div'); d.className='state-cell'; d.innerHTML=`<div class="num">${n}</div><div class="meta">${statusCode(info)}</div>`; host.appendChild(d);} }); }
function formatNextAhuti(side){ const groups=new Map(); for(let n=1;n<=9;n++){ const info=state.numbers[side][n]; if(info.status==='A'||info.status==='B'){ const bet=currentBetFor(info); if(!groups.has(bet)) groups.set(bet,[]); groups.get(bet).push(`${n}(${info.ladder===2?'2S':'S'}${info.step})`); } } const parts=[...groups.entries()].sort((a,b)=>b[0]-a[0]).map(([bet,arr])=>`${bet} on ${arr.join(' ')}`); return `${side} ${parts.join(' | ') || '-'}`; }
function renderSangram(){ q('bankValue').textContent=fmtMoney(state.liveBankroll); q('chakraValue').textContent=`Round : ${state.currentChakra}`; q('nextY').textContent=formatNextAhuti('Y'); q('nextK').textContent=formatNextAhuti('K'); q('nextT').textContent=`T ${nextExposureTotal()}`; q('lastResultValue').textContent=state.lastResult || '-'; }
function renderGranth(){ const host=q('granthList'); host.innerHTML=''; const items=[...state.granth].reverse(); if(!items.length){ host.innerHTML='<div class="kumbh">No Kumbh history yet.</div>'; return;} items.forEach(k=>{ const wrap=document.createElement('div'); wrap.className='kumbh'; const rows=[...k.rows].reverse().map(r=>`<tr><td>${r.chakra}</td><td>${r.y ?? '-'}</td><td>${r.k ?? '-'}</td><td>${r.ahuti}</td><td>${r.axyapatra}</td></tr>`).join(''); wrap.innerHTML=`<div class="label">#${String(k.id).padStart(2,'0')} Kumbh</div><div class="table-wrap"><table><thead><tr><th>Chakra</th><th>Y</th><th>K</th><th>Āhuti</th><th>Axyapatra</th></tr></thead><tbody>${rows}</tbody></table></div>`; host.appendChild(wrap);}); }
function renderDrishti(){ q('sumChakras').textContent=Math.max(0,state.currentChakra); q('sumAhuti').textContent=state.summary.totalAhuti; q('sumProfit').textContent=state.liveBankroll-state.settings.bankroll; q('sumExposure').textContent=state.summary.maxExposure; const tbody=q('drishtiTable').querySelector('tbody'); tbody.innerHTML=''; [...state.drishti].reverse().forEach(r=>{ const tr=document.createElement('tr'); tr.innerHTML=`<td>${r.side}</td><td>${r.number}</td><td>${r.activationChakra}</td><td>${r.winChakra}</td><td>${r.steps}</td><td>${r.prevLoss}</td><td>${r.winBet}</td><td>${r.net}</td><td>${r.status}</td>`; tbody.appendChild(tr); }); }
function renderSopana(){
  const tbody=q('ladderTable').querySelector('tbody'); tbody.innerHTML='';
  state.ladder.forEach((row,idx)=>{ const tr=document.createElement('tr'); tr.innerHTML=`<td>${row.step}</td><td><input type="number" data-ladder-index="${idx}" inputmode="numeric" enterkeyhint="next" value="${row.bet}"></td><td>${row.winReturn}</td><td>${row.netProfit}</td><td>${row.ifLoseTotal}</td>`; tbody.appendChild(tr); });
  const secondBody=q('secondLadderTable').querySelector('tbody'); secondBody.innerHTML='';
  state.secondLadder.forEach((row,idx)=>{ const tr=document.createElement('tr'); tr.innerHTML=`<td>${row.step}</td><td><input type="number" data-second-ladder-index="${idx}" inputmode="numeric" enterkeyhint="next" value="${row.bet}"></td><td>${row.winReturn}</td><td>${row.netProfit}</td><td>${row.ifLoseTotal}</td>`; secondBody.appendChild(tr); });
}
function renderYantra(){ const s=state.settings; q('setBankroll').value=s.bankroll; q('setTargetDollar').value=s.targetDollar; q('setTargetPercent').value=s.targetPercent; q('setStopLoss').value=s.stopLoss; q('setMin').value=s.min; q('setMax').value=s.max; q('setCoin').value=s.coin; q('setTargetNum').value=s.targetNum; q('setDoubleLadder').value=s.doubleLadder||'off'; q('setKeypadMode').value=s.keypadMode; q('setMaxSteps').value=s.maxSteps; q('setReserve').value=s.reserve; q('setCapRule').value=s.capRule; }
function renderMedha(){ const active=[]; const cap=[]; ['Y','K'].forEach(side=>{ for(let n=1;n<=9;n++){ const info=state.numbers[side][n]; if(info.status==='A'||info.status==='B') active.push(`${side}${n} ${info.ladder===2?'2S':'S'}${info.step}`); if(info.status==='C') cap.push(`${side}${n}`);} }); q('medhaPanel').innerHTML=`<div class="medha-item"><div class="label">Active Formation</div><div>${active.join(' | ') || 'None'}</div></div><div class="medha-item"><div class="label">CAP Numbers</div><div>${cap.join(' | ') || 'None'}</div></div>`; }
function renderActiveTab(){ document.querySelectorAll('.screen').forEach(s=>s.classList.toggle('active',s.id===`screen-${state.activeTab}`)); document.querySelectorAll('.nav').forEach(b=>b.classList.toggle('active',b.dataset.target===state.activeTab)); q('screenTitle').textContent=titles[state.activeTab]||titles.sangram; }
function renderAll(){ renderActiveTab(); renderBoards(); renderVyuha(); renderSangram(); renderGranth(); renderDrishti(); renderSopana(); renderYantra(); renderMedha(); saveState(); }

function startPrayoga(){ if(state.currentChakra!==0 || currentKumbh()?.rows?.length){ state.currentKumbhId=null; } const kumbh=ensureKumbh(); state.activeTab='sangram'; renderAll(); showToast('SANGRAM AARAMBHA', `#${String(kumbh.id).padStart(2,'0')} Kumbh ready`); }
async function clearCurrentSession(){ if(!(await askClearKumbh())) return; state.liveBankroll=state.settings.bankroll; state.currentChakra=0; state.numbers={Y:createSide(),K:createSide()}; state.drishti=[]; state.summary={totalAhuti:0,maxExposure:0}; state.lastResult='-'; pending={Y:null,K:null}; state.currentKumbhId=null; const kumbh=ensureKumbh(); state.activeTab='sangram'; renderAll(); showToast('KUMBHA SHUDDHI',`#${String(kumbh.id).padStart(2,'0')} Kumbh ready`); }
function recordSnapshot(){ historyStack.push(JSON.stringify(state)); if(historyStack.length>50) historyStack.shift(); }
function undoLast(options={}){ const prev=historyStack.pop(); if(!prev) return; const preserveTab = options.preserveTab ? state.activeTab : null; state=reviveState(JSON.parse(prev)); if(preserveTab) state.activeTab = preserveTab; pending={Y:null,K:null}; renderAll(); showToast('CHAKRA PUNARAVRITTI','Last chakra reverted'); }

function pushDrishti(rec){ state.drishti.push(rec); }
function resolveNumber(side,num,notes){
  const info=state.numbers[side][num];
  if(info.status==='L') return;
  if(info.status==='C'){ info.status='B'; info.ladder=2; info.step=1; info.pendingSecond=false; notes.push({title:'CAP RETURNED',text:`${side}${num} back on track`,kind:'warn'}); return; }
  if(info.status==='I'){ info.status='A'; info.step=1; info.ladder=1; info.activeAt=state.currentChakra; info.prevLoss=0; return; }
  const bet=currentBetFor(info); const totalReturn=bet*9; const net=(bet*8)-info.prevLoss;
  state.liveBankroll += totalReturn;
  info.winningBet=bet; info.lastNet=net;
  pushDrishti({ side, number:num, activationChakra:info.activeAt ?? state.currentChakra, winChakra:state.currentChakra, steps:info.step, prevLoss:info.prevLoss, winBet:bet, net, status: info.ladder===2 ? 'WIN-2' : 'WIN' });
  info.status='L';
  notes.push({title:'VIJAY DARSHANA', text:`${side}${num} ${info.ladder===2?'2S':'S'}${info.step} Āhuti ${bet} Net +${net}`});
}
function advanceAfterLoss(side,notes){
  for(let n=1;n<=9;n++){
    const info=state.numbers[side][n];
    if(info.status!=='A' && info.status!=='B') continue;
    const bet=currentBetFor(info);
    info.prevLoss += bet;
    info.step += 1;
    if(info.ladder===1){
      const prevBet = state.ladder[Math.max(0,info.step-2)]?.bet || state.settings.max;
      const nextBet = state.ladder[Math.max(0,info.step-1)]?.bet || state.settings.max;
      if((nextBet>=state.settings.max && prevBet>=state.settings.max && state.settings.capRule==='on') || info.step>state.settings.maxSteps){
        info.status='C';
        pushDrishti({ side, number:n, activationChakra:info.activeAt ?? '-', winChakra:'-', steps:Math.min(info.step-1, state.settings.maxSteps), prevLoss:info.prevLoss, winBet:'-', net:-info.prevLoss, status:'CAP' });
        notes.push({title:'REKHA BANDHA', text:`${side}${n} reached CAP`, kind:'warn'});
      } else {
        info.status='A';
      }
    } else {
      if(info.step>state.secondLadder.length) info.step=state.secondLadder.length;
      info.status='B';
    }
  }
}

function processCombined(){
  if(pending.Y===null || pending.K===null) return;
  recordSnapshot();
  state.currentChakra += 1;
  ensureKumbh();
  const y=pending.Y, k=pending.K;
  pending={Y:null,K:null};
  const exposure=nextExposureTotal();
  state.liveBankroll -= exposure;
  state.summary.totalAhuti += exposure;
  state.summary.maxExposure = Math.max(state.summary.maxExposure, exposure);
  const notes=[];
  if(y===0) advanceAfterLoss('Y',notes); else { advanceAfterLoss('Y',[]); resolveNumber('Y',y,notes); }
  if(k===0) advanceAfterLoss('K',notes); else { advanceAfterLoss('K',[]); resolveNumber('K',k,notes); }
  state.lastResult = `Round ${state.currentChakra}: Y ${y} | K ${k}`;
  currentKumbh()?.rows.push({ chakra:state.currentChakra, y, k, ahuti:exposure, axyapatra:state.liveBankroll });
  if(state.liveBankroll <= state.settings.bankroll - state.settings.stopLoss) notes.push({title:'TREASURY WARNING',text:'Axyapatra approaching Raksha Rekha',kind:'warn'});
  if(state.liveBankroll < state.settings.reserve) notes.push({title:'TREASURY WARNING',text:'Axyapatra below Raksha Nidhi',kind:'warn'});
  renderAll();
  notes.forEach(n=>showToast(n.title,n.text,n.kind||''));
}
function processIndividual(side,num){
  recordSnapshot();
  state.currentChakra += 1;
  ensureKumbh();
  let exposure=0;
  for(let n=1;n<=9;n++){ const info=state.numbers[side][n]; if(info.status==='A'||info.status==='B') exposure += currentBetFor(info); }
  state.liveBankroll -= exposure;
  state.summary.totalAhuti += exposure;
  state.summary.maxExposure = Math.max(state.summary.maxExposure, exposure);
  const notes=[];
  if(num===0) advanceAfterLoss(side,notes); else { advanceAfterLoss(side,[]); resolveNumber(side,num,notes); }
  state.lastResult = `Round ${state.currentChakra}: ${side} ${num}`;
  currentKumbh()?.rows.push({ chakra:state.currentChakra, y: side==='Y'?num:'-', k: side==='K'?num:'-', ahuti:exposure, axyapatra:state.liveBankroll });
  renderAll();
  notes.forEach(n=>showToast(n.title,n.text,n.kind||''));
}
function handleTap(side,num,el){ glowKey(el); if(state.settings.keypadMode==='combined'){ pending[side]=num; renderSangram(); if(pending.Y!==null && pending.K!==null) processCombined(); } else { processIndividual(side,num); } }

function switchTab(target){ state.activeTab=target; renderActiveTab(); saveState(); }
function setupTabs(){ document.querySelectorAll('.nav').forEach(btn=>btn.addEventListener('click',()=>switchTab(btn.dataset.target))); }
function recalcTargetLink(source){ const bankroll=Number(q('setBankroll').value)||defaultSettings.bankroll; if(source==='dollar') q('setTargetPercent').value=((Number(q('setTargetDollar').value||0)/bankroll)*100).toFixed(2); if(source==='percent') q('setTargetDollar').value=Math.round((bankroll*Number(q('setTargetPercent').value||0))/100); }

function csvEscape(value){ const text=String(value ?? ''); return /[",\n]/.test(text) ? `"${text.replace(/"/g,'""')}"` : text; }
function granthCsvContent(){ const header=['Kumbh','Chakra','Y','K','Ahuti','Axyapatra']; const rows=[header.join(',')]; state.granth.forEach(k=>k.rows.forEach(r=>rows.push([`#${String(k.id).padStart(2,'0')}`,r.chakra,r.y ?? '-',r.k ?? '-',r.ahuti,r.axyapatra].map(csvEscape).join(',')))); return rows.join('\n'); }
function drishtiCsvContent(){ const header=['Side','Number','ActivationChakra','WinChakra','StepsToWin','PreviousLoss','WinningBet','NetProfitLoss','Status']; const rows=[header.join(',')]; state.drishti.forEach(r=>rows.push([r.side,r.number,r.activationChakra,r.winChakra,r.steps,r.prevLoss,r.winBet,r.net,r.status].map(csvEscape).join(','))); return rows.join('\n'); }

async function saveBlob(blob, suggestedName, types){
  if(window.showSaveFilePicker){
    try {
      const handle = await window.showSaveFilePicker({ suggestedName, types });
      const writable = await handle.createWritable();
      await writable.write(blob);
      await writable.close();
      return true;
    } catch(err){ if(err && err.name === 'AbortError') return false; }
  }
  const url=URL.createObjectURL(blob); const a=document.createElement('a'); a.href=url; a.download=suggestedName; a.click(); setTimeout(()=>URL.revokeObjectURL(url),500);
  return true;
}
async function exportDrishtiCsv(){ const ok = await saveBlob(new Blob([drishtiCsvContent()],{type:'text/csv'}),'drishti.csv',[{description:'CSV file',accept:{'text/csv':['.csv']}}]); if(ok) showToast('DRISHTI EXPORTED','CSV saved'); }
function importDrishtiCsv(e){ const file=e.target.files[0]; if(!file) return; file.text().then(text=>{ const lines=text.trim().split(/\r?\n/).slice(1).filter(Boolean); state.drishti=lines.map(line=>{ const cells=parseCsvLine(line); const [side,number,activationChakra,winChakra,steps,prevLoss,winBet,net,status]=cells; return {side,number,activationChakra,winChakra,steps,prevLoss,winBet,net,status}; }); renderAll(); showToast('DRISHTI LOADED','CSV imported'); }); e.target.value=''; }
async function exportGranthJson(){ const ok = await saveBlob(new Blob([JSON.stringify(state.granth,null,2)],{type:'application/json'}),'granth.json',[{description:'JSON file',accept:{'application/json':['.json']}}]); if(ok) showToast('GRANTH EXPORTED','JSON saved'); }
async function exportGranthCsv(){ const ok = await saveBlob(new Blob([granthCsvContent()],{type:'text/csv'}),'granth.csv',[{description:'CSV file',accept:{'text/csv':['.csv']}}]); if(ok) showToast('GRANTH EXPORTED','CSV saved'); }
function importGranthJson(e){ const file=e.target.files[0]; if(!file) return; file.text().then(text=>{ if(file.name.toLowerCase().endsWith('.csv')) importGranthCsvText(text); else { state.granth=JSON.parse(text); state.currentKumbhId=state.granth.at(-1)?.id||null; } renderAll(); showToast('GRANTH LOADED','History imported'); }); e.target.value=''; }
function importGranthCsvText(text){ const groups=new Map(); text.trim().split(/\r?\n/).slice(1).filter(Boolean).forEach(line=>{ const [kumbhLabel,chakra,y,k,ahuti,axyapatra]=parseCsvLine(line); const id=Number(String(kumbhLabel).replace(/\D/g,''))||1; if(!groups.has(id)) groups.set(id,{id,rows:[]}); groups.get(id).rows.push({chakra:Number(chakra), y: y==='-'?'-':Number(y), k: k==='-'?'-':Number(k), ahuti:Number(ahuti), axyapatra:Number(axyapatra)}); }); state.granth=[...groups.values()].sort((a,b)=>a.id-b.id); state.currentKumbhId=state.granth.at(-1)?.id||null; }
function parseCsvLine(line){ const out=[]; let cur=''; let quoted=false; for(let i=0;i<line.length;i++){ const ch=line[i]; if(ch==='"'){ if(quoted && line[i+1]==='"'){ cur+='"'; i++; } else quoted=!quoted; } else if(ch===',' && !quoted){ out.push(cur); cur=''; } else cur+=ch; } out.push(cur); return out; }

function pdfEscape(text){ return String(text).replace(/\\/g,'\\\\').replace(/\(/g,'\\(').replace(/\)/g,'\\)').replace(/[\u0000-\u001F]/g,' '); }
function buildPdfFromLines(lines){
  const pageWidth = 595, pageHeight = 842, startY = 800, lineHeight = 16, leftX = 40;
  const linesPerPage = 46;
  const pages = [];
  for(let i=0;i<lines.length;i+=linesPerPage) pages.push(lines.slice(i, i+linesPerPage));
  let objects = [];
  const addObject = str => { objects.push(str); return objects.length; };
  const fontId = addObject('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
  const pageIds = [];
  const contentIds = [];
  pages.forEach(pageLines=>{
    const textParts = ['BT', '/F1 11 Tf', `${leftX} ${startY} Td`];
    pageLines.forEach((line, idx)=>{ if(idx>0) textParts.push(`0 -${lineHeight} Td`); textParts.push(`(${pdfEscape(line)}) Tj`); });
    textParts.push('ET');
    const stream = textParts.join('\n');
    const contentId = addObject(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
    contentIds.push(contentId);
    pageIds.push(null);
  });
  const pagesId = addObject('');
  pages.forEach((_,i)=>{ const pageId = addObject(`<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 ${pageWidth} ${pageHeight}] /Resources << /Font << /F1 ${fontId} 0 R >> >> /Contents ${contentIds[i]} 0 R >>`); pageIds[i]=pageId; });
  objects[pagesId-1] = `<< /Type /Pages /Count ${pageIds.length} /Kids [${pageIds.map(id=>`${id} 0 R`).join(' ')}] >>`;
  const catalogId = addObject(`<< /Type /Catalog /Pages ${pagesId} 0 R >>`);
  let pdf='%PDF-1.4\n';
  const offsets=[0];
  objects.forEach((obj,idx)=>{ offsets.push(pdf.length); pdf += `${idx+1} 0 obj\n${obj}\nendobj\n`; });
  const xrefPos = pdf.length;
  pdf += `xref\n0 ${objects.length+1}\n0000000000 65535 f \n`;
  offsets.slice(1).forEach(off=>{ pdf += `${String(off).padStart(10,'0')} 00000 n \n`; });
  pdf += `trailer\n<< /Size ${objects.length+1} /Root ${catalogId} 0 R >>\nstartxref\n${xrefPos}\n%%EOF`;
  return new Blob([pdf],{type:'application/pdf'});
}
async function exportDrishtiPdf(){
  const lines = [
    'KUBERA WARHUNT V4 - DRISHTI REPORT',
    `Generated: ${new Date().toLocaleString()}`,
    `Chakras Played: ${state.currentChakra}`,
    `Total Ahuti: ${state.summary.totalAhuti}`,
    `Net Profit: ${state.liveBankroll - state.settings.bankroll}`,
    `Max Exposure: ${state.summary.maxExposure}`,
    ' ',
    'Side | No | Act | Win | Steps | Prev Loss | Win Bet | Net P/L | Status'
  ];
  state.drishti.forEach(r=>lines.push(`${r.side} | ${r.number} | ${r.activationChakra} | ${r.winChakra} | ${r.steps} | ${r.prevLoss} | ${r.winBet} | ${r.net} | ${r.status}`));
  const ok = await saveBlob(buildPdfFromLines(lines),'drishti-report.pdf',[{description:'PDF file',accept:{'application/pdf':['.pdf']}}]);
  if(ok) showToast('DRISHTI EXPORTED','Adobe-compatible PDF saved');
}

function saveEditableLadders(){
  let cumulative=0;
  document.querySelectorAll('[data-ladder-index]').forEach(inp=>{ const i=Number(inp.dataset.ladderIndex); const bet=Math.max(state.settings.coin, Number(inp.value)||0); inp.value=bet; cumulative += bet; state.ladder[i]={ step:`S${i+1}`, bet, winReturn:bet*9, netProfit:(bet*9)-cumulative, ifLoseTotal:-cumulative }; });
  const capLossBase=Math.abs(state.ladder.at(-1)?.ifLoseTotal || 0);
  let secondLoss=0;
  document.querySelectorAll('[data-second-ladder-index]').forEach(inp=>{ const i=Number(inp.dataset.secondLadderIndex); const bet=Math.max(state.settings.coin, Number(inp.value)||0); inp.value=bet; secondLoss += bet; state.secondLadder[i]={ step:`2S${i+1}`, bet, winReturn:bet*9, netProfit:(bet*9)-(capLossBase+secondLoss), ifLoseTotal:-(capLossBase+secondLoss) }; });
  renderAll(); showToast('SOPANA SAVED','1st and 2nd ladders updated');
}
function resetEditableLadders(){ state.ladder=buildLadder(state.settings); state.secondLadder=buildSecondLadder(state.settings, state.ladder); renderAll(); showToast('SOPANA RESET','Default ladders restored'); }

function setupInstall(){ window.addEventListener('beforeinstallprompt',e=>{ e.preventDefault(); deferredPrompt=e; q('installBtn').classList.remove('hidden'); }); q('installBtn').addEventListener('click', async()=>{ if(!deferredPrompt) return; deferredPrompt.prompt(); await deferredPrompt.userChoice; deferredPrompt=null; q('installBtn').classList.add('hidden'); }); }
function setupControls(){
  q('prayogaBtn').addEventListener('click', startPrayoga);
  q('kumbhaBtn').addEventListener('click', clearCurrentSession);
  q('undoBtn').addEventListener('click', ()=>undoLast());
  q('historyUndoBtn').addEventListener('click', ()=>undoLast({ preserveTab:true }));
  q('setTargetDollar').addEventListener('input', ()=>recalcTargetLink('dollar'));
  q('setTargetPercent').addEventListener('input', ()=>recalcTargetLink('percent'));
  q('setBankroll').addEventListener('input', ()=>recalcTargetLink('dollar'));
  q('applyYantraBtn').addEventListener('click', ()=>{
    const s=state.settings;
    s.bankroll=Number(q('setBankroll').value)||30000; s.targetDollar=Number(q('setTargetDollar').value)||500; s.targetPercent=Number(q('setTargetPercent').value)||1.67; s.stopLoss=Number(q('setStopLoss').value)||50000; s.min=Number(q('setMin').value)||100; s.max=Number(q('setMax').value)||3000; s.coin=Number(q('setCoin').value)||100; s.targetNum=Number(q('setTargetNum').value)||500; s.doubleLadder=q('setDoubleLadder').value; s.keypadMode=q('setKeypadMode').value; s.maxSteps=Number(q('setMaxSteps').value)||30; s.reserve=Number(q('setReserve').value)||20000; s.capRule=q('setCapRule').value;
    state.ladder=buildLadder(s);
    state.secondLadder=buildSecondLadder(s, state.ladder);
    renderAll();
    showToast('YANTRA APPLIED','Settings saved');
  });
  q('saveLadderBtn').addEventListener('click', saveEditableLadders);
  q('resetLadderBtn').addEventListener('click', resetEditableLadders);
  document.addEventListener('keydown', e=>{
    const el=e.target; if(!(el instanceof HTMLInputElement)) return;
    if(!el.matches('[data-ladder-index],[data-second-ladder-index]')) return;
    if(e.key==='Enter'){ e.preventDefault(); const isSecond=el.hasAttribute('data-second-ladder-index'); const current=Number(isSecond?el.dataset.secondLadderIndex:el.dataset.ladderIndex); const selector=isSecond?`[data-second-ladder-index="${current+1}"]`:`[data-ladder-index="${current+1}"]`; const next=document.querySelector(selector); if(next){ next.focus(); next.select(); } else { el.blur(); } }
  });
  document.addEventListener('focusin', e=>{ const el=e.target; if(el instanceof HTMLInputElement && el.matches('[data-ladder-index],[data-second-ladder-index]')) setTimeout(()=>el.select(),0); });
  q('exportCsvBtn').addEventListener('click', exportDrishtiCsv);
  q('exportPdfBtn').addEventListener('click', exportDrishtiPdf);
  q('loadCsvBtn').addEventListener('click', ()=>q('loadCsvFile').click());
  q('loadCsvFile').addEventListener('change', importDrishtiCsv);
  q('exportGranthBtn').addEventListener('click', openExportOverlay);
  q('exportJsonBtn').addEventListener('click', async()=>{ closeExportOverlay(); await exportGranthJson(); });
  q('exportHistoryCsvBtn').addEventListener('click', async()=>{ closeExportOverlay(); await exportGranthCsv(); });
  q('exportCloseBtn').addEventListener('click', closeExportOverlay);
  q('importGranthBtn').addEventListener('click', ()=>q('importGranthFile').click());
  q('importGranthFile').addEventListener('change', importGranthJson);
  q('deleteGranthBtn').addEventListener('click', ()=>{ state.granth=[]; state.currentKumbhId=null; renderAll(); showToast('GRANTH PURGED','All Kumbh history removed'); });
  q('confirmCancelBtn').addEventListener('click', ()=>closeClearKumbh(false));
  q('confirmOkBtn').addEventListener('click', ()=>closeClearKumbh(true));
  q('confirmOverlay').addEventListener('click', e=>{ if(e.target===q('confirmOverlay')) closeClearKumbh(false); });
  q('exportOverlay').addEventListener('click', e=>{ if(e.target===q('exportOverlay')) closeExportOverlay(); });
  document.addEventListener('keydown', e=>{ if(!q('confirmOverlay').classList.contains('hidden') && e.key==='Escape') closeClearKumbh(false); if(!q('exportOverlay').classList.contains('hidden') && e.key==='Escape') closeExportOverlay(); });
}

if('serviceWorker' in navigator){ window.addEventListener('load',()=>navigator.serviceWorker.register('./service-worker.js').catch(()=>{})); }
setupTabs(); setupControls(); setupInstall(); renderAll();
