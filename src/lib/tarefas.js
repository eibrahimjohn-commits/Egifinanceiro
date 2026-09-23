import {
  collection, doc, addDoc, updateDoc, deleteDoc, getDocs, serverTimestamp,
} from "firebase/firestore";
import { db } from "./firebase";

const ref = collection(db, "tarefas");

export async function listarTarefas() {
  const snap = await getDocs(ref);
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

export async function criarTarefa({ texto, dataVencimento }) {
  const docRef = await addDoc(ref, {
    texto: texto.trim(),
    dataVencimento: dataVencimento || null,
    feita: false,
    createdAt: serverTimestamp(),
    concluidaEm: null,
  });
  return docRef.id;
}

export async function marcarTarefa(id, feita) {
  await updateDoc(doc(db, "tarefas", id), { feita, concluidaEm: feita ? serverTimestamp() : null });
}

export async function excluirTarefa(id) {
  await deleteDoc(doc(db, "tarefas", id));
}
