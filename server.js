/**
 * Cloud Cat Chat — No-Bubble + Keep-Alive
 * - 로그인 없이 방/닉네임
 * - 1:1, 초대링크 ?room=, 선택 키(비번)
 * - 읽음표시(1), 타이핑 표시, 이모지(입력창 삽입), 파일 전송, 이미지 라이트박스
 * - 말풍선 제거(No-Bubble), 자동 스크롤, Enter 전송
 * - 유휴 끊김 방지(socket.io 핑 튜닝 + 앱 레벨 keep-alive)
 */
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);

// 일부 프록시는 타임아웃이 짧다. 안전빵으로 여유를 준다.
server.headersTimeout = 65_000;
server.keepAliveTimeout = 61_000;

const io = new Server(server, {
  cors: { origin: '*' },
  serveClient: true,
  pingInterval: 10_000,   // 10s 마다 ping
  pingTimeout: 180_000,   // 3분까지 기다림
  maxHttpBufferSize: 8_000_000
});

const APP_VERSION = 'v-2025-09-21-cloud-cat-no-bubble-ka';
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
      /* CloudCat 컬러 */
      --sky-top:#0a1640; --sky-mid:#0f2b66; --sky-bot:#12386e;
      --cloud-1:rgba(255,255,255,.08); --cloud-2:rgba(200,225,255,.10);
      --ink:#e6f0ff; --muted:#9fb4d6;
      --them-text:#f2f6ff; --me-text:#d6f0ff;
      --header-h:58px;
      --card-bg:rgba(8,14,34,.74);
      --border:rgba(157,178,241,.18);
    }
    *{box-sizing:border-box}
    html,body{height:100%}
    body{
      margin:0;font-family:system-ui,-apple-system,Segoe UI,Roboto,"Noto Sans KR",Arial;
      color:var(--ink);
      background:
        radial-gradient(1000px 600px at 15% -10%, var(--cloud-1), transparent 60%),
        radial-gradient(900px 600px at 80% 0%, var(--cloud-2), transparent 55%),
        radial-gradient(1200px 700px at 50% 120%, rgba(180,210,255,.08), transparent 60%),
        linear-gradient(180deg,var(--sky-top),var(--sky-mid) 40%, var(--sky-bot));
      -webkit-font-smoothing:antialiased; -moz-osx-font-smoothing:grayscale;
    }
    .wrap{max-width:760px;margin:0 auto;min-height:100%;padding:0 12px}
    .card{
      height:100dvh; height:100svh;
      background:var(--card-bg);
      backdrop-filter:blur(10px) saturate(112%);
      border:1px solid var(--border);
      border-radius:24px; box-shadow:0 18px 60px rgba(6,10,26,.55), inset 0 0 0 1px rgba(255,255,255,.02);
      overflow:hidden; display:flex; flex-direction:column;
    }
    .appbar{height:var(--header-h);display:flex;align-items:center;justify-content:space-between;padding:0 16px;border-bottom:1px solid var(--border)}
    .brand{display:flex;gap:10px;align-items:center}
    .cat{width:36px;height:36px;border-radius:999px;background:linear-gradient(180deg,#60a5fa,#a78bfa);display:flex;align-items:center;justify-content:center;box-shadow:0 0 24px rgba(96,165,250,.35)}
    .title{font-weight:800;color:#c7d2fe}
    .subtitle{font-size:12px;color:var(--muted)}
    .status{font-size:12px;color:#8be0ff}

    .chat{flex:1;min-height:0;overflow:auto;background:
      linear-gradient(180deg, rgba(99,179,237,.08), rgba(167,139,250,.06) 40%, transparent 80%);
      padding:14px 14px 110px 14px}
    .divider{display:flex;align-items:center;gap:8px;margin:8px 0}
    .divider .line{height:1px;background:var(--border);flex:1}
    .divider .txt{font-size:12px;color:#a7c5ff;font-family:ui-serif, Georgia, serif}

    /* ===== 메시지 레이아웃 (No-Bubble) ===== */
    .msg{display:flex;gap:10px;margin:10px 0;align-items:flex-end}
    .msg.me{justify-content:flex-end}
    .avatar{width:32px;height:32px;border-radius:50%;background:linear-gradient(180deg,#60a5fa,#a78bfa);display:flex;align-items:center;justify-content:center;font-size:18px;box-shadow:0 6px 20px rgba(96,165,250,.28)}
    .msg.me .avatar{display:none}

    .stack{display:flex;flex-direction:column;max-width:60%}
    @media (max-width:480px){ .stack{max-width:80%} }

    .name{font-size:11px;opacity:.9;color:#bed3ff;margin:0 0 2px 6px}
    .msg.me .name{display:none}

    .time{font-size:10px;color:rgba(220,235,255,.8);align-self:flex-end;min-width:32px;text-align:center}
    .msg.me .time{margin-right:6px}
    .msg.them .time{margin-left:6px}
    .read{font-size:10px;color:rgba(220,235,255,.8);align-self:flex-end;margin-left:6px}

    .bubble{position:relative}
    .bubble .text{
      -webkit-font-smoothing:antialiased;
      -webkit-text-fill-color:currentColor;
      text-rendering:optimizeLegibility;
      word-break:break-word;
      line-height:1.24;
    }
    .me .bubble .text{ color:var(--me-text) }
    .them .bubble .text{ color:var(--them-text) }

    .bubble img{
      display:block;max-width:320px;height:auto;border-radius:12px;cursor:zoom-in;
      box-shadow:0 12px 28px rgba(8,12,26,.28)
    }

    /* ===== 입력줄 ===== */
    .inputbar{
      position:fixed;left:0;right:0;bottom:0;margin:0 auto;max-width:760px;
      background:rgba(6,12,26,.78);backdrop-filter:blur(10px) saturate(112%);
      border-top:1px solid var(--border);padding:10px
    }
    .inputrow{display:flex;gap:8px;align-items:center}
    .text{flex:1;border:1px solid var(--border);background:rgba(255,255,255,.06);color:#e5f0ff;border-radius:14px;padding:12px 12px;font:inherit}
    .btn{height:40px;padding:0 14px;border:none;border-radius:12px;font-weight:700;cursor:pointer}
    .btn-emoji{background:linear-gradient(180deg,#e879f9,#a78bfa);color:#111c3a}
    .btn-attach{background:#223154;color:#dbeafe}
    .btn-send{background:linear-gradient(180deg,#22d3ee,#60a5fa);color:#071226}

    /* ===== 설정 패널 ===== */
    .setup{padding:14px 14px 120px 14px;background:linear-gradient(180deg, rgba(167,139,250,.08), rgba(34,211,238,.06))}
    .panel{background:rgba(6,12,26,.74);border:1px solid var(--border);border-radius:16px;padding:14px}
    .label{display:block;margin:10px 0 6px;color:#d9e6ff}
    .field{width:100%;padding:10px;border:1px solid var(--border);border-radius:10px;font:inherit;background:rgba(255,255,255,.06);color:#e5e7eb}
    .row{display:flex;gap:8px;margin-top:12px}
    .link{font-size:12px;color:#a7c5ff}

    /* ===== 이모지 패널 ===== */
    .emoji-panel{
      position:fixed;left:0;right:0;bottom:60px;margin:0 auto;max-width:760px;
      background:rgba(6,12,26,.9);border:1px solid var(--border);border-bottom:none;border-radius:14px 14px 0 0;
      box-shadow:0 -8px 30px rgba(6,10,26,.55); color:#e5e7eb;
    }
    .emoji-tabs{display:flex;gap:8px;align-items:center;padding:8px 10px;border-bottom:1px solid var(--border);background:rgba(10,18,36,.9);border-radius:14px 14px 0 0}
    .emoji-tabs button{padding:6px 10px;border:1px solid rgba(167,139,250,.25);background:rgba(255,255,255,.06);color:#dbeafe;border-radius:8px;cursor:pointer}
    .emoji-tabs button.active{background:rgba(167,139,250,.25);border-color:#a78bfa;color:#fff}
    .emoji-tabs .combo{margin-left:auto;font-size:12px;color:#cbd5e1}
    .emoji{display:grid;grid-template-columns:repeat(10,1fr);gap:8px;padding:10px;max-height:240px;overflow:auto;background:rgba(11,18,36,.6)}
    .emoji button{font-size:20px;background:transparent;border:1px solid rgba(167,139,250,.18);border-radius:8px;cursor:pointer;padding:6px;color:#fff}
    .emoji button:hover{background:rgba(167,139,250,.18)}

    /* ===== 타이핑 플래그 ===== */
    .typing-flag{
      position:sticky; bottom:8px; left:0;
      display:none; align-items:center; gap:8px;
      background:rgba(8,12,26,.9);
      border:1px solid var(--border);
      padding:6px 10px; border-radius:12px; color:#e5e7eb;
      font-size:12px; box-shadow:0 8px 24px rgba(2,6,23,.5); max-width:70%;
    }
    .typing-flag .who{font-weight:600; color:#a7c5ff}
    .typing-flag .dots i{display:inline-block;width:4px;height:4px;background:#93a4c3;border-radius:50%;margin-left:3px;animation:dotBlink 1.2s infinite}
    .typing-flag .dots i:nth-child(2){animation-delay:.15s}
    .typing-flag .dots i:nth-child(3){animation-delay:.3s}
    @keyframes dotBlink{0%{opacity:.2}20%{opacity:1}100%{opacity:.2}}
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
            <div class="subtitle">구름위를 걷는 고양이 · ${APP_VERSION}</div>
          </div>
        </div>
        <div class="status" id="online">offline</div>
      </div>

      <div class="chat" id="chat">
        <div class="divider"><div class="line"></div><div class="txt">오늘</div><div class="line"></div></div>
      </div>

      <!-- 라이트박스 -->
      <div id="viewer" role="dialog" aria-modal="true" style="display:none;align-items:center;justify-content:center;background:rgba(1,3,10,.86);position:fixed;inset:0;z-index:50">
        <div id="viewerClose" title="닫기" style="position:absolute;top:16px;right:20px;font-size:26px;color:#e5e7eb;cursor:pointer">✕</div>
        <div class="box" style="max-width:92vw;max-height:92vh;border-radius:12px;overflow:hidden;background:#000"><img id="viewerImg" alt="" style="max-width:92vw;max-height:92vh;display:block"></div>
      </div>

      <!-- 이모지 패널 -->
      <div id="emojiPanel" class="emoji-panel" style="display:none">
        <div class="emoji-tabs">
          <button id="tabAnimals" class="active" type="button">동물</button>
          <button id="tabFeels" type="button">감정</button>
          <label class="combo"><input type="checkbox" id="comboMode"> 조합모드</label>
        </div>
        <div id="emojiGrid" class="emoji"></div>
      </div>

      <!-- 입력줄 -->
      <div class="inputbar" id="inputbar" style="display:none">
        <div class="inputrow">
          <input id="text" class="text" type="text" placeholder="메시지를 입력하세요" />
          <input id="file" type="file" style="display:none" accept="image/*,.pdf,.txt,.zip,.doc,.docx,.ppt,.pptx,.xls,.xlsx"/>
          <button id="attach" class="btn btn-attach" type="button">📎</button>
          <button id="emojiBtn" class="btn btn-emoji" type="button">😊</button>
          <button id="send" class="btn btn-send" type="button">보내기</button>
        </div>
        <div class="subtitle" style="margin-top:4px">Enter 전송 · 2MB 이하 첨부 지원</div>
      </div>

      <!-- 초기 설정 -->
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
          <div class="subtitle" id="status" style="margin-top:6px">대기</div>
        </div>
      </div>
    </div>
  </div>

  <script src="/socket.io/socket.io.js?v=${APP_VERSION}"></script>
  <script>
    var $ = function(s){ return document.querySelector(s); };
    var chatBox = $('#chat');
    var setup = $('#setup');
    var inputbar = $('#inputbar');

    // 라이트박스
    var viewer = $('#viewer'); var viewerImg = $('#viewerImg'); var viewerClose = $('#viewerClose');
    function openViewer(src, alt){ viewerImg.src = src; viewerImg.alt = alt || ''; viewer.style.display='flex'; }
    function closeViewer(){ viewer.style.display='none'; viewerImg.src=''; }
    viewer.addEventListener('click', function(e){ if(e.target===viewer) closeViewer(); });
    viewerClose.addEventListener('click', closeViewer);
    window.addEventListener('keydown', function(e){ if(e.key==='Escape') closeViewer(); });

    // 이모지
    var emojiPanel = $('#emojiPanel'), emojiGrid = $('#emojiGrid');
    var tabAnimals = $('#tabAnimals'), tabFeels = $('#tabFeels'), comboChk = $('#comboMode');

    // 입력/상태
    var roomInput = $('#room'), nickInput = $('#nick'), keyInput = $('#key');
    var invite = $('#invite'), statusTag = $('#status'), online = $('#online');
    var fileInput = $('#file'), textInput = $('#text');

    function setInviteLink(r){
      var url = new URL(window.location);
      url.searchParams.set('room', r);
      invite.textContent = url.toString();
    }
    $('#makeLink').onclick = function(){
      var r = (roomInput.value||'').trim();
      if(!r){ alert('방 코드를 입력하세요'); return; }
      setInviteLink(r);
    };

    function addSys(msg){
      var d = document.createElement('div'); d.className='sys'; d.textContent = msg; chatBox.appendChild(d); chatBox.scrollTop = chatBox.scrollHeight;
    }
    function fmt(ts){ var d=new Date(ts); var h=String(d.getHours()).padStart(2,'0'); var m=String(d.getMinutes()).padStart(2,'0'); return h+':'+m; }
    function esc(s){ return (s||'').toString().replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
    function genId(){ return 'm' + Date.now().toString(36) + Math.random().toString(36).slice(2,6); }

    // 읽음 처리
    var hasFocus = document.hasFocus();
    var visible = document.visibilityState === 'visible';
    function isAttended(){ return hasFocus && visible; }
    window.addEventListener('focus', function(){ hasFocus = true; rescanUnread(); });
    window.addEventListener('blur', function(){ hasFocus = false; });
    document.addEventListener('visibilitychange', function(){ visible = document.visibilityState === 'visible'; if (visible) rescanUnread(); });

    var readSent = new Set();
    function sendRead(id){
      if (!window.socket || readSent.has(id)) return;
      readSent.add(id);
      window.socket.emit('read', { room: myRoom, id: id });
    }

    var OBS_THRESHOLD = 0.75;
    var observer = new IntersectionObserver(function(entries){
      if (!isAttended()) return;
      entries.forEach(function(e){
        if (e.intersectionRatio >= OBS_THRESHOLD) {
          var id = e.target.getAttribute('data-mid');
          if (id && !readSent.has(id)) sendRead(id);
        }
      });
    }, { root: chatBox, threshold: [OBS_THRESHOLD] });

    function rescanUnread(){
      if (!isAttended()) return;
      document.querySelectorAll('.msg.them[data-mid]').forEach(function(el){
        var id = el.getAttribute('data-mid');
        if (!id || readSent.has(id)) return;
        observer.observe(el);
      });
    }

    // 타이핑 플래그
    var typingFlag = document.createElement('div');
    typingFlag.className = 'typing-flag';
    typingFlag.innerHTML = '<span class="who"></span> 입력 중 <span class="dots"><i></i><i></i><i></i></span>';
    var typingWho = typingFlag.querySelector('.who');
    var typingHideTimer = null;
    function showTyping(name){
      typingWho.textContent = name || '상대';
      typingFlag.style.display = 'inline-flex';
      chatBox.appendChild(typingFlag);
      clearTimeout(typingHideTimer);
      typingHideTimer = setTimeout(hideTyping, 1500);
    }
    function hideTyping(){ typingFlag.style.display = 'none'; }

    // 메시지 렌더러
    function makeStack(){ var s = document.createElement('div'); s.className = 'stack'; return s; }
    function addMsg(fromMe, name, text, ts, id){
      var row = document.createElement('div'); row.className = 'msg ' + (fromMe? 'me':'them');
      if(id) row.setAttribute('data-mid', id);

      if(!fromMe){
        var av = document.createElement('div'); av.className='avatar'; av.textContent = '🐾';
        row.appendChild(av);
      } else {
        var t = document.createElement('span'); t.className='time'; t.textContent = fmt(ts||Date.now()); row.appendChild(t);
      }

      var stack = makeStack();
      if(!fromMe){
        var nm = document.createElement('div'); nm.className='name'; nm.textContent = name || '상대';
        stack.appendChild(nm);
      }
      var b = document.createElement('div'); b.className='bubble';
      b.innerHTML = '<div class="text">' + esc(text) + '</div>';
      stack.appendChild(b);
      row.appendChild(stack);

      if(fromMe){
        var r = document.createElement('span'); r.className='read'; r.textContent='1'; row.appendChild(r);
      } else {
        var t2 = document.createElement('span'); t2.className='time'; t2.textContent = fmt(ts||Date.now()); row.appendChild(t2);
      }

      chatBox.appendChild(row); chatBox.scrollTop = chatBox.scrollHeight;
      chatBox.appendChild(typingFlag);
      if(!fromMe && id){ observer.observe(row); if(isAttended()) rescanUnread(); }
    }

    function humanSize(b){ if(b<1024) return b+' B'; if(b<1024*1024) return (b/1024).toFixed(1)+' KB'; return (b/1024/1024).toFixed(2)+' MB'; }
    function addFile(fromMe, name, file, id){
      var row = document.createElement('div'); row.className = 'msg ' + (fromMe? 'me':'them');
      if(id) row.setAttribute('data-mid', id);

      if(!fromMe){
        var av = document.createElement('div'); av.className='avatar'; av.textContent = '🐾';
        row.appendChild(av);
      } else {
        var t = document.createElement('span'); t.className='time'; t.textContent = fmt(file.ts||Date.now()); row.appendChild(t);
      }

      var stack = makeStack();
      if(!fromMe){
        var nm = document.createElement('div'); nm.className='name'; nm.textContent = name || '상대';
        stack.appendChild(nm);
      }

      var b = document.createElement('div'); b.className='bubble';
      if ((file.type||'').startsWith('image/')) {
        var img = document.createElement('img'); img.src = file.data; img.alt = file.name || 'image';
        img.addEventListener('click', function(){ openViewer(img.src, img.alt); });
        b.appendChild(img);
        var meta = document.createElement('div'); meta.className='att';
        meta.innerHTML = '<a href="' + file.data + '" download="' + esc(file.name||'image') + '">이미지 저장</a><span class="size"> ' + humanSize(file.size||0) + '</span>';
        b.appendChild(meta);
      } else {
        var meta2 = document.createElement('div'); meta2.className='att';
        meta2.innerHTML = '파일: <a href="' + file.data + '" download="' + esc(file.name||'file') + '">' + esc(file.name||'file') + '</a><span class="size"> ' + humanSize(file.size||0) + '</span>';
        b.appendChild(meta2);
      }
      stack.appendChild(b);
      row.appendChild(stack);

      if(fromMe){
        var r = document.createElement('span'); r.className='read'; r.textContent='1'; row.appendChild(r);
      } else {
        var t2 = document.createElement('span'); t2.className='time'; t2.textContent = fmt(file.ts||Date.now()); row.appendChild(t2);
      }

      chatBox.appendChild(row); chatBox.scrollTop = chatBox.scrollHeight;
      chatBox.appendChild(typingFlag);
      if(!fromMe && id){ observer.observe(row); if(isAttended()) rescanUnread(); }
    }

    // 이모지 데이터/삽입
    var animals = ['🐶','🐱','🐭','🐹','🐰','🦊','🐻','🐼','🐨','🐯','🦁','🐮','🐷','🐸','🐵','🐔','🐧','🐦','🐤','🦆','🦅','🦉','🦇','🐺','🐗','🐴','🦄','🐝','🦋','🐛','🐞','🦖','🦕','🐢','🐍','🦎','🐙','🦑','🦀','🦞','🦐','🐠','🐟','🐡','🐬','🐳','🐋','🐊','🦧','🦍','🦝','🦨','🦦','🦥','🦘','🦡','🦢','🦩','🦚','🦜'];
    var feelings = ['❤️','💖','💕','✨','🔥','🎉','🥳','👍','👏','🤝','🤗','💪','🙂','😊','😂','🤣','🥹','🥺','😡','😎','😱','😘','🤩','😴','😭'];
    var currentTab = 'animals', comboMode = false, pickedAnimal = null;

    function insertAtCursor(input, s){
      input.focus();
      var start = input.selectionStart || input.value.length;
      var end = input.selectionEnd || input.value.length;
      var before = input.value.slice(0,start);
      var after = input.value.slice(end);
      input.value = before + s + after;
      var pos = start + s.length;
      input.setSelectionRange(pos, pos);
    }
    function chooseEmoji(sym){
      if (comboMode){
        if (currentTab === 'animals'){ pickedAnimal = sym; currentTab = 'feelings'; setTabUI(); renderEmoji(); }
        else if (pickedAnimal){ insertAtCursor(textInput, pickedAnimal + sym); pickedAnimal = null; currentTab = 'animals'; setTabUI(); renderEmoji(); }
        else { insertAtCursor(textInput, sym); }
      } else { insertAtCursor(textInput, sym); }
    }
    function renderEmoji(){
      emojiGrid.innerHTML = '';
      var list = currentTab === 'animals' ? animals : feelings;
      for (var i=0;i<list.length;i++){
        var sym = list[i];
        var btn = document.createElement('button');
        btn.type = 'button'; btn.textContent = sym;
        btn.onclick = (function(s){ return function(){ chooseEmoji(s); }; })(sym);
        emojiGrid.appendChild(btn);
      }
    }
    function setTabUI(){ if(currentTab==='animals'){ tabAnimals.classList.add('active'); tabFeels.classList.remove('active'); } else { tabFeels.classList.add('active'); tabAnimals.classList.remove('active'); } }
    tabAnimals.onclick = function(){ currentTab='animals'; setTabUI(); renderEmoji(); };
    tabFeels.onclick = function(){ currentTab='feelings'; setTabUI(); renderEmoji(); };
    comboChk.onchange = function(){ comboMode = comboChk.checked; pickedAnimal = null; };
    setTabUI(); renderEmoji();

    // 소켓 연결
    var socket; var myNick; var myRoom; var joined=false; var typingTimerSend; var typingActive=false; var lastTypingSent=0; var joinGuard;
    var composing = false;
    var keepAliveTimer = null;

    function enableCreate(){ var b=document.querySelector('#create'); if(b) b.disabled=false; }
    function disableCreate(){ var b=document.querySelector('#create'); if(b) b.disabled=true; }

    document.querySelector('#create').onclick = function(){
      if (socket) return; disableCreate();
      var r = (roomInput.value || '').trim();
      var n = (nickInput.value || '').trim();
      var k = (keyInput.value || '').trim();
      if(!r || !n){ alert('방 코드와 닉네임을 입력하세요'); enableCreate(); return; }
      myNick = n; myRoom = r;

      socket = io({
        path:'/socket.io',
        transports:['websocket','polling'],
        forceNew:true,
        reconnection:true,
        reconnectionAttempts: Infinity,
        reconnectionDelay: 1000,
        reconnectionDelayMax: 5000,
        timeout: 15000
      });
      joinGuard = setTimeout(function(){ if(!joined){ enableCreate(); addSys('서버 응답 지연. 다시 시도하세요.'); } }, 16000);

      socket.on('connect', function(){ addSys('서버 연결됨'); online.textContent='online'; });
      socket.on('connect_error', function(err){ addSys('연결 실패: ' + (err && err.message ? err.message : err)); alert('연결 실패: ' + (err && err.message ? err.message : err)); enableCreate(); socket.close(); socket=null; });

      socket.emit('join', { room: r, nick: n, key: k });

      socket.on('joined', function(info){
        joined = true; clearTimeout(joinGuard);
        window.socket = socket; window.myRoom = myRoom; window.myNick = myNick;
        setInviteLink(myRoom);
        setup.style.display='none'; inputbar.style.display='block';
        addSys(info.msg);
        history.replaceState(null, '', '?room='+encodeURIComponent(myRoom)+'&nick='+encodeURIComponent(myNick));
        rescanUnread();

        // 앱 레벨 keep-alive: 10s마다 ka 전송
        if (keepAliveTimer) clearInterval(keepAliveTimer);
        keepAliveTimer = setInterval(function(){
          if (socket && socket.connected) socket.emit('ka', Date.now());
        }, 10_000);
      });

      socket.on('disconnect', function(reason){
        online.textContent='offline';
        if (keepAliveTimer) { clearInterval(keepAliveTimer); keepAliveTimer = null; }
        if(!joined) enableCreate();
        addSys('연결이 끊어졌습니다: ' + reason + ' (자동 재연결 시도)');
      });

      socket.on('join_error', function(err){ clearTimeout(joinGuard); addSys('입장 실패: ' + err); alert('입장 실패: ' + err); statusTag.textContent='거부됨'; enableCreate(); socket.disconnect(); socket=null; });

      socket.on('peer_joined', function(name){ addSys(name + ' 님이 입장했습니다'); });
      socket.on('peer_left', function(name){ addSys(name + ' 님이 퇴장했습니다'); });

      socket.on('msg', function(payload){ var id = payload.id; addMsg(false, payload.nick, payload.text, payload.ts, id); if (id && isAttended()) sendRead(id); });
      socket.on('file', function(p){ var id = p.id; addFile(false, p.nick, { name: p.name, type: p.type, size: p.size, data: p.data, ts: p.ts }, id); if (id && isAttended()) sendRead(id); });

      socket.on('read', function(p){ if (!p || !p.id) return; var row = document.querySelector('.msg.me[data-mid="'+p.id+'"]'); if (row){ var badge=row.querySelector('.read'); if(badge) badge.remove(); } });

      socket.on('typing', function(p){ if (p && p.state){ showTyping(p.nick || '상대'); } else { hideTyping(); } });

      // 서버의 ka 응답은 무시(데이터 흐름만 유지시키면 됨)
      socket.on('ka', function(){});
    };

    // 입력/전송/타이핑
    $('#send').onclick = sendMsg;

    textInput.addEventListener('compositionstart', function(){ composing = true; });
    textInput.addEventListener('compositionend', function(){ composing = false; });
    textInput.addEventListener('keydown', function(e){
      if ((e.key === 'Enter' || e.key === 'NumpadEnter') && !e.shiftKey) {
        if (!composing) { e.preventDefault(); sendMsg(); return; }
      }
      handleTyping();
    });
    textInput.addEventListener('input', handleTyping);
    textInput.addEventListener('blur', function(){ if(window.socket){ window.socket.emit('typing', { room: myRoom, state: 0 }); typingActive=false; } });

    function handleTyping(){
      if(!window.socket || !joined) return;
      var n = Date.now();
      if(!typingActive || n - lastTypingSent > 1000){
        window.socket.emit('typing', { room: myRoom, state: 1 });
        typingActive = true; lastTypingSent = n;
      }
      clearTimeout(typingTimerSend);
      typingTimerSend = setTimeout(function(){ if(window.socket){ window.socket.emit('typing', { room: myRoom, state: 0 }); typingActive=false; } }, 1500);
    }

    // 이모지 패널
    $('#emojiBtn').onclick = function(){ emojiPanel.style.display = (emojiPanel.style.display === 'none' ? 'block' : 'none'); };

    // 파일 전송
    $('#attach').onclick = function(){ fileInput.click(); };
    fileInput.onchange = function(){ var files = Array.from(fileInput.files||[]); files.forEach(function(f){ sendFile(f); }); fileInput.value = ''; };
    document.addEventListener('paste', function(e){
      if(!joined) return;
      var items = e.clipboardData && e.clipboardData.items ? Array.from(e.clipboardData.items) : [];
      items.forEach(function(it){ if (it.kind === 'file') { var f = it.getAsFile(); if (f) sendFile(f); } });
    });

    function sendMsg(){
      if(!window.socket){ addSys('연결되지 않음'); return; }
      var val = (textInput.value || '').trim(); if(!val) return;
      var id = genId();
      window.socket.emit('msg', { room: myRoom, id: id, text: val });
      addMsg(true, myNick, val, Date.now(), id);
      textInput.value = '';
      if(typingActive){ window.socket.emit('typing', { room: myRoom, state: 0 }); typingActive=false; }
    }

    var ALLOWED_TYPES = ['image/png','image/jpeg','image/webp','image/gif','application/pdf','text/plain','application/zip','application/vnd.openxmlformats-officedocument.wordprocessingml.document','application/msword','application/vnd.openxmlformats-officedocument.presentationml.presentation','application/vnd.ms-powerpoint','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','application/vnd.ms-excel'];
    var MAX_BYTES = 2_000_000;

    function sendFile(file){
      if (!file) return;
      if (file.size > MAX_BYTES) { addSys('파일이 너무 큽니다(최대 2MB).'); return; }
      if (ALLOWED_TYPES.indexOf(file.type) === -1 && !(file.type||'').startsWith('image/')) { addSys('허용되지 않은 파일 형식입니다.'); return; }
      var reader = new FileReader();
      reader.onload = function(){
        var dataUrl = reader.result;
        var id = genId();
        addFile(true, myNick, { name: file.name, type: file.type, size: file.size, data: dataUrl, ts: Date.now() }, id);
        window.socket.emit('file', { room: myRoom, id: id, name: file.name, type: file.type, size: file.size, data: dataUrl });
      };
      reader.readAsDataURL(file);
    }

    chatBox.addEventListener('scroll', function(){ if (isAttended()) rescanUnread(); });

    // URL Prefill
    var url = new URL(window.location);
    var r = url.searchParams.get('room');
    var n = url.searchParams.get('nick');
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

  // 파일
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

  // 타이핑 중계
  socket.on('typing', ({ room, state }) => {
    room = sanitize(room, 40);
    const nick = sanitize(socket.data.nick, 24) || '게스트';
    socket.to(room).emit('typing', { nick, state: !!state });
  });

  // 앱 레벨 keep-alive: 클라이언트가 보낸 ka 에 즉시 응답
  socket.on('ka', () => {
    socket.emit('ka', Date.now());
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
