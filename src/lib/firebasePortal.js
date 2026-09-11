import { initializeApp, getApps, getApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";

// Conexão SÓ LEITURA com o projeto do Portal de Vendas — que é um projeto
// Firebase diferente do EGI Financeiro (mesmo padrão que o Portal já usa pra
// ler os Clientes Inativos daqui do Financeiro, só que no sentido inverso).
// Usamos pra puxar código, nome, categoria e subcategoria reais dos produtos
// e enriquecer o histórico de vendas, em vez de adivinhar categoria por
// palavra-chave.
const portalConfig = {
  apiKey: "AIzaSyAuzr9ofkjqY-IqAyzZT5QRetU1bt5QkgE",
  authDomain: "portal-de-vendas-egijj.firebaseapp.com",
  projectId: "portal-de-vendas-egijj",
  storageBucket: "portal-de-vendas-egijj.firebasestorage.app",
  messagingSenderId: "485832516215",
  appId: "1:485832516215:web:b3870c0005d5539c3fdc72",
};

// Nome próprio ("portalVendas") pra não colidir com o app padrão do
// Financeiro — os dois projetos convivem no mesmo bundle.
function appPortal() {
  const nome = "portalVendas";
  const existente = getApps().find((a) => a.name === nome);
  if (existente) return existente;
  return initializeApp(portalConfig, nome);
}

let dbPortalCache = null;
export function dbPortal() {
  if (!dbPortalCache) dbPortalCache = getFirestore(appPortal());
  return dbPortalCache;
}
