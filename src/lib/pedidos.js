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

const pedidosRef = collection(db, "pedidos");

// pedido: { clienteId, clienteCodigo, clienteNome, clienteCidade, clienteEstado,
//   itens: [{ valor, data }],
//   valor (soma bruta dos itens), valorDevido (valor - desconto), valorPago (já recebido),
//   data (data do lançamento), desconto,
//   formasPagamento: [{ tipo, valor, ...extras (cheque: numFolhas, prazoUltimoCheque, parcelas) }],
//   pagamentos: [{ valor, data, formaPagamento, conta? }] (histórico de baixas),
//   status: 'aberto' | 'pago', createdAt }
export async function criarPedido(pedido) {
  const valor = Number(pedido.valor) || 0;
  const valorDevido = Number(pedido.valorDevido ?? valor);
  const valorPago = Number(pedido.valorPago) || 0;
  const payload = {
    ...pedido,
    valor,
    valorDevido,
    valorPago,
    status: valorPago >= valorDevido - 0.01 ? "pago" : "aberto",
    createdAt: serverTimestamp(),
  };
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

// Confirma uma forma de pagamento específica (PIX/TED ou Depósito) dentro de um pedido:
// marca como confirmada, soma ao valor pago e registra no histórico.
export async function confirmarFormaPagamento(pedidoId, pedidoAtual, formaIndex, conta) {
  const formas = [...(pedidoAtual.formasPagamento || [])];
  const forma = formas[formaIndex];
  if (!forma || forma.confirmado) return pedidoAtual.status;

  const hoje = new Date();
  const dataISO = hoje.toISOString().slice(0, 10);

  formas[formaIndex] = { ...forma, confirmado: true, conta: conta || null, dataConfirmacao: dataISO };

  const valorDevido = Number(pedidoAtual.valorDevido ?? pedidoAtual.valor);
  const novoValorPago = Number(pedidoAtual.valorPago || 0) + Number(forma.valor);
  const novoStatus = novoValorPago >= valorDevido - 0.01 ? "pago" : "aberto";

  const historico = [...(pedidoAtual.pagamentos || [])];
  historico.push({ valor: Number(forma.valor), data: dataISO, formaPagamento: forma.tipo, conta: conta || null });

  await updateDoc(doc(db, "pedidos", pedidoId), {
    formasPagamento: formas,
    valorPago: novoValorPago,
    status: novoStatus,
    pagamentos: historico,
  });

  return novoStatus;
}

// Registra uma baixa (pagamento) em um pedido em aberto
export async function registrarBaixa(pedidoId, pedidoAtual, baixa) {
  const valorDevido = Number(pedidoAtual.valorDevido ?? pedidoAtual.valor);
  const novoValorPago = Number(pedidoAtual.valorPago || 0) + Number(baixa.valor);
  const novoStatus = novoValorPago >= valorDevido - 0.01 ? "pago" : "aberto";

  const historico = pedidoAtual.pagamentos || [];
  historico.push({
    valor: Number(baixa.valor),
    data: baixa.data,
    formaPagamento: baixa.formaPagamento,
    conta: baixa.conta || null,
  });

  await updateDoc(doc(db, "pedidos", pedidoId), {
    valorPago: novoValorPago,
    status: novoStatus,
    pagamentos: historico,
  });

  return novoStatus;
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
      const valorPago = p.totalPedidos - p.emAberto;
      const status = p.emAberto <= 0.01 ? "pago" : "aberto";
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
        valor: p.totalPedidos,
        valorDevido: p.totalPedidos,
        valorPago,
        data: dataPedido,
        desconto: p.situacao.toLowerCase().includes("desc") ? "desconto aplicado (histórico importado)" : "",
        formasPagamento,
        pagamentos,
        status,
        origemImportacao: { aba: p.aba, linha: p.linha, situacaoOriginal: p.situacao },
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
