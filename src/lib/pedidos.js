import {
  collection,
  doc,
  addDoc,
  updateDoc,
  getDocs,
  query,
  orderBy,
  serverTimestamp,
  writeBatch,
} from "firebase/firestore";
import { db } from "./firebase";
import { todayISO, valorDevidoDoPedido, valorPagoDoPedido, saldoDoPedido, calcularValorDevido } from "./constants";
import { registrarLog } from "./auditoria";

const pedidosRef = collection(db, "pedidos");

// pedido: { clienteId, clienteCodigo, clienteNome, clienteCidade, clienteEstado,
//   itens: [{ valor, data }],
//   valor (soma bruta dos itens), valorDevido (valor - desconto, sempre recalculado
//     a partir dos itens — ver valorDevidoDoPedido em lib/constants), valorPago (já recebido),
//   data (data do lançamento), desconto,
//   formasPagamento: [{ tipo, valor, ...extras (cheque: numFolhas, prazoUltimoCheque, parcelas) }],
//   pagamentos: [{ valor, data, formaPagamento, conta? }] (histórico de baixas),
//   historicoEdicoes: [{ data, itemIndex, dataItem, valorAnterior, valorNovo }],
//   status: 'aberto' | 'pago', createdAt }
export async function criarPedido(pedido) {
  const valor = Number(pedido.valor) || 0;
  const valorPago = Number(pedido.valorPago) || 0;
  const valorDevido = valorDevidoDoPedido({ ...pedido, valor });
  const statusCalculado = valorPago >= valorDevido - 0.01 ? "pago" : "aberto";
  const payload = {
    ...pedido,
    valor,
    valorDevido,
    valorPago,
    // forcarPago: quando o pedido tem representante e já nasce quase todo
    // pago (ver podeIrDireitoParaRecebidos em constants.js), ele vai direto
    // pra Comissões — o que exige status "pago" mesmo sobrando um resto
    // pequeno em aberto, igual já fazemos com "arquivado" pro caso sem
    // representante.
    status: pedido.forcarPago ? "pago" : statusCalculado,
    createdAt: serverTimestamp(),
  };
  delete payload.forcarPago;
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

// Verifica se o cliente (ou grupo) tem vale em aberto ou cheque ainda a cair, pra
// avisar quem tá lançando um pedido novo antes de fechar a venda.
export async function buscarPendenciasCliente({ clienteId, grupo }) {
  const todos = await listarPedidos();
  const grupoNorm = (grupo || "").trim().toLowerCase();
  const doCliente = todos.filter((p) => {
    if (p.arquivado) return false;
    if (grupoNorm) return (p.clienteGrupo || "").trim().toLowerCase() === grupoNorm;
    return p.clienteId === clienteId;
  });

  const valesAbertos = doCliente
    .filter((p) => p.status === "aberto")
    .map((p) => ({
      data: p.data,
      saldo: saldoDoPedido(p),
    }))
    .filter((v) => v.saldo > 0.01);

  const hoje = todayISO();
  const chequesACair = doCliente.flatMap((p) =>
    (p.formasPagamento || [])
      .filter((f) => f.tipo === "cheque")
      .flatMap((f) => (f.parcelas || []).filter((parc) => parc.data >= hoje).map((parc) => ({ ...parc, pedidoData: p.data })))
  );

  return { valesAbertos, chequesACair };
}

// Confirma uma forma de pagamento específica (PIX/TED ou Depósito) dentro de um pedido:
// marca como confirmada, soma ao valor pago e registra no histórico.
export async function confirmarFormaPagamento(pedidoId, pedidoAtual, formaIndex, conta) {
  const formas = [...(pedidoAtual.formasPagamento || [])];
  const forma = formas[formaIndex];
  if (!forma || forma.confirmado) return pedidoAtual.status;

  const hoje = new Date();
  const dataISO = hoje.toISOString().slice(0, 10);

  formas[formaIndex] = { ...forma, confirmado: true, conta: conta || null, dataConfirmacao: dataISO };

  const historico = [...(pedidoAtual.pagamentos || [])];
  historico.push({ valor: Number(forma.valor), data: dataISO, formaPagamento: forma.tipo, conta: conta || null });

  const valorDevido = valorDevidoDoPedido(pedidoAtual);
  const novoValorPago = valorPagoDoPedido({ ...pedidoAtual, formasPagamento: formas, pagamentos: historico });
  const novoStatus = novoValorPago >= valorDevido - 0.01 ? "pago" : "aberto";

  await updateDoc(doc(db, "pedidos", pedidoId), {
    formasPagamento: formas,
    valorPago: novoValorPago,
    valorDevido,
    status: novoStatus,
    pagamentos: historico,
  });

  return novoStatus;
}

// Registra uma baixa (pagamento) em um pedido em aberto
export async function registrarBaixa(pedidoId, pedidoAtual, baixa) {
  const valorDevido = valorDevidoDoPedido(pedidoAtual);

  const historico = [...(pedidoAtual.pagamentos || [])];
  historico.push({
    valor: Number(baixa.valor),
    data: baixa.data,
    formaPagamento: baixa.formaPagamento,
    conta: baixa.conta || null,
    ...(baixa.descricao ? { descricao: baixa.descricao } : {}),
    // Quando o pagamento é em cheque, guarda também as folhas/parcelas
    // (mesmo formato usado nas formas de pagamento do pedido), pra elas
    // aparecerem no card "Cheques" e entrarem na checagem de atraso.
    ...(baixa.numFolhas ? {
      numFolhas: baixa.numFolhas,
      prazoUltimoCheque: baixa.prazoUltimoCheque,
      parcelas: baixa.parcelas,
    } : {}),
  });

  const novoValorPago = valorPagoDoPedido({ ...pedidoAtual, pagamentos: historico });
  const novoStatus = novoValorPago >= valorDevido - 0.01 ? "pago" : "aberto";

  await updateDoc(doc(db, "pedidos", pedidoId), {
    valorPago: novoValorPago,
    valorDevido,
    status: novoStatus,
    pagamentos: historico,
  });

  return novoStatus;
}

// Recalcula e grava valor/valorDevido/valorPago/status de um pedido a partir
// dos itens e pagamentos atuais — usado depois de qualquer edição/exclusão,
// pra nunca deixar esses campos desatualizados.
async function recalcularEGravar(pedidoId, pedidoAtualizado, camposExtras) {
  const valorBruto = (pedidoAtualizado.itens || []).reduce((s, it) => s + (Number(it.valor) || 0), 0);
  const valorDevido = calcularValorDevido(valorBruto, pedidoAtualizado.desconto);
  const valorPago = valorPagoDoPedido(pedidoAtualizado);
  const status = valorPago >= valorDevido - 0.01 ? "pago" : "aberto";
  await updateDoc(doc(db, "pedidos", pedidoId), {
    ...camposExtras,
    valor: valorBruto,
    valorDevido,
    valorPago,
    status,
  });
  return { valorBruto, valorDevido, valorPago, status };
}

// Edita valor e/ou data de um item (uma "compra" avulsa) dentro de um
// pedido. O total e o valor devido são sempre recalculados a partir da soma
// dos itens — nunca ficam desatualizados. Registra no próprio pedido e no
// log central de auditoria.
export async function editarItemPedido(pedidoId, pedidoAtual, itemIndex, camposEditados) {
  const itens = [...(pedidoAtual.itens || [])];
  const itemAtual = itens[itemIndex];
  if (!itemAtual) throw new Error("Item não encontrado nesse pedido");

  const novoValor = camposEditados.valor !== undefined ? Number(camposEditados.valor) || 0 : itemAtual.valor;
  const novaData = camposEditados.data !== undefined ? camposEditados.data : itemAtual.data;
  itens[itemIndex] = { ...itemAtual, valor: novoValor, data: novaData };

  const descricaoPartes = [];
  if (camposEditados.valor !== undefined && novoValor !== itemAtual.valor) descricaoPartes.push(`valor ${itemAtual.valor} → ${novoValor}`);
  if (camposEditados.data !== undefined && novaData !== itemAtual.data) descricaoPartes.push(`data ${itemAtual.data} → ${novaData}`);

  const historicoEdicoes = [...(pedidoAtual.historicoEdicoes || [])];
  historicoEdicoes.push({ data: new Date().toISOString(), tipo: "edicao_item", itemIndex, dataItem: itemAtual.data, valorAnterior: itemAtual.valor, valorNovo: novoValor });

  const resultado = await recalcularEGravar(pedidoId, { ...pedidoAtual, itens }, { itens, historicoEdicoes });

  await registrarLog({
    tipo: "edicao_item",
    pedidoId,
    clienteNome: pedidoAtual.clienteNome,
    descricao: `Compra de ${itemAtual.data} — ${descricaoPartes.join(", ") || "sem alteração"}`,
    valorAnterior: itemAtual.valor,
    valorNovo: novoValor,
  });

  return resultado;
}

// Exclui um item (uma "compra" avulsa) de dentro de um pedido.
export async function excluirItemPedido(pedidoId, pedidoAtual, itemIndex) {
  const itens = [...(pedidoAtual.itens || [])];
  const itemRemovido = itens[itemIndex];
  if (!itemRemovido) throw new Error("Item não encontrado nesse pedido");
  itens.splice(itemIndex, 1);

  const historicoEdicoes = [...(pedidoAtual.historicoEdicoes || [])];
  historicoEdicoes.push({ data: new Date().toISOString(), tipo: "exclusao_item", dataItem: itemRemovido.data, valorAnterior: itemRemovido.valor, valorNovo: null });

  const resultado = await recalcularEGravar(pedidoId, { ...pedidoAtual, itens }, { itens, historicoEdicoes });

  await registrarLog({
    tipo: "exclusao_item",
    pedidoId,
    clienteNome: pedidoAtual.clienteNome,
    descricao: `Compra de ${itemRemovido.data} excluída`,
    valorAnterior: itemRemovido.valor,
    valorNovo: null,
  });

  return resultado;
}

// Edita valor, data e/ou forma de um pagamento (baixa) já registrado. O
// saldo do pedido se recalcula sozinho a partir disso.
export async function editarPagamento(pedidoId, pedidoAtual, pagamentoIndex, camposEditados) {
  const pagamentos = [...(pedidoAtual.pagamentos || [])];
  const pagamentoAtual = pagamentos[pagamentoIndex];
  if (!pagamentoAtual) throw new Error("Pagamento não encontrado nesse pedido");

  const novoValor = camposEditados.valor !== undefined ? Number(camposEditados.valor) || 0 : pagamentoAtual.valor;
  const novaData = camposEditados.data !== undefined ? camposEditados.data : pagamentoAtual.data;
  pagamentos[pagamentoIndex] = { ...pagamentoAtual, valor: novoValor, data: novaData };

  const descricaoPartes = [];
  if (novoValor !== pagamentoAtual.valor) descricaoPartes.push(`valor ${pagamentoAtual.valor} → ${novoValor}`);
  if (novaData !== pagamentoAtual.data) descricaoPartes.push(`data ${pagamentoAtual.data} → ${novaData}`);

  const historicoEdicoes = [...(pedidoAtual.historicoEdicoes || [])];
  historicoEdicoes.push({ data: new Date().toISOString(), tipo: "edicao_pagamento", pagamentoIndex, dataPagamento: pagamentoAtual.data, valorAnterior: pagamentoAtual.valor, valorNovo: novoValor });

  const resultado = await recalcularEGravar(pedidoId, { ...pedidoAtual, pagamentos }, { pagamentos, historicoEdicoes });

  await registrarLog({
    tipo: "edicao_pagamento",
    pedidoId,
    clienteNome: pedidoAtual.clienteNome,
    descricao: `Pagamento de ${pagamentoAtual.data} — ${descricaoPartes.join(", ") || "sem alteração"}`,
    valorAnterior: pagamentoAtual.valor,
    valorNovo: novoValor,
  });

  return resultado;
}

// Exclui um pagamento (baixa) já registrado. O saldo volta a ficar em aberto
// pelo valor removido, automaticamente (via recálculo do valorPago).
export async function excluirPagamento(pedidoId, pedidoAtual, pagamentoIndex) {
  const pagamentos = [...(pedidoAtual.pagamentos || [])];
  const pagamentoRemovido = pagamentos[pagamentoIndex];
  if (!pagamentoRemovido) throw new Error("Pagamento não encontrado nesse pedido");
  pagamentos.splice(pagamentoIndex, 1);

  const historicoEdicoes = [...(pedidoAtual.historicoEdicoes || [])];
  historicoEdicoes.push({ data: new Date().toISOString(), tipo: "exclusao_pagamento", dataPagamento: pagamentoRemovido.data, valorAnterior: pagamentoRemovido.valor, valorNovo: null });

  const resultado = await recalcularEGravar(pedidoId, { ...pedidoAtual, pagamentos }, { pagamentos, historicoEdicoes });

  await registrarLog({
    tipo: "exclusao_pagamento",
    pedidoId,
    clienteNome: pedidoAtual.clienteNome,
    descricao: `Pagamento de ${pagamentoRemovido.data} (${pagamentoRemovido.formaPagamento}) excluído`,
    valorAnterior: pagamentoRemovido.valor,
    valorNovo: null,
  });

  return resultado;
}

// Edita a data geral de lançamento do pedido (a que aparece no topo do card).
export async function editarDataPedido(pedidoId, pedidoAtual, novaData) {
  const dataAnterior = pedidoAtual.data;
  await updateDoc(doc(db, "pedidos", pedidoId), { data: novaData });

  await registrarLog({
    tipo: "edicao_data_pedido",
    pedidoId,
    clienteNome: pedidoAtual.clienteNome,
    descricao: "Data do pedido alterada",
    valorAnterior: dataAnterior,
    valorNovo: novaData,
  });
}

// Importa pedidos do histórico legado (planilha Pranchteta/PAGOS), linkando com
// clientes já cadastrados por código (ou por nome, se não tiver código) e criando
// cliente novo quando necessário.
export async function importarHistoricoPedidos(pedidosParseados, clientesExistentes, onProgresso) {
  const porCodigo = new Map();
  const porNome = new Map();
  clientesExistentes.forEach((c) => {
    if (c.codigo) porCodigo.set(String(c.codigo).trim(), c);
    if (c.nome) porNome.set(c.nome.trim().toLowerCase(), c);
  });

  const CHUNK = 300;
  let processados = 0;
  let clientesCriados = 0;

  for (let i = 0; i < pedidosParseados.length; i += CHUNK) {
    const lote = pedidosParseados.slice(i, i + CHUNK);
    const batch = writeBatch(db);

    lote.forEach((p) => {
      const cliente = (p.codigo && porCodigo.get(p.codigo)) || porNome.get(p.nome.toLowerCase());
      let clienteId, clienteNome, clienteCidade, clienteEstado;

      if (cliente) {
        clienteId = cliente.id;
        clienteNome = cliente.nome;
        clienteCidade = cliente.cidade || "";
        clienteEstado = cliente.estado || p.uf || "";
      } else {
        const novoRef = doc(collection(db, "clientes"));
        batch.set(novoRef, {
          codigo: p.codigo || "",
          nome: p.nome,
          estado: p.uf || "",
          representante: p.representante || "",
          updatedAt: serverTimestamp(),
        });
        clienteId = novoRef.id;
        clienteNome = p.nome;
        clienteCidade = "";
        clienteEstado = p.uf || "";
        const registro = { id: clienteId, codigo: p.codigo, nome: p.nome, cidade: "", estado: p.uf };
        if (p.codigo) porCodigo.set(p.codigo, registro);
        porNome.set(p.nome.toLowerCase(), registro);
        clientesCriados++;
      }

      const itens = p.itens.length > 0 ? p.itens : [{ valor: p.totalPedidos, data: p.pagamentos[0]?.data || "2020-01-01" }];
      const desconto = p.situacao.toLowerCase().includes("desc") ? "desconto aplicado (histórico importado)" : "";
      // Valor devido e valor pago sempre derivados do que foi de fato
      // reconstruído (itens/pagamentos) — nunca dos totais soltos da
      // planilha antiga, pra ficar sempre consistente com o que aparece
      // nas listas de "Compras" e "Pagamentos" na tela. Os números originais
      // da planilha ficam guardados em origemImportacao só como referência.
      const valorBruto = itens.reduce((s, it) => s + (Number(it.valor) || 0), 0);
      const valorDevido = calcularValorDevido(valorBruto, desconto);
      const valorPago = p.pagamentos.reduce((s, pg) => s + (Number(pg.valor) || 0), 0);
      const status = valorPago >= valorDevido - 0.01 ? "pago" : "aberto";
      const dataPedido = itens.reduce((min, it) => (it.data < min ? it.data : min), itens[0].data);

      const formasPagamento = p.pagamentos.map((pg) => ({ tipo: "legado", valor: pg.valor, conta: pg.conta }));
      const pagamentos = p.pagamentos.map((pg) => ({ valor: pg.valor, data: pg.data, formaPagamento: "legado", conta: pg.conta }));

      const pedidoRef = doc(collection(db, "pedidos"));
      batch.set(pedidoRef, {
        clienteId,
        clienteCodigo: p.codigo,
        clienteNome,
        clienteCidade,
        clienteEstado,
        itens,
        valor: valorBruto,
        valorDevido,
        valorPago,
        data: dataPedido,
        desconto,
        formasPagamento,
        pagamentos,
        status,
        origemImportacao: {
          aba: p.aba, linha: p.linha, situacaoOriginal: p.situacao,
          totalPedidosOriginal: p.totalPedidos, emAbertoOriginal: p.emAberto,
        },
        createdAt: serverTimestamp(),
      });
    });

    await batch.commit();
    processados += lote.length;
    if (onProgresso) onProgresso(processados, pedidosParseados.length, clientesCriados);
  }

  return { processados, clientesCriados };
}

// Arquiva pedidos (marca como definitivamente "recebidos") — usado tanto pelo botão
// "Mover para recebidos" quanto por "Comissão paga".
export async function arquivarPedidos(pedidoIds, extra = {}) {
  const batch = writeBatch(db);
  pedidoIds.forEach((id) => {
    batch.update(doc(db, "pedidos", id), { arquivado: true, ...extra });
  });
  await batch.commit();
}

// "Mover para Comissões" (pra pedidos com representante, no lugar de mover
// pra Recebidos): força o pedido a contar como pago, sem arquivar — ele
// continua ativo, só que agora aparece na aba Comissões aguardando o
// representante ser pago, em vez de ficar preso em Vales com um resto de
// saldo pequeno.
export async function marcarComoPago(pedidoIds) {
  const batch = writeBatch(db);
  pedidoIds.forEach((id) => {
    batch.update(doc(db, "pedidos", id), { status: "pago" });
  });
  await batch.commit();
}
