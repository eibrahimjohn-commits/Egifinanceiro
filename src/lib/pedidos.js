import {
  collection,
  doc,
  addDoc,
  updateDoc,
  getDocs,
  query,
  orderBy,
  serverTimestamp,
} from "firebase/firestore";
import { db } from "./firebase";

const pedidosRef = collection(db, "pedidos");

// pedido: { clienteId, clienteCodigo, clienteNome, clienteCidade, clienteEstado,
//   itens: [{ valor, data }],
//   valor (soma bruta dos itens), valorDevido (valor - desconto), valorPago (já recebido),
//   data (data do lançamento), desconto,
//   formasPagamento: [{ tipo, valor, ...extras (cheque: numFolhas, prazoUltimoCheque, parcelas) }],
//   pagamentos: [{ valor, data, formaPagamento, conta? }] (histórico de baixas),
//   status: 'aberto' | 'pago', createdAt }
export async function criarPedido(pedido) {
  const valor = Number(pedido.valor) || 0;
  const valorDevido = Number(pedido.valorDevido ?? valor);
  const valorPago = Number(pedido.valorPago) || 0;
  const payload = {
    ...pedido,
    valor,
    valorDevido,
    valorPago,
    status: valorPago >= valorDevido - 0.01 ? "pago" : "aberto",
    createdAt: serverTimestamp(),
  };
  const docRef = await addDoc(pedidosRef, payload);
  return docRef.id;
}

export async function listarPedidos() {
  // Sem orderBy: o Firestore omite documentos sem o campo ordenado. Ordenamos no cliente.
  const snap = await getDocs(pedidosRef);
  return snap.docs
    .map((d) => ({ id: d.id, ...d.data() }))
    .sort((a, b) => new Date(b.data || 0) - new Date(a.data || 0));
}

// Registra uma baixa (pagamento) em um pedido em aberto
export async function registrarBaixa(pedidoId, pedidoAtual, baixa) {
  const valorDevido = Number(pedidoAtual.valorDevido ?? pedidoAtual.valor);
  const novoValorPago = Number(pedidoAtual.valorPago || 0) + Number(baixa.valor);
  const novoStatus = novoValorPago >= valorDevido - 0.01 ? "pago" : "aberto";

  const historico = pedidoAtual.pagamentos || [];
  historico.push({
    valor: Number(baixa.valor),
    data: baixa.data,
    formaPagamento: baixa.formaPagamento,
    conta: baixa.conta || null,
  });

  await updateDoc(doc(db, "pedidos", pedidoId), {
    valorPago: novoValorPago,
    status: novoStatus,
    pagamentos: historico,
  });

  return novoStatus;
}
