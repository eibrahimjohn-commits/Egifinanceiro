// Cole aqui as informações do SEU Cloudinary (gratuito) para permitir
// upload de fotos direto do celular no painel.
//
// Como pegar:
// 1. Crie uma conta grátis em cloudinary.com
// 2. No painel (Dashboard), copie o valor "Cloud name" no topo da página
// 3. Vá em Settings (engrenagem) -> Upload -> role até "Upload presets"
//    -> "Add upload preset"
//    -> mude "Signing Mode" de "Signed" para "Unsigned"
//    -> Salve e copie o nome do preset gerado
//
// Cole os dois valores abaixo:

export const cloudinaryConfig = {
  cloudName: "lqun1lmx",
  uploadPreset: "wtt9pmq1",
};
