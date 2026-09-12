import * as XLSX from "xlsx";
import {
  collection, doc, getDocsFromServer, query, where, writeBatch, addDoc, serverTimestamp,
} from "firebase/firestore";
import { db } from "./firebase";
import { dbPortal } from "./firebasePortal";

const linhasRef = collection(db, "vendasLinhas");
const resumoDiarioRef = collection(db, "vendasResumoDiario");
const resumoProdutoMesRef = collection(db, "vendasResumoProdutoMes");
const resumoClienteMesRef = collection(db, "vendasResumoClienteMes");
const importacoesRef = collection(db, "vendasImportacoes");

const ANO_MINIMO_PLAUSIVEL = 2010;

function ehDataPlausivel(v) {
  if (!(v instanceof Date) || isNaN(v)) return false;
  const ano = v.getFullYear();
  return ano >= ANO_MINIMO_PLAUSIVEL && ano <= new Date().getFullYear() + 1;
}

function slug(str) {
  return String(str || "")
    .toLowerCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "sem-nome";
}

// Reconhece as colunas pelo nome (com folga pra acento/maiúscula/variação),
// igual ao padrão já usado no import de clientes — assim uma planilha
// exportada com cabeçalho ligeiramente diferente não quebra o import.
const ALIASES = {
  data: ["data"],
  pedido: ["# pedido", "numero pedido", "nº pedido", "pedido"],
  produto: ["descrição do produto", "descricao do produto", "produto"],
  codigo: ["código do produto", "codigo do produto", "código", "codigo"],
  cliente: ["cliente"],
  qtd: ["quantidade vendida", "quantidade", "qtd"],
  unidade: ["unidade", "un"],
  valorUnit: ["valor unitário", "valor unitario", "valor unit"],
  valorTotal: ["valor total", "total"],
};

function acharColuna(headers, aliases) {
  return headers.findIndex((h) => aliases.includes(String(h || "").trim().toLowerCase()));
}

// Lê o arquivo e devolve as linhas já limpas — sem gravar nada ainda. A tela
// mostra uma prévia antes de confirmar, igual ao padrão de importação que já
// existe em Base de Dados e Análises.
export async function lerPlanilhaVendas(file) {
  const buffer = await file.arrayBuffer();
  const wb = XLSX.read(buffer, { type: "array", cellDates: true });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const linhas = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null });
  if (linhas.length < 2) return { linhas: [], ignoradas: 0, meses: [] };

  const headers = linhas[0].map((h) => String(h || "").trim().toLowerCase());
  const col = {};
  Object.entries(ALIASES).forEach(([campo, aliases]) => { col[campo] = acharColuna(headers, aliases); });

  const faltando = Object.entries(col).filter(([, i]) => i === -1).map(([c]) => c);
  if (faltando.length > 0) {
    throw new Error(`Não encontrei a(s) coluna(s): ${faltando.join(", ")}. Confira o cabeçalho da planilha.`);
  }

  const processadas = [];
  let ignoradas = 0;
  const mesesSet = new Set();

  for (let r = 1; r < linhas.length; r++) {
    const linha = linhas[r];
    const pedido = linha[col.pedido];
    const valorTotal = linha[col.valorTotal];
    const dataRaw = linha[col.data];

    // linhas em branco (separador visual entre pedidos na planilha original)
    if (pedido === null || pedido === undefined || pedido === "") continue;
    if (typeof valorTotal !== "number") { ignoradas++; continue; }
    if (!ehDataPlausivel(dataRaw)) { ignoradas++; continue; }

    const dataISO = dataRaw.toISOString().slice(0, 10);
    const mes = dataISO.slice(0, 7);
    mesesSet.add(mes);

    processadas.push({
      data: dataISO,
      mes,
      pedido: String(pedido).trim(),
      produto: String(linha[col.produto] || "").trim(),
      codigoProduto: String(linha[col.codigo] || "").trim(),
      cliente: String(linha[col.cliente] || "").trim(),
      qtd: Number(linha[col.qtd]) || 0,
      unidade: String(linha[col.unidade] || "").trim(),
      valorUnitario: Number(linha[col.valorUnit]) || 0,
      valorTotal: Number(valorTotal) || 0,
    });
  }

  return { linhas: processadas, ignoradas, meses: Array.from(mesesSet).sort() };
}

