// Refuse to run inside someone else's iframe (clickjacking onto "Atender").
if (window.top !== window.self) throw new Error('framed');
const $ = id => document.getElementById(id);
const BITRATE = { 1080: 15e6, 1440: 25e6, 2160: 45e6 }; // bits/s at 60fps; scaled down for lower fps below
const WIDTH = { 1080: 1920, 1440: 2560, 2160: 3840 };

// One DTLS certificate for the whole session, so voice and screen connections share a fingerprint we can verify once.
const cert = await RTCPeerConnection.generateCertificate({ name: 'ECDSA', namedCurve: 'P-256' });
const myFp = cert.getFingerprints().find(f => f.algorithm === 'sha-256').value.toUpperCase();
const ICE = {
  iceServers: [{ urls: 'stun:stun.l.google.com:19302' }, { urls: 'stun:stun1.l.google.com:19302' }],
  certificates: [cert],
};

let mic, voiceCall, voiceFp, verified = false, screenStream, sendStream, outScreenCall, inScreenCall, pendingCall;
const peer = new Peer({ config: ICE });

peer.on('open', id => { $('myId').textContent = id; status('Pronto. Passe seu ID para o amigo ou cole o dele.'); });
peer.on('error', e => status('Erro: ' + e.type));
peer.on('disconnected', () => peer.reconnect());

peer.on('call', call => {
  if (call.metadata?.type === 'screen') return acceptScreen(call);
  if (voiceCall || pendingCall) return call.close(); // busy
  // Never auto-answer: answering sends the mic.
  pendingCall = call;
  $('callerId').textContent = call.peer;
  $('incoming').classList.remove('hidden');
  call.on('close', clearPending);
});

$('acceptBtn').onclick = async () => {
  const call = pendingCall;
  clearPending();
  if (!call) return;
  try { await getMic(); } catch (e) { call.close(); return status('Sem microfone: ' + e.message); }
  call.answer(mic);
  startVoice(call);
};
$('declineBtn').onclick = () => { pendingCall?.close(); clearPending(); };
function clearPending() { pendingCall = null; $('incoming').classList.add('hidden'); }

$('callBtn').onclick = async () => {
  const id = $('remoteId').value.trim();
  if (!id || id === peer.id) return;
  try { await getMic(); } catch (e) { return status('Sem microfone: ' + e.message); }
  startVoice(peer.call(id, mic, { metadata: { type: 'voice' } }));
};
$('hangBtn').onclick = () => voiceCall?.close();
$('copy').onclick = async () => {
  await navigator.clipboard.writeText($('myId').textContent);
  $('copy').textContent = 'Copiado';
  setTimeout(() => $('copy').textContent = 'Copiar', 1500);
};
$('screenVol').oninput = e => $('remoteScreenAudio').volume = +e.target.value;
$('muteBtn').onclick = () => {
  const t = mic.getAudioTracks()[0];
  t.enabled = !t.enabled;
  $('muteBtn').textContent = t.enabled ? 'Mutar' : 'Desmutar';
  $('muteBtn').setAttribute('aria-pressed', !t.enabled);
};
$('verifyBtn').onclick = () => {
  verified = true;
  status('Código confirmado. Você já pode compartilhar a tela (seu amigo também precisa confirmar para ver).');
  $('verifyBtn').classList.add('hidden');
  $('codeBox').classList.add('ok');
  $('shareBtn').disabled = false;
};
$('shareBtn').onclick = () => screenStream ? stopShare() : openPicker();
$('cancelPick').onclick = () => $('picker').classList.add('hidden');
$('remoteScreen').ondblclick = e => document.fullscreenElement ? document.exitFullscreen() : e.target.requestFullscreen();

async function getMic() {
  mic ??= await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
}

function remoteFp(pc) {
  return pc.remoteDescription?.sdp.match(/a=fingerprint:sha-256 ([0-9A-F:]+)/i)?.[1].toUpperCase();
}

// 40-bit code from both DTLS fingerprints: a man-in-the-middle has different keys on each leg, so the two screens show different codes.
async function safetyCode(a, b) {
  const h = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode([a, b].sort().join('|'))));
  const n = h.slice(0, 5).reduce((acc, x) => acc * 256 + x, 0) % 1e12;
  return String(n).padStart(12, '0').replace(/(\d{4})(?=\d)/g, '$1 ');
}

function onConnected(pc, fn) {
  const check = () => pc.connectionState === 'connected' && (pc.removeEventListener('connectionstatechange', check), fn());
  pc.addEventListener('connectionstatechange', check);
  check();
}

