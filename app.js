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

const q = id => document.getElementById(id);
let clearConfirmResolver = null;
const fmtMoney = n => '₹ ' + Number(n || 0).toLocaleString('en-IN');
const clone = obj => JSON.parse(JSON.stringify(obj));

function freshNumber(){ return { status:'I', step:0, ladder:1, activeAt:null, prevLoss:0, winningBet:0, lastNet:0, pendingSecond:false }; }

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
  if(clearConfirmResolver){
    const resolve = clearConfirmResolver;
    clearConfirmResolver = null;
    resolve(answer);
  }
}
function createSide(){ const s={}; for(let i=1;i<=9;i++) s[i]=freshNumber(); return s; }
function roundUpToCoin(value, coin){ return Math.max(coin, Math.ceil(value / coin) * coin); }

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
function reviveState(raw){ const base = freshState(); const settings={...base.settings,...(raw.settings||{})}; if(!Number.isFinite(Number(settings.stopLoss)) || Number(settings.stopLoss)<=0) settings.stopLoss = base.settings.stopLoss; return {...base,...raw,settings,numbers:raw.numbers||base.numbers,summary:{...base.summary,...(raw.summary||{})},ladder:Array.isArray(raw.ladder)&&raw.ladder.length?raw.ladder:buildLadder(settings),activeTab:raw.activeTab||'sangram'}; }
function loadState(){ try{ const raw = localStorage.getItem(STORAGE_KEY); return raw ? reviveState(JSON.parse(raw)) : freshState(); }catch{ return freshState(); } }
let state = loadState();
function saveState(){ localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); }
function currentKumbh(){ return state.granth.find(k => k.id === state.currentKumbhId) || null; }
function ensureKumbh(){ if(currentKumbh()) return currentKumbh(); const id=(state.granth.at(-1)?.id||0)+1; const k={id,rows:[]}; state.granth.push(k); state.currentKumbhId=id; return k; }
function secondLadderBet(step){ const start=roundUpToCoin(state.settings.max/4,state.settings.coin); if(step<=5) return start; if(step<=10) return Math.min(state.settings.max,start*2); if(step<=15) return Math.min(state.settings.max,start*3); return state.settings.max; }
function currentBetFor(info){ return info.ladder===2 ? secondLadderBet(info.step||1) : (state.ladder[Math.max(0,(info.step||1)-1)]?.bet || state.settings.max); }
function nextExposureTotal(){ let total=0; ['Y','K'].forEach(side=>{ for(let n=1;n<=9;n++){ const info=state.numbers[side][n]; if(info.status==='A' || info.status==='B') total += currentBetFor(info); }}); return total; }

function showToast(title,text,kind=''){
  const layer=q('toastLayer'); const el=document.createElement('div'); el.className=`toast ${kind}`; el.innerHTML=`<div class="title">${title}</div><div>${text}</div>`; layer.appendChild(el); setTimeout(()=>el.remove(),3600);
}
function glowKey(el){ if(!el) return; el.classList.remove('key-glow'); void el.offsetWidth; el.classList.add('key-glow'); setTimeout(()=>el.classList.remove('key-glow'),220); }
function statusCode(info){ if(!info) return '0'; if(info.status==='A') return `S${info.step}`; if(info.status==='B') return 'B'; return info.status; }

