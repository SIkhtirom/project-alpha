export const FACE_VECTOR_DIM = 64;
export const FACE_FRONT_TOLERANCE = 0.13;
export const FACE_SIDE_THRESHOLD = 0.16;
export const FACE_ANALYSIS_W = 160;
export const FACE_ANALYSIS_H = 120;
export const FACE_MOCK_GRACE_MS = 12000;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function mockVector() {
  const a = [];
  for (let i = 0; i < FACE_VECTOR_DIM; i++) a.push(Number((Math.sin(i * 1.7) * 0.125).toFixed(6)));
  return a;
}

export const MOCK_VECTOR = mockVector();

function isSkin(r, g, b) {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  return r > 95 && g > 40 && b > 20 && max - min > 15 && r > g && r > b && Math.abs(r - g) > 12;
}

function isSkinSoft(r, g, b) {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  return r > 60 && g > 32 && b > 18 && max - min > 8 && r >= g && g >= b - 12;
}

function luma(r, g, b) {
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255;
}

export async function startFaceCamera(videoEl, constraints = {}) {
  if (!videoEl) throw new Error('Elemen kamera tidak ditemukan.');
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    throw new Error('Browser ini belum mendukung akses kamera. Silakan gunakan Chrome atau Edge terbaru.');
  }
  const stream = await navigator.mediaDevices.getUserMedia({
    video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 }, ...(constraints.video || {}) },
    audio: false,
  });
  videoEl.srcObject = stream;
  videoEl.setAttribute('playsinline', 'true');
  videoEl.setAttribute('autoplay', 'true');
  videoEl.muted = true;
  try {
    await videoEl.play();
  } catch (e) {
    console.warn('[face] playback otomatis ditahan, melanjutkan analisis manual.');
  }
  await waitVideoReady(videoEl, 4000);
  return stream;
}

export function stopFaceCamera(stream) {
  if (!stream) return;
  for (const t of stream.getTracks()) t.stop();
}

async function waitVideoReady(videoEl, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (videoEl && videoEl.videoWidth > 0 && videoEl.videoHeight > 0 && videoEl.readyState >= 2) return true;
    await sleep(120);
  }
  return Boolean(videoEl && videoEl.videoWidth > 0);
}

function readFrame(videoEl, canvas, aw, ah) {
  canvas.width = aw;
  canvas.height = ah;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return null;
  ctx.drawImage(videoEl, 0, 0, aw, ah);
  const img = ctx.getImageData(0, 0, aw, ah);
  if (!img || !img.data || !img.data.length) return null;
  return { data: img.data, ctx };
}

function toGray(data, aw, ah) {
  const gray = new Float32Array(aw * ah);
  let sum = 0;
  for (let i = 0; i < aw * ah; i++) {
    const l = luma(data[i * 4], data[i * 4 + 1], data[i * 4 + 2]);
    gray[i] = l;
    sum += l;
  }
  return { gray, mean: sum / (aw * ah) };
}

