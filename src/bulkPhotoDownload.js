// Baixa as fotos dos produtos num .zip só, nomeando cada arquivo com o
// nome do produto e em ordem alfabética. Busca várias fotos ao mesmo
// tempo (mais rápido), com progresso e opção de cancelar — útil porque um
// catálogo grande pode ter milhares de fotos.
import { cld, CLD_BULK } from "./shared";

const CONCURRENCY = 8;

function sanitizeFilename(s) {
  return String(s || "")
    .replace(/[\\/:*?"<>|]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 90);
}

// hqOriginal=true baixa o arquivo exatamente como foi enviado (mais
// pesado, mais lento). Por padrão (false), pede uma versão comprimida ao
// Cloudinary — sem cortar nem reduzir muito a resolução, só otimizando o
// peso do arquivo, o que deixa o download bem mais rápido na maioria dos
// casos (fotos de celular costumam vir bem maiores do que precisam).
export async function downloadAllPhotos(products, { onProgress, cancelRef, hqOriginal = false } = {}) {
  const JSZip = (await import("jszip")).default;
  const zip = new JSZip();
  const total = products.length;
  let completed = 0;
  let photoCount = 0;

  // ordem alfabética pelo nome, respeitando acentos do português
  const ordered = products.slice().sort((a, b) =>
    String(a.name || "").localeCompare(String(b.name || ""), "pt-BR", { sensitivity: "base" })
  );

  // dois produtos diferentes podem ter o mesmo nome — como o código não
  // entra mais no nome do arquivo, controlamos aqui pra que um não
  // sobrescreva o outro dentro do zip.
  const usedNames = new Set();
  const uniqueName = (base) => {
    let candidate = base;
    let n = 2;
    while (usedNames.has(candidate.toLowerCase())) {
      candidate = `${base} (${n})`;
      n += 1;
    }
    usedNames.add(candidate.toLowerCase());
    return candidate;
  };

  for (let start = 0; start < ordered.length; start += CONCURRENCY) {
    if (cancelRef && cancelRef.current) break;
    const batch = ordered.slice(start, start + CONCURRENCY);
    await Promise.all(batch.map(async (p) => {
      const imgs = p.images?.length ? p.images : (p.image ? [p.image] : []);
      const baseName = uniqueName(sanitizeFilename(p.name) || p.id);
      for (let i = 0; i < imgs.length; i++) {
        try {
          const url = hqOriginal ? imgs[i] : cld(imgs[i], CLD_BULK);
          const res = await fetch(url);
          if (!res.ok) continue;
          const blob = await res.blob();
          const suffix = imgs.length > 1 ? ` (${i + 1})` : "";
          zip.file(`${baseName}${suffix}.jpg`, blob);
          photoCount += 1;
        } catch (e) {
          console.warn("Falha ao baixar foto de", p.name, e);
        }
      }
      completed += 1;
      onProgress && onProgress(completed, total);
    }));
  }

  if (photoCount === 0) return 0;

  const blob = await zip.generateAsync({ type: "blob" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  const today = new Date().toISOString().slice(0, 10);
  a.download = `fotos-egi-${today}.zip`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return photoCount;
}
