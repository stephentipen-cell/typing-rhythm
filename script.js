const $ = s => document.querySelector(s);
const cv = $('#c'), g = cv.getContext('2d');
let BPM = 110, SPB = 60 / BPM, STEP = SPB / 2, offset = 0, songBuf = null, songSrc = null;
const LEAD = 2.5, PERFECT = 0.07, GOOD = 0.18;
const WORDS = ["type","beat","flow","rush","jazz","keys","tempo","pulse","groove","rhythm","synth","drum","bass","chord","verse","remix","vinyl","tune","clap","loop","disco","swing","funk","sound","echo","track"];
let ac, notes, t0, running = false, score, combo, maxCombo, hits, misses, endTime, nextBeat, flash = null;

const css = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim();

function resize() {
  const r = cv.getBoundingClientRect(), d = window.devicePixelRatio || 1;
  cv.width = r.width * d; cv.height = r.height * d;
  g.setTransform(d, 0, 0, d, 0, 0);
}
addEventListener('resize', resize);

// Build a random chart: each word is spelled one letter per STEP, then a one-beat rest.
// With a song loaded, words keep coming until the song is nearly over.
function buildChart() {
  const out = []; let t = LEAD, pool = [], count = 0;
  const songEnd = songBuf ? LEAD - offset + songBuf.duration : 0;
  while (songBuf ? t < songEnd - 2 : count < 22) {
    if (!pool.length) pool = [...WORDS].sort(() => Math.random() - 0.5);
    for (const ch of pool.pop()) { out.push({ k: ch, t, state: 0, hitAt: 0 }); t += STEP; }
    t += SPB; count++;
  }
  endTime = songBuf ? songEnd + 0.5 : t + 1.5;
  return out;
}

// Rough tempo detection: find the BPM whose beat spacing best matches the loudness onsets.
function detectBPM(buf) {
  const d = buf.getChannelData(0), hop = 512, n = Math.floor(d.length / hop), env = new Float32Array(n), on = new Float32Array(n);
  for (let i = 0; i < n; i++) { let s = 0; for (let j = 0; j < hop; j += 4) s += d[i * hop + j] ** 2; env[i] = Math.sqrt(s); }
  for (let i = 1; i < n; i++) on[i] = Math.max(0, env[i] - env[i - 1]);
  const fps = buf.sampleRate / hop; let best = 0, bpm = 120;
  for (let b = 70; b <= 180; b++) {
    const lag = Math.round(fps * 60 / b); let s = 0;
    for (let i = lag; i < n; i++) s += on[i] * on[i - lag];
    if (s > best) { best = s; bpm = b; }
  }
  return bpm;
}

async function loadSong(e) {
  const f = e.target.files[0]; if (!f) return;
  ac = ac || new (window.AudioContext || window.webkitAudioContext)();
  $('#songName').textContent = 'Loading…';
  try {
    songBuf = await ac.decodeAudioData(await f.arrayBuffer());
    $('#bpm').value = detectBPM(songBuf); $('#click').checked = false;
    $('#songName').textContent = f.name + ' (' + Math.round(songBuf.duration) + 's). BPM auto-detected: adjust it and First beat if the letters feel off.';
    $('#clear').classList.remove('hide');
  } catch (err) { songBuf = null; $('#songName').textContent = 'Could not read that file. Try an MP3 or WAV.'; }
}
function clearSong() {
  songBuf = null; $('#song').value = ''; $('#click').checked = true;
  $('#songName').textContent = 'No song loaded: using the built-in beat'; $('#clear').classList.add('hide');
}
$('#song').addEventListener('change', loadSong);
$('#clear').addEventListener('click', clearSong);

function stopSong() { if (songSrc) { try { songSrc.stop(); } catch (e) {} songSrc = null; } }

// Short synthesized sounds, no audio files needed.
function tone(freq, when, dur, type, vol, slideTo) {
  const o = ac.createOscillator(), v = ac.createGain();
  o.type = type; o.frequency.setValueAtTime(freq, when);
  if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, when + dur);
  v.gain.setValueAtTime(vol, when); v.gain.exponentialRampToValueAtTime(0.001, when + dur);
  o.connect(v).connect(ac.destination); o.start(when); o.stop(when + dur);
}

// Schedule the click track slightly ahead of the playhead, aligned to the chart: kick on beats, hat on off-beats.
function scheduleBeat(now) {
  if (!$('#click').checked) return;
  while (LEAD + nextBeat * SPB / 2 < now + 0.15) {
    const when = t0 + LEAD + nextBeat * SPB / 2;
    if (when >= ac.currentTime) { if (((nextBeat % 2) + 2) % 2 === 0) tone(140, when, 0.18, 'sine', 0.5, 45); else tone(7000, when, 0.04, 'square', 0.04); }
    nextBeat++;
  }
}