function renderBoards(){
  ['Y','K'].forEach(side=>{
    const host=q(side==='Y'?'boardY':'boardK'); host.innerHTML='';
    for(let i=1;i<=10;i++){
      const n=i===10?0:i; const info=n===0?null:state.numbers[side][n];
      const btn=document.createElement('button'); const code=n===0?'0':statusCode(info); const metaClass=info?.step?`step${Math.min(info.step,6)}`:'';
      btn.type='button'; btn.className=`tile ${n===0?'zero':''} ${info?'state-'+info.status:''}`.trim(); btn.dataset.side=side; btn.dataset.num=String(n);
      btn.innerHTML=`<div class="num">${n}</div><div class="meta ${metaClass}">${code}</div>`;
      btn.addEventListener('click',e=>handleTap(side,n,e.currentTarget)); host.appendChild(btn);
    }
  });
}
function renderVyuha(){ ['Y','K'].forEach(side=>{ const host=q(side==='Y'?'vyuhaY':'vyuhaK'); host.innerHTML=''; for(let n=1;n<=9;n++){ const info=state.numbers[side][n]; const d=document.createElement('div'); d.className='state-cell'; d.innerHTML=`<div class="num">${n}</div><div class="meta">${statusCode(info)}</div>`; host.appendChild(d);} }); }
function formatNextAhuti(side){ const groups=new Map(); for(let n=1;n<=9;n++){ const info=state.numbers[side][n]; if(info.status==='A'||info.status==='B'){ const bet=currentBetFor(info); if(!groups.has(bet)) groups.set(bet,[]); groups.get(bet).push(`${n}(${info.ladder===2?'2S':'S'}${info.step})`); } } const parts=[...groups.entries()].sort((a,b)=>b[0]-a[0]).map(([bet,arr])=>`${bet} on ${arr.join(' ')}`); return `${side} ${parts.join(' | ') || '-'}`; }
function renderSangram(){ q('bankValue').textContent=fmtMoney(state.liveBankroll); q('chakraValue').textContent=`Round : ${state.currentChakra}`; q('nextY').textContent=formatNextAhuti('Y'); q('nextK').textContent=formatNextAhuti('K'); q('nextT').textContent=`T ${nextExposureTotal()}`; }
function renderGranth(){ const host=q('granthList'); host.innerHTML=''; const items=[...state.granth].reverse(); if(!items.length){ host.innerHTML='<div class="kumbh">No Kumbh history yet.</div>'; return;} items.forEach(k=>{ const wrap=document.createElement('div'); wrap.className='kumbh'; const rows=[...k.rows].reverse().map(r=>`<tr><td>${r.chakra}</td><td>${r.y ?? '-'}</td><td>${r.k ?? '-'}</td><td>${r.ahuti}</td><td>${r.axyapatra}</td></tr>`).join(''); wrap.innerHTML=`<div class="label">#${String(k.id).padStart(2,'0')} Kumbh</div><div class="table-wrap"><table><thead><tr><th>Chakra</th><th>Y</th><th>K</th><th>Āhuti</th><th>Axyapatra</th></tr></thead><tbody>${rows}</tbody></table></div>`; host.appendChild(wrap);}); }
function renderDrishti(){ q('sumChakras').textContent=Math.max(0,state.currentChakra); q('sumAhuti').textContent=state.summary.totalAhuti; q('sumProfit').textContent=state.liveBankroll-state.settings.bankroll; q('sumExposure').textContent=state.summary.maxExposure; const tbody=q('drishtiTable').querySelector('tbody'); tbody.innerHTML=''; [...state.drishti].reverse().forEach(r=>{ const tr=document.createElement('tr'); tr.innerHTML=`<td>${r.side}</td><td>${r.number}</td><td>${r.activationChakra}</td><td>${r.winChakra}</td><td>${r.steps}</td><td>${r.prevLoss}</td><td>${r.winBet}</td><td>${r.net}</td><td>${r.status}</td>`; tbody.appendChild(tr); }); }
function renderSopana(){ const tbody=q('ladderTable').querySelector('tbody'); tbody.innerHTML=''; state.ladder.forEach((row,idx)=>{ const tr=document.createElement('tr'); tr.innerHTML=`<td>${row.step}</td><td><input type="number" data-ladder-index="${idx}" inputmode="numeric" enterkeyhint="next" value="${row.bet}"></td><td>${row.winReturn}</td><td>${row.netProfit}</td><td>${row.ifLoseTotal}</td>`; tbody.appendChild(tr); }); }
function renderYantra(){ const s=state.settings; q('setBankroll').value=s.bankroll; q('setTargetDollar').value=s.targetDollar; q('setTargetPercent').value=s.targetPercent; q('setStopLoss').value=s.stopLoss; q('setMin').value=s.min; q('setMax').value=s.max; q('setCoin').value=s.coin; q('setTargetNum').value=s.targetNum; q('setDoubleLadder').value=s.doubleLadder||'off'; q('setKeypadMode').value=s.keypadMode; q('setMaxSteps').value=s.maxSteps; q('setReserve').value=s.reserve; q('setCapRule').value=s.capRule; }
function renderMedha(){ const active=[]; const cap=[]; ['Y','K'].forEach(side=>{ for(let n=1;n<=9;n++){ const info=state.numbers[side][n]; if(info.status==='A'||info.status==='B') active.push(`${side}${n} ${info.ladder===2?'2S':'S'}${info.step}`); if(info.status==='C') cap.push(`${side}${n}`);} }); q('medhaPanel').innerHTML=`<div class="medha-item"><div class="label">Active Formation</div><div>${active.join(' | ') || 'None'}</div></div><div class="medha-item"><div class="label">CAP Numbers</div><div>${cap.join(' | ') || 'None'}</div></div>`; }
function renderActiveTab(){ document.querySelectorAll('.screen').forEach(s=>s.classList.toggle('active',s.id===`screen-${state.activeTab}`)); document.querySelectorAll('.nav').forEach(b=>b.classList.toggle('active',b.dataset.target===state.activeTab)); q('screenTitle').textContent=titles[state.activeTab]||titles.sangram; }
function renderAll(){ renderActiveTab(); renderBoards(); renderVyuha(); renderSangram(); renderGranth(); renderDrishti(); renderSopana(); renderYantra(); renderMedha(); saveState(); }