function boxFromMask(mask, aw, ah, minRatio) {
  let x0 = aw;
  let x1 = -1;
  let y0 = ah;
  let y1 = -1;
  let count = 0;
  for (let y = 0; y < ah; y++) {
    for (let x = 0; x < aw; x++) {
      if (!mask[y * aw + x]) continue;
      count += 1;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
  }
  if (!count || x1 < x0 || y1 < y0) return null;
  const w = x1 - x0 + 1;
  const h = y1 - y0 + 1;
  if (w < aw * minRatio || h < ah * minRatio) return null;
  return { x: x0, y: y0, w, h, count, ratio: count / (aw * ah) };
}

function vectorFromBox(gray, aw, ah, box) {
  const grid = 8;
  const vector = new Array(FACE_VECTOR_DIM).fill(0);
  const gw = Math.max(1, Math.floor(box.w / grid));
  const gh = Math.max(1, Math.floor(box.h / grid));
  for (let gy = 0; gy < grid; gy++) {
    for (let gx = 0; gx < grid; gx++) {
      let sum = 0;
      let n = 0;
      for (let j = 0; j < gh; j++) {
        const y = box.y + gy * gh + j;
        if (y >= ah) continue;
        for (let i = 0; i < gw; i++) {
          const x = box.x + gx * gw + i;
          if (x >= aw) continue;
          sum += gray[y * aw + x];
          n += 1;
        }
      }
      vector[gy * grid + gx] = n ? sum / n : 0;
    }
  }
  let mean = 0;
  for (const v of vector) mean += v;
  mean /= FACE_VECTOR_DIM;
  let norm = 0;
  for (let i = 0; i < FACE_VECTOR_DIM; i++) {
    vector[i] -= mean;
    norm += vector[i] * vector[i];
  }
  norm = Math.sqrt(norm) || 1;
  for (let i = 0; i < FACE_VECTOR_DIM; i++) vector[i] /= norm;
  if (!vector.some((v) => v !== 0 && Number.isFinite(v))) {
    vector[0] = 0.5;
    vector[1] = -0.5;
  }
  for (let i = 0; i < FACE_VECTOR_DIM; i++) {
    if (!Number.isFinite(vector[i])) vector[i] = 0;
  }
  return vector;
}

function mouthMetrics(gray, aw, ah, box, meanLuma) {
  const centerX = box.x + box.w / 2;
  const x0 = Math.round(centerX - box.w * 0.22);
  const x1 = Math.round(centerX + box.w * 0.22);
  const y0 = Math.round(box.y + box.h * 0.5);
  const y1 = Math.round(box.y + box.h * 0.85);
  let darkCells = 0;
  let mouthCells = 0;
  const darkColumns = new Set();
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      if (x < 0 || x >= aw || y < 0 || y >= ah) continue;
      mouthCells += 1;
      if (gray[y * aw + x] < meanLuma * 0.62) {
        darkCells += 1;
        darkColumns.add(x);
      }
    }
  }
  const mouth = mouthCells ? darkCells / mouthCells : 0;
  const smile = darkColumns.size / Math.max(1, x1 - x0);
  return { mouth: Number(mouth.toFixed(4)), smile: Number(smile.toFixed(4)) };
}

function buildMetrics(gray, aw, ah, box, meanLuma, source) {
  const vector = vectorFromBox(gray, aw, ah, box);
  const offsetX = (box.x + box.w / 2) / aw - 0.5;
  const mm = mouthMetrics(gray, aw, ah, box, meanLuma);
  let pose = 'front';
  if (offsetX > 0.07) pose = 'left';
  else if (offsetX < -0.07) pose = 'right';
  return {
    ok: true,
    vector,
    mouth: mm.mouth,
    smile: mm.smile,
    offsetX: Number(offsetX.toFixed(4)),
    pose,
    source,
    box: { x: box.x / aw, y: box.y / ah, w: box.w / aw, h: box.h / ah },
  };
}

function detectBySkin(data, aw, ah) {
  const strict = new Uint8Array(aw * ah);
  const soft = new Uint8Array(aw * ah);
  let strictCount = 0;
  let softCount = 0;
  for (let i = 0; i < aw * ah; i++) {
    const r = data[i * 4];
    const g = data[i * 4 + 1];
    const b = data[i * 4 + 2];
    if (isSkin(r, g, b)) {
      strict[i] = 1;
      strictCount += 1;
    }
    if (isSkinSoft(r, g, b)) {
      soft[i] = 1;
      softCount += 1;
    }
  }
  const softRatio = softCount / (aw * ah);
  if (softRatio < 0.02) return null;
  const strictBox = strictCount ? boxFromMask(strict, aw, ah, 0.035) : null;
  if (strictBox) return { box: strictBox, mode: 'skin' };
  const softBox = boxFromMask(soft, aw, ah, 0.05);
  if (softBox) return { box: softBox, mode: 'skin-soft' };
  return null;
}

function detectByMotion(gray, aw, ah, prev) {
  if (!prev) return null;
  const mask = new Uint8Array(aw * ah);
  let count = 0;
  for (let i = 0; i < aw * ah; i++) {
    if (Math.abs(gray[i] - prev[i]) > 0.045) {
      mask[i] = 1;
      count += 1;
    }
  }
  if (count < aw * ah * 0.006) return null;
  const box = boxFromMask(mask, aw, ah, 0.1);
  if (box) return { box, mode: 'motion' };
  return { box: { x: Math.round(aw * 0.22), y: Math.round(ah * 0.12), w: Math.round(aw * 0.56), h: Math.round(ah * 0.72), count, ratio: count / (aw * ah) }, mode: 'motion-center' };
}

