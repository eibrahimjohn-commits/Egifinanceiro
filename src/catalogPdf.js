import { currency, minPrice, unitPriceOf, cld, CLD_PDF, normalizeText } from "./shared";

// Classificação usada pelos dois PDFs padrão: qualquer categoria que
// pareça acessório de cabelo ou bijuteria vai pro PDF 1; tudo o mais
// (cosméticos, armarinhos, variedades, e qualquer categoria nova que for
// criada depois) cai automaticamente no PDF 2, sem precisar atualizar
// essa lista toda vez.
const HAIR_BIJU_KEYWORDS = [
  "presilha", "elastic", "laco", "faixa", "bandana", "tiara", "piranha",
  "bijuteria", "bijouteria", "bijoux", "cabelo", "prendedor", "xuxinha",
];
export function isHairOrBijuCategory(category) {
  const n = normalizeText(category || "");
  return HAIR_BIJU_KEYWORDS.some((k) => n.includes(k));
}

// Paleta "Vitrine Viva" — a mesma direção vibrante aplicada no site,
// agora também no catálogo em PDF.
const GRAPE = [91, 42, 134];
const GRAPE_DEEP = [58, 24, 90];
const PINK = [225, 36, 107];
const SUN = [255, 201, 60];
const MINT = [18, 184, 134];
const CREAM = [255, 253, 248];
const MUTED = [139, 122, 143];

const CONCURRENCY = 8;

// categorias fixas mostradas como "pílulas" decorativas na capa
const COVER_CHIPS = ["Presilhas", "Cosméticos", "Bijuterias", "Armarinhos", "Variedade"];

function loadOriginalJpeg(url, maxDim = 1200) {
  return new Promise((resolve) => {
    if (!url) { resolve(null); return; }
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      try {
        let w = img.naturalWidth, h = img.naturalHeight;
        const scale = Math.min(1, maxDim / Math.max(w, h));
        w = Math.max(1, Math.round(w * scale));
        h = Math.max(1, Math.round(h * scale));
        const canvas = document.createElement("canvas");
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext("2d");
        ctx.drawImage(img, 0, 0, w, h);
        resolve({ dataUrl: canvas.toDataURL("image/jpeg", 0.82), ratio: w / h });
      } catch {
        resolve(null);
      }
    };
    img.onerror = () => resolve(null);
    img.src = url;
  });
}

// Monta o título da capa a partir das categorias que realmente estão no
// que foi exportado — "Catálogo de Presilhas", "Catálogo de Cosméticos e
// Bijuterias", etc. Se for muito abrangente, cai num título geral.
function buildCatalogTitle(products) {
  const cats = Array.from(new Set(products.map((p) => p.category).filter(Boolean)));
  if (cats.length === 0) return "Catálogo de Produtos";
  if (cats.length === 1) return `Catálogo de ${cats[0]}`;
  if (cats.length <= 3) return `Catálogo de ${cats.slice(0, -1).join(", ")} e ${cats[cats.length - 1]}`;
  return "Catálogo Completo";
}