function startPrayoga(){ if(state.currentChakra!==0 || currentKumbh()?.rows?.length){ state.currentKumbhId=null; } const kumbh=ensureKumbh(); state.activeTab='sangram'; renderAll(); showToast('SANGRAM AARAMBHA', `#${String(kumbh.id).padStart(2,'0')} Kumbh ready`); }
async function clearCurrentSession(){ if(!(await askClearKumbh())) return; state.liveBankroll=state.settings.bankroll; state.currentChakra=0; state.numbers={Y:createSide(),K:createSide()}; state.drishti=[]; state.summary={totalAhuti:0,maxExposure:0}; pending={Y:null,K:null}; state.currentKumbhId=null; const kumbh=ensureKumbh(); state.activeTab='sangram'; renderAll(); showToast('KUMBHA SHUDDHI',`#${String(kumbh.id).padStart(2,'0')} Kumbh ready`); }
function recordSnapshot(){ historyStack.push(JSON.stringify(state)); if(historyStack.length>20) historyStack.shift(); }
function undoLast(){ const prev=historyStack.pop(); if(!prev) return; state=reviveState(JSON.parse(prev)); renderAll(); showToast('CHAKRA PUNARAVRITTI','Last chakra reverted'); }

function pushDrishti(rec){ state.drishti.push(rec); }
function resolveNumber(side,num,notes){ const info=state.numbers[side][num]; if(info.status==='L'){ return; }
  if(info.status==='C'){ info.status='B'; info.ladder=2; info.step=1; info.pendingSecond=false; notes.push({title:'CAP RETURNED',text:`${side}${num} back on track`,kind:'warn'}); return; }
  if(info.status==='I'){ info.status='A'; info.step=1; info.ladder=1; info.activeAt=state.currentChakra; info.prevLoss=0; return; }
  const bet=currentBetFor(info); const totalReturn=bet*9; const net=(bet*8)-info.prevLoss;
  state.liveBankroll += totalReturn;
  info.winningBet=bet; info.lastNet=net; pushDrishti({ side, number:num, activationChakra:info.activeAt ?? state.currentChakra, winChakra:state.currentChakra, steps:info.step, prevLoss:info.prevLoss, winBet:bet, net, status:'WIN' });
  info.status='L'; notes.push({title:'VIJAY DARSHANA', text:`${side}${num} ${info.ladder===2?'2S':'S'}${info.step} Āhuti ${bet} Net +${net}`}); }
function advanceAfterLoss(side,notes){ for(let n=1;n<=9;n++){ const info=state.numbers[side][n]; if(info.status!=='A' && info.status!=='B') continue; const bet=currentBetFor(info); info.prevLoss += bet; info.step += 1; if(info.ladder===1){ const nextBet=state.ladder[Math.max(0,info.step-1)]?.bet || state.settings.max; if(nextBet>=state.settings.max && currentBetFor({ladder:1,step:info.step-1})>=state.settings.max && state.settings.capRule==='on'){ info.status='C'; pushDrishti({ side, number:n, activationChakra:info.activeAt ?? '-', winChakra:'-', steps:info.step-1, prevLoss:info.prevLoss, winBet:'-', net:-info.prevLoss, status:'CAP' }); notes.push({title:'REKHA BANDHA', text:`${side}${n} reached CAP`, kind:'warn'}); } else if(info.step>state.settings.maxSteps){ info.status='C'; pushDrishti({ side, number:n, activationChakra:info.activeAt ?? '-', winChakra:'-', steps:state.settings.maxSteps, prevLoss:info.prevLoss, winBet:'-', net:-info.prevLoss, status:'CAP' }); notes.push({title:'REKHA BANDHA', text:`${side}${n} reached CAP`, kind:'warn'}); }
      else info.status='A';
    } else { if(info.step>15) info.step=15; info.status='B'; }
  } }
