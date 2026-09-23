import * as XLSX from "xlsx";
import {
  collection, doc, getDocsFromServer, query, where, writeBatch, addDoc, serverTimestamp,
} from "firebase/firestore";
import { dbVendas } from "./firebaseVendas";
import { dbPortal } from "./firebasePortal";

const db = dbVendas();

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
// Timeout próprio: se o Portal não responder (rede lenta, CORS, regra de
// segurança bloqueando sem erro claro...), essa promise nunca resolveria
// sozinha, e o "try/catch" ali embaixo não ajuda em nada nesse caso — ele só
// pega REJEIÇÃO, não uma promise pendurada pra sempre. Isso é o que estava
// travando a importação inteira em "0 de X", sem erro nenhum aparecer.
function comTimeout(promessa, ms) {
  return Promise.race([
    promessa,
    new Promise((_, reject) => setTimeout(() => reject(new Error("tempo esgotado")), ms)),
  ]);
}

// Guarda o catálogo em memória durante a sessão: ele é usado no import e
// também na exibição (enriquecerCategorias), sem rebuscar a cada tela.
let catalogoCache = null;

export async function buscarCatalogoPortal() {
  if (catalogoCache) return catalogoCache;
  catalogoCache = await lerCatalogoPortal();
  return catalogoCache;
}

async function lerCatalogoPortal() {
  try {
    const snap = await comTimeout(getDocsFromServer(collection(dbPortal(), "products")), 8000);
    const porCodigo = {};
    snap.docs.forEach((d) => {
      const p = d.data();
      if (p.code) porCodigo[String(p.code).trim()] = { categoria: p.category || "", subcategoria: p.subcategory || "" };
    });
    return porCodigo;
  } catch (e) {
    console.warn("Não consegui buscar o catálogo do Portal (ou demorou demais) — seguindo sem categoria.", e);
    return {};
  }
}

// Grava as linhas (idempotente: ID determinístico por pedido+posição, então
// reimportar o mesmo arquivo/período não duplica nada) e recalcula os
// resumos SÓ dos meses tocados por essa importação — nunca varre o
// histórico inteiro, então o custo não cresce conforme os anos acumulam.
// Grava um array de objetos em lotes de até 450 (limite do Firestore é 500
// por batch), disparando os commits em PARALELO em vez de um de cada vez.
// É essa troca (série -> paralelo) que faz uma importação de dezenas de
// milhares de linhas caber em segundos em vez de minutos — o gargalo nunca
// foi o Firestore em si, era esperar cada lote terminar antes de começar o
// próximo, quando eles não dependem uns dos outros.
async function gravarEmLotesParalelo(itens, referencia, montarId, aoProgredir) {
  const TAMANHO_LOTE = 450;
  let feitos = 0;
  const lotes = [];
  for (let i = 0; i < itens.length; i += TAMANHO_LOTE) {
    lotes.push(itens.slice(i, i + TAMANHO_LOTE));
  }
  await Promise.all(lotes.map(async (pedaco) => {
    const batch = writeBatch(db);
    pedaco.forEach((item, j) => batch.set(doc(referencia, montarId(item, j)), item));
    await batch.commit();
    feitos += pedaco.length;
    aoProgredir?.(Math.min(feitos, itens.length), itens.length);
  }));
}

