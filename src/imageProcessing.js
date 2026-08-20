// Algoritmos de melhoria de foto compartilhados entre a ferramenta de
// recorte (uma imagem por vez) e a melhoria em massa (várias de uma vez).

/* ---------------- correção de tom (fundo mais branco) ---------------- */

export function autoWhiteBalance(canvas) {
  const ctx = canvas.getContext("2d");
  const { width, height } = canvas;
  const imageData = ctx.getImageData(0, 0, width, height);
  const data = imageData.data;

  const lums = [];
  for (let i = 0; i < data.length; i += 16) {
    lums.push(0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]);
  }
  lums.sort((a, b) => a - b);
  const threshold = lums[Math.floor(lums.length * 0.97)] || 255;

  let sr = 0, sg = 0, sb = 0, count = 0;
  for (let i = 0; i < data.length; i += 4) {
    const lum = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
    if (lum >= threshold) { sr += data[i]; sg += data[i + 1]; sb += data[i + 2]; count++; }
  }
  if (count < 30) return;

  const clampGain = (g) => Math.min(Math.max(g, 0.85), 1.5);
  const gR = clampGain(255 / Math.max(sr / count, 1));
  const gG = clampGain(255 / Math.max(sg / count, 1));
  const gB = clampGain(255 / Math.max(sb / count, 1));

  for (let i = 0; i < data.length; i += 4) {
    data[i] = Math.min(255, data[i] * gR);
    data[i + 1] = Math.min(255, data[i + 1] * gG);
    data[i + 2] = Math.min(255, data[i + 2] * gB);
  }
  ctx.putImageData(imageData, 0, 0);
}

/* ---------------- remover texto (IA) ---------------- */

function sampleBorderColor(ctx, x, y, w, h, imgW, imgH) {
  const margin = 3;
  const sx = Math.max(0, x - margin);
  const sy = Math.max(0, y - margin);
  const sw = Math.min(imgW - sx, w + margin * 2);
  const sh = Math.min(imgH - sy, h + margin * 2);
  try {
    const data = ctx.getImageData(sx, sy, sw, sh).data;
    let r = 0, g = 0, b = 0, count = 0;
    for (let yy = 0; yy < sh; yy++) {
      for (let xx = 0; xx < sw; xx++) {
        const isBorder = xx < margin || yy < margin || xx >= sw - margin || yy >= sh - margin;
        if (!isBorder) continue;
        const idx = (yy * sw + xx) * 4;
        r += data[idx]; g += data[idx + 1]; b += data[idx + 2]; count++;
      }
    }
    if (count === 0) return "#ffffff";
    return `rgb(${Math.round(r / count)},${Math.round(g / count)},${Math.round(b / count)})`;
  } catch {
    return "#ffffff";
  }
}

// Confere se a região realmente tem letras pretas de verdade (não só uma
// textura ou sombra que a IA de reconhecimento confundiu com texto).
function looksLikeBlackText(ctx, x, y, w, h) {
  try {
    const data = ctx.getImageData(x, y, w, h).data;
    let dark = 0, total = 0;
    for (let i = 0; i < data.length; i += 4) {
      const lum = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
      if (lum < 85) dark++;
      total++;
    }
    if (total === 0) return false;
    const ratio = dark / total;
    return ratio > 0.04 && ratio < 0.55;
  } catch {
    return false;
  }
}

// Roda o reconhecimento de texto num canvas já desenhado e apaga (pinta
// com a cor do fundo local) só os trechos que realmente parecem letras
// pretas. Devolve quantos trechos foram apagados. Se receber um `worker`
// já criado (usado no processamento em massa, pra não recriar um por
// imagem), reaproveita ele em vez de criar um novo.
export async function detectAndEraseText(canvas, existingWorker) {
  const { createWorker } = await import("tesseract.js");
  const worker = existingWorker || await createWorker("por");
  let data;
  try {
    const result = await worker.recognize(canvas);
    data = result.data;
  } finally {
    if (!existingWorker) await worker.terminate();
  }

  const ctx = canvas.getContext("2d");
  const words = (data.words || []).filter((w) => w.confidence >= 50 && w.text && w.text.trim().length > 0);
  let erased = 0;

  words.forEach((w) => {
    const pad = 4;
    const x = Math.max(0, Math.round(w.bbox.x0 - pad));
    const y = Math.max(0, Math.round(w.bbox.y0 - pad));
    const bw = Math.min(canvas.width - x, Math.round(w.bbox.x1 - w.bbox.x0) + pad * 2);
    const bh = Math.min(canvas.height - y, Math.round(w.bbox.y1 - w.bbox.y0) + pad * 2);
    if (bw <= 0 || bh <= 0) return;
    if (!looksLikeBlackText(ctx, x, y, bw, bh)) return;
    const fillColor = sampleBorderColor(ctx, x, y, bw, bh, canvas.width, canvas.height);
    ctx.fillStyle = fillColor;
    ctx.fillRect(x, y, bw, bh);
    erased++;
  });

  return erased;
}

/* ---------------- utilidades de carregamento ---------------- */

export function loadImageFromBlob(blob) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => { resolve(img); URL.revokeObjectURL(url); };
    img.onerror = (e) => { URL.revokeObjectURL(url); reject(e); };
    img.src = url;
  });
}

export function loadImageFromUrl(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = url;
  });
}
