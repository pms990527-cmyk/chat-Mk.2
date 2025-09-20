/**
 * Mini 1:1 Chat — single-file Node.js + Socket.IO app
 * UI: KakaoTalk-like styling (yellow my-bubbles, white others, header bar, sticky input)
 * Note: No nested backticks in client JS inside the server template string.
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

const APP_VERSION = "v-2025-09-21-04";

app.get('/', (req, res) => {
  const { room = '', nick = '' } = req.query;
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.end(`<!doctype html>
<html lang="ko">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>1:1 Private Chat</title>
  <style>
    :root{ --kakao-yellow:#FEE500; --kakao-bg:#EDEDED; --ink:#111827; --muted:#8B95A1; --bubble:#fff; --me:#111; --them:#111; --header-h:56px; }
    *{box-sizing:border-box}
    html,body{height:100%}
    body{margin:0;font-family:system-ui,-apple-system,Segoe UI,Roboto,Noto Sans KR,Arial;background:var(--kakao-bg);color:#111}
    .wrap{max-width:680px;margin:0 auto;padding:0 0 12px;min-height:100%;}
    .card{display:flex;flex-direction:column;min-height:100vh;background:#fff;box-shadow:0 6px 30px rgba(0,0,0,.06)}

    /* Header (app bar) */
    .appbar{height:var(--header-h);display:flex;align-items:center;gap:10px;padding:0 14px;background:var(--kakao-yellow);border-bottom:1px solid rgba(0,0,0,.08);position:sticky;top:0;z-index:10}
    .appbar .title{font-weight:700}
    .appbar .room{font-size:12px;color:#333}

    /* Chat area */
    .chat{flex:1;overflow:auto;background:var(--kakao-bg);padding:12px 12px 90px 12px}
    .sys{color:#6b7280;text-align:center;font-size:12px;margin:10px 0}

    /* Message row */
    .msg{display:flex;gap:8px;margin:6px 0;align-items:flex-end}
    .msg.me{justify-content:flex-end}
    .avatar{width:32px;height:32px;border-radius:50%;background:#d9d9d9;color:#222;display:flex;align-items:center;justify-content:center;font-weight:700;font-size:13px}
    .msg.me .avatar{display:none}

    /* Bubble */
    .bubble{max-width:75%;padding:8px 10px;border-radius:14px;line-height:1.35;position:relative;word-break:break-word}
    .name{font-size:12px;color:#666;margin-bottom:2px}
    .meta{font-size:11px;color:#888;margin-top:4px;text-align:right}

    /* Others = white bubble */
    .them .bubble{background:var(--bubble);border:1px solid #e5e7eb}
    .them .bubble:after{content:"";position:absolute;left:-6px;bottom:8px;border:6px solid transparent;border-right-color:#e5e7eb}
    .them .bubble:before{content:"";position:absolute;left:-5px;bottom:8px;border:6px solid transparent;border-right-color:#fff}

    /* Me = yellow bubble */
    .me .bubble{background:var(--kakao-yellow);color:#000}
    .me .bubble:after{content:"";position:absolute;right:-6px;bottom:8px;border:6px solid transparent;border-left-color:#c9b200}
    .me .bubble:before{content:"";position:absolute;right:-5px;bottom:8px;border:6px solid transparent;border-left-color:var(--kakao-yellow)}

    /* Input bar */
    .inputbar{position:fixed;left:0;right:0;bottom:0;margin:0 auto;max-width:680px;background:#fff;border-top:1px solid #eee;padding:10px;display:flex;gap:8px}
    .inputbar input[type=text]{flex:1;padding:12px 12px;border:1px solid #e5e7eb;border-radius:20px;font:inherit}
    .inputbar button{padding:0 16px;height:40px;border:none;border-radius:20px;background:var(--kakao-yellow);font-weight:700;color:#111;cursor:pointer}

    .small{font-size:12px;color:#6b7280}
  </style>
</head>
<body>
  <div class="wrap">
    <div class="card">
      <div class="appbar">
        <div style="display:flex;flex-direction:column">
          <span class="title">1:1 채팅</span>
          <span class="room">방: <span id="roomLabel"></span> · <span class="small">v ${APP_VERSION}</span></span>
        </div>
      </div>

      <div class="chat" id="chat"></div>

      <div class="inputbar" id="inputbar" style="display:none">
        <input id="text" type="text" placeholder="메시지 입력" />
        <button id="send">전송</button>
      </div>

      <div id="setup" style="padding:12px 12px 100px 12px;background:var(--kakao-bg)">
        <div style="background:#fff;border:1px solid #eee;border-radius:12px;padding:12px">
          <label>대화방 코드</label>
          <input id="room" type="text" placeholder="예: myroom123" value="${room}" style="width:100%;padding:10px;border:1px solid #e5e7eb;border-radius:10px" />

          <label style="margin-top:10px">닉네임</label>
          <input id="nick" type="text" placeholder="예: 민성" value="${nick}" style="width:100%;padding:10px;border:1px solid #e5e7eb;border-radius:10px" />

          <label style="margin-top:10px">방 키 (선택)</label>
          <input id="key" type="password" placeholder="비밀번호" style="width:100%;padding:10px;border:1px solid #e5e7eb;border-radius:10px" />

          <div style="display:flex;gap:8px;margin-top:12px">
            <button id="create" style="flex:0 0 auto;padding:10px 14px;border:none;border-radius:10px;background:var(--kakao-yellow);font-weight:700;cursor:pointer">입장</button>
            <button id="makeLink" style="flex:0 0 auto;padding:10px 14px;border:1px solid #e5e7eb;border-radius:10px;background:#fff;cursor:pointer">초대 링크</button>
          </div>
          <div class="small" style="margin-top:8px">Invite link: <span id="invite"></span></div>
          <div class="small" id="typing" style="min-height:16px;margin-top:6px"></div>
          <div class="small" id="status" style="margin-top:6px">대기</div>
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

    const roomInput = $('#room');
    const nickInput = $('#nick');
    const keyInput = $('#key');
    const invite = $('#invite');
    const roomLabel = $('#roomLabel');
    const statusTag = $('#status');
    const typing = $('#typing');

    function setInviteLink(r){
      const url = new URL(window.location);
      url.searchParams.set('room', r);
      invite.textContent = url.toString();
      roomLabel.textContent = r || '-';
    }

    $('#makeLink').onclick = () => {
      const r = roomInput.value.trim();
      if(!r){ alert('방 코드를 입력하세요'); return; }
      setInviteLink(r);
    };

    function addSys(msg){
      const d = document.createElement('div'); d.className='sys'; d.textContent = msg; chatBox.appendChild(d); chatBox.scrollTop = chatBox.scrollHeight; }

    function fmt(ts){ const d=new Date(ts); return d.toLocaleTimeString('ko-KR',{hour:'2-digit',minute:'2-digit'}); }
    function esc(s){ return (s||'').toString().replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
    function initial(n){ n=(n||'').trim(); return n? n[0].toUpperCase(): '?'; }

    // Kakao-like renderer
    function addMsg(fromMe, name, text, ts){
      const row = document.createElement('div'); row.className = 'msg ' + (fromMe? 'me':'them');
      if(!fromMe){
        const av = document.createElement('div'); av.className='avatar'; av.textContent = initial(name); row.appendChild(av);
      }
      const b = document.createElement('div'); b.className='bubble';
      const nameHtml = fromMe? '' : '<div class="name">' + esc(name) + '</div>';
      const textHtml = '<div class="text">' + esc(text) + '</div>';
      const metaHtml = '<div class="meta">' + fmt(ts||Date.now()) + '</div>';
      b.innerHTML = nameHtml + textHtml + metaHtml;
      row.appendChild(b);
      chatBox.appendChild(row);
      chatBox.scrollTop = chatBox.scrollHeight;
    }

    let socket; let myNick; let myRoom; let joined=false; let typingTimer;

    $('#create').onclick = () => {
      if (socket) return; $('#create').disabled = true;
      const r = roomInput.value.trim();
      const n = nickInput.value.trim();
      const k = keyInput.value.trim();
      if(!r || !n){ alert('방 코드와 닉네임을 입력하세요'); $('#create').disabled = false; return; }
      myNick = n; myRoom = r; roomLabel.textContent = r;
      socket = io();
      socket.emit('join', { room: r, nick: n, key: k });

      socket.on('joined', (info)=>{
        joined = true; statusTag.textContent = '연결됨';
        setInviteLink(myRoom);
        setup.style.display='none'; inputbar.style.display='flex';
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

    $('#send').onclick = sendMsg;
    $('#text').addEventListener('keydown', (e)=>{
      if(e.key==='Enter') sendMsg();
      else if(['Shift','Alt','Control','Meta'].includes(e.key)===false && joined) socket.emit('typing', myRoom);
    });

    function sendMsg(){
      const input = $('#text'); const val = input.value.trim(); if(!val) return;
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