function startVoice(call) {
  voiceCall = call;
  status('Chamando ' + call.peer + '...');
  const pc = call.peerConnection;
  const types = new Set();
  let failMsg, connectTimer;
  pc.addEventListener('icecandidate', e => e.candidate && types.add(e.candidate.type));
  // Without these timers a call whose network blocks P2P sits in "checking" forever.
  const ringTimer = setTimeout(() => { failMsg = 'Ninguém atendeu.'; call.close(); }, 60000);
  pc.addEventListener('signalingstatechange', () => {
    if (pc.signalingState !== 'stable' || connectTimer) return; // stable after offer/answer = the call was answered
    clearTimeout(ringTimer);
    status('Conectando...');
    connectTimer = setTimeout(() => {
      if (pc.connectionState === 'connected') return;
      failMsg = `Não conectou: a rede de um de vocês bloqueia conexão direta (precisa de servidor TURN). [diag: ${[...types].join(',') || 'nenhum'} / ${pc.iceConnectionState}]`;
      call.close();
    }, 20000);
  });
  call.on('stream', s => { $('remoteAudio').srcObject = s; status('Em chamada com ' + call.peer); });
  onConnected(call.peerConnection, async () => {
    voiceFp = remoteFp(call.peerConnection);
    if (!voiceFp) return call.close();
    $('code').textContent = await safetyCode(myFp, voiceFp);
    $('codeBox').classList.remove('hidden');
    status('Comparem o código em voz alta. Se for igual, OS DOIS cliquem em "É igual ao do amigo" para liberar a tela.');
  });
  toggleInCall(true);
  onEnd(call, () => {
    voiceCall = voiceFp = null;
    verified = false;
    stopShare();
    inScreenCall?.close();
    clearTimeout(ringTimer);
    clearTimeout(connectTimer);
    toggleInCall(false);
    status(failMsg || 'Chamada encerrada.');
  });
}

function toggleInCall(on) {
  document.body.classList.toggle('in-call', on);
  $('callBtn').classList.toggle('hidden', on);
  $('hangBtn').classList.toggle('hidden', !on);
  $('muteBtn').disabled = !on;
  $('shareBtn').disabled = true; // only after the safety code is confirmed
  $('codeBox').classList.add('hidden');
  $('codeBox').classList.remove('ok');
  $('verifyBtn').classList.remove('hidden');
}

// PeerJS 'close' doesn't always fire when the other side vanishes, so also watch the raw connection.
// PeerJS close() is also silent on a call that never opened, so wrap it: every close() runs our cleanup.
function onEnd(call, fn) {
  let done = false;
  const close = call.close.bind(call);
  const end = () => { if (!done) { done = true; fn(); close(); } };
  call.close = end;
  call.on('close', end);
  call.on('error', end);
  call.peerConnection?.addEventListener('connectionstatechange', () => {
    if (['failed', 'closed'].includes(call.peerConnection.connectionState)) end();
  });
}

function acceptScreen(call) {
  // Only from the verified person we're already talking to.
  if (!verified || call.peer !== voiceCall?.peer) return call.close();
  inScreenCall?.close();
  inScreenCall = call;
  let trusted = false;
  const show = s => {
    if (!trusted || !s) return;
    $('remoteScreen').srcObject = s;
    $('remoteScreenAudio').srcObject = s;
    stopRemoteVu?.();
    stopRemoteVu = watchLevel(s.getAudioTracks()[0], 'remoteVu');
    $('remoteTile').classList.remove('hidden');
  };
  call.answer(undefined, { sdpTransform: preferH264 });
  call.on('stream', show);
  onConnected(call.peerConnection, () => {
    if (remoteFp(call.peerConnection) !== voiceFp) { status('ALERTA: chave da tela não bate com a da chamada. Bloqueado.'); return call.close(); }
    trusted = true;
    show(call.remoteStream);
  });
  onEnd(call, () => {
    if (inScreenCall === call) inScreenCall = null;
    stopRemoteVu?.();
    $('remoteTile').classList.add('hidden');
    $('remoteScreen').srcObject = null;
  });
}

function openPicker() { $('picker').classList.remove('hidden'); }
$('pickBtn').onclick = () => { $('picker').classList.add('hidden'); startShare(); };