// Busca o catálogo do Portal de Vendas (outro projeto Firebase) pra
// enriquecer cada linha com a categoria/subcategoria REAL do produto, em vez
// de adivinhar por palavra-chave. Se o Portal não responder por qualquer
// motivo, o import segue sem categoria — nunca trava por causa disso.
async function buscarCatalogoPortal() {
  try {
    const snap = await getDocsFromServer(collection(dbPortal(), "products"));
    const porCodigo = {};
    snap.docs.forEach((d) => {
      const p = d.data();
      if (p.code) porCodigo[String(p.code).trim()] = { categoria: p.category || "", subcategoria: p.subcategory || "" };
    });
    return porCodigo;
  } catch (e) {
    console.warn("Não consegui buscar o catálogo do Portal — seguindo sem categoria.", e);
    return {};
  }
}

// Grava as linhas (idempotente: ID determinístico por pedido+posição, então
// reimportar o mesmo arquivo/período não duplica nada) e recalcula os
// resumos SÓ dos meses tocados por essa importação — nunca varre o
// histórico inteiro, então o custo não cresce conforme os anos acumulam.
export async function importarPlanilhaVendas(linhas, nomeArquivo, aoProgredir) {
  const catalogo = await buscarCatalogoPortal();

  const comEnriquecimento = linhas.map((l) => ({
    ...l,
    categoria: catalogo[l.codigoProduto]?.categoria || "",
    subcategoria: catalogo[l.codigoProduto]?.subcategoria || "",
  }));

  // grava em lotes de 450 (limite do Firestore é 500 por batch)
  const TAMANHO_LOTE = 450;
  for (let i = 0; i < comEnriquecimento.length; i += TAMANHO_LOTE) {
    const pedaco = comEnriquecimento.slice(i, i + TAMANHO_LOTE);
    const batch = writeBatch(db);
    pedaco.forEach((l, j) => {
      const id = `${l.pedido}_${i + j}`;
      batch.set(doc(linhasRef, id), l);
    });
    await batch.commit();
    aoProgredir?.(Math.min(i + TAMANHO_LOTE, comEnriquecimento.length), comEnriquecimento.length);
  }

  const meses = Array.from(new Set(comEnriquecimento.map((l) => l.mes))).sort();
  for (const mes of meses) {
    await recalcularResumosDoMes(mes);
  }

  await addDoc(importacoesRef, {
    nomeArquivo,
    linhasProcessadas: linhas.length,
    meses,
    createdAt: serverTimestamp(),
  });

  const faturamentoTotal = linhas.reduce((s, l) => s + l.valorTotal, 0);
  return { linhasProcessadas: linhas.length, meses, faturamentoTotal };
}

