import React from "react";

// Direção "Vitrine Viva" — vibrante, colorida, feita pra quem descobre
// produto no feed do Instagram/WhatsApp, não numa planilha. Mantemos os
// mesmos NOMES de chave (plum, brass, etc.) usados em todo o app, só
// trocando os valores — assim o resto do código não precisa mudar linha
// por linha.
export const PALETTE = {
  ink: "#2B1B33",       // texto principal
  plum: "#E1246B",      // rosa vivo — accent/CTA principal (era vinho)
  plumDeep: "#5B2A86",  // roxo uva — cabeçalhos, fundo escuro (era vinho escuro)
  brass: "#E1246B",     // rosa vivo — botões primários, preço (era dourado)
  brassLight: "#F0729F",// rosa claro (era dourado claro)
  paper: "#FFFDF8",     // fundo da página (era creme)
  paperDeep: "#FBEAF0", // superfície secundária, tom rosa bem clarinho
  line: "#F0D8E4",      // bordas suaves
  good: "#12B886",      // menta — sucesso
  bad: "#E1246B",       // usa o próprio rosa pra alertas leves; erros graves usam vermelho abaixo
  danger: "#D62839",    // vermelho de verdade, pra erro grave (diferente de "bad" cosmético)
  sun: "#FFC93C",       // amarelo-sol — accent secundário/destaque
};

export const CATEGORY_LIST = ["Presilhas", "Elásticos", "Laços", "Bandanas", "Bijuterias", "Cosméticos", "Diversos"];