export async function importarPlanilhaVendas(linhas, nomeArquivo, aoProgredir) {
  const catalogo = await buscarCatalogoPortal();

  const comEnriquecimento = linhas.map((l, i) => ({
    ...l,
    categoria: catalogo[l.codigoProduto]?.categoria || "",
    subcategoria: catalogo[l.codigoProduto]?.subcategoria || "",
    _indice: i, // usado só pra montar um ID de documento único, não é gravado como veio
  }));

  await gravarEmLotesParalelo(
    comEnriquecimento, linhasRef,
    (l) => `${l.pedido}_${l._indice}`,
    aoProgredir
  );

  const meses = Array.from(new Set(comEnriquecimento.map((l) => l.mes))).sort();
  // Meses diferentes não dependem um do outro — recalcula todos em paralelo.
  await Promise.all(meses.map((mes) => recalcularResumosDoMes(mes)));

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

  const diasArr = Array.from(porDia.values()).map((d) => ({
    data: d.data, mes: d.mes, faturamento: d.faturamento, pedidos: d.pedidosSet.size, itens: d.itens,
  }));
  const produtosArr = Array.from(porProduto.values());
  const clientesArr = Array.from(porCliente.values()).map((c) => ({
    cliente: c.cliente, mes: c.mes, faturamento: c.faturamento, pedidos: c.pedidosSet.size,
  }));

  // Os 3 resumos são independentes entre si — grava os 3 ao mesmo tempo em
  // vez de um depois do outro.
  await Promise.all([
    gravarEmLotesParalelo(diasArr, resumoDiarioRef, (d) => d.data),
    gravarEmLotesParalelo(produtosArr, resumoProdutoMesRef, (p) => `${p.codigoProduto || slug(p.produto)}_${mes}`),
    gravarEmLotesParalelo(clientesArr, resumoClienteMesRef, (c) => `${slug(c.cliente)}_${mes}`),
  ]);
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

  // Cada doc do resumo é UM produto em UM mês em que ele vendeu (o resumo
  // mensal só grava produto que teve venda naquele mês — mês parado não
  // gera doc). Por isso contar os docs por produto dá certinho "quantos
  // meses, dentro do período escolhido, esse produto vendeu alguma coisa" —
  // sem misturar com meses em que ele simplesmente não tinha estoque.
  const agrupado = new Map();
  linhas.forEach((l) => {
    const chave = l.codigoProduto || l.produto;
    const atual = agrupado.get(chave) || {
      codigoProduto: l.codigoProduto, produto: l.produto, categoria: l.categoria, subcategoria: l.subcategoria,
      qtd: 0, faturamento: 0, mesesComVenda: 0,
    };
    atual.qtd += l.qtd;
    atual.faturamento += l.faturamento;
    atual.mesesComVenda += 1;
    agrupado.set(chave, atual);
  });
  return Array.from(agrupado.values())
    // Faturamento médio só nos meses em que o produto de fato vendeu — não
    // dilui por mês parado (falta de estoque, por exemplo), que é exatamente
    // o viés que a média simples por mês do período teria.
    .map((p) => ({ ...p, faturamentoPorMesVendido: p.mesesComVenda ? p.faturamento / p.mesesComVenda : 0 }))
    .sort((a, b) => b.faturamento - a.faturamento);
}

// Quantos meses o período selecionado abrange (denominador de contexto: "8
// de 12 meses vendeu" é mais claro que só "8 meses").
export function contarMesesPeriodo(mesInicio, mesFim) {
  const [aIni, mIni] = mesInicio.split("-").map(Number);
  const [aFim, mFim] = mesFim.split("-").map(Number);
  return (aFim - aIni) * 12 + (mFim - mIni) + 1;
}

// Preenche categoria/subcategoria que ficaram em branco, cruzando o código do
// produto com o catálogo do Portal. Serve pros dados importados ANTES de a
// busca de categoria existir: corrige a exibição sem precisar reimportar.
// Só preenche o que está vazio — categoria já gravada é mantida.
export async function enriquecerCategorias(produtos) {
  if (!produtos?.length) return produtos || [];
  if (produtos.every((p) => p.categoria)) return produtos;
  const catalogo = await buscarCatalogoPortal();
  if (!Object.keys(catalogo).length) return produtos;
  return produtos.map((p) => {
    if (p.categoria) return p;
    const doCatalogo = catalogo[String(p.codigoProduto || "").trim()];
    return doCatalogo ? { ...p, categoria: doCatalogo.categoria, subcategoria: doCatalogo.subcategoria } : p;
  });
}

