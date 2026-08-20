import React, { useState, useRef, useEffect } from "react";
import { X, Check, Sparkles, Loader2, Undo2 } from "lucide-react";
import { PALETTE, btnPrimary, btnSecondarySmall, overlayStyle, modalStyle, modalHeaderStyle, iconBtn } from "./shared";
import { autoWhiteBalance, detectAndEraseText, loadImageFromBlob } from "./imageProcessing";

const VIEWPORT_MAX = 320; // tamanho máximo de exibição (a imagem cabe dentro disso, sem cortar)
const OUTPUT_MAX = 900;   // maior lado da foto final, em pixels
const MIN_BOX = 40;       // menor largura/altura que a caixa de recorte pode ter, em px de tela
const HANDLE = 18;        // área de toque da alça de redimensionar (maior que o desenho, pra facilitar no celular)

/* ---------------- remover fundo (IA) ---------------- */

async function removeBackgroundToWhite(sourceUrl) {
  const { removeBackground } = await import("@imgly/background-removal");
  const resultBlob = await removeBackground(sourceUrl);
  const img = await loadImageFromBlob(resultBlob);
  const canvas = document.createElement("canvas");
  canvas.width = img.naturalWidth;
  canvas.height = img.naturalHeight;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(img, 0, 0);
  return canvas.toDataURL("image/jpeg", 0.92);
}

/* ---------------- remover texto (IA), só dentro da área recortada ---------------- */

// Recorta só a área selecionada na tela de recorte, roda a remoção de
// texto nela (mais rápido que na foto inteira, e menos chance de mexer em
// algo fora do que interessa), e cola o resultado de volta na foto
// completa, na mesma posição.
async function removeTextInCropArea(fullImg, sx, sy, sw, sh) {
  const fullCanvas = document.createElement("canvas");
  fullCanvas.width = fullImg.naturalWidth;
  fullCanvas.height = fullImg.naturalHeight;
  const fullCtx = fullCanvas.getContext("2d");
  fullCtx.drawImage(fullImg, 0, 0);

  const regionCanvas = document.createElement("canvas");
  regionCanvas.width = Math.max(1, Math.round(sw));
  regionCanvas.height = Math.max(1, Math.round(sh));
  const regionCtx = regionCanvas.getContext("2d");
  regionCtx.drawImage(fullImg, sx, sy, sw, sh, 0, 0, regionCanvas.width, regionCanvas.height);

  const erased = await detectAndEraseText(regionCanvas);
  if (erased === 0) return null;

  fullCtx.drawImage(regionCanvas, sx, sy, sw, sh);
  return { dataUrl: fullCanvas.toDataURL("image/jpeg", 0.92), count: erased };
}

