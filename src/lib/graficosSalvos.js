import {
  collection, doc, getDoc, setDoc, getDocs, deleteDoc, serverTimestamp,
} from "firebase/firestore";
import { dbVendas } from "./firebaseVendas";

const ref = collection(dbVendas(), "graficosSalvos");

// A "chave" identifica exatamente uma configuração de gráfico (tipo +
// período + comparações). Duas visitas com a MESMA configuração caem na
// MESMA chave — a segunda vez é 1 leitura de documento em vez de reler e
// re-somar tudo de novo. Comparações são ordenadas antes de entrar na chave
// pra "A vs B" e "B vs A" caírem no mesmo cache.
export function chaveVendas(mesInicio, mesFim, comparacoes) {
  const comps = comparacoes.map((c) => `${c.mesInicio}-${c.mesFim}`).sort().join("_");
  return `vendas__${mesInicio}_${mesFim}__${comps}`;
}

export function chaveProdutos(mesInicio, mesFim) {
  return `produtos__${mesInicio}_${mesFim}`;
}

export async function buscarGraficoSalvo(chave) {
  const snap = await getDoc(doc(ref, chave));
  return snap.exists() ? snap.data() : null;
}

export async function salvarGraficoSalvo(chave, dados) {
  await setDoc(doc(ref, chave), { ...dados, atualizadoEm: serverTimestamp() });
}

export async function listarGraficosSalvos(tipo) {
  const snap = await getDocs(ref);
  return snap.docs
    .map((d) => ({ id: d.id, ...d.data() }))
    .filter((g) => g.tipo === tipo)
    .sort((a, b) => (b.atualizadoEm?.seconds || 0) - (a.atualizadoEm?.seconds || 0));
}

export async function excluirGraficoSalvo(id) {
  await deleteDoc(doc(ref, id));
}

// Chamado depois de qualquer importação bem-sucedida — os gráficos salvos
// podem cobrir meses que acabaram de mudar, então o cache inteiro é
// descartado em vez de arriscar mostrar um número desatualizado sem
// ninguém perceber. Como é só um cache (os dados de verdade continuam
// intactos), recriar tudo do zero na próxima visita é seguro, só custa
// as leituras normais de novo dessa vez.
export async function limparTodosGraficosSalvos() {
  const snap = await getDocs(ref);
  await Promise.all(snap.docs.map((d) => deleteDoc(doc(ref, d.id))));
}