// Relê só as linhas DAQUELE mês (algumas dezenas de milhares no pior caso,
// nunca o histórico inteiro) e regrava os 3 tipos de resumo do zero — por
// isso é seguro reimportar o mesmo período mais de uma vez, sem duplicar.
async function recalcularResumosDoMes(mes) {
  const snap = await getDocsFromServer(query(linhasRef, where("mes", "==", mes)));
  const linhasDoMes = snap.docs.map((d) => d.data());

  const porDia = new Map();
  const porProduto = new Map();
  const porCliente = new Map();

  linhasDoMes.forEach((l) => {
    const dia = porDia.get(l.data) || { data: l.data, mes, faturamento: 0, pedidosSet: new Set(), itens: 0 };
    dia.faturamento += l.valorTotal;
    dia.pedidosSet.add(l.pedido);
    dia.itens += 1;
    porDia.set(l.data, dia);

    const chaveProd = l.codigoProduto || l.produto;
    const prod = porProduto.get(chaveProd) || {
      codigoProduto: l.codigoProduto, produto: l.produto, categoria: l.categoria, subcategoria: l.subcategoria,
      mes, qtd: 0, faturamento: 0,
    };
    prod.qtd += l.qtd;
    prod.faturamento += l.valorTotal;
    porProduto.set(chaveProd, prod);

    const cli = porCliente.get(l.cliente) || { cliente: l.cliente, mes, faturamento: 0, pedidosSet: new Set() };
    cli.faturamento += l.valorTotal;
    cli.pedidosSet.add(l.pedido);
    porCliente.set(l.cliente, cli);
  });

  const TAMANHO_LOTE = 450;

  const diasArr = Array.from(porDia.values()).map((d) => ({
    data: d.data, mes: d.mes, faturamento: d.faturamento, pedidos: d.pedidosSet.size, itens: d.itens,
  }));
  for (let i = 0; i < diasArr.length; i += TAMANHO_LOTE) {
    const batch = writeBatch(db);
    diasArr.slice(i, i + TAMANHO_LOTE).forEach((d) => batch.set(doc(resumoDiarioRef, d.data), d));
    await batch.commit();
  }

  const produtosArr = Array.from(porProduto.values());
  for (let i = 0; i < produtosArr.length; i += TAMANHO_LOTE) {
    const batch = writeBatch(db);
    produtosArr.slice(i, i + TAMANHO_LOTE).forEach((p) => {
      const id = `${p.codigoProduto || slug(p.produto)}_${mes}`;
      batch.set(doc(resumoProdutoMesRef, id), p);
    });
    await batch.commit();
  }

  const clientesArr = Array.from(porCliente.values()).map((c) => ({
    cliente: c.cliente, mes: c.mes, faturamento: c.faturamento, pedidos: c.pedidosSet.size,
  }));
  for (let i = 0; i < clientesArr.length; i += TAMANHO_LOTE) {
    const batch = writeBatch(db);
    clientesArr.slice(i, i + TAMANHO_LOTE).forEach((c) => {
      const id = `${slug(c.cliente)}_${mes}`;
      batch.set(doc(resumoClienteMesRef, id), c);
    });
    await batch.commit();
  }
}

export async function listarImportacoes() {
  const snap = await getDocsFromServer(importacoesRef);
  return snap.docs
    .map((d) => ({ id: d.id, ...d.data() }))
    .sort((a, b) => (b.meses?.[0] || "").localeCompare(a.meses?.[0] || ""));
}

// --- Leitura pros dashboards — sempre nos resumos prontos, nunca no bruto ---

export async function listarResumoDiario(mesInicio, mesFim) {
  const snap = await getDocsFromServer(query(resumoDiarioRef, where("mes", ">=", mesInicio), where("mes", "<=", mesFim)));
  return snap.docs.map((d) => d.data()).sort((a, b) => a.data.localeCompare(b.data));
}

export async function listarResumoProdutos(mesInicio, mesFim) {
  const snap = await getDocsFromServer(query(resumoProdutoMesRef, where("mes", ">=", mesInicio), where("mes", "<=", mesFim)));
  const linhas = snap.docs.map((d) => d.data());

  const agrupado = new Map();
  linhas.forEach((l) => {
    const chave = l.codigoProduto || l.produto;
    const atual = agrupado.get(chave) || { codigoProduto: l.codigoProduto, produto: l.produto, categoria: l.categoria, subcategoria: l.subcategoria, qtd: 0, faturamento: 0 };
    atual.qtd += l.qtd;
    atual.faturamento += l.faturamento;
    agrupado.set(chave, atual);
  });
  return Array.from(agrupado.values()).sort((a, b) => b.faturamento - a.faturamento);
}

export async function listarResumoClientes(mesInicio, mesFim) {
  const snap = await getDocsFromServer(query(resumoClienteMesRef, where("mes", ">=", mesInicio), where("mes", "<=", mesFim)));
  const linhas = snap.docs.map((d) => d.data());

  const agrupado = new Map();
  linhas.forEach((l) => {
    const atual = agrupado.get(l.cliente) || { cliente: l.cliente, faturamento: 0, pedidos: 0 };
    atual.faturamento += l.faturamento;
    atual.pedidos += l.pedidos;
    agrupado.set(l.cliente, atual);
  });
  return Array.from(agrupado.values()).sort((a, b) => b.faturamento - a.faturamento);
}

// Detalhe bruto — só usado quando a pessoa clica pra investigar um caso
// específico (não entra nos dashboards, que sempre leem os resumos).
export async function listarLinhasDoPedido(pedido) {
  const snap = await getDocsFromServer(query(linhasRef, where("pedido", "==", String(pedido))));
  return snap.docs.map((d) => d.data());
}