function processCombined(){ if(pending.Y===null || pending.K===null) return; recordSnapshot(); state.currentChakra += 1; ensureKumbh(); const y=pending.Y, k=pending.K; pending={Y:null,K:null}; let exposure=nextExposureTotal(); state.liveBankroll -= exposure; state.summary.totalAhuti += exposure; state.summary.maxExposure = Math.max(state.summary.maxExposure, exposure); const notes=[]; if(y===0) advanceAfterLoss('Y',notes); else { advanceAfterLoss('Y',[]); resolveNumber('Y',y,notes); } if(k===0) advanceAfterLoss('K',notes); else { advanceAfterLoss('K',[]); resolveNumber('K',k,notes); }
  currentKumbh()?.rows.push({ chakra:state.currentChakra, y, k, ahuti:exposure, axyapatra:state.liveBankroll });
  if(state.liveBankroll <= state.settings.bankroll - state.settings.stopLoss) notes.push({title:'TREASURY WARNING',text:'Axyapatra approaching Raksha Rekha',kind:'warn'});
  if(state.liveBankroll < state.settings.reserve) notes.push({title:'TREASURY WARNING',text:'Axyapatra below Raksha Nidhi',kind:'warn'});
  renderAll(); notes.forEach(n=>showToast(n.title,n.text,n.kind||'')); }
function processIndividual(side,num){ recordSnapshot(); state.currentChakra += 1; ensureKumbh(); let exposure=0; for(let n=1;n<=9;n++){ const info=state.numbers[side][n]; if(info.status==='A'||info.status==='B') exposure += currentBetFor(info); }
  state.liveBankroll -= exposure; state.summary.totalAhuti += exposure; state.summary.maxExposure = Math.max(state.summary.maxExposure, exposure); const notes=[]; if(num===0) advanceAfterLoss(side,notes); else { advanceAfterLoss(side,[]); resolveNumber(side,num,notes); }
  currentKumbh()?.rows.push({ chakra:state.currentChakra, y: side==='Y'?num:'-', k: side==='K'?num:'-', ahuti:exposure, axyapatra:state.liveBankroll });
  renderAll(); notes.forEach(n=>showToast(n.title,n.text,n.kind||'')); }
function handleTap(side,num,el){ glowKey(el); if(state.settings.keypadMode==='combined'){ pending[side]=num; } else { processIndividual(side,num); } renderSangram(); if(state.settings.keypadMode==='combined' && pending.Y!==null && pending.K!==null) processCombined(); }

