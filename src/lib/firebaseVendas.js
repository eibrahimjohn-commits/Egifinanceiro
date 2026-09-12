import { initializeApp, getApps } from "firebase/app";
import { initializeFirestore } from "firebase/firestore";

// Mesmo projeto Firebase do EGI Financeiro — mas com uma instância PRÓPRIA,
// sem cache local persistente (persistentLocalCache/persistentMultipleTabManager).
//
// Por quê: aquele cache guarda, no localStorage do navegador (uns 5-10MB no
// total), um rastro de cada consulta já feita, pra coordenar abas e permitir
// uso offline. Isso é ótimo pra Pedidos/Vales, que se usa o dia inteiro. Mas
// Vendas faz MUITAS consultas pontuais (uma importação de anos de histórico,
// um dashboard trocando de período toda hora) — e isso sozinho já estourou
// esse espaço uma vez (erro "QuotaExceededError" ao importar).
//
// Aqui usamos cache só em memória (o padrão do initializeFirestore sem
// configurar localCache): nunca escreve no localStorage, nunca esbarra nesse
// limite — o preço é não funcionar offline nessa aba específica, o que não
// faz falta pra relatório histórico.
const firebaseConfig = {
  apiKey: "AIzaSyBmFbOWy-aMCwJJlzVytvqdc3itDaRH2b4",
  authDomain: "egifinanceiro.firebaseapp.com",
  projectId: "egifinanceiro",
  storageBucket: "egifinanceiro.firebasestorage.app",
  messagingSenderId: "705289484628",
  appId: "1:705289484628:web:8ebfab46447178f6c2f0c1",
  measurementId: "G-9426T5VST7",
};

function appVendas() {
  const nome = "vendas";
  const existente = getApps().find((a) => a.name === nome);
  if (existente) return existente;
  return initializeApp(firebaseConfig, nome);
}

let dbVendasCache = null;
export function dbVendas() {
  if (!dbVendasCache) dbVendasCache = initializeFirestore(appVendas(), {});
  return dbVendasCache;
}
