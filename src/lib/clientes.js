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
  writeBatch,
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

export async function importarClientes(linhas, onProgresso) {
  // linhas: [{ codigo, nome, razaoSocial, cnpj, cidade, estado }]
  const CHUNK = 400;
  let processados = 0;
  for (let i = 0; i < linhas.length; i += CHUNK) {
    const lote = linhas.slice(i, i + CHUNK);
    const batch = writeBatch(db);
    lote.forEach((c) => {
      const idSeguro = "cod_" + String(c.codigo).replace(/[^a-zA-Z0-9_-]/g, "_");
      const ref = doc(db, "clientes", idSeguro);
      batch.set(
        ref,
        {
          codigo: String(c.codigo),
          nome: c.nome,
          razaoSocial: c.razaoSocial || "",
          cnpj: c.cnpj || "",
          cnpjDigits: onlyDigits(c.cnpj || ""),
          cidade: c.cidade || "",
          estado: c.estado || "",
          updatedAt: serverTimestamp(),
        },
        { merge: true }
      );
    });
    await batch.commit();
    processados += lote.length;
    if (onProgresso) onProgresso(processados, linhas.length);
  }
  return processados;
}
// Enriquece em lote os clientes que têm CNPJ mas ainda não têm dados públicos.
// Vai devagar de propósito (a API pública tem limite por minuto) e pode ser parado.
export async function enriquecerClientesEmLote({ clientes, onProgresso, deveParar }) {
  const pendentes = clientes.filter(
    (c) => onlyDigits(c.cnpj || "").length === 14 && !c.infoExtra?.consultadoEm
  );

  let sucesso = 0;
  let falhas = 0;

  for (let i = 0; i < pendentes.length; i++) {
    if (deveParar && deveParar()) break;

    const cliente = pendentes[i];
    try {
      const dados = await consultarCnpj(cliente.cnpj);
      await updateDoc(doc(db, "clientes", cliente.id), {
        infoExtra: dados.infoExtra,
        razaoSocial: cliente.razaoSocial || dados.razaoSocial || "",
        cidade: cliente.cidade || dados.cidade || "",
        estado: cliente.estado || dados.estado || "",
        updatedAt: serverTimestamp(),
      });
      sucesso++;
    } catch {
      falhas++;
    }

    if (onProgresso) onProgresso({ feitos: i + 1, total: pendentes.length, sucesso, falhas });

    // pausa de ~1,5s entre consultas para respeitar o limite da API pública
    await new Promise((r) => setTimeout(r, 1500));
  }

  return { sucesso, falhas, totalPendentes: pendentes.length };
}

export async function listarGruposUnicos() {
  const snap = await getDocs(clientesRef);
  const grupos = new Set();
  snap.docs.forEach((d) => {
    const g = (d.data().grupo || "").trim();
    if (g) grupos.add(g);
  });
  return Array.from(grupos).sort();
}

// Consulta gratuita e pública de dados cadastrais de CNPJ via BrasilAPI.
// Traz também informações públicas adicionais (telefone, situação cadastral, capital social).
// Obs: faturamento da empresa NÃO é informação pública no Brasil (sigilo fiscal) — não é retornado.
export async function consultarCnpj(cnpj) {
  const digits = onlyDigits(cnpj);
  if (digits.length !== 14) throw new Error("CNPJ precisa ter 14 dígitos");

  const resp = await fetch(`https://brasilapi.com.br/api/cnpj/v1/${digits}`);
  if (!resp.ok) throw new Error("CNPJ não encontrado na base pública");
  const data = await resp.json();

  const telefone = data.ddd_telefone_1
    ? `(${data.ddd_telefone_1.slice(0, 2)}) ${data.ddd_telefone_1.slice(2)}`
    : "";

  return {
    razaoSocial: data.razao_social || "",
    nomeFantasia: data.nome_fantasia || data.razao_social || "",
    cidade: data.municipio || "",
    estado: data.uf || "",
    infoExtra: {
      telefone,
      situacaoCadastral: data.descricao_situacao_cadastral || "",
      capitalSocial: data.capital_social ?? null,
      atividadePrincipal: data.cnae_fiscal_descricao || "",
      consultadoEm: new Date().toISOString(),
    },
  };
}
