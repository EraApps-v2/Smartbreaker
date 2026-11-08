import { supabaseClient } from './supabase-client.js';

const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
let breakerOn = true, toastTimer, tuyaConfigured = Boolean(supabaseClient), tuyaConnected = false, tuyaDeviceOnline = null, tuyaValues = null, availableDpCodes = [], commandPending = false, authSession = null, refreshPending = false, lastStatusAt = null, passwordRecoveryMode = new URLSearchParams(location.hash.slice(1)).get('type') === 'recovery', recoveryRequestMode = false;
const demo = {
  voltage: 220.4, current: 1.94, power: 428, energy: 4.82, tariff: 1444.70,
  week: [3.8,4.6,3.9,5.2,4.1,5.4,5.4],
  month: [3.2,4.1,3.8,5.1,4.6,4.2,5.3,3.9,4.8,5.1,4.3,5.5,4.9,3.8,4.5,5.2,4.6,5.4,4.1,5.0,3.7,4.8,5.2,4.4,5.3,4.0,4.6,5.1,4.2,5.4]
};
const storedTariff=localStorage.getItem('voltguardTariff');
const parsedStoredTariff=storedTariff===null?null:Number(storedTariff);
const savedTariff=parsedStoredTariff===1450||parsedStoredTariff===1444?demo.tariff:parsedStoredTariff;
let tariffRate=savedTariff===null?demo.tariff:savedTariff;
if(!Number.isFinite(tariffRate)||tariffRate<0)tariffRate=demo.tariff;
const dailyEnergyStorageKey='voltguardDailyEnergy';
let dailyEnergyRecord=null;
function localDateKey(date=new Date()){
  return [date.getFullYear(),String(date.getMonth()+1).padStart(2,'0'),String(date.getDate()).padStart(2,'0')].join('-');
}
function readDailyEnergyRecord(){
  try{
    const saved=localStorage.getItem(dailyEnergyStorageKey);
    if(!saved)return null;
    const record=JSON.parse(saved);
    if(!record||typeof record.date!=='string'||!Number.isFinite(record.lastCounter)||record.lastCounter<0||
      !Number.isFinite(record.usedKwh)||record.usedKwh<0)return null;
    return record;
  }catch(error){
    console.error('Catatan pemakaian harian tidak dapat dibaca.',error);
    return null;
  }
}
function updateDailyEnergy(counterKwh){
  if(!Number.isFinite(counterKwh)||counterKwh<0)return;
  const today=localDateKey();
  if(!dailyEnergyRecord||dailyEnergyRecord.date!==today){
    dailyEnergyRecord={date:today,lastCounter:counterKwh,usedKwh:0,startedAt:Date.now()};
  }else if(counterKwh>=dailyEnergyRecord.lastCounter){
    dailyEnergyRecord.usedKwh+=counterKwh-dailyEnergyRecord.lastCounter;
    dailyEnergyRecord.lastCounter=counterKwh;
  }else{
    dailyEnergyRecord.usedKwh+=counterKwh;
    dailyEnergyRecord.lastCounter=counterKwh;
  }
  try{
    localStorage.setItem(dailyEnergyStorageKey,JSON.stringify(dailyEnergyRecord));
  }catch(error){
    showToast(`Pemakaian harian tidak dapat disimpan: ${error.message}`);
  }
}
dailyEnergyRecord=readDailyEnergyRecord();
const historyStorageKey='voltguardDemoHistory';
function makeInitialDemoHistory(){
  return Array.from({length:7},(_,i)=>{
    const date=new Date();
    date.setDate(date.getDate()-i);
    const id=[date.getFullYear(),String(date.getMonth()+1).padStart(2,'0'),String(date.getDate()).padStart(2,'0')].join('-');
    const energy=demo.week[6-i];
    return {id,energy,avg:Math.round(energy*1000/24)};
  });
}
function loadDemoHistory(){
  const saved=localStorage.getItem(historyStorageKey);
  if(saved===null){
    const initial=makeInitialDemoHistory();
    localStorage.setItem(historyStorageKey,JSON.stringify(initial));
    return initial;
  }
  try{
    const entries=JSON.parse(saved);
    if(!Array.isArray(entries))throw new Error('Format riwayat tidak valid.');
    return entries.filter(entry=>
      entry&&/^\d{4}-\d{2}-\d{2}$/.test(entry.id)&&
      Number.isFinite(entry.energy)&&entry.energy>=0&&
      Number.isFinite(entry.avg)&&entry.avg>=0
    );
  }catch(error){
    console.error('Riwayat demo tidak dapat dibaca.',error);
    showToast('Riwayat demo rusak dan tidak dapat dimuat.');
    return [];
  }
}
let demoHistory=loadDemoHistory();
function saveDemoHistory(){
  try{
    localStorage.setItem(historyStorageKey,JSON.stringify(demoHistory));
    return true;
  }catch(error){
    showToast(`Riwayat tidak dapat disimpan: ${error.message}`);
    return false;
  }
}
function showToast(message){const el=$('#toast');el.textContent=message;el.classList.add('show');clearTimeout(toastTimer);toastTimer=setTimeout(()=>el.classList.remove('show'),3200)}
function rupiah(n,digits=0){return Number(n).toLocaleString('id-ID',{minimumFractionDigits:digits,maximumFractionDigits:digits})}
function renderState(){
  const liveData=tuyaConnected&&tuyaDeviceOnline!==false;
  const stateKnown=(tuyaConnected&&tuyaDeviceOnline!==false)||!tuyaConfigured;
  const value=(key,demoValue,digits=0)=>liveData
    ?(tuyaValues?.[key]===null||tuyaValues?.[key]===undefined?'—':Number(tuyaValues[key]).toFixed(digits))
    :tuyaConfigured?'—':Number(demoValue).toFixed(digits);
  const visibleState=stateKnown?(breakerOn?'ON':'OFF'):'—';
  $('#breakerStatusText').textContent=stateKnown?(breakerOn?'MENYALA':'MATI'):'TIDAK DIKETAHUI';
  $('#ringState').textContent=visibleState;
  $('#switchLabel').textContent=stateKnown?(breakerOn?'Aktif':'Tidak aktif'):'Tidak diketahui';
  $('#switchUpdated').textContent=tuyaDeviceOnline===false?'Perangkat offline':liveData&&lastStatusAt?`Diperbarui ${lastStatusAt.toLocaleTimeString('id-ID')}`:tuyaConfigured?'Menunggu koneksi':'Data simulasi';
  $('#breakerStatusBadge').style.background=stateKnown?(breakerOn?'#e7fbf3':'#fff0e9'):'#fff6dc';
  $('#breakerStatusBadge').style.color=stateKnown?(breakerOn?'#0e9c6f':'#d36a4b'):'#977414';
  $('.ring').style.background=!stateKnown?'conic-gradient(#d9b84c 0 20%,#f7f0d8 20% 100%)':breakerOn?'conic-gradient(#18c58f 0 78%,#dff5ed 78% 100%)':'conic-gradient(#d36a4b 0 20%,#f8e8e2 20% 100%)';
  $('#powerValue').textContent=stateKnown&&tuyaConnected&&!breakerOn?'0':value('power',demo.power);
  $('#currentValue').textContent=stateKnown&&tuyaConnected&&!breakerOn?'0.00':value('current',demo.current,2);
  $('#voltageValue').textContent=value('voltage',demo.voltage,1);
  $('#temperatureValue').textContent=value('temperature',24.9,1);
  const dailyKwh=liveData
    ?(dailyEnergyRecord?.date===localDateKey()?dailyEnergyRecord.usedKwh:null)
    :tuyaConfigured?null:demo.energy;
  $('#energyValue').textContent=dailyKwh==null?'—':Number(dailyKwh).toFixed(2);
  $('#costValue').textContent=dailyKwh==null?'—':rupiah(dailyKwh*tariffRate,2);
  const energyNote=$('#dailyEnergyNote');
  if(energyNote){
    energyNote.textContent=liveData&&dailyEnergyRecord?.date===localDateKey()
      ?`Dihitung sejak ${new Date(dailyEnergyRecord.startedAt||Date.now()).toLocaleTimeString('id-ID',{hour:'2-digit',minute:'2-digit'})}`
      :liveData?'Menunggu data energi':tuyaConfigured?'Data belum tersedia':'Data simulasi';
  }
  $('#deviceSubtext').textContent=`${tuyaConnected?'Tuya':tuyaConfigured?'Tuya offline':'Mode demo'} · status ${visibleState}`;
  $('#demoTag').textContent=tuyaConnected?'TUYA LIVE':tuyaConfigured?'OFFLINE':'SIMULASI';
  $('#quickControlNote').textContent=tuyaConnected?'Kontrol fisik aktif melalui Tuya':tuyaConfigured?'Menunggu koneksi Tuya; tombol dinonaktifkan':'Kontrol fisik belum diaktifkan';
  const missingMetrics=tuyaValues&&['voltage','current','power','energy'].some(key=>tuyaValues[key]===null||tuyaValues[key]===undefined);
  $('#metricsSubtext').textContent=tuyaConnected
    ?tuyaDeviceOnline===false?'Perangkat offline; data live tidak tersedia'
      :missingMetrics?`Kode DP metrik belum cocok. DP Tuya: ${availableDpCodes.slice(0,12).join(', ')||'tidak ada'}`:'Data langsung dari perangkat'
    :tuyaConfigured?'Data belum tersedia saat breaker offline':'Nilai contoh untuk pratinjau desain';
  $('#quickOn').classList.toggle('selected',stateKnown&&breakerOn);
  $('#quickOff').classList.toggle('selected',stateKnown&&!breakerOn);
  $('#deviceDetailText').textContent=tuyaConnected&&tuyaDeviceOnline===false
    ?'Cloud Tuya terjangkau, tetapi perangkat melaporkan offline. Data dan kontrol dinonaktifkan.'
    :tuyaConnected?'Breaker terhubung. Status dibaca langsung dari Tuya.'
    :tuyaConfigured?'Breaker belum terhubung. Periksa konfigurasi dan koneksi backend.'
      :'Perangkat belum ditautkan; informasi yang tampil adalah data simulasi.';
  $('#deviceDetailStatus').textContent=tuyaConnected?(tuyaDeviceOnline===false?'● Perangkat offline':'● Terhubung'):tuyaConfigured?'● Offline':'● Mode demo';
  $('#deviceDetailApi').textContent=tuyaConnected&&tuyaDeviceOnline!==false?'Kontrol aktif':tuyaConfigured?'Kontrol nonaktif':'API belum dikonfigurasi';
  $('#safetyNote').textContent=tuyaConnected&&tuyaDeviceOnline!==false
    ?'Kontrol terhubung ke Tuya. Pastikan breaker yang benar; aplikasi ini bukan sarana pemutus darurat.'
    :tuyaConnected&&tuyaDeviceOnline===false?'Perangkat Tuya offline. Data dapat kedaluwarsa dan kontrol dinonaktifkan.'
      :tuyaConfigured?'Status breaker tidak tersedia. Kontrol dinonaktifkan sampai koneksi pulih.'
      :'Pratinjau simulasi. Hubungkan backend Tuya untuk mengaktifkan kontrol fisik.';
  updateControls();
}
function updateConnection(){
  const online=tuyaConnected&&tuyaDeviceOnline!==false;
  $('#connectionTitle').textContent=tuyaConnected&&tuyaDeviceOnline===false?'Perangkat Tuya offline':online?'Terhubung ke Tuya':tuyaConfigured?'Tuya belum tersambung':'Mode demo';
  $('#connectionSubtext').textContent=online?'Pembaruan otomatis tiap 3 detik':tuyaConnected?'API terhubung; perangkat offline':tuyaConfigured?'Periksa koneksi backend dan akun Tuya':'Belum terhubung ke Tuya';
  $('#deviceConnectionStatus').textContent=online?'Online':tuyaConnected?'Perangkat offline':tuyaConfigured?'Offline':'Demo';
  $('#liveStatus').textContent=online?'TUYA LIVE':tuyaConnected?'DEVICE OFFLINE':tuyaConfigured?'TUYA OFFLINE':'DEMO DATA';
  updateControls();
}
function updateControls(){
  const disabled=!tuyaConnected||tuyaDeviceOnline===false||commandPending;
  ['#onBtn','#offBtn','#quickOn','#quickOff'].forEach(selector=>{
    const button=$(selector);
    if(button)button.disabled=disabled;
  });
}
function updateAuthUi(){
  const loginPanel=$('#cloudLogin');
  const isHosted=httpsLocation();
  const hideAuthPanel=!supabaseClient||Boolean(authSession)&&!passwordRecoveryMode;
  if(loginPanel)loginPanel.classList.toggle('hidden',isHosted?hideAuthPanel:!supabaseClient||Boolean(authSession));
  $('#loginForm')?.classList.toggle('hidden',!supabaseClient||Boolean(authSession)||passwordRecoveryMode||recoveryRequestMode);
  $('#recoveryRequestForm')?.classList.toggle('hidden',!supabaseClient||Boolean(authSession)||passwordRecoveryMode||!recoveryRequestMode);
  $('#passwordRecoveryForm')?.classList.toggle('hidden',!supabaseClient||!passwordRecoveryMode);
  const configMessage=$('#cloudConfigMessage');
  if(configMessage)configMessage.classList.toggle('hidden',!isHosted||Boolean(supabaseClient));
  const logoutButton=$('#logoutBtn');
  if(logoutButton)logoutButton.classList.toggle('hidden',!supabaseClient||!authSession);
}
function httpsLocation(){
  return location.protocol==='https:'&&!['localhost','127.0.0.1'].includes(location.hostname);
}
function applyUserSettings(session){
  const saved=session?.user?.user_metadata?.voltguard_tariff;
  const value=Number(saved);
  if(saved!==undefined&&Number.isFinite(value)&&value>=0)tariffRate=value;
  $('#tariffInput').value=String(tariffRate);
  renderState();
  renderHistory();
}
async function callTuya(action, details={}){
  if(supabaseClient){
    if(!authSession)throw new Error('Silakan login untuk mengakses perangkat.');
    const {data,error}=await supabaseClient.functions.invoke('voltguard',{body:{action,...details}});
    if(error){
      let message=error.message||'Permintaan ke backend Supabase gagal.';
      try{
        const response=error.context;
        if(response?.json){const body=await response.json();message=body.error||message}
      }catch{}
      throw new Error(message);
    }
    return data;
  }
  const response=await fetch(action==='status'?'/api/status':'/api/switch',{
    method:action==='status'?'GET':'POST',
    headers:action==='status'?{}:{'content-type':'application/json'},
    body:action==='status'?undefined:JSON.stringify(details)
  });
  const data=await response.json();
  if(!response.ok)throw new Error(data.error||'Permintaan Tuya gagal.');
  return data;
}
async function refreshTuya(showFeedback=false){
  if(refreshPending)return false;
  if(supabaseClient&&!authSession)return false;
  refreshPending=true;
  try{
    if(!supabaseClient){
      const configResponse=await fetch('/api/config');
      const configData=await configResponse.json();
      if(!configResponse.ok)throw new Error(configData.error||'Backend tidak dapat dihubungi.');
      tuyaConfigured=configData.configured===true;
    }
    if(!tuyaConfigured){tuyaConnected=false;tuyaValues=null;updateConnection();renderState();if(showFeedback)showToast('Backend Tuya belum dikonfigurasi. Kontrol fisik belum aktif.');return false}
    const data=await callTuya('status');
    if(typeof data.breakerOn!=='boolean')throw new Error('Status sakelar Tuya tidak dikenali. Periksa kode DP.');
    breakerOn=data.breakerOn;tuyaDeviceOnline=data.deviceOnline??null;tuyaValues=data.values||null;availableDpCodes=Array.isArray(data.availableDpCodes)?data.availableDpCodes:[];tuyaConnected=true;lastStatusAt=new Date();
    if(tuyaDeviceOnline!==false&&tuyaValues?.energy!==null&&tuyaValues?.energy!==undefined)updateDailyEnergy(Number(tuyaValues.energy));
    renderState();updateConnection();
    if(showFeedback)showToast('Status Tuya berhasil diperbarui.');
    return true;
  }catch(error){
    if(tuyaConfigured){tuyaConnected=false;updateConnection();renderState()}
    if(showFeedback)showToast(error.message);
    return false;
  }finally{
    refreshPending=false;
  }
}
function renderBars(period='week'){
  const vals=demo[period], labels=period==='week'?['Sen','Sel','Rab','Kam','Jum','Sab','Min']:vals.map((_,i)=>`${i+1}`);
  const max=Math.max(...vals);
  $('#barChart').innerHTML=vals.map((v,i)=>`<div class="bar-col"><div class="bar" title="${v.toFixed(1)} kWh" style="height:${Math.max(8,v/max*100)}%"></div><span class="bar-label">${labels[i]}</span></div>`).join('');
  const total=vals.reduce((a,b)=>a+b,0);
  $('#weekTotal').textContent=`${total.toLocaleString('id-ID',{maximumFractionDigits:1})} kWh`;
}
function renderHistory(){
  const rows=demoHistory.map(entry=>{
    const date=new Date(`${entry.id}T12:00:00`);
    return {...entry,date:date.toLocaleDateString('id-ID',{day:'2-digit',month:'short',year:'numeric'}),cost:entry.energy*tariffRate};
  });
  $('#historyTable').innerHTML=rows.length
    ?rows.map(r=>`<tr><td><b>${r.date}</b></td><td>${r.energy.toFixed(2)} kWh</td><td>${r.avg} W</td><td>Rp ${rupiah(r.cost)}</td><td><span class="table-status">Data demo</span></td><td><button class="delete-history-btn" type="button" data-delete-history="${r.id}" aria-label="Hapus riwayat ${r.date}">Hapus</button></td></tr>`).join('')
    :'<tr><td class="empty-history" colspan="6">Semua riwayat demo sudah dihapus.</td></tr>';
  $('#clearDemoHistoryBtn').disabled=rows.length===0;
}
function deleteDemoHistory(id){
  const previous=demoHistory;
  demoHistory=demoHistory.filter(entry=>entry.id!==id);
  if(!saveDemoHistory()){demoHistory=previous;return}
  renderHistory();
}
function setPage(name){
  ['overview','history','devices'].forEach(p=>$('#'+p+'Page').classList.toggle('hidden',p!==name));
  $$('.nav-item').forEach(b=>b.classList.toggle('active',b.dataset.page===name));
  $('#pageTitle').textContent=({overview:'Dashboard energi',history:'Riwayat energi',devices:'Perangkat'})[name];
  $('.sidebar').classList.remove('open');
}
function requestToggle(on){
  if(!tuyaConnected){showToast('Kontrol fisik belum aktif. Hubungkan backend Tuya dan pastikan status perangkat terbaca.');return}
  if(tuyaDeviceOnline===false){showToast('Perangkat Tuya offline. Kontrol dinonaktifkan.');return}
  if(on===breakerOn){showToast(`Breaker ${tuyaConnected?'Tuya':'demo'} sudah ${on?'ON':'OFF'}.`);return}
  $('#modalTitle').textContent=on?'Nyalakan breaker?':'Matikan breaker?';
  $('#modalText').textContent=on
    ?'Perintah ini akan dikirim ke breaker melalui Tuya. Pastikan perangkat yang benar dipilih.'
    :'Perintah ini akan mematikan breaker melalui Tuya. Jangan mengandalkan aplikasi ini sebagai satu-satunya sarana pemutus darurat.';
  $('#confirmAction').textContent=on?'Ya, nyalakan':'Ya, matikan';
  $('#confirmAction').dataset.next=on?'on':'off';
  $('#confirmModal').classList.remove('hidden');
}
$('#cancelModal').addEventListener('click',()=>$('#confirmModal').classList.add('hidden'));
$('#confirmModal').addEventListener('click',e=>{if(e.target.id==='confirmModal')$('#confirmModal').classList.add('hidden')});
$('#confirmAction').addEventListener('click',async()=>{
  const on=$('#confirmAction').dataset.next==='on';
  const button=$('#confirmAction');
  commandPending=true;button.disabled=true;updateControls();
  try{
    if(!tuyaConnected)throw new Error('Breaker tidak terhubung. Perintah tidak dikirim.');
    await callTuya('switch',{on});
    $('#confirmModal').classList.add('hidden');
    const refreshed=await refreshTuya(false);
    showToast(refreshed?'Perintah diterima Tuya. Status perangkat diperbarui.':'Perintah diterima Tuya, tetapi status terbaru belum terbaca.');
  }catch(error){showToast(error.message)}
  finally{commandPending=false;button.disabled=false;updateControls()}
});
$('#onBtn').addEventListener('click',()=>requestToggle(true));
$('#offBtn').addEventListener('click',()=>requestToggle(false));
$('#refreshBtn').addEventListener('click',()=>refreshTuya(true));
$('#periodSelect').addEventListener('change',e=>renderBars(e.target.value));
$$('.nav-item').forEach(b=>b.addEventListener('click',()=>setPage(b.dataset.page)));
$$('[data-goto]').forEach(b=>b.addEventListener('click',()=>setPage(b.dataset.goto)));
$('#menuBtn').addEventListener('click',()=>$('.sidebar').classList.toggle('open'));
$('#setupBtn').addEventListener('click',()=>$('.setup-panel').scrollIntoView({behavior:'smooth'}));
$('#exportBtn').addEventListener('click',()=>{
  const rows=[['Tanggal','Energi_kWh','Rata-rata_daya_W','Estimasi_biaya_Rp','Sumber']];
  demoHistory.forEach(entry=>{const d=new Date(`${entry.id}T12:00:00`);rows.push([d.toLocaleDateString('id-ID'),entry.energy.toFixed(2),entry.avg,Math.round(entry.energy*tariffRate),'SIMULASI'])});
  const csv=rows.map(r=>r.join(',')).join('\r\n');const blob=new Blob(['\ufeff'+csv],{type:'text/csv;charset=utf-8;'});const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download='riwayat-energi-demo.csv';a.click();URL.revokeObjectURL(a.href);
});
$('#historyTable').addEventListener('click',event=>{
  const button=event.target.closest('[data-delete-history]');
  if(button)deleteDemoHistory(button.dataset.deleteHistory);
});
$('#clearDemoHistoryBtn').addEventListener('click',()=>{
  if(!demoHistory.length)return;
  if(!window.confirm('Hapus semua riwayat demo? Tindakan ini tidak dapat dibatalkan.'))return;
  const previous=demoHistory;
  demoHistory=[];
  if(!saveDemoHistory())demoHistory=previous;
  renderHistory();
});
$('#todayDate').textContent=new Date().toLocaleDateString('id-ID',{weekday:'short',day:'numeric',month:'short',year:'numeric'});
$('#tariffInput').value=String(tariffRate);
$('#tariffInput').addEventListener('change',event=>{
  const value=Number(event.target.value);
  if(event.target.value===''||!Number.isFinite(value)||value<0){
    event.target.value=String(tariffRate);
    showToast('Tarif harus berupa angka nol atau lebih.');
    return;
  }
  const previous=tariffRate;
  tariffRate=value;
  renderState();
  renderHistory();
  if(supabaseClient&&authSession){
    (async()=>{
      try{
        const {data,error}=await supabaseClient.auth.updateUser({
          data:{...authSession.user.user_metadata,voltguard_tariff:tariffRate}
        });
      if(error){
        tariffRate=previous;
        event.target.value=String(previous);
        renderState();renderHistory();
        showToast(`Tarif tidak tersimpan: ${error.message}`);
      }else if(data.user){
        authSession={...authSession,user:data.user};
      }
      }catch(error){
        tariffRate=previous;
        event.target.value=String(previous);
        renderState();renderHistory();
        showToast(`Tarif tidak tersimpan: ${error.message}`);
      }
    })();
  }else{
    localStorage.setItem('voltguardTariff',String(tariffRate));
  }
});
renderState();renderBars();renderHistory();updateConnection();refreshTuya(false);
if('serviceWorker' in navigator && location.protocol.startsWith('http')) navigator.serviceWorker.register('sw.js').catch(()=>{});

