const socket = io({ path: '/chat/socket.io' });

const joinView = document.getElementById('joinView');
const chatView = document.getElementById('chatView');
const joinForm = document.getElementById('joinForm');
const usernameInput = document.getElementById('usernameInput');
const joinError = document.getElementById('joinError');

const meLabel = document.getElementById('meLabel');
const usersList = document.getElementById('usersList');
const chatTitle = document.getElementById('chatTitle');

const messages = document.getElementById('messages');
const messageForm = document.getElementById('messageForm');
const messageInput = document.getElementById('messageInput');
const sendError = document.getElementById('sendError');

const videoCallBtn = document.getElementById('videoCallBtn');
const endCallBtn = document.getElementById('endCallBtn');
const screenShareBtn = document.getElementById('screenShareBtn');
const switchCameraBtn = document.getElementById('switchCameraBtn');

const localVideo = document.getElementById('localVideo');
const remoteVideo = document.getElementById('remoteVideo');
const callStatus = document.getElementById('callStatus');

let me = '';
let selectedUser = '';
let allMessages = [];

let localStream = null;
let screenStream = null;
let remoteStream = null;
let pc = null;
let activeCallUser = '';
let usingFrontCamera = true;

const rtcConfig = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' }
  ]
};

const isMobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
if (!isMobile) switchCameraBtn.style.display = 'none';