// Grava de vez a categoria nos resumos que estão sem ela, cruzando o código
// com o catálogo do Portal. Roda uma vez por período: depois disso os dados
// já saem do banco com categoria e o cruzamento não se repete.
// Só toca no que está vazio e só em quem tem correspondência no catálogo.
export async function gravarCategoriasNosResumos(mesInicio, mesFim) {
  const snap = await getDocsFromServer(query(resumoProdutoMesRef, where("mes", ">=", mesInicio), where("mes", "<=", mesFim)));
  const semCategoria = snap.docs.filter((d) => !d.data().categoria);
  if (!semCategoria.length) return 0;

  const catalogo = await buscarCatalogoPortal();
  if (!Object.keys(catalogo).length) return 0;

  const paraAtualizar = semCategoria
    .map((d) => ({ ref: d.ref, doCatalogo: catalogo[String(d.data().codigoProduto || "").trim()] }))
    .filter((x) => x.doCatalogo && (x.doCatalogo.categoria || x.doCatalogo.subcategoria));
  if (!paraAtualizar.length) return 0;

  const TAMANHO_LOTE = 450;
  const lotes = [];
  for (let i = 0; i < paraAtualizar.length; i += TAMANHO_LOTE) lotes.push(paraAtualizar.slice(i, i + TAMANHO_LOTE));
  await Promise.all(lotes.map(async (pedaco) => {
    const batch = writeBatch(db);
    pedaco.forEach(({ ref: docRef, doCatalogo }) => batch.update(docRef, {
      categoria: doCatalogo.categoria || "",
      subcategoria: doCatalogo.subcategoria || "",
    }));
    await batch.commit();
  }));
  return paraAtualizar.length;
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

// Detalhe de um produto específico — só é chamado quando a pessoa clica pra
// investigar (não faz parte do carregamento normal do dashboard). Lê o bruto
// de TODAS as vendas desse produto (todos os meses importados) e monta:
// evolução mês a mês, ranking de clientes (todo o histórico e últimos 12
// meses) e quantos clientes distintos já compraram.
export async function buscarDetalheProduto(codigoProduto) {
  const snap = await getDocsFromServer(query(linhasRef, where("codigoProduto", "==", codigoProduto)));
  const linhas = snap.docs.map((d) => d.data());

  const porMes = new Map();
  const porClienteTodoPeriodo = new Map();
  const porClienteUltimoAno = new Map();

  const hoje = new Date();
  const umAnoAtras = new Date(hoje.getFullYear() - 1, hoje.getMonth(), hoje.getDate()).toISOString().slice(0, 10);

  linhas.forEach((l) => {
    const mes = porMes.get(l.mes) || { mes: l.mes, qtd: 0, faturamento: 0 };
    mes.qtd += l.qtd;
    mes.faturamento += l.valorTotal;
    porMes.set(l.mes, mes);

    const cli = porClienteTodoPeriodo.get(l.cliente) || { cliente: l.cliente, qtd: 0, faturamento: 0, pedidos: new Set() };
    cli.qtd += l.qtd;
    cli.faturamento += l.valorTotal;
    cli.pedidos.add(l.pedido);
    porClienteTodoPeriodo.set(l.cliente, cli);

    if (l.data >= umAnoAtras) {
      const cliAno = porClienteUltimoAno.get(l.cliente) || { cliente: l.cliente, qtd: 0, faturamento: 0, pedidos: new Set() };
      cliAno.qtd += l.qtd;
      cliAno.faturamento += l.valorTotal;
      cliAno.pedidos.add(l.pedido);
      porClienteUltimoAno.set(l.cliente, cliAno);
    }
  });

  function finalizarClientes(mapa) {
    return Array.from(mapa.values())
      .map((c) => ({ cliente: c.cliente, qtd: c.qtd, faturamento: c.faturamento, pedidos: c.pedidos.size }))
      .sort((a, b) => b.faturamento - a.faturamento);
  }

  return {
    porMes: Array.from(porMes.values()).sort((a, b) => a.mes.localeCompare(b.mes)),
    clientesTodoPeriodo: finalizarClientes(porClienteTodoPeriodo),
    clientesUltimoAno: finalizarClientes(porClienteUltimoAno),
    clientesDistintos: porClienteTodoPeriodo.size,
    qtdTotal: linhas.reduce((s, l) => s + l.qtd, 0),
    faturamentoTotal: linhas.reduce((s, l) => s + l.valorTotal, 0),
  };
}
