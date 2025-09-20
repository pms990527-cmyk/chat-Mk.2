/**
 * Cloud Cat 1:1 Chat — Node.js + Socket.IO
 * - 테마/이모티콘/첨부 유지
 * - 레이아웃: 뷰포트 고정, 채팅은 스크롤 박스
 * - 읽음 표시(현실적 정의):
 *    상대 탭이 visible + 창 focus + 해당 메시지 버블이 채팅 뷰포트에 충분히 보일 때(read) 전송
 *    → 내 메시지 옆 '1' 제거
 */
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*' },
  serveClient: true,
  pingTimeout: 25000,
  pingInterval: 20000,
  maxHttpBufferSize: 8_000_000
});

// ---- In-memory rooms ----
const rooms = new Map();
function getRoom(roomId) {
  if (!rooms.has(roomId)) rooms.set(roomId, { key: null, users: new Set(), lastMsgs: [] });
  return rooms.get(roomId);
}
function sanitize(str, max = 200) {
  if (typeof str !== 'string') return '';
  return str.replace(/[<>]/g, '').slice(0, max);
}
function now() { return Date.now(); }
function isThrottled(room, socketId, limit = 8, windowMs = 10_000) {
  const t = now();
  room.lastMsgs = room.lastMsgs.filter(m => t - m.t < windowMs);
  const count = room.lastMsgs.reduce((acc, m) => acc + (m.from === socketId ? 1 : 0), 0);
  return count >= limit;
}

const APP_VERSION = "v-2025-09-21-12";

app.get('/healthz', (_, res) => res.status(200).type('text/plain').send('ok'));

