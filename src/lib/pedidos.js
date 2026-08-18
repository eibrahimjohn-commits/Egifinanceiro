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
//   valor (soma dos itens), valorPago (soma do que já entrou, ex: dinheiro),
//   data (data do lançamento), desconto,
//   formasPagamento: [{ tipo, valor, ...extras (cheque: valorTotal, numFolhas, prazoUltimoCheque, parcelas) }],
//   status: 'aberto' | 'pago', createdAt }
export async function criarPedido(pedido) {
  const valor = Number(pedido.valor) || 0;
  const valorPago = Number(pedido.valorPago) || 0;
  const payload = {
    ...pedido,
    valor,
    valorPago,
    status: valorPago >= valor ? "pago" : "aberto",
    createdAt: serverTimestamp(),
  };
  const docRef = await addDoc(pedidosRef, payload);
  return docRef.id;
}

export async function listarPedidos() {
  const snap = await getDocs(query(pedidosRef, orderBy("data", "desc")));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

// Registra uma baixa (pagamento) em um pedido em aberto
export async function registrarBaixa(pedidoId, pedidoAtual, baixa) {
  const novoValorPago = Number(pedidoAtual.valorPago || 0) + Number(baixa.valor);
  const novoStatus = novoValorPago >= Number(pedidoAtual.valor) ? "pago" : "aberto";

  const historico = pedidoAtual.pagamentos || [];
  historico.push({
    valor: Number(baixa.valor),
    data: baixa.data,
    formaPagamento: baixa.formaPagamento,
  });

  await updateDoc(doc(db, "pedidos", pedidoId), {
    valorPago: novoValorPago,
    status: novoStatus,
    pagamentos: historico,
  });

  return novoStatus;
}
