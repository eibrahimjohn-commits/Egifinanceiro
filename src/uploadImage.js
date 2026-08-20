import { cloudinaryConfig } from "./cloudinaryConfig";

// Envia um arquivo de imagem (tirado da câmera ou escolhido da galeria)
// direto para o Cloudinary e devolve a URL pública da foto já hospedada.
export async function uploadImageToCloudinary(file) {
  if (!cloudinaryConfig.cloudName || cloudinaryConfig.cloudName === "COLE_AQUI") {
    throw new Error("Configuração do Cloudinary não preenchida (src/cloudinaryConfig.js).");
  }
  const formData = new FormData();
  formData.append("file", file);
  formData.append("upload_preset", cloudinaryConfig.uploadPreset);

  const res = await fetch(`https://api.cloudinary.com/v1_1/${cloudinaryConfig.cloudName}/image/upload`, {
    method: "POST",
    body: formData,
  });
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Falha no upload da imagem: ${errText}`);
  }
  const data = await res.json();
  return data.secure_url;
}
