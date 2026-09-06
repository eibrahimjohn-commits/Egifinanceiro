import { collection, addDoc, getDocs, serverTimestamp } from "firebase/firestore";
import { db } from "./firebase";

const logRef = collection(db, "logAlteracoes");

// Registro central de auditoria — toda edição ou exclusão de compra, pagamento
// ou data de um pedido cai aqui, além de ficar também anotada no próprio
// pedido (pra quem está olhando aquele card específico no Vales). Isso existe
// separado pra dar uma aba única de "veja tudo que mudou, em qualquer
// pedido, nessa ordem", sem precisar abrir pedido por pedido.
export async function registrarLog({ tipo, pedidoId, clienteNome, descricao, valorAnterior, valorNovo }) {
  await addDoc(logRef, {
    tipo,
    pedidoId,
    clienteNome,
    descricao,
    valorAnterior: valorAnterior ?? null,
    valorNovo: valorNovo ?? null,
    data: new Date().toISOString(),
    createdAt: serverTimestamp(),
  });
}

export async function listarLogs() {
  const snap = await getDocs(logRef);
  return snap.docs
    .map((d) => ({ id: d.id, ...d.data() }))
    .sort((a, b) => new Date(b.data) - new Date(a.data));
}
