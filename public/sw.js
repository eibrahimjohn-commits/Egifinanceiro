// Service worker mínimo — existe principalmente para o navegador permitir
// "Adicionar à tela inicial" como um app de verdade. Não guarda nada
// offline de propósito, para sempre mostrar produtos e preços atuais.
//
// Importante: NÃO escutamos o evento "fetch" aqui. O Safari do iPhone tem
// um bug conhecido (erro "WebKitBlobResource") quando um service worker
// intercepta requisições numa página que também usa links de download
// (blob:) — como o botão de baixar PDF/planilha. Sem escutar "fetch", o
// navegador cuida de tudo normalmente, e a instalação como app continua
// funcionando do mesmo jeito.
self.addEventListener("install", () => {
  self.skipWaiting();
});
self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});
