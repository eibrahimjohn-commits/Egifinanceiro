import React from "react";
import ReactDOM from "react-dom/client";
import StoreApp from "./Store";

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <StoreApp />
  </React.StrictMode>
);

// habilita "Adicionar à tela inicial" (instalar como app) no celular.
// Na primeira visita depois desta correção, desregistra qualquer versão
// antiga do service worker (que tinha o bug do Safari) antes de registrar
// a nova — assim quem já tinha instalado o site também é corrigido.
if ("serviceWorker" in navigator) {
  window.addEventListener("load", async () => {
    try {
      if (!localStorage.getItem("egi_sw_fixed_v2")) {
        const regs = await navigator.serviceWorker.getRegistrations();
        await Promise.all(regs.map((r) => r.unregister()));
        localStorage.setItem("egi_sw_fixed_v2", "1");
      }
      await navigator.serviceWorker.register("/sw.js");
    } catch (err) {
      console.warn("Service worker não pôde ser registrado:", err);
    }
  });
}