app.get('/', (req, res) => {
  const { room = '', nick = '' } = req.query;
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.end(`<!doctype html>
<html lang="ko">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Cloud Cat Chat</title>
  <style>
    :root{
      --sky-50:#f0f9ff; --sky-100:#e0f2fe; --sky-200:#bae6fd; --sky-300:#7dd3fc; --sky-400:#38bdf8;
      --ink:#0f172a; --muted:#64748b; --white:#ffffff; --header-h:58px;
    }
    *{box-sizing:border-box}
    html,body{height:100%}
    body{margin:0;font-family:system-ui,-apple-system,Segoe UI,Roboto,Noto Sans KR,Arial;background:linear-gradient(180deg,var(--sky-100),var(--white));color:var(--ink)}
    .wrap{max-width:720px;margin:0 auto;min-height:100%;padding:0 12px}

    .card{
      height:100dvh; height:100svh;
      background:rgba(255,255,255,.85);
      backdrop-filter:blur(6px);
      border:1px solid rgba(14,165,233,.12);
      border-radius:24px;
      box-shadow:0 12px 40px rgba(2,6,23,.08);
      overflow:hidden;
      display:flex; flex-direction:column;
    }

    .appbar{height:var(--header-h);display:flex;align-items:center;justify-content:space-between;padding:0 16px;background:rgba(255,255,255,.9);border-bottom:1px solid rgba(14,165,233,.18)}
    .brand{display:flex;gap:10px;align-items:center}
    .cat{width:36px;height:36px;border-radius:999px;background:var(--sky-200);display:flex;align-items:center;justify-content:center}
    .title{font-weight:800;color:#0284c7}
    .subtitle{font-size:12px;color:var(--muted);font-family:ui-serif, Georgia, serif}
    .status{display:flex;gap:6px;align-items:center;color:#0284c7;font-size:12px;font-family:ui-serif, Georgia, serif}

    .chat{flex:1; min-height:0; overflow:auto;
      background:linear-gradient(180deg,var(--sky-50),var(--white));
      padding:14px 14px 110px 14px}
    .divider{display:flex;align-items:center;gap:8px;margin:8px 0}
    .divider .line{height:1px;background:rgba(14,165,233,.35);flex:1}
    .divider .txt{font-size:12px;color:#0ea5e9;font-family:ui-serif, Georgia, serif}

    .msg{display:flex;gap:8px;margin:8px 0;align-items:flex-end}
    .msg.me{justify-content:flex-end}
    .avatar{width:32px;height:32px;border-radius:50%;background:var(--sky-200);display:flex;align-items:center;justify-content:center;font-size:13px}
    .msg.me .avatar{display:none}

    .bubble{max-width:76%;padding:10px 12px;border-radius:18px;line-height:1.45;word-break:break-word;background-clip:padding-box; position:relative}
    .them .bubble{background:var(--white);border:1px solid var(--sky-200);color:#075985}
    .me .bubble{background:var(--sky-400);color:#f8fafc;border:0;outline:none;box-shadow:0 8px 24px rgba(2,132,199,.25)}

    .time{font-size:10px;color:#94a3b8;align-self:flex-end;min-width:34px;text-align:center;opacity:.9}
    .msg.me .time{margin-right:6px}
    .msg.them .time{margin-left:6px}

    .read{font-size:10px;color:#94a3b8;align-self:flex-end;margin-left:6px;opacity:.95}

    .bubble, .bubble * { -webkit-text-stroke:0 !important; text-shadow:none !important; -webkit-font-smoothing:antialiased !important; -moz-osx-font-smoothing:grayscale !important; mix-blend-mode:normal !important; }

    .bubble img{display:block;max-width:280px;height:auto;border-radius:12px}
    .att{margin-top:6px;font-size:12px}
    .att a{color:#0ea5e9;text-decoration:none;word-break:break-all}
    .att .size{color:#64748b;margin-left:6px}

    .inputbar{position:fixed;left:0;right:0;bottom:0;margin:0 auto;max-width:720px;background:rgba(255,255,255,.92);backdrop-filter:blur(6px);border-top:1px solid rgba(14,165,233,.18);padding:10px}
    .inputrow{display:flex;gap:8px;align-items:center}
    .text{flex:1;border:1px solid var(--sky-200);border-radius:14px;padding:12px 12px;font:inherit}
    .btn{height:40px;padding:0 14px;border:none;border-radius:12px;font-weight:700;cursor:pointer}
    .btn-emoji{background:var(--sky-200);color:#0c4a6e}
    .btn-attach{background:#e2e8f0;color:#0f172a}
    .btn-send{background:var(--sky-400);color:#fff}

    .setup{padding:14px 14px 120px 14px;background:linear-gradient(180deg,var(--sky-50),var(--white))}
    .panel{background:#fff;border:1px solid rgba(14,165,233,.18);border-radius:16px;padding:14px}
    .label{display:block;margin:10px 0 6px}
    .field{width:100%;padding:10px;border:1px solid var(--sky-200);border-radius:10px;font:inherit}
    .row{display:flex;gap:8px;margin-top:12px}
    .link{font-size:12px;color:#0ea5e9}

    .emoji-panel{position:fixed;left:0;right:0;bottom:60px;margin:0 auto;max-width:720px;background:var(--sky-50);border:1px solid rgba(14,165,233,.18);border-bottom:none;border-radius:14px 14px 0 0;box-shadow:0 -6px 24px rgba(2,6,23,.06);}
    .emoji-tabs{display:flex;gap:8px;align-items:center;padding:8px 10px;border-bottom:1px solid rgba(14,165,233,.18);background:#fff;border-radius:14px 14px 0 0}
    .emoji-tabs button{padding:6px 10px;border:1px solid rgba(2,6,23,.08);background:#f8fafc;border-radius:8px;cursor:pointer}
    .emoji-tabs button.active{background:#fff;border-color:#0284c7;color:#0284c7}
    .emoji-tabs .combo{margin-left:auto;font-size:12px;color:#64748b}

    .emoji{display:grid;grid-template-columns:repeat(10,1fr);gap:8px;padding:10px;max-height:240px;overflow:auto;background:var(--sky-50)}
    .emoji button{font-size:20px;background:transparent;border:1px solid rgba(2,6,23,.06);border-radius:8px;cursor:pointer;padding:6px}
    .emoji button:hover{background:#fff}
  </style>
</head>
<body>
  <div class="wrap">
    <div class="card">
      <div class="appbar">
        <div class="brand">
          <div class="cat">🐱</div>
          <div>
            <div class="title">Cloud Cat Chat</div>
            <div class="subtitle">구름 위를 걷는 고양이 테마 · v ${APP_VERSION}</div>
          </div>
        </div>
        <div class="status"><span>☁️</span><span id="online">offline</span></div>
      </div>

      <div class="chat" id="chat">
        <div class="divider"><div class="line"></div><div class="txt">오늘</div><div class="line"></div></div>
      </div>

      <div id="emojiPanel" class="emoji-panel" style="display:none">
        <div class="emoji-tabs">
          <button id="tabAnimals" class="active" type="button">동물</button>
          <button id="tabFeels" type="button">감정</button>
          <label class="combo"><input type="checkbox" id="comboMode"> 조합모드</label>
        </div>
        <div id="emojiGrid" class="emoji"></div>
      </div>

      <div class="inputbar" id="inputbar" style="display:none">
        <div class="inputrow">
          <input id="text" class="text" type="text" placeholder="구름 속 고양이에게 말을 걸어보세요..." />
          <input id="file" type="file" style="display:none" accept="image/*,.pdf,.txt,.zip,.doc,.docx,.ppt,.pptx,.xls,.xlsx"/>
          <button id="attach" class="btn btn-attach" type="button">📎</button>
          <button id="emojiBtn" class="btn btn-emoji" type="button">😊</button>
          <button id="send" class="btn btn-send" type="button">야옹!</button>
        </div>
        <div class="subtitle" style="margin-top:4px">Enter 전송 · 2MB 이하 첨부 지원</div>
      </div>

      <div id="setup" class="setup">
        <div class="panel">
          <label class="label">대화방 코드</label>
          <input id="room" class="field" type="text" placeholder="예: myroom123" value="${room}" />
          <label class="label">닉네임</label>
          <input id="nick" class="field" type="text" placeholder="예: 민성" value="${nick}" />
          <label class="label">방 키 (선택)</label>
          <input id="key" class="field" type="password" placeholder="비밀번호" />
          <div class="row">
            <button id="create" class="btn btn-send" type="button">입장</button>
            <button id="makeLink" class="btn btn-emoji" type="button">초대 링크</button>
          </div>
          <div class="link" style="margin-top:6px">Invite link: <span id="invite"></span></div>
          <div class="subtitle" id="typing" style="min-height:16px;margin-top:6px"></div>
          <div class="subtitle" id="status" style="margin-top:6px">대기</div>
        </div>
      </div>
    </div>
  </div>

  <script src="/socket.io/socket.io.js?v=${APP_VERSION}"></script>
  <script>
    const $ = (s)=>document.querySelector(s);
    const chatBox = $('#chat');
    const setup = $('#setup');
    const inputbar = $('#inputbar');

    const emojiPanel = $('#emojiPanel');
    const emojiGrid = $('#emojiGrid');
    const tabAnimals = $('#tabAnimals');
    const tabFeels = $('#tabFeels');
    const comboChk = $('#comboMode');

    const roomInput = $('#room');
    const nickInput = $('#nick');
    const keyInput = $('#key');
    const invite = $('#invite');
    const statusTag = $('#status');
    const typing = $('#typing');
    const online = $('#online');
    const fileInput = $('#file');

    function setInviteLink(r){
      const url = new URL(window.location);
      url.searchParams.set('room', r);
      invite.textContent = url.toString();
    }
    $('#makeLink').onclick = () => {
      const r = roomInput.value.trim();
      if(!r){ alert('방 코드를 입력하세요'); return; }
      setInviteLink(r);
    };

    function addSys(msg){
      const d = document.createElement('div'); d.className='sys'; d.textContent = msg; chatBox.appendChild(d); chatBox.scrollTop = chatBox.scrollHeight;
    }
    function fmt(ts){ const d=new Date(ts); const h=String(d.getHours()).padStart(2,'0'); const m=String(d.getMinutes()).padStart(2,'0'); return h+':'+m; }
    function esc(s){ return (s||'').toString().replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
    function initial(n){ n=(n||'').trim(); return n? n[0].toUpperCase(): '?'; }
    function humanSize(b){ if(b<1024) return b+' B'; if(b<1024*1024) return (b/1024).toFixed(1)+' KB'; return (b/1024/1024).toFixed(2)+' MB'; }

    // ---- 읽음 로직을 위한 유틸 ----
    function genId(){ return 'm' + Date.now().toString(36) + Math.random().toString(36).slice(2,6); }

    let hasFocus = document.hasFocus();
    let visible = document.visibilityState === 'visible';
    function isAttended(){ return hasFocus && visible; }

    window.addEventListener('focus', ()=>{ hasFocus = true; rescanUnread(); });
    window.addEventListener('blur', ()=>{ hasFocus = false; });
    document.addEventListener('visibilitychange', ()=>{
      visible = document.visibilityState === 'visible';
      if (visible) rescanUnread();
    });

    const readSent = new Set();   // 이미 read 보낸 id
    function sendRead(id){
      if (!window.socket || readSent.has(id)) return;
      readSent.add(id);
      window.socket.emit('read', { room: myRoom, id });
    }

    // 채팅 뷰포트 안에서 "충분히 보이는지" 검사
    const OBS_THRESHOLD = 0.75;
    const observer = new IntersectionObserver((entries)=>{
      if (!isAttended()) return;
      entries.forEach(e=>{
        if (e.intersectionRatio >= OBS_THRESHOLD) {
          const id = e.target.getAttribute('data-mid');
          if (id && !readSent.has(id)) sendRead(id);
        }
      });
    }, { root: chatBox, threshold: [OBS_THRESHOLD] });

    function rescanUnread(){
      if (!isAttended()) return;
      // 현재 DOM에 있는 '상대 메시지' 중 미확인 것들을 관찰
      document.querySelectorAll('.msg.them[data-mid]').forEach(el=>{
        const id = el.getAttribute('data-mid');
        if (!id || readSent.has(id)) return;
        observer.observe(el);
        // 바로 보이는 상태라면 observer 콜백이 곧 실행됨
      });
    }

    // ---- 렌더러 ----
    function addMsg(fromMe, name, text, ts, id){
      const row = document.createElement('div'); row.className = 'msg ' + (fromMe? 'me':'them');
      if(id) row.setAttribute('data-mid', id);
      if(!fromMe){ const av = document.createElement('div'); av.className='avatar'; av.textContent = initial(name); row.appendChild(av); }
      if(fromMe){ const t = document.createElement('span'); t.className='time'; t.textContent = fmt(ts||Date.now()); row.appendChild(t); }
      const b = document.createElement('div'); b.className='bubble';
      b.innerHTML = '<div class="text">' + esc(text) + '</div>';
      row.appendChild(b);
      if(fromMe){
        const r = document.createElement('span'); r.className='read'; r.textContent='1'; row.appendChild(r);
      } else {
        const t2 = document.createElement('span'); t2.className='time'; t2.textContent = fmt(ts||Date.now()); row.appendChild(t2);
      }
      chatBox.appendChild(row); chatBox.scrollTop = chatBox.scrollHeight;

      // 상대 메시지는 관찰 시작
      if(!fromMe && id){ observer.observe(row); if(isAttended()) rescanUnread(); }
    }

    function addFile(fromMe, name, file, id){
      const row = document.createElement('div'); row.className = 'msg ' + (fromMe? 'me':'them');
      if(id) row.setAttribute('data-mid', id);
      if(!fromMe){ const av = document.createElement('div'); av.className='avatar'; av.textContent = initial(name); row.appendChild(av); }
      if(fromMe){ const t = document.createElement('span'); t.className='time'; t.textContent = fmt(file.ts||Date.now()); row.appendChild(t); }
      const b = document.createElement('div'); b.className='bubble';
      if ((file.type||'').startsWith('image/')) {
        const img = document.createElement('img'); img.src = file.data; img.alt = file.name || 'image';
        b.appendChild(img);
        const meta = document.createElement('div'); meta.className='att';
        meta.innerHTML = '<a href="' + file.data + '" download="' + esc(file.name||'image') + '">이미지 저장</a><span class="size">' + humanSize(file.size||0) + '</span>';
        b.appendChild(meta);
      } else {
        const meta = document.createElement('div'); meta.className='att';
        meta.innerHTML = '파일: <a href="' + file.data + '" download="' + esc(file.name||'file') + '">' + esc(file.name||'file') + '</a><span class="size">' + humanSize(file.size||0) + '</span>';
        b.appendChild(meta);
      }
      row.appendChild(b);
      if(fromMe){
        const r = document.createElement('span'); r.className='read'; r.textContent='1'; row.appendChild(r);
      } else {
        const t2 = document.createElement('span'); t2.className='time'; t2.textContent = fmt(file.ts||Date.now()); row.appendChild(t2);
      }
      chatBox.appendChild(row); chatBox.scrollTop = chatBox.scrollHeight;

      if(!fromMe && id){ observer.observe(row); if(isAttended()) rescanUnread(); }
    }

    // ---- 이모지 ----
    const animals = ['🐶','🐱','🐭','🐹','🐰','🦊','🐻','🐼','🐨','🐯','🦁','🐮','🐷','🐸','🐵','🐔','🐧','🐦','🐤','🦆','🦅','🦉','🦇','🐺','🐗','🐴','🦄','🐝','🦋','🐛','🐞','🦖','🦕','🐢','🐍','🦎','🐙','🦑','🦀','🦞','🦐','🐠','🐟','🐡','🐬','🐳','🐋','🐊','🦧','🦍','🦝','🦨','🦦','🦥','🦘','🦡','🦢','🦩','🦚','🦜'];
    const feelings = ['❤️','💖','💕','✨','🔥','🎉','🥳','👍','👏','🤝','🤗','💪','🙂','😊','😂','🤣','🥹','🥺','😡','😎','😱','😘','🤩','😴','😭'];
    let currentTab = 'animals';
    let comboMode = false;
    let pickedAnimal = null;

    function sendEmoji(sym){
      if(!window.socket || !window.myRoom) return;
      const id = genId();
      window.socket.emit('msg', { room: window.myRoom, id: id, text: sym });
      addMsg(true, window.myNick, sym, Date.now(), id);
      emojiPanel.style.display = 'none';
      pickedAnimal = null; currentTab = 'animals'; setTabUI(); renderEmoji();
    }

    function renderEmoji(){
      emojiGrid.innerHTML = '';
      const list = currentTab === 'animals' ? animals : feelings;
      for (var i=0;i<list.length;i++){
        var sym = list[i];
        var btn = document.createElement('button');
        btn.type = 'button'; btn.textContent = sym;
        btn.onclick = (function(s){ return function(){
          if(comboMode){
            if(currentTab==='animals'){ pickedAnimal = s; currentTab='feelings'; setTabUI(); renderEmoji(); }
            else if(pickedAnimal){ sendEmoji(pickedAnimal + s); }
            else { sendEmoji(s); }
          } else { sendEmoji(s); }
        }; })(sym);
        emojiGrid.appendChild(btn);
      }
    }
    function setTabUI(){ if(currentTab==='animals'){ tabAnimals.classList.add('active'); tabFeels.classList.remove('active'); } else { tabFeels.classList.add('active'); tabAnimals.classList.remove('active'); } }
    tabAnimals.onclick = ()=>{ currentTab='animals'; setTabUI(); renderEmoji(); };
    tabFeels.onclick = ()=>{ currentTab='feelings'; setTabUI(); renderEmoji(); };
    comboChk.onchange = ()=>{ comboMode = comboChk.checked; pickedAnimal = null; };
    setTabUI(); renderEmoji();

    // ---- 소켓/입장/전송 ----
    let socket; let myNick; let myRoom; let joined=false; let typingTimer; let joinGuard;

    function enableCreate(){ const b=document.querySelector('#create'); if(b) b.disabled=false; }
    function disableCreate(){ const b=document.querySelector('#create'); if(b) b.disabled=true; }

    document.querySelector('#create').onclick = () => {
      if (socket) return; disableCreate();
      const r = (roomInput.value || '').trim();
      const n = (nickInput.value || '').trim();
      const k = (keyInput.value || '').trim();
      if(!r || !n){ alert('방 코드와 닉네임을 입력하세요'); enableCreate(); return; }
      myNick = n; myRoom = r;

      socket = io({ path:'/socket.io', transports:['websocket','polling'], forceNew:true, reconnection:true, reconnectionAttempts:5, timeout:10000 });
      joinGuard = setTimeout(()=>{ if(!joined){ enableCreate(); addSys('서버 응답 지연. 다시 시도하세요.'); } }, 12000);

      socket.on('connect', ()=> addSys('서버 연결됨'));
      socket.on('connect_error', (err)=>{ addSys('연결 실패: ' + (err && err.message ? err.message : err)); alert('연결 실패: ' + (err && err.message ? err.message : err)); enableCreate(); socket.close(); socket=null; });

      socket.emit('join', { room: r, nick: n, key: k });

      socket.on('joined', (info)=>{
        joined = true; clearTimeout(joinGuard); online.textContent = 'online';
        window.socket = socket; window.myRoom = myRoom; window.myNick = myNick;
        setInviteLink(myRoom);
        setup.style.display='none'; inputbar.style.display='block';
        addSys(info.msg);
        history.replaceState(null, '', '?room='+encodeURIComponent(myRoom)+'&nick='+encodeURIComponent(myNick));
        rescanUnread();
      });

      socket.on('join_error', (err)=>{ clearTimeout(joinGuard); addSys('입장 실패: ' + err); alert('입장 실패: ' + err); statusTag.textContent='거부됨'; enableCreate(); socket.disconnect(); socket=null; });
      socket.on('disconnect', (reason)=> { if(!joined) enableCreate(); addSys('연결이 끊어졌습니다: ' + reason); });

      socket.on('peer_joined', (name)=> addSys(name + ' 님이 입장했습니다'));
      socket.on('peer_left', (name)=> addSys(name + ' 님이 퇴장했습니다'));

      socket.on('msg', ({ id, nick, text, ts }) => { addMsg(false, nick, text, ts, id); if (id && isAttended()) sendRead(id); });
      socket.on('file', ({ id, nick, name, type, size, data, ts }) => { addFile(false, nick, { name, type, size, data, ts }, id); if (id && isAttended()) sendRead(id); });

      socket.on('read', ({ id }) => { if (!id) return; const row = document.querySelector('.msg.me[data-mid="'+id+'"]'); if (row){ const badge=row.querySelector('.read'); if(badge) badge.remove(); } });

      socket.on('typing', (name)=>{ typing.textContent = name + ' 입력 중...'; clearTimeout(typingTimer); typingTimer = setTimeout(()=> typing.textContent = '', 1200); });
      socket.on('info', (m)=> addSys(m));
    };

    document.querySelector('#send').onclick = sendMsg;
    document.querySelector('#text').addEventListener('keydown', (e)=>{
      if(e.key==='Enter') sendMsg();
      else if(['Shift','Alt','Control','Meta'].includes(e.key)===false && joined && window.socket) window.socket.emit('typing', myRoom);
    });

    document.querySelector('#emojiBtn').onclick = () => { emojiPanel.style.display = (emojiPanel.style.display === 'none' ? 'block' : 'none'); };

    document.querySelector('#attach').onclick = () => fileInput.click();
    fileInput.onchange = () => { const files = Array.from(fileInput.files||[]); files.forEach(f => sendFile(f)); fileInput.value = ''; };

    document.addEventListener('paste', (e)=>{ if(!joined) return; const items = e.clipboardData && e.clipboardData.items ? Array.from(e.clipboardData.items) : []; items.forEach(it => { if (it.kind === 'file') { const f = it.getAsFile(); if (f) sendFile(f); } }); });

    function sendMsg(){
      if(!window.socket){ addSys('연결되지 않음'); return; }
      const input = document.querySelector('#text');
      const val = (input.value || '').trim(); if(!val) return;
      const id = genId();
      window.socket.emit('msg', { room: myRoom, id: id, text: val });
      addMsg(true, myNick, val, Date.now(), id);
      input.value = '';
    }

    const ALLOWED_TYPES = ['image/png','image/jpeg','image/webp','image/gif','application/pdf','text/plain','application/zip','application/vnd.openxmlformats-officedocument.wordprocessingml.document','application/msword','application/vnd.openxmlformats-officedocument.presentationml.presentation','application/vnd.ms-powerpoint','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','application/vnd.ms-excel'];
    const MAX_BYTES = 2_000_000;

    function sendFile(file){
      if (!file) return;
      if (file.size > MAX_BYTES) { addSys('파일이 너무 큽니다(최대 2MB).'); return; }
      if (!ALLOWED_TYPES.includes(file.type) && !file.type.startsWith('image/')) { addSys('허용되지 않은 파일 형식입니다.'); return; }
      const reader = new FileReader();
      reader.onload = () => {
        const dataUrl = reader.result;
        const id = genId();
        addFile(true, myNick, { name: file.name, type: file.type, size: file.size, data: dataUrl, ts: Date.now() }, id);
        window.socket.emit('file', { room: myRoom, id: id, name: file.name, type: file.type, size: file.size, data: dataUrl });
      };
      reader.readAsDataURL(file);
    }

    // 사용자가 스크롤로 메시지를 화면에 올려놓았을 때도 관찰 반응하도록
    chatBox.addEventListener('scroll', ()=> { if (isAttended()) rescanUnread(); });

    // URL prefill
    const url = new URL(window.location);
    const r = url.searchParams.get('room');
    const n = url.searchParams.get('nick');
    if(r){ roomInput.value = r; setInviteLink(r); }
    if(n){ nickInput.value = n; }
  </script>
</body>
</html>`);
});

