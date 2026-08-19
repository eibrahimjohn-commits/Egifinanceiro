import { collection, addDoc, getDocs, query, orderBy, serverTimestamp } from "firebase/firestore";
import { db } from "./firebase";

const ref = collection(db, "pagamentosSaida");

export async function criarPagamentoSaida(pagamento) {
  const docRef = await addDoc(ref, { ...pagamento, createdAt: serverTimestamp() });
  return docRef.id;
}

export async function listarPagamentosSaida() {
  const snap = await getDocs(ref);
  return snap.docs
    .map((d) => ({ id: d.id, ...d.data() }))
    .sort((a, b) => new Date(b.data || 0) - new Date(a.data || 0));
}