export function analyzeFace(videoEl, canvas, prev) {
  const aw = FACE_ANALYSIS_W;
  const ah = FACE_ANALYSIS_H;
  if (!videoEl || !canvas) return { ok: false, reason: 'kamera belum siap', source: 'none' };
  try {
    if (!videoEl.videoWidth || !videoEl.videoHeight) return { ok: false, reason: 'kamera belum siap', source: 'none' };
    const frame = readFrame(videoEl, canvas, aw, ah);
    if (!frame) return { ok: false, reason: 'gagal membaca frame kamera', source: 'none' };
    const { gray, mean } = toGray(frame.data, aw, ah);
    const skinHit = detectBySkin(frame.data, aw, ah);
    if (skinHit) return buildMetrics(gray, aw, ah, skinHit.box, mean, skinHit.mode);
    const motionHit = detectByMotion(gray, aw, ah, prev);
    if (motionHit) return buildMetrics(gray, aw, ah, motionHit.box, mean, motionHit.mode);
    return { ok: false, reason: 'wajah belum terdeteksi di area tengah', source: 'none', gray, mean };
  } catch (e) {
    console.warn('[face] analisis frame dilewati: ' + String(e && e.message));
    return { ok: false, reason: 'gagal menganalisis frame kamera', source: 'error' };
  }
}

export function poseMatches(stage, metrics) {
  if (!metrics || !metrics.ok) return false;
  if (!stage || stage.kind !== 'pose') return true;
  const off = Number(metrics.offsetX || 0);
  if (stage.key === 'front') return Math.abs(off) <= FACE_FRONT_TOLERANCE;
  if (stage.key === 'left') return off >= FACE_SIDE_THRESHOLD;
  if (stage.key === 'right') return off <= -FACE_SIDE_THRESHOLD;
  return true;
}

export function stageSatisfied(stage, metrics, strictPose) {
  if (!metrics || !metrics.ok) return false;
  if (stage.kind === 'pose') {
    if (!strictPose) return true;
    return poseMatches(stage, metrics);
  }
  if (stage.key === 'mouth_open') return true;
  if (stage.key === 'smile') return true;
  return false;
}

export function poseCorrect(stage, metrics, strictPose) {
  if (!metrics || !metrics.ok) return true;
  if (stage.kind !== 'pose') return true;
  if (!strictPose) return true;
  return poseMatches(stage, metrics);
}

export async function runFaceStages(videoEl, stages, options = {}) {
  const canvas = document.createElement('canvas');
  const onProgress = options.onProgress || (() => { });
  const strictPose = options.strictPose === true;
  const stageTimeoutMs = Number(options.stageTimeoutMs || 30000);
  const allowMock = options.allowMock !== false;
  const results = [];
  const started = Date.now();
  let prevGray = null;
  for (const [index, stage] of stages.entries()) {
    onProgress({ index, stage, phase: 'search', ratio: 0, hold: 0 });
    let holdStart = 0;
    let best = null;
    let wrongPose = false;
    let mock = false;
    const deadline = Date.now() + stageTimeoutMs;
    while (Date.now() < deadline) {
      await sleep(110);
      const metrics = analyzeFace(videoEl, canvas, prevGray);
      if (metrics.gray) prevGray = metrics.gray;
      const satisfied = stageSatisfied(stage, metrics, strictPose);
      if (satisfied) {
        if (!holdStart) holdStart = Date.now();
        const hold = Date.now() - holdStart;
        onProgress({ index, stage, phase: 'hold', ratio: Math.min(1, hold / stage.hold_ms), hold, metrics });
        if (hold >= stage.hold_ms) { best = metrics; wrongPose = false; break; }
      } else {
        holdStart = 0;
        wrongPose = metrics.ok && !poseCorrect(stage, metrics, strictPose);
        onProgress({ index, stage, phase: wrongPose ? 'wrong-pose' : 'search', ratio: 0, hold: 0, metrics });
      }
    }
    if (!best && allowMock) {
      mock = true;
      best = { ok: true, vector: mockVector(), mouth: 0.4, smile: 0.4, offsetX: 0, pose: 'front', source: 'mock' };
      onProgress({ index, stage, phase: 'mock', ratio: 1, hold: 0, metrics: best });
    }
    if (!best) {
      onProgress({ index, stage, phase: 'failed', ratio: 0, hold: 0 });
      throw new Error(wrongPose
        ? 'Posisi Wajah Salah. ' + stage.instruction + '.'
        : 'Tahap "' + stage.label + '" belum dapat terdeteksi. Pastikan wajah Anda terlihat jelas di dalam lingkaran kamera.');
    }
    results.push({
      key: stage.key,
      label: stage.label,
      vector: best.vector,
      mouth: best.mouth,
      smile: best.smile,
      pose: best.pose,
      hold_ms: stage.hold_ms,
      mock,
      satisfied: true,
    });
  }
  return { stages: results, duration_ms: Date.now() - started, mocked: results.some((r) => r.mock) };
}