function startGame() {
  if (!ac) ac = new (window.AudioContext || window.webkitAudioContext)();
  ac.resume(); stopSong();
  if (document.activeElement) document.activeElement.blur();
  const num = (id, lo, hi, def) => Math.min(hi, Math.max(lo, +$(id).value || def));
  BPM = num('#bpm', 60, 200, 110); SPB = 60 / BPM; STEP = SPB / +$('#density').value; offset = num('#offset', 0, 2000, 0) / 1000;
  notes = buildChart();
  score = combo = maxCombo = hits = misses = 0; nextBeat = -Math.floor(LEAD / (SPB / 2)); flash = null;
  t0 = ac.currentTime + 0.1; running = true;
  if (songBuf) { songSrc = ac.createBufferSource(); songSrc.buffer = songBuf; songSrc.connect(ac.destination); songSrc.start(t0 + LEAD - offset); }
  $('#ov').classList.add('hide');
  updateHUD(); resize(); requestAnimationFrame(loop);
}

function showFlash(text, color) { flash = { text, color, at: performance.now() }; }

// Judge a key press against the nearest matching unhit note.
function handleKey(e) {
  if (!running) { if (e.key === 'Enter') startGame(); return; }
  if (e.key.length !== 1 || e.ctrlKey || e.metaKey) return;
  const k = e.key.toLowerCase(), now = ac.currentTime - t0;
  let best = null;
  for (const n of notes) {
    if (n.state || n.k !== k) continue;
    const d = Math.abs(n.t - now);
    if (d <= GOOD && (!best || d < Math.abs(best.t - now))) best = n;
  }
  if (!best) { combo = 0; showFlash('WRONG', css('--bad')); updateHUD(); return; }
  const d = Math.abs(best.t - now), perfect = d <= PERFECT;
  best.state = perfect ? 3 : 1; best.hitAt = now;
  combo++; maxCombo = Math.max(maxCombo, combo); hits++;
  score += (perfect ? 100 : 50) * Math.min(4, 1 + Math.floor(combo / 10));
  showFlash(perfect ? 'PERFECT' : 'GOOD', perfect ? css('--ok') : css('--good'));
  tone(300 + (k.charCodeAt(0) - 97) * 22, ac.currentTime, 0.12, 'triangle', 0.25);
  updateHUD();
}
addEventListener('keydown', handleKey);
$('#go').addEventListener('click', startGame);

function updateHUD() {
  $('#sc').textContent = score; $('#cb').textContent = combo;
  const tot = hits + misses;
  $('#ac').textContent = (tot ? Math.round(hits / tot * 100) : 100) + '%';
}

function endGame() {
  running = false; stopSong();
  const tot = hits + misses, acc = tot ? Math.round(hits / tot * 100) : 0;
  const rank = acc >= 95 ? 'S' : acc >= 85 ? 'A' : acc >= 70 ? 'B' : acc >= 50 ? 'C' : 'D';
  $('#ovT').textContent = 'Rank ' + rank;
  $('#ovP').textContent = 'Score ' + score + ' · Accuracy ' + acc + '% · Best combo ' + maxCombo + '. Press Enter to play again.';
  $('#go').textContent = 'Play again (Enter)';
  $('#ov').classList.remove('hide');
}

function draw(now) {
  const w = cv.clientWidth, h = cv.clientHeight, cy = h / 2, hx = w * 0.2, speed = w * 0.45, r = Math.min(26, h / 8);
  g.clearRect(0, 0, w, h);
  g.fillStyle = css('--line'); g.globalAlpha = 0.35; g.fillRect(0, cy - r - 10, w, 2 * r + 20); g.globalAlpha = 1;
  const pulse = 1 - ((((now - LEAD) / SPB) % 1) + 1) % 1;
  g.lineWidth = 3; g.strokeStyle = css('--acc'); g.beginPath(); g.arc(hx, cy, r + 4 + pulse * 6, 0, 7); g.stroke();
  g.font = '700 ' + Math.round(r * 0.9) + 'px system-ui,sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
  for (const n of notes) {
    const x = hx + (n.t - now) * speed;
    if (x < -r || x > w + r) continue;
    if (n.state === 1 || n.state === 3) {
      const a = Math.max(0, 1 - (now - n.hitAt) * 4); if (!a) continue;
      g.globalAlpha = a; g.fillStyle = n.state === 3 ? css('--ok') : css('--good');
      g.beginPath(); g.arc(hx, cy, r * (1 + (1 - a) * 0.6), 0, 7); g.fill(); g.globalAlpha = 1; continue;
    }
    g.globalAlpha = n.state === 2 ? 0.35 : 1;
    g.fillStyle = n.state === 2 ? css('--mut') : css('--acc');
    g.beginPath(); g.arc(x, cy, r, 0, 7); g.fill();
    g.fillStyle = '#fff'; g.fillText(n.k.toUpperCase(), x, cy + 1); g.globalAlpha = 1;
  }
  if (flash) {
    const age = (performance.now() - flash.at) / 500;
    if (age < 1) {
      g.globalAlpha = 1 - age; g.fillStyle = flash.color; g.font = '800 22px system-ui,sans-serif';
      g.fillText(flash.text, hx, cy - r - 30 - age * 16); g.globalAlpha = 1;
    }
  }
}

function loop() {
  if (!running) return;
  const now = ac.currentTime - t0;
  scheduleBeat(now);
  for (const n of notes) if (!n.state && n.t < now - GOOD) { n.state = 2; misses++; combo = 0; showFlash('MISS', css('--bad')); updateHUD(); }
  draw(now);
  if (now > endTime) { endGame(); return; }
  requestAnimationFrame(loop);
}
resize(); notes = [];