/* ---------------- ferramenta de recorte ---------------- */
// Caixa de seleção livre (não precisa mais ser quadrada) — arrasta pra
// mover, arrasta a alça do canto pra redimensionar largura e altura
// independentemente.
export default function ImageCropModal({ src, onCancel, onSave }) {
  const [activeSrc, setActiveSrc] = useState(src);
  const [originalSrc] = useState(src);
  const imgRef = useRef(null);
  const [natural, setNatural] = useState(null);
  const [box, setBox] = useState(null); // { x, y, w, h } em px de tela, relativo à imagem exibida
  const [saving, setSaving] = useState(false);
  const [whiteBalance, setWhiteBalance] = useState(true);
  const [removingBg, setRemovingBg] = useState(false);
  const [removingText, setRemovingText] = useState(false);
  const [aiEdited, setAiEdited] = useState(false);
  const [info, setInfo] = useState("");
  const [error, setError] = useState("");
  const dragState = useRef(null); // { mode: 'move'|'resize', startX, startY, startBox }

  useEffect(() => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      setNatural({ w: img.naturalWidth, h: img.naturalHeight });
      imgRef.current = img;
      setBox(null); // recalcula a caixa de recorte pro novo tamanho
    };
    img.onerror = () => setError("Não foi possível carregar essa imagem para edição.");
    img.src = activeSrc;
  }, [activeSrc]);

  const scale = natural ? Math.min(VIEWPORT_MAX / natural.w, VIEWPORT_MAX / natural.h) : 1;
  const dispW = natural ? natural.w * scale : 0;
  const dispH = natural ? natural.h * scale : 0;

  useEffect(() => {
    if (!natural || box) return;
    const w = dispW * 0.85;
    const h = dispH * 0.85;
    setBox({ x: (dispW - w) / 2, y: (dispH - h) / 2, w, h });
  }, [natural]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleRemoveBackground = async () => {
    setRemovingBg(true);
    setError("");
    setInfo("");
    try {
      const whiteBgDataUrl = await removeBackgroundToWhite(activeSrc);
      setActiveSrc(whiteBgDataUrl);
      setAiEdited(true);
    } catch (e) {
      console.error(e);
      setError("Não foi possível remover o fundo dessa foto. Você ainda pode continuar e recortar normalmente.");
    } finally {
      setRemovingBg(false);
    }
  };

  const handleRemoveText = async () => {
    if (!box || !imgRef.current) return;
    setRemovingText(true);
    setError("");
    setInfo("");
    try {
      const sx = box.x / scale, sy = box.y / scale;
      const sw = box.w / scale, sh = box.h / scale;
      const result = await removeTextInCropArea(imgRef.current, sx, sy, sw, sh);
      if (!result) {
        setInfo("Nenhum texto foi identificado dentro da área de recorte.");
      } else {
        setActiveSrc(result.dataUrl);
        setAiEdited(true);
      }
    } catch (e) {
      console.error(e);
      setError("Não foi possível remover texto dessa foto. Você ainda pode continuar e recortar normalmente.");
    } finally {
      setRemovingText(false);
    }
  };

  const handleUndoAiEdits = () => {
    setActiveSrc(originalSrc);
    setAiEdited(false);
    setError("");
    setInfo("");
  };

  if (!natural || !box) {
    return (
      <div style={overlayStyle}>
        <div style={{ ...modalStyle, maxWidth: 360, textAlign: "center", padding: 30 }} className="egi-sans">
          {error || "Carregando imagem..."}
          {error && <div style={{ marginTop: 16 }}><button onClick={onCancel} style={btnSecondarySmall}>Fechar</button></div>}
        </div>
      </div>
    );
  }

  const clampBox = (x, y, w, h) => {
    const cw = Math.max(MIN_BOX, Math.min(w, dispW));
    const ch = Math.max(MIN_BOX, Math.min(h, dispH));
    const cx = Math.max(0, Math.min(x, dispW - cw));
    const cy = Math.max(0, Math.min(y, dispH - ch));
    return { x: cx, y: cy, w: cw, h: ch };
  };

  const getPoint = (e) => {
    const t = e.touches ? e.touches[0] : e;
    return { x: t.clientX, y: t.clientY };
  };

  const startMove = (e) => {
    e.preventDefault();
    const p = getPoint(e);
    dragState.current = { mode: "move", startX: p.x, startY: p.y, startBox: box };
  };
  const startResize = (e) => {
    e.preventDefault();
    e.stopPropagation();
    const p = getPoint(e);
    dragState.current = { mode: "resize", startX: p.x, startY: p.y, startBox: box };
  };
  const onMove = (e) => {
    if (!dragState.current) return;
    const p = getPoint(e);
    const dx = p.x - dragState.current.startX;
    const dy = p.y - dragState.current.startY;
    const sb = dragState.current.startBox;
    if (dragState.current.mode === "move") {
      setBox(clampBox(sb.x + dx, sb.y + dy, sb.w, sb.h));
    } else {
      // largura e altura mudam independentes — não precisa mais ser quadrado
      setBox(clampBox(sb.x, sb.y, sb.w + dx, sb.h + dy));
    }
  };
  const endDrag = () => { dragState.current = null; };

  const handleSave = () => {
    setSaving(true);
    setError("");
    try {
      const sx = box.x / scale, sy = box.y / scale;
      const sw = box.w / scale, sh = box.h / scale;
      const aspect = sw / sh;
      let outW = OUTPUT_MAX, outH = OUTPUT_MAX;
      if (aspect >= 1) outH = Math.round(OUTPUT_MAX / aspect);
      else outW = Math.round(OUTPUT_MAX * aspect);

      const canvas = document.createElement("canvas");
      canvas.width = outW;
      canvas.height = outH;
      const ctx = canvas.getContext("2d");
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, outW, outH);
      ctx.drawImage(imgRef.current, sx, sy, sw, sh, 0, 0, outW, outH);
      if (whiteBalance) autoWhiteBalance(canvas);
      canvas.toBlob((blob) => {
        if (!blob) { setError("Não foi possível gerar a imagem recortada."); setSaving(false); return; }
        const file = new File([blob], "foto-recortada.jpg", { type: "image/jpeg" });
        onSave(file).catch((e) => { console.error(e); setError(e.message || "Erro ao salvar."); setSaving(false); });
      }, "image/jpeg", 0.92);
    } catch (e) {
      console.error(e);
      setError("Não foi possível editar essa imagem (pode ser uma restrição do navegador). Tente reenviar a foto.");
      setSaving(false);
    }
  };

  const busy = saving || removingBg || removingText;

  return (
    <div style={{ ...overlayStyle, zIndex: 70 }} onClick={busy ? undefined : onCancel}>
      <div style={{ ...modalStyle, maxWidth: 380 }} onClick={(e) => e.stopPropagation()}>
        <div style={modalHeaderStyle}>
          <h2 className="egi-display" style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>Recortar foto</h2>
          {!busy && <button onClick={onCancel} style={iconBtn}><X size={18} /></button>}
        </div>
        <div style={{ padding: 22 }} className="egi-sans">
          <div style={{ display: "flex", justifyContent: "center", gap: 8, marginBottom: 10, flexWrap: "wrap" }}>
            <button onClick={handleRemoveBackground} disabled={busy} className="egi-sans" style={{ ...btnSecondarySmall, opacity: removingBg ? 0.7 : 1 }}>
              {removingBg ? <Loader2 size={13} style={{ animation: "spin 1s linear infinite" }} /> : <Sparkles size={13} />}
              {removingBg ? "Removendo fundo..." : "Remover fundo"}
            </button>
            <button onClick={handleRemoveText} disabled={busy} className="egi-sans" style={{ ...btnSecondarySmall, opacity: removingText ? 0.7 : 1 }} title="Remove texto só dentro da área de recorte selecionada abaixo">
              {removingText ? <Loader2 size={13} style={{ animation: "spin 1s linear infinite" }} /> : <Sparkles size={13} />}
              {removingText ? "Removendo texto..." : "Remover texto (na área)"}
            </button>
          </div>
          {aiEdited && (
            <div style={{ display: "flex", justifyContent: "center", marginBottom: 10 }}>
              <button onClick={handleUndoAiEdits} disabled={busy} className="egi-sans" style={btnSecondarySmall}>
                <Undo2 size={13} /> Desfazer edições de IA
              </button>
            </div>
          )}
          {(removingBg || removingText) && (
            <p style={{ fontSize: 11, color: "#9c8a7f", textAlign: "center", marginTop: -4, marginBottom: 14 }}>
              Pode demorar um pouco mais na primeira vez, enquanto o navegador baixa o modelo de IA.
            </p>
          )}
          {info && <p style={{ fontSize: 11.5, color: PALETTE.brass, textAlign: "center", marginTop: -4, marginBottom: 14 }}>{info}</p>}

          <div
            style={{ width: dispW, height: dispH, margin: "0 auto", position: "relative", background: PALETTE.paperDeep, userSelect: "none", touchAction: "none" }}
            onMouseMove={onMove} onMouseUp={endDrag} onMouseLeave={endDrag}
            onTouchMove={onMove} onTouchEnd={endDrag}
          >
            <img src={activeSrc} alt="" draggable={false} style={{ width: dispW, height: dispH, display: "block", pointerEvents: "none" }} />

            {/* escurece tudo ao redor da caixa, em 4 tiras (evita cortar a alça de redimensionar) */}
            <div style={{ position: "absolute", left: 0, top: 0, width: dispW, height: box.y, background: "rgba(0,0,0,0.5)", pointerEvents: "none" }} />
            <div style={{ position: "absolute", left: 0, top: box.y + box.h, width: dispW, height: dispH - box.y - box.h, background: "rgba(0,0,0,0.5)", pointerEvents: "none" }} />
            <div style={{ position: "absolute", left: 0, top: box.y, width: box.x, height: box.h, background: "rgba(0,0,0,0.5)", pointerEvents: "none" }} />
            <div style={{ position: "absolute", left: box.x + box.w, top: box.y, width: dispW - box.x - box.w, height: box.h, background: "rgba(0,0,0,0.5)", pointerEvents: "none" }} />

            <div
              onMouseDown={startMove} onTouchStart={startMove}
              style={{
                position: "absolute", left: box.x, top: box.y, width: box.w, height: box.h,
                border: "2px solid #fff", cursor: "move", boxSizing: "border-box",
              }}
            >
              <div style={{ position: "absolute", inset: 0, border: "1px dashed rgba(255,255,255,0.6)" }} />
              <div
                onMouseDown={startResize} onTouchStart={startResize}
                style={{
                  position: "absolute", right: -HANDLE / 2, bottom: -HANDLE / 2, width: HANDLE, height: HANDLE,
                  borderRadius: "50%", background: PALETTE.brass, border: "2px solid #fff", cursor: "nwse-resize",
                }}
              />
            </div>
          </div>
          <p style={{ fontSize: 11.5, color: "#9c8a7f", marginTop: 12, textAlign: "center" }}>
            Arraste dentro do quadro para posicionar. Arraste o círculo no canto para redimensionar — largura e altura são livres, não precisa ser quadrado.
          </p>
          <label className="egi-sans" style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 7, marginTop: 10, fontSize: 12, color: "#5c4c43", cursor: "pointer" }}>
            <input type="checkbox" checked={whiteBalance} onChange={(e) => setWhiteBalance(e.target.checked)} />
            Corrigir tom do fundo automaticamente (deixar mais branco)
          </label>
          {error && <div style={{ color: PALETTE.bad, fontSize: 12.5, marginTop: 10, textAlign: "center" }}>{error}</div>}
        </div>
        <div style={{ padding: "14px 22px", borderTop: `1px solid ${PALETTE.line}`, display: "flex", justifyContent: "flex-end", gap: 10 }}>
          <button onClick={onCancel} className="egi-sans" style={btnSecondarySmall} disabled={busy}>Cancelar</button>
          <button onClick={handleSave} className="egi-sans" style={{ ...btnPrimary, opacity: busy ? 0.7 : 1 }} disabled={busy}>
            <Check size={15} /> {saving ? "Salvando..." : "Aplicar recorte"}
          </button>
        </div>
        <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
      </div>
    </div>
  );
}
