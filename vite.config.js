import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "path";

export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      input: {
        main: resolve(__dirname, "index.html"),
        admin: resolve(__dirname, "admin/index.html"),
      },
      output: {
        // Separa bibliotecas de terceiros em arquivos próprios. Isso não
        // reduz o tamanho total baixado na primeira visita, mas faz o
        // navegador guardar esses arquivos em cache separadamente — nas
        // próximas visitas (ou depois de uma atualização do site), só o
        // pouco que realmente mudou precisa ser baixado de novo.
        manualChunks: {
          "vendor-react": ["react", "react-dom"],
          "vendor-firebase": ["firebase/app", "firebase/auth", "firebase/firestore"],
          "vendor-icons": ["lucide-react"],
        },
      },
    },
  },
});