function switchTab(target){ state.activeTab=target; renderActiveTab(); saveState(); }
function setupTabs(){ document.querySelectorAll('.nav').forEach(btn=>btn.addEventListener('click',()=>switchTab(btn.dataset.target))); }
function recalcTargetLink(source){ const bankroll=Number(q('setBankroll').value)||defaultSettings.bankroll; if(source==='dollar') q('setTargetPercent').value=((Number(q('setTargetDollar').value||0)/bankroll)*100).toFixed(2); if(source==='percent') q('setTargetDollar').value=Math.round((bankroll*Number(q('setTargetPercent').value||0))/100); }
function exportDrishtiCsv(){ const header='Side,Number,ActivationChakra,WinChakra,StepsToWin,PreviousLoss,WinningBet,NetProfitLoss,Status\n'; const rows=state.drishti.map(r=>[r.side,r.number,r.activationChakra,r.winChakra,r.steps,r.prevLoss,r.winBet,r.net,r.status].join(',')).join('\n'); downloadFile('drishti.csv',header+rows,'text/csv'); }
function importDrishtiCsv(e){ const file=e.target.files[0]; if(!file) return; file.text().then(text=>{ state.drishti=text.trim().split(/\r?\n/).slice(1).filter(Boolean).map(line=>{ const [side,number,activationChakra,winChakra,steps,prevLoss,winBet,net,status]=line.split(','); return {side,number,activationChakra,winChakra,steps,prevLoss,winBet,net,status}; }); renderAll(); showToast('DRISHTI LOADED','CSV imported'); }); e.target.value=''; }
function exportGranthJson(){ downloadFile('granth.json',JSON.stringify(state.granth,null,2),'application/json'); }
function importGranthJson(e){ const file=e.target.files[0]; if(!file) return; file.text().then(text=>{ state.granth=JSON.parse(text); state.currentKumbhId=state.granth.at(-1)?.id||null; renderAll(); showToast('GRANTH LOADED','History imported'); }); e.target.value=''; }
function downloadFile(name,content,type){ const blob=new Blob([content],{type}); const url=URL.createObjectURL(blob); const a=document.createElement('a'); a.href=url; a.download=name; a.click(); setTimeout(()=>URL.revokeObjectURL(url),500); }
function setupInstall(){ window.addEventListener('beforeinstallprompt',e=>{ e.preventDefault(); deferredPrompt=e; q('installBtn').classList.remove('hidden'); }); q('installBtn').addEventListener('click', async()=>{ if(!deferredPrompt) return; deferredPrompt.prompt(); await deferredPrompt.userChoice; deferredPrompt=null; q('installBtn').classList.add('hidden'); }); }
function setupControls(){
  q('prayogaBtn').addEventListener('click', startPrayoga);
  q('kumbhaBtn').addEventListener('click', clearCurrentSession);
  q('undoBtn').addEventListener('click', undoLast);
  q('setTargetDollar').addEventListener('input', ()=>recalcTargetLink('dollar'));
  q('setTargetPercent').addEventListener('input', ()=>recalcTargetLink('percent'));
  q('setBankroll').addEventListener('input', ()=>recalcTargetLink('dollar'));
  q('applyYantraBtn').addEventListener('click', ()=>{
    const s=state.settings; s.bankroll=Number(q('setBankroll').value)||30000; s.targetDollar=Number(q('setTargetDollar').value)||500; s.targetPercent=Number(q('setTargetPercent').value)||1.67; s.stopLoss=Number(q('setStopLoss').value)||50000; s.min=Number(q('setMin').value)||100; s.max=Number(q('setMax').value)||3000; s.coin=Number(q('setCoin').value)||100; s.targetNum=Number(q('setTargetNum').value)||500; s.doubleLadder=q('setDoubleLadder').value; s.keypadMode=q('setKeypadMode').value; s.maxSteps=Number(q('setMaxSteps').value)||30; s.reserve=Number(q('setReserve').value)||20000; s.capRule=q('setCapRule').value; state.ladder=buildLadder(s); renderAll(); showToast('YANTRA APPLIED','Settings saved');
  });
  q('saveLadderBtn').addEventListener('click', ()=>{ let cumulative=0; document.querySelectorAll('[data-ladder-index]').forEach(inp=>{ const i=Number(inp.dataset.ladderIndex); const bet=Math.max(state.settings.coin, Number(inp.value)||0); inp.value=bet; cumulative += bet; state.ladder[i]={ step:`S${i+1}`, bet, winReturn: bet*9, netProfit:(bet*9)-cumulative, ifLoseTotal:-cumulative }; }); renderAll(); showToast('SOPANA SAVED','Editable ladder updated'); });
  q('resetLadderBtn').addEventListener('click', ()=>{ state.ladder=buildLadder(state.settings); renderAll(); showToast('SOPANA RESET','Default ladder restored'); });
  document.addEventListener('keydown', e=>{ const el=e.target; if(!(el instanceof HTMLInputElement)) return; if(!el.matches('[data-ladder-index]')) return; if(e.key==='Enter'){ e.preventDefault(); const current=Number(el.dataset.ladderIndex); const next=document.querySelector(`[data-ladder-index="${current+1}"]`); if(next){ next.focus(); next.select(); } else { el.blur(); } } });
  document.addEventListener('focusin', e=>{ const el=e.target; if(el instanceof HTMLInputElement && el.matches('[data-ladder-index]')) setTimeout(()=>el.select(),0); });
  q('exportCsvBtn').addEventListener('click', exportDrishtiCsv); q('loadCsvBtn').addEventListener('click', ()=>q('loadCsvFile').click()); q('loadCsvFile').addEventListener('change', importDrishtiCsv);
  q('exportGranthBtn').addEventListener('click', exportGranthJson); q('importGranthBtn').addEventListener('click', ()=>q('importGranthFile').click()); q('importGranthFile').addEventListener('change', importGranthJson);
  q('deleteGranthBtn').addEventListener('click', ()=>{ state.granth=[]; state.currentKumbhId=null; renderAll(); showToast('GRANTH PURGED','All Kumbh history removed'); });
  q('confirmCancelBtn').addEventListener('click', ()=>closeClearKumbh(false));
  q('confirmOkBtn').addEventListener('click', ()=>closeClearKumbh(true));
  q('confirmOverlay').addEventListener('click', e=>{ if(e.target===q('confirmOverlay')) closeClearKumbh(false); });
  document.addEventListener('keydown', e=>{ if(q('confirmOverlay').classList.contains('hidden')) return; if(e.key==='Escape') closeClearKumbh(false); });
}

if('serviceWorker' in navigator){ window.addEventListener('load',()=>navigator.serviceWorker.register('./service-worker.js').catch(()=>{})); }
setupTabs(); setupControls(); setupInstall(); renderAll();
