import {
  collection,
  doc,
  getDoc,
  getDocs,
  addDoc,
  updateDoc,
  query,
  where,
  orderBy,
  serverTimestamp,
} from "firebase/firestore";
import { db } from "./firebase";

const clientesRef = collection(db, "clientes");

export function onlyDigits(str) {
  return (str || "").replace(/\D/g, "");
}

// Busca cliente por código exato, CNPJ (com ou sem máscara) ou nome (parcial, client-side)
export async function buscarCliente(termo) {
  const termoLimpo = (termo || "").trim();
  if (!termoLimpo) return { exact: null, matches: [] };

  const cnpjDigits = onlyDigits(termoLimpo);

  // 1. tenta por código exato
  const byCodeSnap = await getDocs(query(clientesRef, where("codigo", "==", termoLimpo)));
  if (!byCodeSnap.empty) {
    const d = byCodeSnap.docs[0];
    return { exact: { id: d.id, ...d.data() }, matches: [] };
  }

  // 2. tenta por CNPJ (armazenado só com dígitos)
  if (cnpjDigits.length >= 11) {
    const byCnpjSnap = await getDocs(query(clientesRef, where("cnpjDigits", "==", cnpjDigits)));
    if (!byCnpjSnap.empty) {
      const d = byCnpjSnap.docs[0];
      return { exact: { id: d.id, ...d.data() }, matches: [] };
    }
  }

  // 3. busca por nome (traz todos e filtra no cliente, base pequena)
  const allSnap = await getDocs(clientesRef);
  const termoLower = termoLimpo.toLowerCase();
  const matches = allSnap.docs
    .map((d) => ({ id: d.id, ...d.data() }))
    .filter(
      (c) =>
        c.nome?.toLowerCase().includes(termoLower) ||
        c.razaoSocial?.toLowerCase().includes(termoLower)
    );

  return { exact: null, matches };
}

export async function listarClientes() {
  const snap = await getDocs(query(clientesRef, orderBy("nome")));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

export async function salvarCliente(dadosCliente, id = null) {
  const payload = {
    ...dadosCliente,
    cnpjDigits: onlyDigits(dadosCliente.cnpj),
    updatedAt: serverTimestamp(),
  };
  if (id) {
    await updateDoc(doc(db, "clientes", id), payload);
    return id;
  } else {
    payload.createdAt = serverTimestamp();
    const docRef = await addDoc(clientesRef, payload);
    return docRef.id;
  }
}

// Consulta gratuita e pública de dados cadastrais de CNPJ via BrasilAPI
export async function consultarCnpj(cnpj) {
  const digits = onlyDigits(cnpj);
  if (digits.length !== 14) throw new Error("CNPJ precisa ter 14 dígitos");

  const resp = await fetch(`https://brasilapi.com.br/api/cnpj/v1/${digits}`);
  if (!resp.ok) throw new Error("CNPJ não encontrado na base pública");
  const data = await resp.json();

  return {
    razaoSocial: data.razao_social || "",
    nomeFantasia: data.nome_fantasia || data.razao_social || "",
    cidade: data.municipio || "",
    estado: data.uf || "",
  };
}