$('#quickOn').addEventListener('click',()=>requestToggle(true));
$('#quickOff').addEventListener('click',()=>requestToggle(false));
$('#loginForm')?.addEventListener('submit',async event=>{
  event.preventDefault();
  const submit=$('#loginSubmit');
  const message=$('#loginMessage');
  submit.disabled=true;
  message.textContent='Menghubungkan...';
  try{
    const {error}=await supabaseClient.auth.signInWithPassword({
      email:$('#loginEmail').value.trim(),
      password:$('#loginPassword').value
    });
    if(error)throw error;
    $('#loginPassword').value='';
    message.textContent='';
  }catch(error){
    message.textContent=error.message?.toLowerCase().includes('invalid login credentials')
      ?'Email atau kata sandi tidak cocok. Gunakan “Lupa kata sandi?” untuk membuat kata sandi baru.'
      :error.message||'Login gagal. Periksa email dan kata sandi.';
  }finally{
    submit.disabled=false;
  }
});
$('#forgotPasswordBtn')?.addEventListener('click',()=>{
  recoveryRequestMode=true;
  $('#recoveryEmail').value=$('#loginEmail').value.trim();
  $('#recoveryMessage').textContent='';
  updateAuthUi();
});
$('#backToLoginBtn')?.addEventListener('click',()=>{
  recoveryRequestMode=false;
  updateAuthUi();
});
$('#recoveryRequestForm')?.addEventListener('submit',async event=>{
  event.preventDefault();
  const submit=$('#recoverySubmit');
  const message=$('#recoveryMessage');
  submit.disabled=true;
  message.textContent='Mengirim tautan pemulihan...';
  try{
    const {error}=await supabaseClient.auth.resetPasswordForEmail($('#recoveryEmail').value.trim(),{
      redirectTo:`${location.origin}${location.pathname}`
    });
    if(error)throw error;
    message.textContent='Jika email terdaftar, tautan pemulihan akan dikirim. Periksa kotak masuk dan folder spam.';
  }catch(error){
    message.textContent=`Gagal mengirim tautan pemulihan: ${error.message}`;
  }finally{
    submit.disabled=false;
  }
});
$('#passwordRecoveryForm')?.addEventListener('submit',async event=>{
  event.preventDefault();
  const submit=$('#passwordRecoverySubmit');
  const message=$('#passwordRecoveryMessage');
  const password=$('#newPassword').value;
  if(password!==$('#confirmNewPassword').value){
    message.textContent='Konfirmasi kata sandi tidak sama.';
    return;
  }
  submit.disabled=true;
  message.textContent='Menyimpan kata sandi baru...';
  try{
    const {error}=await supabaseClient.auth.updateUser({password});
    if(error)throw error;
    $('#newPassword').value='';
    $('#confirmNewPassword').value='';
    passwordRecoveryMode=false;
    recoveryRequestMode=false;
    message.textContent='Kata sandi berhasil diperbarui. Anda sudah masuk ke dashboard.';
    updateAuthUi();
  }catch(error){
    message.textContent=`Gagal memperbarui kata sandi: ${error.message}`;
  }finally{
    submit.disabled=false;
  }
});
$('#logoutBtn')?.addEventListener('click',async()=>{
  const {error}=await supabaseClient.auth.signOut();
  if(error)showToast(`Gagal logout: ${error.message}`);
});
renderState();
updateAuthUi();
if(supabaseClient){
  const {data:{session},error}=await supabaseClient.auth.getSession();
  if(error)showToast(`Gagal memeriksa sesi login: ${error.message}`);
  authSession=session;
  applyUserSettings(authSession);
  updateAuthUi();
  if(authSession)refreshTuya(false);
  supabaseClient.auth.onAuthStateChange((event,nextSession)=>{
    if(event==='PASSWORD_RECOVERY')passwordRecoveryMode=true;
    authSession=nextSession;
    applyUserSettings(authSession);
    tuyaConnected=false;
    tuyaDeviceOnline=null;
    tuyaValues=null;
    updateAuthUi();updateConnection();renderState();
    if(authSession)setTimeout(()=>refreshTuya(false),0);
  });
}
setInterval(()=>{if(document.visibilityState==='visible')refreshTuya(false)},3000);