// Capa "cartão central": página inteira roxa, com um cartão claro
// arredondado flutuando no meio e bolhas coloridas escapando pelas
// bordas — a opção escolhida entre as alternativas testadas.
function drawCoverPage(doc, pageW, pageH, meta) {
  doc.setFillColor(...GRAPE);
  doc.rect(0, 0, pageW, pageH, "F");

  // bolhas decorativas nas bordas
  doc.setFillColor(...PINK);
  doc.circle(-6, 24, 40, "F");
  doc.setFillColor(...SUN);
  doc.circle(pageW + 6, pageH - 50, 34, "F");
  doc.setFillColor(...MINT);
  doc.circle(pageW - 26, 20, 16, "F");

  const cardY = 62;
  // altura do cartão calculada a partir do conteúdo (o título pode
  // ocupar uma ou duas linhas), pra não sobrar um vão grande embaixo
  doc.setFont("helvetica", "bold");
  doc.setFontSize(22);
  const titleLineCount = doc.splitTextToSize(meta.title, pageW - 80).length;
  const cardH = 150 + (titleLineCount - 1) * 9;
  doc.setFillColor(...CREAM);
  doc.roundedRect(22, cardY, pageW - 44, cardH, 22, 22, "F");

  doc.setFont("helvetica", "bold");
  doc.setFontSize(46);
  doc.setTextColor(...GRAPE_DEEP);
  doc.text(meta.brand, pageW / 2, cardY + 46, { align: "center" });

  doc.setFont("helvetica", "normal");
  doc.setFontSize(12);
  doc.setTextColor(...MUTED);
  doc.text(meta.brandSub, pageW / 2, cardY + 60, { align: "center" });

  doc.setDrawColor(...PINK);
  doc.setLineWidth(1.2);
  doc.line(pageW / 2 - 24, cardY + 72, pageW / 2 + 24, cardY + 72);

  doc.setFont("helvetica", "bold");
  doc.setFontSize(22);
  doc.setTextColor(...PINK);
  const titleLines = doc.splitTextToSize(meta.title, pageW - 80);
  doc.text(titleLines, pageW / 2, cardY + 96, { align: "center" });
  const afterTitle = cardY + 96 + (titleLines.length - 1) * 9;

  // "pílulas" de categoria decorativas
  doc.setFont("helvetica", "bold");
  doc.setFontSize(8.5);
  const chipY = afterTitle + 26;
  const gaps = 5;
  const widths = COVER_CHIPS.map((c) => doc.getTextWidth(c) + 13);
  const totalW = widths.reduce((s, w) => s + w, 0) + gaps * (COVER_CHIPS.length - 1);
  let cx = (pageW - totalW) / 2;
  COVER_CHIPS.forEach((c, i) => {
    const w = widths[i];
    doc.setFillColor(251, 234, 240);
    doc.roundedRect(cx, chipY - 6, w, 11, 5.5, 5.5, "F");
    doc.setTextColor(...GRAPE_DEEP);
    doc.text(c, cx + w / 2, chipY + 1, { align: "center" });
    cx += w + gaps;
  });

  doc.setFont("helvetica", "normal");
  doc.setFontSize(11);
  doc.setTextColor(...MUTED);
  // posicionado logo abaixo das pílulas (não fixo no rodapé do cartão) —
  // assim não colide quando o título ocupa duas linhas
  const countText = meta.noveltyCount > 0
    ? `${meta.count} produtos  \u00b7  ${meta.noveltyCount} novidade${meta.noveltyCount > 1 ? "s" : ""} no início`
    : `${meta.count} produtos  \u00b7  gerado em ${meta.date}`;
  doc.text(countText, pageW / 2, chipY + 22, { align: "center" });

  const noticeY = pageH - 40;
  doc.setFillColor(255, 255, 255);
  doc.roundedRect(30, noticeY - 12, pageW - 60, 26, 10, 10, "F");
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8.5);
  doc.setTextColor(...MUTED);
  const notice = doc.splitTextToSize(
    "As fotos são ilustrativas e os preços podem ser alterados sem aviso prévio. Peça confirmação de disponibilidade antes de fechar pedidos grandes.",
    pageW - 90
  );
  doc.text(notice, pageW / 2, noticeY, { align: "center" });
}