io.on('connection', (socket) => {
  socket.on('join', ({ room, nick, key }) => {
    room = sanitize(room, 40);
    nick = sanitize(nick, 24);
    key = sanitize(key, 50);
    if (!room || !nick) return socket.emit('join_error', '잘못된 파라미터');

    const r = getRoom(room);
    if (r.users.size >= 2) return socket.emit('join_error', '이 방은 최대 2명만 입장할 수 있어요');

    if (r.users.size === 0) {
      if (key) r.key = key;
    } else {
      if (r.key && key !== r.key) return socket.emit('join_error', '방 키가 일치하지 않습니다');
      if (!r.key && key) return socket.emit('join_error', '이미 만들어진 방에는 키를 새로 설정할 수 없어요');
    }

    socket.data.nick = nick;
    socket.data.room = room;

    socket.join(room);
    r.users.add(socket.id);

    socket.emit('joined', { msg: nick + ' 님, ' + room + ' 방에 입장했습니다' + (r.key ? ' (키 적용됨)' : '') });
    socket.to(room).emit('peer_joined', nick);
  });

  socket.on('msg', ({ room, id, text }) => {
    room = sanitize(room, 40);
    id = sanitize(id, 64);
    const r = rooms.get(room);
    if (!r) return;
    const nick = sanitize(socket.data.nick, 24) || '게스트';
    text = sanitize(text, 2000);

    if (isThrottled(r, socket.id)) return socket.emit('info', '메시지가 너무 빠릅니다. 잠시 후 다시 시도하세요.');

    r.lastMsgs.push({ t: now(), from: socket.id });
    socket.to(room).emit('msg', { id, nick, text, ts: now() });
  });

  const ALLOWED_TYPES = new Set(['image/png','image/jpeg','image/webp','image/gif','application/pdf','text/plain','application/zip','application/vnd.openxmlformats-officedocument.wordprocessingml.document','application/msword','application/vnd.openxmlformats-officedocument.presentationml.presentation','application/vnd.ms-powerpoint','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','application/vnd.ms-excel']);
  const MAX_BYTES = 2_000_000;
  const MAX_DATAURL = 7_000_000;

  socket.on('file', ({ room, id, name, type, size, data }) => {
    room = sanitize(room, 40);
    id = sanitize(id, 64);
    const r = rooms.get(room);
    if (!r) return;
    const nick = sanitize(socket.data.nick, 24) || '게스트';
    name = sanitize(name, 140);
    type = sanitize(type, 100);
    size = Number(size) || 0;

    if (size > MAX_BYTES) return socket.emit('info', '파일이 너무 큽니다(최대 2MB).');
    if (!(ALLOWED_TYPES.has(type) || (type||'').startsWith('image/'))) return socket.emit('info', '허용되지 않은 파일 형식입니다.');
    if (typeof data !== 'string' || data.slice(0,5) !== 'data:' || data.length > MAX_DATAURL) return socket.emit('info', '파일 데이터가 올바르지 않습니다.');
    if (isThrottled(r, socket.id, 5, 15_000)) return socket.emit('info', '전송이 너무 빠릅니다. 잠시 후 다시 시도하세요.');

    socket.to(room).emit('file', { id, nick, name, type, size, data, ts: now() });
  });

  // 읽음 중계
  socket.on('read', ({ room, id }) => {
    room = sanitize(room, 40);
    id = sanitize(id, 64);
    if (!room || !id) return;
    socket.to(room).emit('read', { id });
  });

  socket.on('typing', (room) => {
    room = sanitize(room, 40);
    const r = rooms.get(room);
    if (!r) return;
    const nick = sanitize(socket.data.nick, 24) || '게스트';
    socket.to(room).emit('typing', nick);
  });

  socket.on('disconnect', () => {
    const room = socket.data.room;
    const nick = socket.data.nick;
    if (room && rooms.has(room)) {
      const r = rooms.get(room);
      r.users.delete(socket.id);
      socket.to(room).emit('peer_left', nick || '게스트');
      if (r.users.size === 0) rooms.delete(room);
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log('1:1 chat running on http://localhost:' + PORT);
});