function fmt(ts) {
  return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function setCallStatus(text) {
  callStatus.textContent = text;
}

function renderUsers(users) {
  usersList.innerHTML = '';
  users.filter(u => u !== me).forEach((u) => {
    const li = document.createElement('li');
    li.textContent = u;
    if (u === selectedUser) li.classList.add('active');
    li.onclick = () => selectUser(u);
    usersList.appendChild(li);
  });
}

function renderMessages() {
  messages.innerHTML = '';
  if (!selectedUser) return;

  const thread = allMessages.filter(
    (m) => (m.from === me && m.to === selectedUser) || (m.from === selectedUser && m.to === me)
  );

  thread.forEach((m) => {
    const item = document.createElement('div');
    item.className = `message ${m.from === me ? 'me' : 'them'}`;
    item.innerHTML = `<div class="meta">${m.from} • ${fmt(m.timestamp)}</div><div>${m.text}</div>`;
    messages.appendChild(item);
  });
  messages.scrollTop = messages.scrollHeight;
}

function selectUser(user) {
  selectedUser = user;
  chatTitle.textContent = `Chat with ${user}`;

  Array.from(usersList.children).forEach((li) => {
    li.classList.toggle('active', li.textContent === user);
  });

  socket.emit('chat:history', user, (res) => {
    if (!res?.ok) return;
    allMessages = res.messages || [];
    renderMessages();
  });
}

async function getCameraStream(front = true) {
  const constraints = {
    audio: true,
    video: isMobile
      ? { facingMode: front ? 'user' : 'environment', width: { ideal: 1280 }, height: { ideal: 720 } }
      : { width: { ideal: 1280 }, height: { ideal: 720 } }
  };
  return navigator.mediaDevices.getUserMedia(constraints);
}

async function ensureLocalMedia() {
  if (localStream) return localStream;
  localStream = await getCameraStream(usingFrontCamera);
  localVideo.srcObject = localStream;
  return localStream;
}

function stopStream(stream) {
  if (!stream) return;
  stream.getTracks().forEach(t => t.stop());
}

function cleanupPeer() {
  if (pc) {
    pc.onicecandidate = null;
    pc.ontrack = null;
    pc.onconnectionstatechange = null;
    pc.close();
    pc = null;
  }
  remoteStream = null;
  remoteVideo.srcObject = null;
}

function resetCallState(msg = 'No active call') {
  cleanupPeer();
  activeCallUser = '';
  setCallStatus(msg);
}

function ensurePeer(targetUser) {
  if (pc) return pc;
  pc = new RTCPeerConnection(rtcConfig);

  pc.onicecandidate = (event) => {
    if (event.candidate && targetUser) {
      socket.emit('call:ice', { to: targetUser, candidate: event.candidate });
    }
  };

  pc.ontrack = (event) => {
    remoteStream = event.streams[0];
    remoteVideo.srcObject = remoteStream;
  };

  pc.onconnectionstatechange = () => {
    const state = pc?.connectionState;
    if (state === 'connected') setCallStatus(`In call with ${activeCallUser}`);
    if (state === 'failed' || state === 'disconnected') {
      setCallStatus('Connection unstable. Call ended.');
      resetCallState('Connection unstable. Call ended.');
    }
  };

  return pc;
}

function addTracksToPeer(peer, stream) {
  const existingKinds = new Set(peer.getSenders().map(s => s.track?.kind).filter(Boolean));
  stream.getTracks().forEach(track => {
    if (!existingKinds.has(track.kind)) peer.addTrack(track, stream);
  });
}

async function startCall() {
  try {
    if (!selectedUser) return setCallStatus('Select a user first.');
    if (activeCallUser) return setCallStatus(`Already in call with ${activeCallUser}`);

    activeCallUser = selectedUser;
    setCallStatus(`Calling ${activeCallUser}...`);

    const stream = await ensureLocalMedia();
    const peer = ensurePeer(activeCallUser);
    addTracksToPeer(peer, stream);

    const offer = await peer.createOffer();
    await peer.setLocalDescription(offer);

    socket.emit('call:offer', { to: activeCallUser, offer }, (res) => {
      if (!res?.ok) {
        resetCallState(res?.error || 'Call failed to start.');
      }
    });
  } catch (err) {
    resetCallState(`Call error: ${err.message}`);
  }
}

async function acceptIncomingCall(from, offer) {
  try {
    if (activeCallUser && activeCallUser !== from) {
      socket.emit('call:reject', { to: from });
      setCallStatus(`Rejected ${from}: already in another call.`);
      return;
    }

    activeCallUser = from;
    if (!selectedUser) selectUser(from);

    const stream = await ensureLocalMedia();
    const peer = ensurePeer(activeCallUser);
    addTracksToPeer(peer, stream);

    await peer.setRemoteDescription(new RTCSessionDescription(offer));
    const answer = await peer.createAnswer();
    await peer.setLocalDescription(answer);

    socket.emit('call:answer', { to: from, answer }, (res) => {
      if (!res?.ok) setCallStatus(res?.error || 'Failed to answer call.');
    });

    setCallStatus(`In call with ${from}`);
  } catch (err) {
    setCallStatus(`Accept error: ${err.message}`);
    socket.emit('call:reject', { to: from });
    resetCallState('Call failed.');
  }
}

function endCall(notify = true) {
  if (notify && activeCallUser) {
    socket.emit('call:end', { to: activeCallUser });
  }
  resetCallState('No active call');
}

function getVideoSender() {
  return pc?.getSenders().find(s => s.track && s.track.kind === 'video');
}

async function startScreenShare() {
  try {
    if (!activeCallUser || !pc) return setCallStatus('Start a call first.');
    if (!navigator.mediaDevices.getDisplayMedia) return setCallStatus('Screen share not supported on this browser.');

    screenStream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
    const screenTrack = screenStream.getVideoTracks()[0];

    const sender = getVideoSender();
    if (sender) await sender.replaceTrack(screenTrack);

    localVideo.srcObject = screenStream;
    setCallStatus('Sharing screen...');

    screenTrack.onended = async () => {
      await stopScreenShare();
    };
  } catch (err) {
    setCallStatus(`Screen share failed: ${err.message}`);
  }
}

async function stopScreenShare() {
  if (!screenStream) return;
  const camTrack = localStream?.getVideoTracks?.()[0];
  const sender = getVideoSender();
  if (sender && camTrack) await sender.replaceTrack(camTrack);
  stopStream(screenStream);
  screenStream = null;
  localVideo.srcObject = localStream;
  setCallStatus(`In call with ${activeCallUser}`);
}

async function switchCamera() {
  try {
    if (!isMobile) return;
    usingFrontCamera = !usingFrontCamera;

    const newStream = await getCameraStream(usingFrontCamera);
    const newVideoTrack = newStream.getVideoTracks()[0];
    const newAudioTrack = newStream.getAudioTracks()[0];

    const oldStream = localStream;
    localStream = newStream;
    localVideo.srcObject = localStream;

    if (pc) {
      const vSender = pc.getSenders().find(s => s.track?.kind === 'video');
      const aSender = pc.getSenders().find(s => s.track?.kind === 'audio');
      if (vSender && newVideoTrack) await vSender.replaceTrack(newVideoTrack);
      if (aSender && newAudioTrack) await aSender.replaceTrack(newAudioTrack);
    }

    if (oldStream) stopStream(oldStream);
    setCallStatus(`Switched camera (${usingFrontCamera ? 'front' : 'rear'})`);
  } catch (err) {
    setCallStatus(`Camera switch failed: ${err.message}`);
  }
}

joinForm.addEventListener('submit', (e) => {
  e.preventDefault();
  joinError.textContent = '';
  const username = usernameInput.value.trim();

  socket.emit('user:join', username, (res) => {
    if (!res?.ok) {
      joinError.textContent = res?.error || 'Join failed';
      return;
    }

    me = res.username;
    meLabel.textContent = `You: ${me}`;
    joinView.classList.add('hidden');
    chatView.classList.remove('hidden');
    renderUsers(res.users || []);
  });
});

messageForm.addEventListener('submit', (e) => {
  e.preventDefault();
  sendError.textContent = '';
  const text = messageInput.value.trim();

  if (!selectedUser) {
    sendError.textContent = 'Select a user first.';
    return;
  }
  if (!text) return;

  socket.emit('chat:send', { to: selectedUser, text }, (res) => {
    if (!res?.ok) {
      sendError.textContent = res?.error || 'Send failed';
      return;
    }
    messageInput.value = '';
  });
});

videoCallBtn.addEventListener('click', startCall);
endCallBtn.addEventListener('click', async () => {
  await stopScreenShare();
  endCall(true);
});
screenShareBtn.addEventListener('click', async () => {
  if (screenStream) await stopScreenShare();
  else await startScreenShare();
});
switchCameraBtn.addEventListener('click', switchCamera);

socket.on('users:list', (users) => {
  renderUsers(users || []);
  if (selectedUser && !(users || []).includes(selectedUser)) {
    selectedUser = '';
    chatTitle.textContent = 'Select a user to chat';
    messages.innerHTML = '';
  }

  if (activeCallUser && !(users || []).includes(activeCallUser)) {
    resetCallState(`${activeCallUser} went offline.`);
  }
});

socket.on('chat:message', ({ with: otherUser, message }) => {
  allMessages.push(message);
  if (selectedUser === otherUser) renderMessages();
});

socket.on('call:incoming', async ({ from, offer }) => {
  const ok = window.confirm(`Incoming video call from ${from}. Accept?`);
  if (!ok) {
    socket.emit('call:reject', { to: from });
    setCallStatus(`Rejected call from ${from}`);
    return;
  }
  await acceptIncomingCall(from, offer);
});

socket.on('call:answered', async ({ from, answer }) => {
  try {
    if (!pc) return;
    await pc.setRemoteDescription(new RTCSessionDescription(answer));
    activeCallUser = from;
    setCallStatus(`In call with ${from}`);
  } catch (err) {
    setCallStatus(`Answer error: ${err.message}`);
  }
});

socket.on('call:ice', async ({ candidate }) => {
  try {
    if (pc && candidate) {
      await pc.addIceCandidate(new RTCIceCandidate(candidate));
    }
  } catch (err) {
    console.error('ICE error', err);
  }
});

socket.on('call:rejected', ({ from }) => {
  resetCallState(`${from} rejected the call.`);
});

socket.on('call:ended', ({ from }) => {
  resetCallState(`Call ended by ${from}`);
});

socket.on('call:busy', ({ from }) => {
  resetCallState(`${from} is busy.`);
});