// Cada página mostra só a foto de capa do produto (a primeira), sempre no
// maior tamanho possível — testamos dividir em grade quando havia mais de
// uma foto, mas sobrava espaço em branco demais. Uma foto só, grande,
// fica mais bonito e mais fácil de folhear.
function drawProductPage(doc, p, imageResult, margin, contentW, pageH, pageW, isNovelty, photoIndex = 0, photoTotal = 0) {
  doc.setFillColor(...CREAM);
  doc.rect(0, 0, pageW, pageH, "F");

  const headerH = 32;
  doc.setFillColor(...GRAPE);
  doc.roundedRect(margin, margin, contentW, headerH, 14, 14, "F");
  doc.setFillColor(...PINK);
  doc.circle(margin + contentW - 6, margin + 4, 10, "F");

  doc.setFont("helvetica", "bold");
  doc.setFontSize(14);
  doc.setTextColor(...CREAM);
  const titleLines = doc.splitTextToSize(p.name, contentW - (isNovelty ? 48 : 16));
  doc.text(titleLines.slice(0, 2), margin + 8, margin + 13);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8.5);
  doc.setTextColor(255, 220, 236);
  const catPath = `${p.category || ""}${p.subcategory ? " \u203a " + p.subcategory : ""}`;
  const subtitle = p.code ? `${p.code}  \u00b7  ${catPath}` : catPath;
  const photoTag = photoTotal > 1 ? `${subtitle}  \u00b7  foto ${photoIndex + 1} de ${photoTotal}` : subtitle;
  doc.text(photoTag, margin + 8, margin + headerH - 6);

  if (isNovelty) {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(7.5);
    const label = "NOVIDADE";
    const w = doc.getTextWidth(label) + 10;
    const bx = margin + contentW - w - 8;
    doc.setFillColor(...SUN);
    doc.roundedRect(bx, margin + 6, w, 9, 4.5, 4.5, "F");
    doc.setTextColor(...GRAPE_DEEP);
    doc.text(label, bx + w / 2, margin + 12.2, { align: "center" });
  }

  const imgY0 = margin + headerH + 6;
  const footH = 30;
  const footY = pageH - margin - footH;
  const imgAreaH = footY - 6 - imgY0;

  doc.setFillColor(255, 255, 255);
  doc.roundedRect(margin, imgY0, contentW, imgAreaH, 12, 12, "F");
  if (imageResult) {
    const pad = 6;
    let drawW = contentW - pad * 2, drawH = drawW / imageResult.ratio;
    if (drawH > imgAreaH - pad * 2) { drawH = imgAreaH - pad * 2; drawW = drawH * imageResult.ratio; }
    const dx = margin + (contentW - drawW) / 2;
    const dy = imgY0 + (imgAreaH - drawH) / 2;
    doc.addImage(imageResult.dataUrl, "JPEG", dx, dy, drawW, drawH);
  }

  const price = minPrice(p);
  const unitPrice = unitPriceOf(p, price);
  doc.setFillColor(...PINK);
  doc.roundedRect(margin, footY, contentW, footH, 14, 14, "F");

  const cols4 = [
    { label: "VALOR", value: currency(price) },
    { label: "UNIDADE", value: p.unit || "\u2014" },
    { label: "VALOR UNIT.", value: unitPrice != null ? currency(unitPrice) : "\u2014" },
    { label: "C\u00d3DIGO", value: p.code || "\u2014" },
  ];
  const colW = contentW / cols4.length;
  cols4.forEach((c, idx) => {
    const x = margin + idx * colW + 8;
    doc.setFont("helvetica", "bold");
    doc.setFontSize(7);
    doc.setTextColor(255, 220, 236);
    doc.text(c.label, x, footY + 11);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(13);
    doc.setTextColor(...CREAM);
    doc.text(String(c.value), x, footY + 22, { maxWidth: colW - 10 });
  });
}

