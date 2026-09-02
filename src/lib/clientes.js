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
// Gera um código de 8 dígitos garantidamente único, pra clientes lançados direto
// no pedido sem estarem cadastrados no sistema da empresa (sem código próprio).
export async function gerarCodigoUnico() {
  for (let tentativa = 0; tentativa < 8; tentativa++) {
    const candidato = String(Math.floor(10000000 + Math.random() * 90000000));
    const snap = await getDocs(query(clientesRef, where("codigo", "==", candidato)));
    if (snap.empty) return candidato;
  }
  // extremamente improvável de chegar aqui, mas garante que nunca trava
  return String(Date.now()).slice(-8);
}

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
  // Importante: NÃO usar orderBy() aqui. O Firestore exclui silenciosamente
  // qualquer documento que não tenha o campo usado na ordenação, o que fazia
  // clientes sumirem da lista sem nenhum erro. Ordenamos no cliente.
  const snap = await getDocs(clientesRef);
  return snap.docs
    .map((d) => ({ id: d.id, ...d.data() }))
    .sort((a, b) => (a.nome || "").localeCompare(b.nome || "", "pt-BR"));
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
  // linhas: [{ chave, codigo, nome, razaoSocial, cnpj, cidade, estado, representante }]
  const CHUNK = 400;
  let processados = 0;
  for (let i = 0; i < linhas.length; i += CHUNK) {
    const lote = linhas.slice(i, i + CHUNK);
    const batch = writeBatch(db);
    lote.forEach((c) => {
      const base = String(c.chave || c.codigo || c.cnpj || "").trim();
      const idSeguro = "cli_" + (base.replace(/[^a-zA-Z0-9_-]/g, "_") || Math.random().toString(36).slice(2, 12));
      const ref = doc(db, "clientes", idSeguro);
      batch.set(
        ref,
        {
          codigo: String(c.codigo ?? ""),
          nome: c.nome || "Sem nome",
          razaoSocial: c.razaoSocial || "",
          cnpj: c.cnpj || "",
          cnpjDigits: onlyDigits(c.cnpj || ""),
          cidade: c.cidade || "",
          estado: c.estado || "",
          representante: c.representante || "",
          cep: c.cep || "",
          contato: c.contato || "",
          telefones: c.telefones || [],
          whatsapp: c.whatsapp || "",
          ultimaCompraPlanilha: c.ultimaCompra || "",
          mediaCompra: c.mediaCompra || 0,
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

// --- Limpeza de duplicados ---------------------------------------------
// Agrupa clientes pela mesma identidade (código, senão CNPJ, senão nome) e
// aponta qual manter. Mantém o registro mais completo (mais campos preenchidos).

function pontuarCompletude(c) {
  let p = 0;
  if (c.ultimaCompraPlanilha) p += 3;
  if (c.telefones?.length) p += 2;
  if (c.whatsapp) p += 2;
  if (c.mediaCompra) p += 1;
  if (c.infoExtra?.consultadoEm) p += 2;
  if (c.cnpjDigits) p += 1;
  if (c.razaoSocial) p += 1;
  if (c.cidade) p += 1;
  if (c.representante) p += 1;
  if (c.grupo) p += 1;
  if (c.observacao) p += 1;
  return p;
}

export function analisarDuplicados(clientes) {
  const grupos = new Map();
  clientes.forEach((c) => {
    const chave =
      (c.codigo || "").trim() ||
      (c.cnpjDigits || "").trim() ||
      (c.nome || "").trim().toLowerCase();
    if (!chave) return;
    if (!grupos.has(chave)) grupos.set(chave, []);
    grupos.get(chave).push(c);
  });

  const paraRemover = [];
  let gruposComDuplicata = 0;

  grupos.forEach((lista) => {
    if (lista.length < 2) return;
    gruposComDuplicata++;
    const ordenados = [...lista].sort((a, b) => pontuarCompletude(b) - pontuarCompletude(a));
    // mantém o primeiro (mais completo), remove os demais
    ordenados.slice(1).forEach((c) => paraRemover.push(c));
  });

  return {
    totalAtual: clientes.length,
    gruposComDuplicata,
    paraRemover,
    totalDepois: clientes.length - paraRemover.length,
  };
}

export async function removerDuplicados(paraRemover, onProgresso) {
  const CHUNK = 400;
  let removidos = 0;
  for (let i = 0; i < paraRemover.length; i += CHUNK) {
    const lote = paraRemover.slice(i, i + CHUNK);
    const batch = writeBatch(db);
    lote.forEach((c) => batch.delete(doc(db, "clientes", c.id)));
    await batch.commit();
    removidos += lote.length;
    if (onProgresso) onProgresso(removidos, paraRemover.length);
  }
  return removidos;
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

// Marca que o contato foi feito com um cliente inativo — some da lista de inativos
// por 14 dias (ou até ele comprar de novo, o que vier primeiro).
export async function registrarContatoInativo(clienteId) {
  await updateDoc(doc(db, "clientes", clienteId), {
    ultimoContatoInativo: new Date().toISOString().slice(0, 10),
  });
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

  const montarTelefone = (ddd) => {
    const d = String(ddd || "").replace(/\D/g, "");
    if (d.length < 10) return "";
    return `(${d.slice(0, 2)}) ${d.slice(2)}`;
  };

  const telefones = [
    montarTelefone(data.ddd_telefone_1),
    montarTelefone(data.ddd_telefone_2),
  ].filter(Boolean);

  return {
    razaoSocial: data.razao_social || "",
    nomeFantasia: data.nome_fantasia || data.razao_social || "",
    cidade: data.municipio || "",
    estado: data.uf || "",
    infoExtra: {
      telefone: telefones[0] || "",
      telefones,
      email: data.email || "",
      situacaoCadastral: data.descricao_situacao_cadastral || "",
      capitalSocial: data.capital_social ?? null,
      porte: data.porte || data.descricao_porte || "",
      atividadePrincipal: data.cnae_fiscal_descricao || "",
      dataAbertura: data.data_inicio_atividade || "",
      consultadoEm: new Date().toISOString(),
    },
  };
}
