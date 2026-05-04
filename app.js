'use strict';
// ════════════════════════════════════════════════
// 藤井工藝 OBD DASH Ver.3 — app.js
// ════════════════════════════════════════════════

const G_PER_MS2 = 1/9.80665;  // m/s² → G

// ═══════════════════════════════════════════
// 共通 STATE
// ═══════════════════════════════════════════
const S = {
  rpm:0,speed:0,coolant:null,intake:null,
  mapKpa:null,boost:null,oilTemp:null,throttle:null,instHP:null,
  gx:0, gy:0,                      // [G] 画面右=正, 画面奥行(車両前)=正
  gear:'N',gearCand:'N',gearCnt:0,
  conn:'Disconnected',device:null,txChar:null,
  polling:false,waiting:false,buf:'',
  curPid:'',pidQueue:[],
  // TIMER
  elapsedSec:0,
};

// ═══════════════════════════════════════════
// TIMER 関連 (BT接続中のみカウント、常時バックグラウンド更新)
// ═══════════════════════════════════════════
let _btConnectedAt = null;       // 接続成功時刻 (ms)。null=未接続。

function formatTime(sec){
  if(sec<0) sec=0;
  const h=Math.floor(sec/3600);
  const m=Math.floor((sec%3600)/60);
  return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}`;
}
function startTimer(){
  _btConnectedAt = Date.now();
  S.elapsedSec = 0;
}
function resetTimer(){
  _btConnectedAt = null;
  S.elapsedSec = 0;
}
// 1秒ごとに常時バックグラウンドで経過時間を更新 (機能未選択でも継続)
setInterval(()=>{
  if(_btConnectedAt!==null){
    S.elapsedSec = Math.floor((Date.now()-_btConnectedAt)/1000);
  }
  // 表示中ウィジェットがあれば DOM 反映
  for(let i=0;i<PANEL_SLOTS.length;i++){
    if(PANEL_SLOTS[i]==='timer'){
      const el=document.getElementById(`sv-${i}`);
      if(el) el.textContent=formatTime(S.elapsedSec);
    }
  }
},1000);

// ═══════════════════════════════════════════
// WIDGET 定義 (PIDリストで取得最適化)
// ═══════════════════════════════════════════
const WIDGETS = {
  gear:    {label:'GEAR',     unit:'',       color:'#00b4ff',accent:'#00b4ff',
            getValue:()=>S.gear,                     isWarn:()=>false,
            special:'gear',  pids:['010C','010D']},
  speed:   {label:'SPEED',    unit:'km/h',   color:'#ffffff',accent:'#ffd200',
            getValue:()=>S.speed,                    isWarn:()=>false,
            special:false,   pids:['010D']},
  intake:  {label:'INTAKE',   unit:'°C',     color:'#22e54a',accent:'#22e54a',
            getValue:()=>S.intake,
            isWarn:()=>S.intake!==null&&S.intake>=70,
            special:false,   pids:['010F']},
  coolant: {label:'COOLANT',  unit:'°C',     color:'#00b4ff',accent:'#00b4ff',
            getValue:()=>S.coolant,
            isWarn:()=>S.coolant!==null&&S.coolant>=105,
            special:false,   pids:['0105']},
  oiltemp: {label:'OIL TEMP', unit:'°C',     color:'#ff8000',accent:'#ff3d1a',
            getValue:()=>S.oilTemp,
            isWarn:()=>S.oilTemp!==null&&S.oilTemp>=130,
            special:false,   pids:['015C']},
  boost:   {label:'BOOST',    unit:'kg/cm²', color:'#ffd200',accent:'#ffd200',
            getValue:()=>S.boost!==null?S.boost.toFixed(2):null,
            isWarn:()=>false,
            special:false,   pids:['010B']},
  throttle:{label:'THROTTLE', unit:'%',      color:'#00ff88',accent:'#00ff88',
            getValue:()=>S.throttle,                 isWarn:()=>false,
            special:'thr',   pids:['0111']},
  insthp:  {label:'EST.HP',   unit:'PS',     color:'#ff8000',accent:'#ff8000',
            getValue:()=>S.instHP,                   isWarn:()=>false,
            special:'hp',    pids:['010B','010C']},
  gball:   {label:'G-METER',  unit:'',       color:'#00ff88',accent:'#00ff88',
            getValue:()=>null,                       isWarn:()=>false,
            special:'gball', pids:[]},
  timer:   {label:'TIME',     unit:'',       color:'#00b4ff',accent:'#00b4ff',
            getValue:()=>formatTime(S.elapsedSec),   isWarn:()=>false,
            special:'timer', pids:[]},
};
const WIDGET_KEYS = Object.keys(WIDGETS);

// ═══════════════════════════════════════════
// CONFIG
// ═══════════════════════════════════════════
const DEFAULT_CFG = {
  panelCount:5,
  responseMode:'double',
  showBoost:true,boostMin:-0.5,boostMax:2.0,
  hpCoeff:0.000197,maxHP:250,
  // G-meter (G単位)
  gMaxG:1.5,           // 表示円の端=1.5G
  gAlertG:1.0,         // 1.0Gでアラート
  gInvertX:false, gInvertY:false,
  // RPM
  maxRpm:6200,warnRpm:4800,rpmDots:12,
  dotConfig:[
    {color:'green',threshold:1000},{color:'green',threshold:1500},
    {color:'green',threshold:2000},{color:'green',threshold:2500},
    {color:'green',threshold:3000},{color:'green',threshold:3500},
    {color:'yellow',threshold:4000},{color:'yellow',threshold:4300},
    {color:'yellow',threshold:4600},{color:'red',threshold:5000},
    {color:'red',threshold:5400},{color:'red',threshold:5800},
  ],
  finalDrive:3.502,tireDiamMm:616,
  gearRatios:[4.459,2.508,1.556,1.142,0.851,0.672],
  tolerancePct:10,hysteresis:2,minSpeed:4,minRpm:500,medianSize:5,
};

const DEFAULT_SLOTS = ['speed','intake','gear','coolant','oiltemp'];

function loadCfg(){
  try{const s=JSON.parse(localStorage.getItem('gtdash_cfg_v3'));
    if(s) return Object.assign({},DEFAULT_CFG,s);}catch(_){}
  return JSON.parse(JSON.stringify(DEFAULT_CFG));
}
function loadSlots(){
  try{
    const s=JSON.parse(localStorage.getItem('gtdash_slots_v3'));
    if(Array.isArray(s)){
      // 旧Ver3 (4スロット, ギア固定中央) からの移行
      if(s.length===4 && !s.includes('gear')){
        return [s[0],s[1],'gear',s[2],s[3]];
      }
      if(s.length>=0 && s.length<=5){
        return s.map(k=>WIDGETS[k]?k:'speed');
      }
    }
  }catch(_){}
  return [...DEFAULT_SLOTS];
}
function saveSlots(arr){try{localStorage.setItem('gtdash_slots_v3',JSON.stringify(arr));}catch(_){}}

let CFG=loadCfg();
let PANEL_SLOTS=loadSlots();
if(PANEL_SLOTS.length !== CFG.panelCount){
  resizeSlots(CFG.panelCount);
}

function resizeSlots(n){
  n=Math.max(0,Math.min(5,n|0));
  if(n===PANEL_SLOTS.length) return;
  if(n<PANEL_SLOTS.length){PANEL_SLOTS=PANEL_SLOTS.slice(0,n);}
  else{
    while(PANEL_SLOTS.length<n){
      PANEL_SLOTS.push(DEFAULT_SLOTS[PANEL_SLOTS.length]||'speed');
    }
  }
}

// ═══════════════════════════════════════════
// OBD PID (動的決定)
// ═══════════════════════════════════════════
const ELM_SERVICES=[
  '0000ffe0-0000-1000-8000-00805f9b34fb',
  '0000fff0-0000-1000-8000-00805f9b34fb',
  '000018f0-0000-1000-8000-00805f9b34fb',
  '0000ffe5-0000-1000-8000-00805f9b34fb',
];
const NOISE=['NODATA','ERROR','UNABLE','SEARCHING','STOPPED','BUSBUSY'];

let ACTIVE_PIDS_FAST=['010C'];
let ACTIVE_PIDS_SLOW=[];

function recomputeActivePids(){
  const fast=new Set();
  const slow=new Set();
  fast.add('010C');                       // RPM (TOPで常時)
  if(CFG.showBoost) slow.add('010B');     // ブーストバー
  for(const wid of PANEL_SLOTS){
    const def=WIDGETS[wid];
    if(!def||!def.pids) continue;
    for(const pid of def.pids){
      if(pid==='010C'||pid==='010D') fast.add(pid);
      else slow.add(pid);
    }
  }
  ACTIVE_PIDS_FAST=[...fast];
  ACTIVE_PIDS_SLOW=[...slow];
  _slowIdx=0;
  S.pidQueue=[];
  dbg('[PID] fast='+JSON.stringify(ACTIVE_PIDS_FAST)+' slow='+JSON.stringify(ACTIVE_PIDS_SLOW));
}

let _slowIdx=0;
function nextPids(){
  const pids=[...ACTIVE_PIDS_FAST];
  if(ACTIVE_PIDS_SLOW.length>0){
    pids.push(ACTIVE_PIDS_SLOW[_slowIdx % ACTIVE_PIDS_SLOW.length]);
    _slowIdx++;
  }
  return pids;
}

// ═══════════════════════════════════════════
// GEAR
// ═══════════════════════════════════════════
function buildGearTable(){
  const circ=Math.PI*CFG.tireDiamMm/1000;
  const factor=CFG.finalDrive*1000/(circ*60);
  return CFG.gearRatios.map((gr,i)=>({gear:String(i+1),rpmPerKmh:gr*factor}));
}
let GEAR_TABLE=buildGearTable();

const _ratioHistory=[];
function detectGear(){
  if(S.speed<CFG.minSpeed||S.rpm<CFG.minRpm){
    _ratioHistory.length=0;S.gearCand='N';S.gearCnt=0;S.gear='N';return;
  }
  const ratio=S.rpm/S.speed;
  _ratioHistory.push(ratio);
  if(_ratioHistory.length>CFG.medianSize) _ratioHistory.shift();
  if(_ratioHistory.length<CFG.medianSize) return;
  const sorted=[..._ratioHistory].sort((a,b)=>a-b);
  const medRatio=sorted[Math.floor(sorted.length/2)];
  const maxDev=Math.max(...sorted)-Math.min(...sorted);
  if((maxDev/medRatio)>0.15) return;
  const tol=(CFG.tolerancePct||10)/100;
  let best='N',bestPct=tol;
  for(const g of GEAR_TABLE){
    const pct=Math.abs(medRatio-g.rpmPerKmh)/g.rpmPerKmh;
    if(pct<bestPct){bestPct=pct;best=g.gear;}
  }
  if(best==='N') return;
  if(best===S.gearCand){
    S.gearCnt++;
    if(S.gearCnt>=CFG.hysteresis) S.gear=best;
  }else{S.gearCand=best;S.gearCnt=1;}
}

function computeInstHP(){
  if(S.rpm>200&&S.mapKpa!==null){
    S.instHP=Math.round(S.mapKpa*S.rpm*(CFG.hpCoeff||0.000197));
  }else{S.instHP=null;}
}

// ═══════════════════════════════════════════
// LED
// ═══════════════════════════════════════════
function buildLeds(){
  const bar=document.getElementById('led-bar');
  bar.innerHTML='';
  for(let i=0;i<CFG.rpmDots;i++){
    const d=document.createElement('div');
    d.className='led';d.id=`led-${i}`;
    bar.appendChild(d);
  }
}
function updateLeds(){
  const bar=document.getElementById('led-bar');
  if(bar) bar.classList.toggle('warn',S.rpm>=CFG.warnRpm);
  for(let i=0;i<CFG.rpmDots;i++){
    const d=document.getElementById(`led-${i}`);
    if(!d) continue;
    const dc=CFG.dotConfig[i];
    if(!dc){d.className='led';continue;}
    const cc=['green','yellow','red','blue','orange','white'].includes(dc.color)?dc.color:'green';
    d.className=S.rpm>=dc.threshold?`led ${cc} on`:`led ${cc}`;
  }
}

// ═══════════════════════════════════════════
// PANELS
// ═══════════════════════════════════════════
function buildPanels(){
  const main=document.getElementById('main');
  const top=document.getElementById('top');
  main.innerHTML='';
  if(PANEL_SLOTS.length===0){
    main.classList.add('empty');
    top.classList.add('full');
    return;
  }
  main.classList.remove('empty');
  top.classList.remove('full');
  for(let i=0;i<PANEL_SLOTS.length;i++){
    const div=document.createElement('div');
    div.className='panel slot-panel';
    div.id=`slot-${i}`;
    main.appendChild(div);
  }
  renderAllSlots();
}

function renderSlot(i){
  const el=document.getElementById(`slot-${i}`);
  if(!el) return;
  const wid=PANEL_SLOTS[i];
  const def=WIDGETS[wid];
  if(!def) return;
  el.classList.toggle('slot-gear',def.special==='gear');
  if(def.special==='gear'){
    el.innerHTML=`
      <button class="edit-btn" data-slot="${i}">✎</button>
      <div class="gear-frame-inner" id="gf-${i}">
        <span class="gear-val-inner" id="gv-${i}">N</span>
        <span class="gear-label-inner">GEAR</span>
      </div>`;
  }else if(def.special==='gball'){
    // 数値表示なし、ラベル A→F
    el.innerHTML=`
      <button class="edit-btn" data-slot="${i}">✎</button>
      <div class="s-label">G-METER</div>
      <div class="gb-wrap">
        <div class="gb-circle">
          <div class="gb-ring gb-ring-full"></div>
          <div class="gb-ring gb-ring-half"></div>
          <div class="gb-cross-h"></div>
          <div class="gb-cross-v"></div>
          <div class="gb-lbl gb-lbl-l">L</div>
          <div class="gb-lbl gb-lbl-r">R</div>
          <div class="gb-lbl gb-lbl-a">F</div>
          <div class="gb-lbl gb-lbl-b">B</div>
          <div class="gb-dot"></div>
        </div>
      </div>`;
  }else if(def.special==='thr'){
    el.innerHTML=`
      <button class="edit-btn" data-slot="${i}">✎</button>
      <span class="accent-bar" style="background:linear-gradient(90deg,${def.accent},transparent)"></span>
      <div class="s-label">${def.label}</div>
      <div class="s-num-wrap">
        <div class="s-val" id="sv-${i}" style="color:${def.color}">--</div>
        <div class="s-unit">${def.unit}</div>
      </div>
      <div class="thr-bar-track"><div class="thr-bar-fill" id="thr-fill-${i}"></div></div>`;
  }else if(def.special==='hp'){
    el.innerHTML=`
      <button class="edit-btn" data-slot="${i}">✎</button>
      <span class="accent-bar" style="background:linear-gradient(90deg,${def.accent},transparent)"></span>
      <div class="s-label">${def.label}</div>
      <div class="s-num-wrap">
        <div class="s-val" id="sv-${i}" style="color:${def.color}">--</div>
        <div class="s-unit">${def.unit}</div>
      </div>
      <div class="hp-bar-track"><div class="hp-bar-fill" id="hp-fill-${i}"></div></div>`;
  }else if(def.special==='timer'){
    el.innerHTML=`
      <button class="edit-btn" data-slot="${i}">✎</button>
      <span class="accent-bar" style="background:linear-gradient(90deg,${def.accent},transparent)"></span>
      <div class="s-label">${def.label}</div>
      <div class="s-num-wrap">
        <div class="s-val timer-val" id="sv-${i}" style="color:${def.color}">${formatTime(S.elapsedSec)}</div>
      </div>`;
  }else{
    el.innerHTML=`
      <button class="edit-btn" data-slot="${i}">✎</button>
      <span class="accent-bar" style="background:linear-gradient(90deg,${def.accent},transparent)"></span>
      <div class="s-label">${def.label}</div>
      <div class="s-num-wrap">
        <div class="s-val" id="sv-${i}" style="color:${def.color}">--</div>
        <div class="s-unit">${def.unit}</div>
      </div>`;
  }
}
function renderAllSlots(){for(let i=0;i<PANEL_SLOTS.length;i++) renderSlot(i);}

// ═══════════════════════════════════════════
// G-SENSOR (重力ローパス除去 + 画面回転対応)
//
// 設計:
//  1. accelerationIncludingGravity から純加速度を抽出 (重力を低周波で動的推定)
//  2. screen.orientation.angle に応じて (lx,ly) を画面座標 (sx,sy) に回転変換
//  3. 画面右方向 sx = 横G、画面奥行き -lz = 縦G(車両前=z負を反転)
//
// 端末は「立てた状態(画面が垂直)」想定:
//  - 重力は常に画面平面内 → 画面平面内の運動成分が車両の旋回G・上下G
//  - 画面奥行き(z軸)は端末をどう回転しても変わらない → 車両前後Gはここから取れる
//
// 画面回転 (screen.orientation.angle):
//   0   : 縦持ち (基準)
//   90  : 反時計回り90° (内カメラ右、ホームボタン左)
//   180 : 上下逆さ
//   270 : 時計回り90° (内カメラ左、ホームボタン右)
//
// 回転変換 (端末→画面):
//   sx =  lx*cos(θ) + ly*sin(θ)
//   sy = -lx*sin(θ) + ly*cos(θ)   ※sy=画面上方向だが重力方向のため未使用
// ═══════════════════════════════════════════
let _gravX=0,_gravY=0,_gravZ=0,_gInit=false;
const G_LP_ALPHA=0.92;
let _calibPending=false;

function calibrateG(){_calibPending=true;}

function getOrientationAngle(){
  // 優先: screen.orientation.angle, 後方互換: window.orientation
  if(screen.orientation && typeof screen.orientation.angle==='number'){
    return screen.orientation.angle;
  }
  if(typeof window.orientation==='number'){
    // window.orientation: 0/90/-90/180 → screen.orientation.angle: 0/270/90/180
    let a=window.orientation;
    if(a===-90) a=270;
    return a;
  }
  return 0;
}

function setupGSensor(){
  if(typeof DeviceMotionEvent==='undefined') return;
  window.addEventListener('devicemotion',onMotion,{passive:true});
  // 画面回転変更時は重力推定をリセット (向きが変わると重力ベクトルも変わるため)
  if(screen.orientation){
    screen.orientation.addEventListener('change',()=>{_gInit=false;});
  }
  window.addEventListener('orientationchange',()=>{_gInit=false;});
}

function onMotion(e){
  const a=e.accelerationIncludingGravity;
  if(!a||a.x===null||a.x===undefined) return;
  const ax=a.x||0, ay=a.y||0, az=a.z||0;

  // 重力推定 (初回 or キャリブ要求 or 回転後 → 即セット)
  if(!_gInit||_calibPending){
    _gravX=ax; _gravY=ay; _gravZ=az;
    _gInit=true; _calibPending=false;
  }else{
    _gravX=G_LP_ALPHA*_gravX + (1-G_LP_ALPHA)*ax;
    _gravY=G_LP_ALPHA*_gravY + (1-G_LP_ALPHA)*ay;
    _gravZ=G_LP_ALPHA*_gravZ + (1-G_LP_ALPHA)*az;
  }

  // 純加速度 (重力除去) [m/s²]
  const lx=ax-_gravX;
  const ly=ay-_gravY;
  const lz=az-_gravZ;

  // 画面回転を考慮して端末座標 → 画面座標へ回転変換
  const angle = getOrientationAngle();
  const rad   = angle * Math.PI / 180;
  const cos   = Math.cos(rad);
  const sin   = Math.sin(rad);
  // 画面右方向 sx (画面回転で軸が変わる)
  const sx =  lx*cos + ly*sin;
  // 画面上方向 sy は重力方向で運動成分が乗らない → 未使用
  // 縦G(車両前後)は画面奥行き lz を使う (画面回転では変わらない)

  // [G]に変換 + 反転オプション適用
  S.gx =  sx * G_PER_MS2 * (CFG.gInvertX?-1:1);
  S.gy = -lz * G_PER_MS2 * (CFG.gInvertY?-1:1);

  updateGballs();
}

function updateGballs(){
  const maxG=CFG.gMaxG||1.5;
  const alertG=CFG.gAlertG||1.0;
  const total=Math.sqrt(S.gx*S.gx+S.gy*S.gy);
  const isAlert=total>=alertG;

  for(let i=0;i<PANEL_SLOTS.length;i++){
    if(PANEL_SLOTS[i]!=='gball') continue;
    const el=document.getElementById(`slot-${i}`);
    if(!el) continue;
    const dot=el.querySelector('.gb-dot');
    const circ=el.querySelector('.gb-circle');
    if(!dot||!circ) continue;
    const pctX=50+(S.gx/maxG)*45;
    const pctY=50-(S.gy/maxG)*45;  // Y正=画面上=F方向
    dot.style.left=clamp(pctX,5,95).toFixed(1)+'%';
    dot.style.top =clamp(pctY,5,95).toFixed(1)+'%';
    dot.classList.toggle('alert',isAlert);
    circ.classList.toggle('alert',isAlert);
  }
}
function clamp(v,mn,mx){return Math.min(mx,Math.max(mn,v));}

// ═══════════════════════════════════════════
// UI UPDATE
// ═══════════════════════════════════════════
const GEAR_COLORS={N:'#00b4ff','1':'#ff8000','R':'#ff3d1a'};

function updateUI(){
  const rpmEl=document.getElementById('rpm-val');
  rpmEl.textContent=S.rpm;
  rpmEl.classList.toggle('warn',S.rpm>=CFG.warnRpm);
  updateLeds();

  const boostMin=CFG.boostMin??-0.5;
  const boostMax=CFG.boostMax||2.0;
  const boostRange=boostMax-boostMin;
  const fill=document.getElementById('boost-bar-fill');
  const bval=document.getElementById('boost-bar-val');
  if(S.boost!==null){
    const pct=clamp((S.boost-boostMin)/boostRange,0,1)*100;
    if(fill) fill.style.width=pct.toFixed(1)+'%';
    if(bval) bval.textContent=S.boost.toFixed(2);
  }else{
    if(fill) fill.style.width='0%';
    if(bval) bval.textContent='---';
  }
  const ticks=document.querySelectorAll('.boost-tick');
  if(ticks.length===5){
    const step=boostRange/4;
    ticks.forEach((el,i)=>{el.textContent=(boostMin+step*i).toFixed(1);});
  }

  updateSlots();

  const cl=document.getElementById('conn-label');
  cl.textContent=`OBD: ${S.conn}`;
  cl.style.color=S.conn==='Connected'?'#1FD060':'#FF3D1A';
  const btn=document.getElementById('btn-conn');
  btn.textContent=S.conn==='Connected'?'DISCONNECT':'CONNECT';
  btn.className=S.conn==='Connected'?'disc':'';
  const rl=document.getElementById('ratio-label');
  rl.textContent=S.speed>2?`${(S.rpm/S.speed).toFixed(1)} r/v`:'';
}

function updateSlots(){
  for(let i=0;i<PANEL_SLOTS.length;i++){
    const wid=PANEL_SLOTS[i];
    const def=WIDGETS[wid];
    if(!def) continue;
    if(def.special==='gball') continue;
    if(def.special==='gear'){
      const gvEl=document.getElementById(`gv-${i}`);
      const gfEl=document.getElementById(`gf-${i}`);
      if(gvEl&&gfEl){
        const col=GEAR_COLORS[S.gear]||'#ffffff';
        gvEl.textContent=S.gear;
        gvEl.style.color=col;
        gvEl.style.textShadow=`0 0 18px ${col}80`;
        gfEl.style.borderColor=col;
        gfEl.style.boxShadow=`inset 0 0 28px ${col}1f, 0 0 22px ${col}38`;
      }
      continue;
    }
    const valEl=document.getElementById(`sv-${i}`);
    if(!valEl) continue;
    const val=def.getValue();
    const isNull=(val===null||val===undefined);
    valEl.textContent=isNull?'--':val;
    const warn=!isNull&&def.isWarn();
    valEl.classList.toggle('warn',warn);
    valEl.style.color=warn?'':def.color;
    if(def.special==='thr'){
      const f=document.getElementById(`thr-fill-${i}`);
      if(f) f.style.width=(isNull?0:clamp(val,0,100))+'%';
    }else if(def.special==='hp'){
      const f=document.getElementById(`hp-fill-${i}`);
      if(f){
        const maxHP=CFG.maxHP||250;
        const pct=isNull?0:clamp((val/maxHP)*100,0,100);
        f.style.width=pct.toFixed(1)+'%';
      }
    }
  }
}

// ═══════════════════════════════════════════
// PICKER
// ═══════════════════════════════════════════
let _pickerSlot=-1;
function openPicker(slotIndex){
  _pickerSlot=slotIndex;
  document.getElementById('picker-slot-num').textContent=slotIndex+1;
  buildPickerGrid();
  document.getElementById('modal-picker').classList.add('show');
}
function closePicker(){
  document.getElementById('modal-picker').classList.remove('show');
  _pickerSlot=-1;
}
function buildPickerGrid(){
  const grid=document.getElementById('picker-grid');
  grid.innerHTML='';
  const current=PANEL_SLOTS[_pickerSlot];
  for(const key of WIDGET_KEYS){
    const def=WIDGETS[key];
    const card=document.createElement('div');
    card.className='picker-card'+(key===current?' active':'');
    let preview='';
    if(def.special==='gear'){preview=S.gear;}
    else if(def.special==='gball'){preview='2D';}
    else if(def.special==='timer'){preview=formatTime(S.elapsedSec);}
    else{
      const v=def.getValue();
      preview=(v!==null&&v!==undefined)?`${v}${def.unit}`:'--';
    }
    card.innerHTML=`
      <div class="picker-card-lbl">${def.label}</div>
      <div class="picker-card-val">${preview}</div>`;
    card.addEventListener('click',()=>selectWidget(key));
    grid.appendChild(card);
  }
}
function selectWidget(key){
  if(_pickerSlot<0) return;
  PANEL_SLOTS[_pickerSlot]=key;
  saveSlots(PANEL_SLOTS);
  renderSlot(_pickerSlot);
  recomputeActivePids();
  closePicker();
  updateUI();
}

// ═══════════════════════════════════════════
// CONFIG MODAL
// ═══════════════════════════════════════════
function openCfg(){
  document.getElementById('cfg-panelcount').value=String(CFG.panelCount);
  document.getElementById('cfg-respmode').value=CFG.responseMode;
  document.getElementById('cfg-showboost').value=CFG.showBoost?'on':'off';
  document.getElementById('cfg-boostmin').value=CFG.boostMin;
  document.getElementById('cfg-boostmax').value=CFG.boostMax;
  document.getElementById('cfg-hpcoeff').value=CFG.hpCoeff;
  document.getElementById('cfg-maxhp').value=CFG.maxHP;
  document.getElementById('cfg-gmaxg').value=CFG.gMaxG;
  document.getElementById('cfg-galertg').value=CFG.gAlertG;
  document.getElementById('cfg-ginvertx').value=String(CFG.gInvertX);
  document.getElementById('cfg-ginverty').value=String(CFG.gInvertY);
  document.getElementById('cfg-dotcount').value=CFG.rpmDots;
  document.getElementById('cfg-maxrpm').value=CFG.maxRpm;
  document.getElementById('cfg-warnrpm').value=CFG.warnRpm;
  document.getElementById('cfg-finaldrive').value=CFG.finalDrive;
  document.getElementById('cfg-tirediam').value=CFG.tireDiamMm;
  document.getElementById('cfg-gearcount').value=CFG.gearRatios.length;
  document.getElementById('cfg-tolerance').value=CFG.tolerancePct;
  renderDotRows();renderGearRows();
  document.getElementById('modal-cfg').classList.add('show');
}
function closeCfg(){document.getElementById('modal-cfg').classList.remove('show');}

function renderDotRows(){
  const c=parseInt(document.getElementById('cfg-dotcount').value)||CFG.rpmDots;
  while(CFG.dotConfig.length<c){
    const last=CFG.dotConfig[CFG.dotConfig.length-1]||{color:'green',threshold:1000};
    CFG.dotConfig.push({color:last.color,threshold:last.threshold+500});
  }
  CFG.dotConfig=CFG.dotConfig.slice(0,c);
  let html='';
  for(let i=0;i<c;i++){
    const dc=CFG.dotConfig[i];
    html+=`<div class="cfg-dot-row">
      <span>#${i+1}</span>
      <select id="cfg-dc-${i}">${['green','yellow','red','blue','orange','white']
        .map(k=>`<option value="${k}"${k===dc.color?' selected':''}>${k}</option>`).join('')}</select>
      <label>点灯</label>
      <input type="number" id="cfg-dt-${i}" value="${dc.threshold}" step="100" style="width:74px;"> rpm~
    </div>`;
  }
  document.getElementById('cfg-dots').innerHTML=html;
}
function renderGearRows(){
  const c=parseInt(document.getElementById('cfg-gearcount').value)||CFG.gearRatios.length;
  while(CFG.gearRatios.length<c){
    const last=CFG.gearRatios[CFG.gearRatios.length-1]||1.0;
    CFG.gearRatios.push(+(last*0.8).toFixed(3));
  }
  CFG.gearRatios=CFG.gearRatios.slice(0,c);
  let html='';
  for(let i=0;i<c;i++){
    html+=`<div class="cfg-gear-row">
      <span>${i+1}速</span>
      <input type="number" id="cfg-gr-${i}" value="${CFG.gearRatios[i]}" step="0.001">
    </div>`;
  }
  document.getElementById('cfg-gears').innerHTML=html;
}

function saveCfg(){
  const newCount=clamp(parseInt(document.getElementById('cfg-panelcount').value),0,5);
  const countChanged=(newCount!==PANEL_SLOTS.length);
  if(countChanged){
    resizeSlots(newCount);
    saveSlots(PANEL_SLOTS);
  }
  CFG.panelCount=newCount;

  CFG.responseMode=document.getElementById('cfg-respmode').value||'double';
  CFG.showBoost=document.getElementById('cfg-showboost').value!=='off';
  CFG.boostMin=Math.min(0,parseFloat(document.getElementById('cfg-boostmin').value)||-0.5);
  CFG.boostMax=Math.max(0.5,parseFloat(document.getElementById('cfg-boostmax').value)||2.0);
  CFG.hpCoeff=parseFloat(document.getElementById('cfg-hpcoeff').value)||0.000197;
  CFG.maxHP=parseInt(document.getElementById('cfg-maxhp').value)||250;
  CFG.gMaxG=Math.max(0.1,parseFloat(document.getElementById('cfg-gmaxg').value)||1.5);
  CFG.gAlertG=Math.max(0.1,parseFloat(document.getElementById('cfg-galertg').value)||1.0);
  CFG.gInvertX=document.getElementById('cfg-ginvertx').value==='true';
  CFG.gInvertY=document.getElementById('cfg-ginverty').value==='true';
  CFG.rpmDots=Math.max(4,Math.min(20,parseInt(document.getElementById('cfg-dotcount').value)||12));
  CFG.maxRpm=parseInt(document.getElementById('cfg-maxrpm').value)||6200;
  CFG.warnRpm=parseInt(document.getElementById('cfg-warnrpm').value)||4800;
  CFG.dotConfig=[];
  for(let i=0;i<CFG.rpmDots;i++){
    const cEl=document.getElementById(`cfg-dc-${i}`);
    const tEl=document.getElementById(`cfg-dt-${i}`);
    CFG.dotConfig.push({color:cEl?cEl.value:'green',threshold:tEl?(parseInt(tEl.value)||1000):1000});
  }
  CFG.finalDrive=parseFloat(document.getElementById('cfg-finaldrive').value)||3.502;
  CFG.tireDiamMm=parseInt(document.getElementById('cfg-tirediam').value)||616;
  const gc=Math.max(3,Math.min(10,parseInt(document.getElementById('cfg-gearcount').value)||6));
  CFG.gearRatios=[];
  for(let i=0;i<gc;i++){
    const el=document.getElementById(`cfg-gr-${i}`);
    CFG.gearRatios.push(el?(parseFloat(el.value)||1.0):1.0);
  }
  CFG.tolerancePct=Math.max(3,Math.min(20,parseInt(document.getElementById('cfg-tolerance').value)||10));

  applyBoostVisibility();
  try{localStorage.setItem('gtdash_cfg_v3',JSON.stringify(CFG));}catch(_){}
  GEAR_TABLE=buildGearTable();
  buildLeds();
  if(countChanged) buildPanels(); else renderAllSlots();
  recomputeActivePids();
  updateUI();closeCfg();
}
function resetCfg(){
  if(!confirm('全設定を初期化しますか？')) return;
  CFG=JSON.parse(JSON.stringify(DEFAULT_CFG));
  PANEL_SLOTS=[...DEFAULT_SLOTS];
  try{localStorage.removeItem('gtdash_cfg_v3');localStorage.removeItem('gtdash_slots_v3');}catch(_){}
  GEAR_TABLE=buildGearTable();
  buildLeds();buildPanels();recomputeActivePids();updateUI();openCfg();
}
function applyBoostVisibility(){
  const el=document.getElementById('boost-bar-wrap');
  if(el) el.style.display=CFG.showBoost?'':'none';
}

// ═══════════════════════════════════════════
// QUICK CONNECT
// ═══════════════════════════════════════════
const STORAGE_DEV='gtdash_last_device';
function saveDevice(id,name){try{localStorage.setItem(STORAGE_DEV,JSON.stringify({id,name}));}catch(_){}}
function loadDevice(){try{return JSON.parse(localStorage.getItem(STORAGE_DEV));}catch(_){return null;}}

function _addDisconnectHandler(device){
  device.addEventListener('gattserverdisconnected',()=>{
    console.log('[BLE] disconnected');
    S.polling=false;S.txChar=null;
    clearInterval(_pollTimer);clearTimeout(_timeoutTimer);clearInterval(_watchdogTimer);
    Object.assign(S,{rpm:0,speed:0,coolant:null,intake:null,
      mapKpa:null,boost:null,oilTemp:null,throttle:null,instHP:null,
      gearCand:'N',gearCnt:0,buf:'',waiting:false});
    _ratioHistory.length=0;
    resetTimer();   // ← 切断時にタイマーリセット
    if(!_reconnecting){S.conn='Disconnected';updateUI();}
  });
}
function closeQuickModal(){document.getElementById('modal-quick').classList.remove('show');}
async function quickConnect(){
  closeQuickModal();
  const saved=loadDevice();if(!saved){openModal();return;}
  try{
    const devices=await navigator.bluetooth.getDevices();
    const device=devices.find(d=>d.id===saved.id);
    if(!device){openModal();return;}
    S.device=device;S.conn='Connecting...';updateUI();
    _addDisconnectHandler(device);
    const server=await device.gatt.connect();
    await _initAfterConnect(server,device);
  }catch(e){console.warn('[QUICK]',e);openModal();}
}
function checkAutoConnect(){
  const saved=loadDevice();if(!saved) return;
  document.getElementById('quick-device-name').textContent=saved.name||'UniCarScan';
  document.getElementById('modal-quick').classList.add('show');
}

// ═══════════════════════════════════════════
// BLE
// ═══════════════════════════════════════════
function send(cmd){
  if(!S.txChar) return;
  S.txChar.writeValueWithoutResponse(new TextEncoder().encode(cmd+'\r')).catch(e=>console.warn('[SEND]',e));
}
function sleep(ms){return new Promise(r=>setTimeout(r,ms));}

async function startBLE(){
  closeModal();
  if(!navigator.bluetooth){alert('Android Chrome が必要です。');return;}
  try{
    S.conn='Scanning...';updateUI();
    const device=await navigator.bluetooth.requestDevice({
      acceptAllDevices:true,optionalServices:ELM_SERVICES
    });
    S.device=device;S.conn='Connecting...';updateUI();
    _addDisconnectHandler(device);
    saveDevice(device.id,device.name);
    const server=await device.gatt.connect();
    await _initAfterConnect(server,device);
  }catch(e){console.error('[BLE]',e);S.conn='Disconnected';updateUI();}
}

async function _initAfterConnect(server,device){
  try{
    S.conn='Discovering...';updateUI();
    let txChar=null,rxChar=null;
    const services=await server.getPrimaryServices();
    for(const svcUuid of ELM_SERVICES){
      try{
        const svc=await server.getPrimaryService(svcUuid);
        const chars=await svc.getCharacteristics();
        for(const c of chars){
          if((c.properties.notify||c.properties.indicate)&&!rxChar) rxChar=c;
          if((c.properties.writeWithoutResponse||c.properties.write)&&!txChar) txChar=c;
        }
        if(txChar&&rxChar) break;
      }catch(_){}
    }
    if(!txChar||!rxChar){
      const STD=['00001800','00001801','0000180a','0000180f'];
      for(const svc of services){
        if(STD.some(s=>svc.uuid.startsWith(s))) continue;
        try{
          const chars=await svc.getCharacteristics();
          for(const c of chars){
            if((c.properties.notify||c.properties.indicate)&&!rxChar) rxChar=c;
            if((c.properties.writeWithoutResponse||c.properties.write)&&!txChar) txChar=c;
          }
          if(txChar&&rxChar) break;
        }catch(_){}
      }
    }
    if(!txChar||!rxChar){S.conn='Match failed';updateUI();alert('ELM327のCharacteristicが見つかりません。');return;}
    S.txChar=txChar;
    await rxChar.startNotifications();
    rxChar.addEventListener('characteristicvaluechanged',onData);
    await sleep(500);
    send('ATZ');await sleep(1600);
    for(const cmd of ['ATE0','ATL0','ATS0','ATH0','ATSP0']){send(cmd);await sleep(400);}
    S.conn='Connected';S.polling=true;
    if(_btConnectedAt===null) startTimer();   // ← 接続成功でタイマー開始（再接続では維持しない=リセット済み）
    recomputeActivePids();
    S.pidQueue=nextPids();
    updateUI();poll();
  }catch(e){console.error('[BLE]',e);S.conn='Disconnected';updateUI();}
}

let _pollTimer=null,_timeoutTimer=null,_watchdogTimer=null;
let _consecutiveTimeouts=0,_lastDataAt=0,_reconnecting=false;
const WATCHDOG_MS=3000,NO_DATA_MS=5000,MAX_TIMEOUTS=8;

function onData(event){
  try{S.buf+=new TextDecoder().decode(event.target.value);}catch(_){return;}
  if(!S.buf.includes('>')&&S.buf.split('\r').filter(x=>x.trim()).length<1) return;
  clearTimeout(_timeoutTimer);
  const r=S.buf;S.buf='';
  S.waiting=false;_consecutiveTimeouts=0;_lastDataAt=Date.now();
  if(S.conn!=='Connected') return;
  const lines=r.split('\r').map(l=>l.replace(/[\n>]/g,'').trim()).filter(l=>l.length>3);
  const pid=S.curPid;
  dbg('['+pid+'] mode='+CFG.responseMode+' lines='+JSON.stringify(lines));
  if(lines.length>0){
    if(CFG.responseMode==='single'){for(const l of lines){if(parseLine(pid,l)) break;}}
    else                            {for(const l of lines) parseLine(pid,l);}
    updateUI();
  }
}
function poll(){
  if(_pollTimer) clearInterval(_pollTimer);
  _pollTimer=setInterval(()=>{
    if(!S.polling||S.conn!=='Connected'){clearInterval(_pollTimer);return;}
    if(S.waiting) return;
    if(!S.pidQueue.length) S.pidQueue=nextPids();
    if(!S.pidQueue.length) return;
    S.curPid=S.pidQueue.shift();
    S.waiting=true;
    send(S.curPid);
    _timeoutTimer=setTimeout(()=>{
      S.buf='';S.waiting=false;_consecutiveTimeouts++;
      dbg('[TIMEOUT] count='+_consecutiveTimeouts);
    },500);
  },50);
  startWatchdog();
}
function startWatchdog(){
  if(_watchdogTimer) clearInterval(_watchdogTimer);
  _lastDataAt=Date.now();_consecutiveTimeouts=0;
  _watchdogTimer=setInterval(()=>{
    if(S.conn!=='Connected'||!S.polling) return;
    const stale=Date.now()-_lastDataAt>NO_DATA_MS;
    const tooMany=_consecutiveTimeouts>=MAX_TIMEOUTS;
    if(stale||tooMany){dbg('[WATCHDOG] reconnect');attemptReconnect();}
  },WATCHDOG_MS);
}
async function attemptReconnect(){
  if(_reconnecting) return;
  _reconnecting=true;S.conn='Reconnecting...';updateUI();
  try{
    S.polling=false;
    clearInterval(_pollTimer);clearTimeout(_timeoutTimer);clearInterval(_watchdogTimer);
    S.txChar=null;S.buf='';S.waiting=false;
    if(S.device?.gatt?.connected){try{S.device.gatt.disconnect();}catch(_){}}
    await sleep(500);
    if(S.device){const server=await S.device.gatt.connect();await _initAfterConnect(server,S.device);}
    else{S.conn='Disconnected';updateUI();}
  }catch(e){console.error('[WD reconnect]',e);S.conn='Disconnected';updateUI();}
  finally{_reconnecting=false;}
}
document.addEventListener('visibilitychange',()=>{
  if(document.visibilityState==='visible'){
    if(S.conn==='Connected'){_lastDataAt=Date.now();_consecutiveTimeouts=0;}
    requestWakeLock();
  }
});

// ═══════════════════════════════════════════
// DEBUG
// ═══════════════════════════════════════════
let _dbgLog='';
function dbg(msg){
  _dbgLog=msg+'\n'+_dbgLog;
  if(_dbgLog.length>1500) _dbgLog=_dbgLog.slice(0,1500);
  const el=document.getElementById('dbg-overlay');
  if(el&&el.classList.contains('show')) el.textContent=_dbgLog;
}
function toggleDbg(){
  const el=document.getElementById('dbg-overlay');
  el.classList.toggle('show');
  if(el.classList.contains('show')) el.textContent=_dbgLog;
}

function parseLine(pid,raw){
  const s=raw.replace(/[\s\r\n>]/g,'').toUpperCase();
  if(!s||NOISE.some(n=>s.includes(n))) return false;
  const hdr='4'+pid.slice(1);
  const idx=s.indexOf(hdr);
  if(idx<0) return false;
  const v=s.slice(idx+4);
  try{
    if(pid==='010C'&&v.length>=4){
      S.rpm=(parseInt(v.slice(0,2),16)*256+parseInt(v.slice(2,4),16))>>2;
      detectGear();computeInstHP();return true;
    }else if(pid==='010D'&&v.length>=2){
      S.speed=parseInt(v.slice(0,2),16);detectGear();return true;
    }else if(pid==='0105'&&v.length>=2){
      S.coolant=parseInt(v.slice(0,2),16)-40;return true;
    }else if(pid==='010F'&&v.length>=2){
      S.intake=parseInt(v.slice(0,2),16)-40;return true;
    }else if(pid==='010B'&&v.length>=2){
      const k=parseInt(v.slice(0,2),16);
      S.mapKpa=k;S.boost=(k-101.325)/98.0665;computeInstHP();return true;
    }else if(pid==='015C'&&v.length>=2){
      S.oilTemp=parseInt(v.slice(0,2),16)-40;return true;
    }else if(pid==='0111'&&v.length>=2){
      S.throttle=Math.round(parseInt(v.slice(0,2),16)/255*100);return true;
    }
  }catch(e){console.warn('[PARSE]',e);}
  return false;
}

function onConnBtn(){
  if(S.conn==='Connected'){
    S.polling=false;
    if(S.device?.gatt?.connected) S.device.gatt.disconnect();
  }else{openModal();}
}
function openModal(){document.getElementById('modal').classList.add('show');}
function closeModal(){document.getElementById('modal').classList.remove('show');}

// ═══════════════════════════════════════════
// PWA / Wake Lock
// ═══════════════════════════════════════════
if('serviceWorker' in navigator){
  navigator.serviceWorker.register('./sw.js')
    .then(()=>console.log('[PWA] SW registered'))
    .catch(e=>console.warn('[PWA] SW error',e));
}
let _wakeLock=null;
async function requestWakeLock(){
  if(!('wakeLock' in navigator)) return;
  try{_wakeLock=await navigator.wakeLock.request('screen');}
  catch(e){console.warn('[WakeLock]',e);}
}

// ═══════════════════════════════════════════
// 画面向き自動横化
// ═══════════════════════════════════════════
let _orientLocked=false;
async function tryLockLandscape(){
  if(_orientLocked) return;
  if(!screen.orientation?.lock) return;
  try{
    await screen.orientation.lock('landscape');
    _orientLocked=true;
  }catch(e){/* PWA未インストール時など → ユーザー操作起点で再試行 */}
}

// ═══════════════════════════════════════════
// EVENT BINDING (HTML から onclick を分離)
// ═══════════════════════════════════════════
function bindEvents(){
  document.getElementById('btn-cfg').addEventListener('click',openCfg);
  document.getElementById('btn-dbg').addEventListener('click',toggleDbg);
  document.getElementById('btn-conn').addEventListener('click',onConnBtn);
  document.getElementById('btn-cfg-save').addEventListener('click',saveCfg);
  document.getElementById('btn-cfg-reset').addEventListener('click',resetCfg);
  document.getElementById('btn-cfg-cancel').addEventListener('click',closeCfg);
  document.getElementById('btn-calib').addEventListener('click',calibrateG);
  document.getElementById('btn-picker-cancel').addEventListener('click',closePicker);
  document.getElementById('btn-scan').addEventListener('click',startBLE);
  document.getElementById('btn-cancel').addEventListener('click',closeModal);
  document.getElementById('btn-quick').addEventListener('click',quickConnect);
  document.getElementById('btn-quick-cancel').addEventListener('click',closeQuickModal);

  // モーダル背景クリックで閉じる
  document.getElementById('modal-picker').addEventListener('click',e=>{
    if(e.target.id==='modal-picker') closePicker();
  });

  // ピッカーの ✎ ボタン (動的生成パネル) はイベント委譲
  document.getElementById('main').addEventListener('click',e=>{
    const btn=e.target.closest('.edit-btn');
    if(btn){
      const slot=parseInt(btn.dataset.slot,10);
      if(!isNaN(slot)) openPicker(slot);
    }
  });

  // CFGモーダルの dotcount/gearcount 変更で行を再描画
  const dc=document.getElementById('cfg-dotcount');
  const gc=document.getElementById('cfg-gearcount');
  if(dc) dc.addEventListener('change',renderDotRows);
  if(gc) gc.addEventListener('change',renderGearRows);

  // ユーザー操作起点で画面向き再ロック試行
  ['click','touchstart'].forEach(ev=>{
    document.addEventListener(ev,tryLockLandscape,{capture:true,passive:true});
  });
}

// ═══════════════════════════════════════════
// SPLASH
// ═══════════════════════════════════════════
function showSplash(){
  const splash = document.createElement('div');
  splash.id = 'splash';
  Object.assign(splash.style, {
    position:'fixed', inset:'0', zIndex:'9999',
    background:'#000',
    display:'flex', flexDirection:'column',
    alignItems:'center', justifyContent:'center',
    gap:'12px',
    transition:'opacity 0.6s ease',
  });
  splash.innerHTML = `
    <div style="font-style:italic;font-weight:900;
      font-size:clamp(28px,6vw,56px);
      letter-spacing:0.12em;color:#ffffff;">藤井工藝</div>
    <div style="font-style:italic;font-weight:700;
      font-size:clamp(14px,2.8vw,26px);
      letter-spacing:0.3em;color:#00b4ff;">OBD DASH</div>
    <div style="font-size:clamp(9px,1.2vw,12px);
      letter-spacing:0.2em;color:#5a6068;margin-top:4px;">Ver.3</div>`;
  document.body.appendChild(splash);

  // 3秒後にフェードアウト → 削除
  setTimeout(()=>{
    splash.style.opacity = '0';
    setTimeout(()=>splash.remove(), 650);
  }, 3000);
}

// ═══════════════════════════════════════════
// INIT
// ═══════════════════════════════════════════
showSplash();
buildLeds();
applyBoostVisibility();
buildPanels();
recomputeActivePids();
updateUI();
setupGSensor();
requestWakeLock();
bindEvents();
tryLockLandscape();
setTimeout(checkAutoConnect,600);