// Gera o PDF do catálogo. As fotos de vários produtos são buscadas ao
// mesmo tempo (em lotes), não uma de cada vez.
//
// Ao terminar, abre numa aba nova. Importante: usamos um "data URI" (a
// própria imagem do PDF embutida no endereço) em vez de um link
// temporário (blob) — um link temporário quebra e trava o Safari do
// iPhone com um erro ao reabrir o navegador depois de fechado. Se o
// arquivo for grande demais para isso, baixa direto no aparelho.
// Ordena o catálogo: novidades dos últimos 30 dias primeiro (também em
// ordem alfabética entre si), depois todo o resto em ordem alfabética.
// Assim quem folheia vê o que chegou de novo logo de cara, sem perder a
// previsibilidade de encontrar um item pelo nome.
function sortForCatalog(products) {
  const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;
  const byName = (a, b) =>
    String(a.name || "").localeCompare(String(b.name || ""), "pt-BR", { sensitivity: "base" });
  // usa só createdAt: produtos cadastrados antes dessa data não têm o
  // campo, então simplesmente não entram como novidade (correto — eles
  // são antigos mesmo).
  const novelties = products.filter((p) => (p.createdAt || 0) >= cutoff).sort(byName);
  const rest = products.filter((p) => (p.createdAt || 0) < cutoff).sort(byName);
  return { ordered: [...novelties, ...rest], noveltyCount: novelties.length };
}

export async function generateCatalogPdf(products, { onProgress, cancelRef } = {}) {
  const { jsPDF } = await import("jspdf");
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  const pageW = 210, pageH = 297, margin = 14;
  const contentW = pageW - margin * 2;

  const { ordered, noveltyCount } = sortForCatalog(products);

  // Uma página por FOTO: um produto com 3 fotos vira 3 páginas, todas com
  // as informações completas. Produto sem foto ainda gera uma página (só
  // com os dados). O contador "foto X de Y" só aparece quando há mais de
  // uma, pra não poluir o caso comum.
  const pages = [];
  ordered.forEach((p, productIndex) => {
    const imgs = p.images?.length ? p.images : (p.image ? [p.image] : []);
    const isNovelty = productIndex < noveltyCount;
    if (imgs.length === 0) {
      pages.push({ product: p, url: null, photoIndex: 0, photoTotal: 0, isNovelty });
    } else {
      imgs.forEach((url, i) => {
        pages.push({ product: p, url, photoIndex: i, photoTotal: imgs.length, isNovelty });
      });
    }
  });

  drawCoverPage(doc, pageW, pageH, {
    brand: "EGI",
    brandSub: "Importadora e Distribuidora",
    title: buildCatalogTitle(products),
    count: products.length,
    noveltyCount,
    date: new Date().toLocaleDateString("pt-BR"),
  });

  let completed = 0;
  for (let start = 0; start < pages.length; start += CONCURRENCY) {
    if (cancelRef && cancelRef.current) break;
    const batch = pages.slice(start, start + CONCURRENCY);

    const batchImages = await Promise.all(
      batch.map((entry) => loadOriginalJpeg(cld(entry.url, CLD_PDF), 1200))
    );

    for (let j = 0; j < batch.length; j++) {
      if (cancelRef && cancelRef.current) break;
      const entry = batch[j];
      doc.addPage();
      drawProductPage(doc, entry.product, batchImages[j], margin, contentW, pageH, pageW, entry.isNovelty, entry.photoIndex, entry.photoTotal);
      completed += 1;
      onProgress && onProgress(completed, pages.length);
    }
  }

  const today = new Date().toISOString().slice(0, 10);
  const filename = `catalogo-egi-${today}.pdf`;

  let dataUri = null;
  try {
    dataUri = doc.output("datauristring");
  } catch {
    dataUri = null;
  }

  // Abre só AGORA, com o PDF já pronto — nada de aba em branco esperando.
  // Usamos "data URI" (o PDF inteiro embutido no endereço) em vez de um
  // link temporário: o link temporário some quando a aba de origem fecha,
  // e é isso que travava o Safari do iPhone ao reabrir depois.
  //
  // PDFs muito grandes (catálogo inteiro, muitas fotos) podem estourar o
  // limite do navegador para esse formato — nesse caso, baixa direto.
  const tooLarge = !dataUri || dataUri.length > 15_000_000;
  if (!tooLarge) {
    const win = window.open(dataUri, "_blank");
    if (win) return;
    // se o navegador bloqueou a abertura, cai no download abaixo
  }
  doc.save(filename);
}
