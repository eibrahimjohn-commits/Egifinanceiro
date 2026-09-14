import {
  collection, doc, addDoc, updateDoc, getDocs, serverTimestamp, query, orderBy,
} from "firebase/firestore";
import { db } from "./firebase";
import { registrarLog } from "./auditoria";

const ref = collection(db, "chequesDevolvidos");

export const MOTIVOS_DEVOLUCAO = [
  { value: "sem_fundo", label: "Sem fundo" },
  { value: "sustado", label: "Sustado" },
  { value: "erro_preenchimento", label: "Erro de preenchimento/assinatura" },
  { value: "outro", label: "Outro" },
];

export async function listarChequesDevolvidos() {
  const snap = await getDocs(query(ref, orderBy("dataRegistro", "desc")));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

// Junta os cheques (dados na hora da venda + baixas registradas depois) de
// todos os pedidos de um cliente/grupo — é essa lista que a pessoa escolhe
// na hora de registrar um cheque devolvido, em vez de digitar valor e data
// de cabeça e arriscar errar ou duplicar um registro.
export function listarChequesDoCliente(pedidos) {
  const cheques = [];
  pedidos.forEach((p) => {
    (p.formasPagamento || [])
      .filter((f) => f.tipo === "cheque")
      .forEach((f) => {
        (f.parcelas || [{ numero: 1, valor: f.valor, data: f.data || p.data }]).forEach((parc) => {
          cheques.push({ valor: Number(parc.valor) || 0, data: parc.data, origem: "Recebido na venda", pedidoId: p.id });
        });
      });
    (p.pagamentos || [])
      .filter((pg) => pg.formaPagamento === "cheque")
      .forEach((pg) => {
        (pg.parcelas || [{ numero: 1, valor: pg.valor, data: pg.data }]).forEach((parc) => {
          cheques.push({ valor: Number(parc.valor) || 0, data: parc.data, origem: "Pagamento registrado", pedidoId: p.id });
        });
      });
  });
  return cheques.sort((a, b) => new Date(b.data) - new Date(a.data));
}

export async function registrarChequeDevolvido(dados) {
  const payload = {
    clienteId: dados.clienteId || null,
    clienteNome: dados.clienteNome,
    clienteGrupo: dados.clienteGrupo || "",
    clienteRepresentante: dados.clienteRepresentante || "",
    valorCheque: Number(dados.valorCheque) || 0,
    dataCheque: dados.dataCheque,
    fornecedor: dados.fornecedor || "",
    motivo: dados.motivo,
    motivoDetalhe: dados.motivo === "outro" ? (dados.motivoDetalhe || "") : "",
    dataRegistro: dados.dataRegistro,
    status: "aberto",
    valorPago: 0,
    pagamentos: [],
    createdAt: serverTimestamp(),
  };
  const docRef = await addDoc(ref, payload);

  await registrarLog({
    tipo: "cheque_devolvido_registrado",
    pedidoId: dados.pedidoId || docRef.id,
    clienteNome: dados.clienteNome,
    descricao: `Cheque devolvido registrado — ${MOTIVOS_DEVOLUCAO.find((m) => m.value === dados.motivo)?.label || dados.motivo}${dados.fornecedor ? ` (via ${dados.fornecedor})` : ""}`,
    valorAnterior: null,
    valorNovo: payload.valorCheque,
  });

  return docRef.id;
}

// Mesmo espírito do registrarBaixa de pedidos normais — soma ao histórico de
// pagamentos desse cheque devolvido e marca como quitado quando bater o
// valor total.
export async function registrarPagamentoChequeDevolvido(id, chequeAtual, baixa) {
  const historico = [...(chequeAtual.pagamentos || [])];
  historico.push({
    valor: Number(baixa.valor),
    data: baixa.data,
    formaPagamento: baixa.formaPagamento,
    conta: baixa.conta || null,
    ...(baixa.descricao ? { descricao: baixa.descricao } : {}),
  });
  const novoValorPago = historico.reduce((s, pg) => s + (Number(pg.valor) || 0), 0);
  const novoStatus = novoValorPago >= chequeAtual.valorCheque - 0.01 ? "pago" : "aberto";

  await updateDoc(doc(db, "chequesDevolvidos", id), {
    pagamentos: historico,
    valorPago: novoValorPago,
    status: novoStatus,
  });

  return novoStatus;
}

export async function editarChequeDevolvido(id, dados) {
  await updateDoc(doc(db, "chequesDevolvidos", id), dados);
}
