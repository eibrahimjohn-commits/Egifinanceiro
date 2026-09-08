import {
  collection, doc, addDoc, updateDoc, deleteDoc, getDocs, serverTimestamp,
} from "firebase/firestore";
import { db } from "./firebase";

const ref = collection(db, "pagamentosRecorrentes");

export async function listarRecorrentes() {
  const snap = await getDocs(ref);
  return snap.docs
    .map((d) => ({ id: d.id, ...d.data() }))
    .sort((a, b) => new Date(a.proximoVencimento) - new Date(b.proximoVencimento));
}

export async function criarRecorrente({ nome, valor, diaVencimento, proximoVencimento }) {
  await addDoc(ref, {
    nome,
    valor: Number(valor) || 0,
    diaVencimento: Number(diaVencimento),
    proximoVencimento,
    ultimoPagamento: null,
    createdAt: serverTimestamp(),
  });
}

export async function editarRecorrente(id, dados) {
  await updateDoc(doc(db, "pagamentosRecorrentes", id), dados);
}

export async function excluirRecorrente(id) {
  await deleteDoc(doc(db, "pagamentosRecorrentes", id));
}

// Avança a data pro mesmo dia do mês seguinte. Se o dia não existir no mês
// seguinte (ex: vencimento dia 31 e fevereiro só tem 28), cai no último dia
// daquele mês em vez de estourar pro mês depois.
function avancarUmMes(dataISO) {
  const d = new Date(dataISO + "T00:00:00");
  const diaAlvo = d.getDate();
  d.setMonth(d.getMonth() + 1);
  if (d.getDate() !== diaAlvo) d.setDate(0);
  return d.toISOString().slice(0, 10);
}

// Marca como pago: registra a data e já avança o vencimento pro mês seguinte
// (mesmo dia). A etiqueta some da lista de pendências agora e só volta a
// aparecer como "A vencer" quando faltar 1 semana pro novo vencimento.
export async function marcarRecorrentePago(id, atual) {
  const proximoVencimento = avancarUmMes(atual.proximoVencimento);
  await updateDoc(doc(db, "pagamentosRecorrentes", id), {
    ultimoPagamento: new Date().toISOString().slice(0, 10),
    proximoVencimento,
  });
  return proximoVencimento;
}

// Status é sempre calculado na hora — nunca gravado — porque senão precisaria
// de alguma rotina rodando todo dia só pra "descobrir" que passou o prazo.
// Atrasado: já passou do vencimento. A vencer: falta 1 semana ou menos.
// Pago: tem folga de mais de 1 semana até o próximo vencimento.
export function statusRecorrente(item) {
  const hoje = new Date();
  hoje.setHours(0, 0, 0, 0);
  const venc = new Date(item.proximoVencimento + "T00:00:00");
  const dias = Math.round((venc - hoje) / 86400000);
  if (dias < 0) return { label: "Atrasado", classe: "badge-atraso", dias };
  if (dias <= 7) return { label: "A vencer", classe: "badge-aberto", dias };
  return { label: "Pago", classe: "badge-pago", dias };
}
