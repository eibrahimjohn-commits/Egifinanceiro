// Melhoria de fotos em massa: para cada produto, tenta apagar texto e
// equilibrar o tom do fundo em cada foto, sobe o resultado como uma nova
// imagem no Cloudinary e salva o produto — sempre preservando a foto
// original de cada posição, pra dar pra reverter depois.
import { autoWhiteBalance, detectAndEraseText, loadImageFromUrl } from "./imageProcessing";
import { uploadImageToCloudinary } from "./uploadImage";
import { saveProduct } from "./data";

async function enhanceOneImage(url, sharedWorker, { doText, doBackground }) {
  const img = await loadImageFromUrl(url);
  const canvas = document.createElement("canvas");
  canvas.width = img.naturalWidth;
  canvas.height = img.naturalHeight;
  const ctx = canvas.getContext("2d");
  ctx.drawImage(img, 0, 0);
  if (doText) await detectAndEraseText(canvas, sharedWorker);
  if (doBackground) autoWhiteBalance(canvas);
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("Falha ao gerar imagem"))), "image/jpeg", 0.9);
  });
}

// Desfaz as melhorias feitas em massa: volta as fotos de cada produto
// para as versões originais guardadas. Produtos que nunca passaram pela
// melhoria (sem originalImages) são ignorados.
export async function bulkRevertPhotos(products, { onProgress, cancelRef } = {}) {
  const total = products.length;
  let completed = 0;
  let reverted = 0;

  for (const p of products) {
    if (cancelRef && cancelRef.current) break;
    completed += 1;

    const originals = p.originalImages || [];
    const current = p.images || [];
    const hasChange = originals.length > 0 && originals.some((url, i) => url !== current[i]);

    if (hasChange) {
      try {
        await saveProduct({ ...p, images: [...originals], photosEnhancedAt: null });
        reverted += 1;
      } catch (e) {
        console.warn("Falha ao reverter fotos de", p.name, e);
      }
    }
    onProgress && onProgress(completed, total);
  }

  return reverted;
}

// products: lista de produtos a processar (já filtrada por você antes).
// skipAlreadyDone: pula produtos que já passaram por essa melhoria antes
// (controlado pelo campo photosEnhancedAt), pra poder rodar em várias
// levas sem repetir trabalho.
export async function bulkEnhancePhotos(products, { onProgress, cancelRef, skipAlreadyDone = true, doText = true, doBackground = true } = {}) {
  if (!doText && !doBackground) return 0;

  // o modelo de reconhecimento de texto só é carregado se a remoção de
  // texto estiver marcada — melhorar só o fundo fica bem mais rápido
  let worker = null;
  if (doText) {
    const { createWorker } = await import("tesseract.js");
    worker = await createWorker("por");
  }
  const total = products.length;
  let completed = 0;
  let productsChanged = 0;

  try {
    for (const p of products) {
      if (cancelRef && cancelRef.current) break;
      completed += 1;

      if (skipAlreadyDone && p.photosEnhancedAt) {
        onProgress && onProgress(completed, total);
        continue;
      }

      const images = p.images?.length ? [...p.images] : (p.image ? [p.image] : []);
      if (images.length === 0) {
        onProgress && onProgress(completed, total);
        continue;
      }
      // a "original" de cada posição só é definida na primeira vez —
      // rodadas seguintes nunca sobrescrevem essa referência
      const originalImages = p.originalImages?.length ? [...p.originalImages] : [...images];
      const newImages = [...images];

      for (let i = 0; i < images.length; i++) {
        if (cancelRef && cancelRef.current) break;
        try {
          const blob = await enhanceOneImage(images[i], worker, { doText, doBackground });
          const file = new File([blob], "foto-melhorada.jpg", { type: "image/jpeg" });
          const url = await uploadImageToCloudinary(file);
          newImages[i] = url;
        } catch (e) {
          console.warn("Falha ao melhorar foto de", p.name, e);
        }
      }

      try {
        await saveProduct({ ...p, images: newImages, originalImages, photosEnhancedAt: Date.now() });
        productsChanged += 1;
      } catch (e) {
        console.warn("Falha ao salvar produto após melhoria:", p.name, e);
      }

      onProgress && onProgress(completed, total);
    }
  } finally {
    if (worker) await worker.terminate();
  }

  return productsChanged;
}