export function currency(n) {
  const v = Number(n) || 0;
  return v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

// remove acentos/cedilha para busca não sensível a acentuação
export function normalizeText(str) {
  return (str || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

// só as variações que a cliente pode ver/comprar (esconde as inativas)
export function activeVariations(product) {
  return (product?.variations || []).filter((v) => v.active !== false);
}

// menor preço entre as variações ativas, ou o preço base se não houver variação
export function minPrice(product) {
  const vars = activeVariations(product);
  return vars.length ? Math.min(...vars.map((v) => v.price)) : product.basePrice;
}

// preço por unidade quando o produto é vendido em pacote/caixa (packageQty > 1)
export function unitPriceOf(product, price) {
  const qty = Number(product.packageQty) || 1;
  if (qty <= 1) return null;
  return price / qty;
}

/* ---------------------------------------------------------------
   Otimização de imagens (Cloudinary)
   ---------------------------------------------------------------
   Sem isso, toda foto carrega no tamanho original que foi enviada —
   mesmo numa miniatura pequena de card. Isso consome banda do
   Cloudinary muito mais rápido que o necessário e deixa a vitrine
   mais lenta no celular. Pedindo uma versão redimensionada e já
   comprimida (qualidade automática, formato moderno como WebP/AVIF
   quando o navegador suporta), cada imagem chega bem mais leve.
--------------------------------------------------------------- */
// Tamanhos pedidos ao Cloudinary. Regra: pedir o MENOR tamanho que ainda
// fica nítido no lugar onde a foto aparece — pedir maior que isso é banda
// jogada fora (e banda é o recurso que aperta primeiro no plano gratuito).
// "q_auto:eco" comprime um pouco mais que o padrão, sem diferença
// perceptível numa tela de celular.
export const CLD_THUMB = "w_300,h_300,c_fill,g_auto,q_auto:eco,f_auto";  // cards da vitrine (2 fotos lado a lado = ~metade da largura)
export const CLD_DETAIL = "w_700,h_700,c_fill,g_auto,q_auto:eco,f_auto"; // ficha do produto, modo catálogo
export const CLD_FULL = "w_1400,c_limit,q_auto:good,f_auto";             // tela cheia — aqui vale manter mais qualidade
export const CLD_TINY = "w_120,h_120,c_fill,g_auto,q_auto:eco,f_auto";   // miniaturas 72px do painel
export const CLD_PDF = "w_1000,c_limit,q_auto:good,f_auto";              // catálogo em PDF — redimensiona sem cortar a foto
export const CLD_BULK = "w_1600,c_limit,q_auto:good";                    // baixar todas as fotos — mantém a extensão original, só comprime

export function cld(url, preset) {
  if (!url || typeof url !== "string" || !url.includes("/upload/")) return url;
  return url.replace("/upload/", `/upload/${preset}/`);
}

export const FONT_IMPORT = `
  @import url('https://fonts.googleapis.com/css2?family=Baloo+2:wght@600;700;800&family=Nunito:wght@400;500;600;700&display=swap');
  .egi-display { font-family: 'Baloo 2', sans-serif; }
  .egi-sans { font-family: 'Nunito', sans-serif; }
  * { box-sizing: border-box; }
  body { margin: 0; }
  ::-webkit-scrollbar { width: 8px; height: 8px; }
  ::-webkit-scrollbar-thumb { background: ${PALETTE.line}; border-radius: 4px; }
`;

export const btnPrimary = {
  display: "flex", alignItems: "center", gap: 8, padding: "11px 20px",
  background: PALETTE.brass, color: "#fff", border: "none", borderRadius: 999,
  fontSize: 14, fontWeight: 700, cursor: "pointer", fontFamily: "'Baloo 2', sans-serif",
  boxShadow: "0 3px 0 #A31650",
};
export const btnSecondarySmall = {
  display: "flex", alignItems: "center", gap: 6, padding: "8px 14px",
  background: "#fff", color: PALETTE.ink, border: `1px solid ${PALETTE.line}`, borderRadius: 999,
  fontSize: 12.5, fontWeight: 700, cursor: "pointer", fontFamily: "'Baloo 2', sans-serif",
  boxShadow: "0 2px 0 " + PALETTE.line,
};
export const inputBase = {
  width: "100%", padding: "10px 14px", borderRadius: 14, border: `1.5px solid ${PALETTE.line}`,
  fontSize: 13.5, outline: "none", background: "#fff", fontFamily: "inherit",
};
export const inputSmall = { ...inputBase, padding: "7px 11px", fontSize: 12.5, borderRadius: 10 };
export const iconBtn = { background: "none", border: "none", cursor: "pointer", color: PALETTE.ink, display: "flex", alignItems: "center", padding: 4 };
export const overlayStyle = { position: "fixed", inset: 0, background: "rgba(43,27,51,0.55)", zIndex: 50, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 };
export const modalStyle = { background: PALETTE.paper, borderRadius: 24, width: "100%", maxHeight: "88vh", display: "flex", flexDirection: "column", boxShadow: "0 20px 60px rgba(43,27,51,0.35)" };
export const modalHeaderStyle = { display: "flex", justifyContent: "space-between", alignItems: "center", padding: "18px 24px", borderBottom: `1px solid ${PALETTE.line}` };

export function LoadingBlock({ label }) {
  return (
    <div className="egi-sans" style={{ textAlign: "center", padding: "80px 0", color: PALETTE.plum, opacity: 0.7 }}>
      {label}
    </div>
  );
}

export function EmptyState({ text }) {
  return (
    <div className="egi-sans" style={{ textAlign: "center", padding: "70px 20px", color: "#8a7a6f", border: `1px dashed ${PALETTE.line}`, borderRadius: 14 }}>
      {text}
    </div>
  );
}

export function Field({ label, children }) {
  return (
    <div>
      <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 5, color: "#5c4c43" }}>{label}</div>
      {children}
    </div>
  );
}

export function ErrorBanner({ message }) {
  if (!message) return null;
  return (
    <div className="egi-sans" style={{ background: "#fbeceb", color: PALETTE.bad, border: `1px solid #e6bcb8`, borderRadius: 10, padding: "12px 16px", margin: "16px auto", maxWidth: 1180, fontSize: 13.5 }}>
      {message}
    </div>
  );
}