async function startShare() {
  if (!verified || !voiceCall) return;
  const res = +$('res').value, fps = +$('fps').value, hint = $('hint').value, sound = $('sysAudio').checked, noEcho = $('noEcho').checked;
  try {
    // The browser shows its own picker (screen / window / tab).
    screenStream = await navigator.mediaDevices.getDisplayMedia({
      video: { width: { ideal: WIDTH[res] }, height: { ideal: res }, frameRate: { ideal: fps, max: fps } },
      // restrictOwnAudio keeps this page's audio (the friend's voice) out of a system-audio capture.
      // It's optional because a browser may implement it by dropping all of its own audio (other tabs too).
      audio: sound ? { echoCancellation: false, noiseSuppression: false, autoGainControl: false, restrictOwnAudio: noEcho } : false,
      systemAudio: sound ? 'include' : 'exclude',
      selfBrowserSurface: 'exclude',
    });
  } catch (e) { return status(e.name === 'NotAllowedError' ? 'Compartilhamento cancelado.' : 'Não consegui capturar: ' + e.message); }

  const video = screenStream.getVideoTracks()[0];
  video.contentHint = hint;
  video.onended = stopShare;
  stopLocalVu?.();
  stopLocalVu = watchLevel(screenStream.getAudioTracks()[0], 'localVu');
  const surface = video.getSettings().displaySurface;
  if (sound && !screenStream.getAudioTracks().length) {
    status(surface === 'window'
      ? 'Sem som: o navegador não pega o áudio de uma janela. Para ter som, compartilhe a tela inteira ou uma aba.'
      : 'Sem som: na janela do navegador, marque a opção de compartilhar áudio.');
  }
  $('localScreen').srcObject = new MediaStream([video]);
  $('localTile').classList.remove('hidden');
  $('shareBtn').textContent = 'Parar compartilhamento';
  $('shareBtn').classList.add('sharing');

  // Send black/silent until we've checked the other end has the verified key.
  sendStream = screenStream.clone();
  sendStream.getTracks().forEach(t => { t.enabled = false; t.contentHint = t.kind === 'video' ? hint : t.contentHint; });
  const call = outScreenCall = peer.call(voiceCall.peer, sendStream, { metadata: { type: 'screen' }, sdpTransform: preferH264 });
  const pc = call.peerConnection;
  // The friend's app silently refuses screens until they confirm the code, so don't wait forever.
  const refusedTimer = setTimeout(() => {
    if (outScreenCall !== call || pc.connectionState === 'connected') return;
    status('A tela não foi aceita: seu amigo precisa clicar em "É igual ao do amigo" e depois você compartilha de novo.');
    stopShare();
  }, 15000);
  onConnected(pc, async () => {
    clearTimeout(refusedTimer);
    if (remoteFp(pc) !== voiceFp) { status('ALERTA: chave da tela não bate com a da chamada. Bloqueado.'); return stopShare(); }
    status('Compartilhando sua tela.');
    sendStream.getTracks().forEach(t => t.enabled = true);
    for (const sender of pc.getSenders().filter(s => s.track?.kind === 'video')) {
      const p = sender.getParameters();
      p.degradationPreference = hint === 'motion' ? 'maintain-framerate' : 'maintain-resolution';
      p.encodings.forEach(enc => {
        enc.maxBitrate = BITRATE[res] * Math.max(fps, 30) / 60;
        enc.maxFramerate = fps;
        enc.priority = enc.networkPriority = 'high';
      });
      await sender.setParameters(p).catch(e => console.warn('setParameters', e));
    }
  });
  onEnd(call, stopShare);
}

// Live level meter for a screen's audio, so you can see whether sound is actually captured / arriving.
let stopLocalVu, stopRemoteVu;
function watchLevel(track, id) {
  const meter = $(id), box = meter.closest('.vu');
  box.classList.toggle('none', !track);
  meter.value = 0;
  if (!track) return null;
  const ctx = new AudioContext();
  const an = ctx.createAnalyser();
  an.fftSize = 512;
  ctx.createMediaStreamSource(new MediaStream([track])).connect(an);
  const buf = new Float32Array(an.fftSize);
  let raf;
  const tick = () => {
    an.getFloatTimeDomainData(buf);
    let peak = 0;
    for (const v of buf) peak = Math.max(peak, Math.abs(v));
    meter.value = Math.max(peak, meter.value * 0.85); // fall off smoothly
    raf = requestAnimationFrame(tick);
  };
  ctx.resume().then(tick);
  return () => { cancelAnimationFrame(raf); ctx.close(); meter.value = 0; };
}

function stopShare() {
  stopLocalVu?.();
  stopLocalVu = null;
  if (!screenStream) return;
  screenStream.getTracks().forEach(t => t.stop());
  sendStream?.getTracks().forEach(t => t.stop());
  screenStream = sendStream = null;
  const c = outScreenCall;
  outScreenCall = null;
  c?.close();
  $('localTile').classList.add('hidden');
  $('shareBtn').textContent = 'Compartilhar tela';
  $('shareBtn').classList.remove('sharing');
}

function status(t) { $('status').textContent = t; }
