/**
 * Mini 1:1 Chat — Node.js + Socket.IO
 * UI: Cloud Cat theme (inspired by the user's CloudCatChat.tsx)
 * - Sky gradient, cloud header, white vs sky bubbles, emoji picker, sticky input bar
 * - No nested backticks in client JS (safe for server template string)
 */
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*' },
  maxHttpBufferSize: 1e6
});

// ---- In-memory rooms ----
const rooms = new Map();
function getRoom(roomId) {
  if (!rooms.has(roomId)) {
    rooms.set(roomId, { key: null, users: new Set(), lastMsgs: [] });
  }
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

const APP_VERSION = "v-2025-09-21-05";

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
      --sky-500:#0ea5e9; --ink:#0f172a; --muted:#64748b; --white:#ffffff; --bg:#e6f1fb;
      --header-h:58px;
    }
    *{box-sizing:border-box}
    html,body{height:100%}
    body{margin:0;font-family:system-ui,-apple-system,Segoe UI,Roboto,Noto Sans KR,Arial;background:linear-gradient(180deg,var(--sky-100),var(--white));color:var(--ink)}
    .wrap{max-width:720px;margin:0 auto;min-height:100%;padding:0 12px}
    .card{min-height:100vh;background:rgba(255,255,255,.85);backdrop-filter:blur(6px);border:1px solid rgba(14,165,233,.12);border-radius:24px;box-shadow:0 12px 40px rgba(2,6,23,.08);overflow:hidden;display:flex;flex-direction:column}

    /* Header */
    .appbar{height:var(--header-h);display:flex;align-items:center;justify-content:space-between;padding:0 16px;background:rgba(255,255,255,.9);border-bottom:1px solid rgba(14,165,233,.18)}
    .brand{display:flex;gap:10px;align-items:center}
    .cat{width:36px;height:36px;border-radius:999px;background:var(--sky-200);display:flex;align-items:center;justify-content:center}
    .title{font-weight:800;color:var(--sky-600, #0284c7)}
    .subtitle{font-size:12px;color:var(--muted);font-family:ui-serif, Georgia, serif}
    .status{display:flex;gap:6px;align-items:center;color:var(--sky-600,#0284c7);font-size:12px;font-family:ui-serif, Georgia, serif}

    /* Chat area */
    .chat{flex:1;overflow:auto;background:linear-gradient(180deg,var(--sky-50),var(--white));padding:14px 14px 110px 14px}
    .divider{display:flex;align-items:center;gap:8px;margin:8px 0}
    .divider .line{height:1px;background:rgba(14,165,233,.35);flex:1}
    .divider .txt{font-size:12px;color:#0ea5e9;font-family:ui-serif, Georgia, serif}

    /* Message row */
    .msg{display:flex;gap:8px;margin:8px 0;align-items:flex-end}
    .msg.me{justify-content:flex-end}
    .avatar{width:32px;height:32px;border-radius:50%;background:var(--sky-200);display:flex;align-items:center;justify-content:center;font-size:13px}
    .msg.me .avatar{display:none}

    .bubble{max-width:76%;padding:10px 12px;border-radius:18px;line-height:1.45;word-break:break-word}
    .meta{font-size:10px;margin-top:4px;font-family:ui-serif, Georgia, serif}

    .them .bubble{background:var(--white);border:1px solid var(--sky-200);color:#075985}
    .them .meta{color:#38bdf8}

    .me .bubble{background:var(--sky-400);color:#fff;box-shadow:0 4px 18px rgba(56,189,248,.35)}
    .me .meta{color:#dbeafe}

    /* Input area */
    .inputbar{position:fixed;left:0;right:0;bottom:0;margin:0 auto;max-width:720px;background:rgba(255,255,255,.92);backdrop-filter:blur(6px);border-top:1px solid rgba(14,165,233,.18);padding:10px}
    .inputrow{display:flex;gap:8px;align-items:center}
    .text{flex:1;border:1px solid var(--sky-200);border-radius:14px;padding:12px 12px;font:inherit}
    .btn{height:40px;padding:0 14px;border:none;border-radius:12px;font-weight:700;cursor:pointer}
    .btn-emoji{background:var(--sky-200);color:#0c4a6e}
    .btn-send{background:var(--sky-400);color:#fff}

    /* Setup panel */
    .setup{padding:14px 14px 120px 14px;background:linear-gradient(180deg,var(--sky-50),var(--white))}
    .panel{background:#fff;border:1px solid rgba(14,165,233,.18);border-radius:16px;padding:14px}
    .label{display:block;margin:10px 0 6px}
    .field{width:100%;padding:10px;border:1px solid var(--sky-200);border-radius:10px;font:inherit}
    .row{display:flex;gap:8px;margin-top:12px}
    .link{font-size:12px;color:#0ea5e9}

    /* Emoji picker */
    .emoji{display:grid;grid-template-columns:repeat(10,1fr);gap:8px;padding:8px 10px;max-height:220px;overflow:auto;border-top:1px solid rgba(14,165,233,.18);background:var(--sky-50)}
    .emoji button{font-size:20px;background:transparent;border:none;cursor:pointer}
      /* time badge outside bubbles */
    .time{font-size:10px;color:#94a3b8;align-self:flex-end;min-width:34px;text-align:center;opacity:.9}
    .msg.me .time{margin-right:6px}
    .msg.them .time{margin-left:6px}
    /* ensure no white outline on text */
    .bubble .text{-webkit-text-stroke:0;text-shadow:none}
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
            <div class="subtitle">구름 위를 걷는 고양이 테마</div>
          </div>
        </div>
        <div class="status"><span>☁️</span><span id="online">offline</span></div>
      </div>

      <div class="chat" id="chat">
        <div class="divider"><div class="line"></div><div class="txt">오늘</div><div class="line"></div></div>
      </div>

      <div id="emojiWrap" class="emoji" style="display:none"></div>

      <div class="inputbar" id="inputbar" style="display:none">
        <div class="inputrow">
          <input id="text" class="text" type="text" placeholder="구름 속 고양이에게 말을 걸어보세요..." />
          <button id="emojiBtn" class="btn btn-emoji" type="button">😊</button>
          <button id="send" class="btn btn-send" type="button">야옹!</button>
        </div>
        <div class="subtitle" style="margin-top:4px">Enter를 눌러 전송</div>
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
    const emojiWrap = $('#emojiWrap');

    const roomInput = $('#room');
    const nickInput = $('#nick');
    const keyInput = $('#key');
    const invite = $('#invite');
    const statusTag = $('#status');
    const typing = $('#typing');
    const online = $('#online');

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
    function fmt(ts){ const d=new Date(ts); const h=String(d.getHours()).padStart(2,'0'); const m=String(d.getMinutes()).padStart(2,'0'); return h+':'+m; }); }
    function esc(s){ return (s||'').toString().replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
    function initial(n){ n=(n||'').trim(); return n? n[0].toUpperCase(): '?'; }

    function addMsg(fromMe, name, text, ts){
      const row = document.createElement('div'); row.className = 'msg ' + (fromMe? 'me':'them');
      if(!fromMe){ const av = document.createElement('div'); av.className='avatar'; av.textContent = initial(name); row.appendChild(av); }
      if(fromMe){ const t = document.createElement('span'); t.className='time'; t.textContent = fmt(ts||Date.now()); row.appendChild(t); }
      const b = document.createElement('div'); b.className='bubble';
      b.innerHTML = '<div class="text">' + esc(text) + '</div>';
      row.appendChild(b);
      if(!fromMe){ const t2 = document.createElement('span'); t2.className='time'; t2.textContent = fmt(ts||Date.now()); row.appendChild(t2); }
      chatBox.appendChild(row); chatBox.scrollTop = chatBox.scrollHeight;
    }

    // Emoji picker
    const emojis = ['😀','😁','😂','🤣','😊','😎','😍','🥰','🤔','😐','😶','😏','😮','😪','😴','😛','😜','🤪','🫠','😲','🙁','😞','😢','😭','😨','😱','🥵','🥶','😳','🤒','🤕','🤢','🤧','😇','🥳','🥺','🤠','🤡','👻','👽','🤖','🎃','😺','😸','😹','😻','😼','😽'];
    function renderEmoji(){
      emojiWrap.innerHTML = '';
      emojis.forEach(e => {
        const btn = document.createElement('button'); btn.textContent = e; btn.onclick = () => {
          const t = document.querySelector('#text'); t.value = (t.value || '') + e; t.focus();
        }; emojiWrap.appendChild(btn);
      });
    }
    renderEmoji();

    let socket; let myNick; let myRoom; let joined=false; let typingTimer;

    $('#create').onclick = () => {
      if (socket) return; $('#create').disabled = true;
      const r = roomInput.value.trim();
      const n = nickInput.value.trim();
      const k = keyInput.value.trim();
      if(!r || !n){ alert('방 코드와 닉네임을 입력하세요'); $('#create').disabled = false; return; }
      myNick = n; myRoom = r;
      socket = io();
      socket.emit('join', { room: r, nick: n, key: k });

      socket.on('joined', (info)=>{
        joined = true; online.textContent = 'online';
        setInviteLink(myRoom);
        setup.style.display='none'; inputbar.style.display='block';
        addSys(info.msg);
        history.replaceState(null, '', '?room='+encodeURIComponent(myRoom)+'&nick='+encodeURIComponent(myNick));
      });

      socket.on('join_error', (err)=>{
        addSys('입장 실패: ' + err);
        statusTag.textContent = '거부됨';
        $('#create').disabled = false; socket.disconnect(); socket=null;
      });

      socket.on('peer_joined', (name)=> addSys(name + ' 님이 입장했습니다'));
      socket.on('peer_left', (name)=> addSys(name + ' 님이 퇴장했습니다'));

      socket.on('msg', ({ nick, text, ts }) => { addMsg(false, nick, text, ts); });

      socket.on('typing', (name)=>{
        typing.textContent = name + ' 입력 중...';
        clearTimeout(typingTimer); typingTimer = setTimeout(()=> typing.textContent = '', 1200);
      });

      socket.on('info', (m)=> addSys(m));
    };

    document.querySelector('#send').onclick = sendMsg;
    document.querySelector('#text').addEventListener('keydown', (e)=>{
      if(e.key==='Enter') sendMsg();
      else if(['Shift','Alt','Control','Meta'].includes(e.key)===false && joined) socket.emit('typing', myRoom);
    });

    document.querySelector('#emojiBtn').onclick = () => {
      const s = emojiWrap.style.display === 'none' ? 'grid' : 'none';
      emojiWrap.style.display = s;
      if (s === 'grid') document.querySelector('#text').focus();
    };

    function sendMsg(){
      const input = document.querySelector('#text');
      const val = (input.value || '').trim(); if(!val) return;
      socket.emit('msg', { room: myRoom, text: val });
      addMsg(true, myNick, val, Date.now());
      input.value = '';
    }

    // Prefill from URL
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

    if (r.users.size >= 2) {
      return socket.emit('join_error', '이 방은 최대 2명만 입장할 수 있어요');
    }

    if (r.users.size === 0) {
      if (key) r.key = key;
    } else {
      if (r.key && key !== r.key) {
        return socket.emit('join_error', '방 키가 일치하지 않습니다');
      }
      if (!r.key && key) {
        return socket.emit('join_error', '이미 만들어진 방에는 키를 새로 설정할 수 없어요');
      }
    }

    socket.data.nick = nick;
    socket.data.room = room;

    socket.join(room);
    r.users.add(socket.id);

    socket.emit('joined', { msg: `${nick} 님, ${room} 방에 입장했습니다${r.key ? ' (키 적용됨)' : ''}` });
    socket.to(room).emit('peer_joined', nick);
  });

  socket.on('msg', ({ room, text }) => {
    room = sanitize(room, 40);
    const r = rooms.get(room);
    if (!r) return;
    const nick = sanitize(socket.data.nick, 24) || '게스트';
    text = sanitize(text, 2000);

    if (isThrottled(r, socket.id)) {
      return socket.emit('info', '메시지가 너무 빠릅니다. 잠시 후 다시 시도하세요.');
    }

    r.lastMsgs.push({ t: now(), from: socket.id });
    socket.to(room).emit('msg', { nick, text, ts: now() });
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
