import { useEffect, useState } from "react";
import "../components/ui.css";
import { listarPedidos, registrarBaixa, confirmarFormaPagamento, arquivarPedidos, marcarComoPago, editarItemPedido, excluirItemPedido, editarPagamento, excluirPagamento } from "../lib/pedidos";
import { listarClientes } from "../lib/clientes";
import ClienteCadastroModal from "../components/ClienteCadastroModal";
import CampoConta from "../components/CampoConta";
import ChequesDevolvidos, { DetalheChequeDevolvido } from "../components/ChequesDevolvidos";
import { listarChequesDevolvidos } from "../lib/chequesDevolvidos";
import {
  formatCurrency, formatDate, todayISO, FORMAS_PAGAMENTO, CONTAS_PADRAO,
  pedidoEstaAtrasado, calcularPercentualAberto, tagResumoCliente, podeMoverParaRecebidos,
  calcularParcelasCheque, prazoPadraoUltimoCheque, redistribuirDatasCheque, valorDevidoDoPedido, valorPagoDoPedido, saldoDoPedido,
  parseDescontoPercent, FORMAS_RECEBIMENTO_IMEDIATO, herdarCondicoesDoGrupo,
} from "../lib/constants";

const FORMAS_COM_CONTA = ["pix_ted", "deposito"];
const FORMAS_COM_CONFIRMAR = ["pix_ted", "deposito"];

function labelForma(tipo) {
  if (tipo === "legado") return "Legado";
  return FORMAS_PAGAMENTO.find((f) => f.value === tipo)?.label || tipo;
}

function montarConta(contaSelecionada, identificacao) {
  if (contaSelecionada === "Terceiros") {
    return identificacao.trim() ? `Terceiros - ${identificacao.trim()}` : "Terceiros";
  }
  return contaSelecionada;
}

// Padrão de exibição: "Nome (Representante)" — usa o Grupo de cliente como nome
// quando existir, senão usa o nome do cliente. O representante aparece entre
// parênteses sempre que estiver preenchido, com ou sem grupo.
function nomeExibicao(g) {
  const nomeBase = g.nomeGrupo || Array.from(g.clientesNomes)[0];
  return g.representante ? `${nomeBase} (${g.representante})` : nomeBase;
}

// Só o nome do grupo (ou do cliente, se não tiver grupo), sem o representante
// junto — usado no título do card, que agora leva o representante numa
// linha separada.
function nomeGrupoOuCliente(g) {
  return g.nomeGrupo || Array.from(g.clientesNomes)[0];
}

// Agrupa uma lista qualquer de pedidos por "Grupo de cliente" (ou cliente individual),
// somando valor devido/pago e derivando saldo, percentual, atraso e representante.
// Agrupa uma lista qualquer de pedidos por "Grupo de cliente" (ou cliente individual),
// somando valor devido/pago e derivando saldo, percentual, atraso e representante.
// `clientesPorId` é o cadastro ATUAL dos clientes — usamos ele (e não a cópia que
// ficou gravada no pedido no momento da venda) pra grupo/nome/representante nunca
// ficarem desatualizados se alguém editar o cadastro depois.
function agruparPorCliente(lista, clientesPorId = {}) {
  const grupos = new Map();
  lista.forEach((p) => {
    const clienteAtual = clientesPorId[p.clienteId];
    const grupoAtual = (clienteAtual?.grupo ?? p.clienteGrupo ?? "").trim();
    const nomeAtual = clienteAtual?.nome || p.clienteNome;
    const representanteAtual = clienteAtual?.representante || p.clienteRepresentante;
    const chave = grupoAtual.toLowerCase() || `cli_${p.clienteId}`;
    if (!grupos.has(chave)) {
      grupos.set(chave, {
        chave,
        nomeGrupo: grupoAtual,
        clientesNomes: new Set(),
        clientesIds: new Set(),
        representante: "",
        pedidos: [],
        totalDevido: 0,
        totalPago: 0,
        dataMaisRecente: p.data,
        // Data do pedido em aberto mais antigo do grupo — não do último
        // pedido lançado. É o que importa pra "quem está esperando pagar há
        // mais tempo": um cliente pode ter comprado ontem e ainda dever de
        // 3 meses atrás; ordenar pelo último pedido escondia esse caso.
        dataMaisAntigaAberto: saldoDoPedido(p) > 0.01 ? p.data : undefined,
        atrasado: false,
      });
    }
    const g = grupos.get(chave);
    g.pedidos.push(p);
    g.clientesNomes.add(nomeAtual);
    if (p.clienteId) g.clientesIds.add(p.clienteId);
    if (!g.representante && representanteAtual) g.representante = representanteAtual;
    g.totalDevido += valorDevidoDoPedido(p);
    g.totalPago += valorPagoDoPedido(p);
    if (new Date(p.data) > new Date(g.dataMaisRecente)) g.dataMaisRecente = p.data;
    if (saldoDoPedido(p) > 0.01 && (!g.dataMaisAntigaAberto || new Date(p.data) < new Date(g.dataMaisAntigaAberto))) {
      g.dataMaisAntigaAberto = p.data;
    }
    if (pedidoEstaAtrasado(p, clientesPorId[p.clienteId])) g.atrasado = true;
  });
  return Array.from(grupos.values()).map((g) => {
    const saldo = g.totalDevido - g.totalPago;
    const percentual = calcularPercentualAberto(saldo, g.totalDevido);
    return { ...g, saldo, percentual, tag: tagResumoCliente(saldo, percentual, g.atrasado) };
  });
}

// Estimativa de quanto de um saldo em aberto cai dentro dos próximos 30 dias,
// proporcional ao prazo de pagamento do pedido: prazo de 30 dias conta o
// valor integral; prazos maiores contam proporcionalmente (ex: prazo de 90
// dias conta 1/3 do saldo). Sem prazo definido, considera o valor todo
// (mais seguro pra previsão do que assumir prazo indefinido).
function contribuicao30Dias(saldo, prazoDias) {
  const prazo = Number(prazoDias) || 0;
  if (prazo <= 0) return saldo;
  const fator = Math.min(30 / prazo, 1);
  return saldo * fator;
}

// Conteúdo expandido de um grupo — some cliente, compras, pagamentos, ações.
// Fica DENTRO do card, sem navegar de página. Componente hoisted fora do corpo
// da página (senão perde o foco dos campos a cada tecla).
function DetalheExpandido({
  g,
  clientesPorId = {}, chequesDevolvidos = [],
  pedidoBaixa, onAbrirBaixa, onCancelarBaixa, onConfirmarBaixa,
  valorBaixa, setValorBaixa, dataBaixa, setDataBaixa, formaBaixa, setFormaBaixa,
  contaBaixa, setContaBaixa, contaBaixaId, setContaBaixaId,
  numFolhasBaixa, setNumFolhasBaixa, prazoUltimoChequeBaixa, setPrazoUltimoChequeBaixa,
  parcelasBaixaManual, parcelasDaBaixa, onEditarParcelaBaixa, onRecalcularParcelasBaixa,
  descricaoBaixa, setDescricaoBaixa,
  editandoItem, onAbrirEdicaoItem, onCancelarEdicaoItem, onSalvarEdicaoItem,
  onSetValorEditandoItem, onSetDataEditandoItem, onExcluirCompra,
  editandoPagamento, onAbrirEdicaoPagamento, onCancelarEdicaoPagamento, onSalvarEdicaoPagamento,
  onSetValorEditandoPagamento, onSetDataEditandoPagamento, onExcluirPagamento,
  confirmando, onAbrirConfirmar, onCancelarConfirmar, onConfirmarPixDeposito,
  contaConfirmar, setContaConfirmar, contaConfirmarId, setContaConfirmarId,
  onMoverRecebidos, onMoverComissoes, somenteLeitura,
}) {
  const historico = g.pedidos
    .flatMap((p) => (p.pagamentos || []).map((pg, pagamentoIndex) => ({ ...pg, pedidoData: p.data, pedido: p, pagamentoIndex })))
    .sort((a, b) => new Date(b.data) - new Date(a.data));

  // Soma exatamente o que está listado em "Compras" (já com desconto aplicado
  // por item) — em vez do total oficial gravado no pedido. Pra pedidos
  // antigos/congelados os dois podem divergir (a lista reconstruída da
  // planilha antiga às vezes não captura 100% do histórico original), então
  // mostramos os dois e avisamos quando não batem, em vez de esconder a
  // diferença atrás de um único número que não bate com o que está na tela.
  const somaComprasListadas = g.pedidos.reduce((soma, p) => {
    const percentDesconto = parseDescontoPercent(p.desconto);
    const itens = p.itens?.length ? p.itens : [{ valor: p.valor, data: p.data }];
    return soma + itens.reduce((s, it) => {
      const valorComDesconto = percentDesconto > 0 ? Number(it.valor) * (1 - percentDesconto / 100) : Number(it.valor);
      return s + valorComDesconto;
    }, 0);
  }, 0);
  const compraseDivergemDoOficial = Math.abs(somaComprasListadas - g.totalDevido) > 0.5;

  // Pagamentos: TUDO que o cliente pagou, de qualquer forma, numa lista só —
  // baixas registradas depois (editáveis) + o que foi recebido na hora da
  // venda (dinheiro, cheque, conta de 3º) + PIX/depósito ainda aguardando
  // confirmação (aparece, mas não soma no total). Formas "legado" e PIX já
  // confirmado ficam de fora do lado da venda porque já existem em
  // "pagamentos" — mostrar os dois duplicava.
  const pagamentosLista = [
    ...historico.map((pg) => ({
      origem: "baixa", data: pg.data, tipo: pg.formaPagamento, valor: Number(pg.valor) || 0,
      conta: pg.conta, descricao: pg.descricao, parcelas: pg.parcelas,
      pedido: pg.pedido, pagamentoIndex: pg.pagamentoIndex, original: pg,
    })),
    ...g.pedidos.flatMap((p) => (p.formasPagamento || []).map((f, formaIndex) => ({ f, formaIndex, p })))
      .filter(({ f }) => FORMAS_RECEBIMENTO_IMEDIATO.includes(f.tipo) || (FORMAS_COM_CONFIRMAR.includes(f.tipo) && !f.confirmado))
      .map(({ f, formaIndex, p }) => ({
        origem: "venda", data: p.data, tipo: f.tipo, valor: Number(f.valor) || 0,
        conta: f.conta, descricao: f.descricao, parcelas: f.parcelas,
        pendente: FORMAS_COM_CONFIRMAR.includes(f.tipo) && !f.confirmado,
        pedido: p, formaIndex,
      })),
  ].sort((a, b) => new Date(b.data) - new Date(a.data));
  const somaPagamentosListados = pagamentosLista.filter((pg) => !pg.pendente).reduce((s, pg) => s + pg.valor, 0);
  const pagamentosDivergemDoOficial = Math.abs(somaPagamentosListados - g.totalPago) > 0.5;

  const edicoes = g.pedidos
    .flatMap((p) => p.historicoEdicoes || [])
    .sort((a, b) => new Date(b.data) - new Date(a.data));

  const pedidosComSaldo = somenteLeitura ? [] : g.pedidos.filter((p) => saldoDoPedido(p) > 0.01);

  // Resumo do cliente/grupo — valor médio, últimas compras, observação,
  // cheques ainda por vencer e histórico de cheques que já voltaram. Tudo
  // calculado a partir do que já está carregado (nada de leitura extra),
  // exceto chequesDevolvidos que vem pronto do componente pai.
  const mediaCompra = g.pedidos.length > 0
    ? g.pedidos.reduce((s, p) => s + valorDevidoDoPedido(p), 0) / g.pedidos.length
    : 0;
  const ultimasCompras = [...g.pedidos]
    .sort((a, b) => new Date(b.data) - new Date(a.data))
    .slice(0, 3)
    .map((p) => ({ data: p.data, valor: valorDevidoDoPedido(p) }));
  const observacoes = Array.from(g.clientesIds)
    .map((id) => clientesPorId[id]?.observacao)
    .filter(Boolean);
  const hojeResumo = new Date();
  const chequesEmAberto = [];
  g.pedidos.forEach((p) => {
    const todasParcelas = [
      ...(p.formasPagamento || []).filter((f) => f.tipo === "cheque").flatMap((f) => f.parcelas || []),
      ...(p.pagamentos || []).filter((pg) => pg.formaPagamento === "cheque").flatMap((pg) => pg.parcelas || []),
    ];
    todasParcelas.forEach((parc) => {
      if (parc.data && new Date(parc.data + "T00:00:00") > hojeResumo) {
        chequesEmAberto.push({ data: parc.data, valor: Number(parc.valor) || 0 });
      }
    });
  });
  const chequesDevolvidosDoCliente = chequesDevolvidos.filter((c) =>
    g.clientesIds.has(c.clienteId) || (g.nomeGrupo && c.clienteGrupo?.trim().toLowerCase() === g.nomeGrupo.trim().toLowerCase())
  );

  return (
    <div style={{ padding: "0 4px 4px" }} onClick={(e) => e.stopPropagation()}>
      <div className="card" style={{ background: "var(--bg)" }}>
        <h3 style={{ fontSize: 14, marginBottom: 10 }}>Resumo do cliente</h3>
        <div style={{ display: "flex", gap: 20, flexWrap: "wrap", marginBottom: 12 }}>
          <div>
            <div style={{ fontSize: 12, color: "var(--ink-soft)" }}>Valor médio das compras</div>
            <strong style={{ fontSize: 15 }}>{formatCurrency(mediaCompra)}</strong>
          </div>
          <div>
            <div style={{ fontSize: 12, color: "var(--ink-soft)" }}>Cheques que já voltaram</div>
            <strong style={{ fontSize: 15, color: chequesDevolvidosDoCliente.length > 0 ? "var(--red)" : "var(--ink)" }}>
              {chequesDevolvidosDoCliente.length}
            </strong>
          </div>
        </div>

        {ultimasCompras.length > 0 && (
          <div style={{ marginBottom: 10 }}>
            <div style={{ fontSize: 12, color: "var(--ink-soft)", marginBottom: 4 }}>Últimas compras</div>
            {ultimasCompras.map((c, i) => (
              <div key={i} style={{ display: "flex", justifyContent: "space-between", fontSize: 13 }}>
                <span>{formatDate(c.data)}</span>
                <strong>{formatCurrency(c.valor)}</strong>
              </div>
            ))}
          </div>
        )}

        {chequesEmAberto.length > 0 && (
          <div style={{ marginBottom: 10 }}>
            <div style={{ fontSize: 12, color: "var(--ink-soft)", marginBottom: 4 }}>
              Cheques em aberto (ainda não venceram) — {formatCurrency(chequesEmAberto.reduce((s, c) => s + c.valor, 0))}
            </div>
            {chequesEmAberto.map((c, i) => (
              <div key={i} style={{ display: "flex", justifyContent: "space-between", fontSize: 13 }}>
                <span>Vence {formatDate(c.data)}</span>
                <strong>{formatCurrency(c.valor)}</strong>
              </div>
            ))}
          </div>
        )}

        {observacoes.length > 0 && (
          <div>
            <div style={{ fontSize: 12, color: "var(--ink-soft)", marginBottom: 4 }}>Observações</div>
            {observacoes.map((obs, i) => (
              <div key={i} style={{ fontSize: 13 }}>{obs}</div>
            ))}
          </div>
        )}
      </div>

      {!somenteLeitura && podeMoverParaRecebidos(g.percentual) && !pedidoBaixa && (
        g.representante ? (
          <button className="btn btn-secondary btn-block" style={{ marginBottom: 12 }} onClick={() => onMoverComissoes(g)}>
            Mover para Comissões
          </button>
        ) : (
          <button className="btn btn-secondary btn-block" style={{ marginBottom: 12 }} onClick={() => onMoverRecebidos(g)}>
            Mover para recebidos
          </button>
        )
      )}

      {pedidosComSaldo.length > 0 && !pedidoBaixa && (
        <div className="card" style={{ background: "var(--bg)" }}>
          <h3 style={{ fontSize: 14, marginBottom: 10 }}>Registrar pagamento</h3>
          {pedidosComSaldo.length === 1 ? (
            <button className="btn btn-primary btn-block" onClick={() => onAbrirBaixa(pedidosComSaldo[0], pedidosComSaldo)}>
              Registrar pagamento de {formatCurrency(saldoDoPedido(pedidosComSaldo[0]))}
            </button>
          ) : (
            pedidosComSaldo.map((p) => (
              <div key={p.id} className="list-item" onClick={() => onAbrirBaixa(p, pedidosComSaldo)}>
                <div>
                  <strong>{formatDate(p.data)}</strong>
                  <div style={{ fontSize: 13, color: "var(--ink-soft)" }}>
                    {formatCurrency(saldoDoPedido(p))} em aberto
                  </div>
                </div>
                <span>→</span>
              </div>
            ))
          )}
        </div>
      )}

      {pedidoBaixa && (
        <div className="card" style={{ background: "var(--bg)" }}>
          <h3 style={{ fontSize: 14, marginBottom: 10 }}>Registrar pagamento — pedido de {formatDate(pedidoBaixa.data)}</h3>
          <div className="row">
            <div className="field">
              <label>Valor recebido</label>
              <input className="input" type="number" step="0.01" value={valorBaixa} onChange={(e) => { setValorBaixa(e.target.value); onRecalcularParcelasBaixa(); }} />
            </div>
            <div className="field">
              <label>Data</label>
              <input className="input" type="date" value={dataBaixa} onChange={(e) => setDataBaixa(e.target.value)} />
            </div>
          </div>
          <div className="field">
            <label>Forma de pagamento</label>
            <select className="input" value={formaBaixa} onChange={(e) => {
              const novoTipo = e.target.value;
              setFormaBaixa(novoTipo);
              // Sugere o prazo padrão (30 dias por folha) ao trocar pra cheque.
              if (novoTipo === "cheque" && !prazoUltimoChequeBaixa) {
                setPrazoUltimoChequeBaixa(prazoPadraoUltimoCheque(numFolhasBaixa));
              }
            }}>
              {FORMAS_PAGAMENTO.map((f) => <option key={f.value} value={f.value}>{f.label}</option>)}
            </select>
          </div>
          {FORMAS_COM_CONTA.includes(formaBaixa) && (
            <CampoConta conta={contaBaixa} setConta={setContaBaixa} identificacao={contaBaixaId} setIdentificacao={setContaBaixaId} />
          )}
          {formaBaixa === "conta_terceiros" && (
            <div className="field">
              <label>De quem é a conta</label>
              <input className="input" value={descricaoBaixa} onChange={(e) => setDescricaoBaixa(e.target.value)}
                placeholder="Ex: conta do irmão do cliente, João Silva" />
            </div>
          )}
          {formaBaixa === "cheque" && (
            <>
              <div className="row">
                <div className="field">
                  <label>Número de folhas</label>
                  <input className="input" type="number" min="1" value={numFolhasBaixa}
                    onChange={(e) => { setNumFolhasBaixa(e.target.value); setPrazoUltimoChequeBaixa(prazoPadraoUltimoCheque(e.target.value)); onRecalcularParcelasBaixa(); }} />
                </div>
                <div className="field">
                  <label>Prazo do último cheque</label>
                  <input className="input" type="date" value={prazoUltimoChequeBaixa}
                    onChange={(e) => {
                      // Com folhas já ajustadas, mudar o prazo só move a última e
                      // redistribui as do meio (preserva a data da primeira).
                      if (parcelasBaixaManual) onEditarParcelaBaixa(parcelasBaixaManual.length - 1, "data", e.target.value);
                      else setPrazoUltimoChequeBaixa(e.target.value);
                    }} />
                </div>
              </div>
              {valorBaixa && prazoUltimoChequeBaixa && Number(numFolhasBaixa) > 0 && (
                <div style={{ background: "white", borderRadius: 10, padding: 10, marginBottom: 12 }}>
                  {parcelasDaBaixa().map((p, pi) => (
                    <div key={p.numero} style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 6 }}>
                      <span style={{ fontSize: 12, color: "var(--ink-soft)", flexShrink: 0, width: 32 }}>N°{p.numero}</span>
                      <input className="input" type="number" step="0.01" value={p.valor}
                        onChange={(e) => onEditarParcelaBaixa(pi, "valor", e.target.value)}
                        style={{ flex: 1, padding: "6px 8px", fontSize: 13 }} />
                      <input className="input" type="date" value={p.data}
                        onChange={(e) => onEditarParcelaBaixa(pi, "data", e.target.value)}
                        style={{ flex: 1, padding: "6px 8px", fontSize: 13 }} />
                    </div>
                  ))}
                  {parcelasBaixaManual && (
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 11 }}>
                      {Math.abs(parcelasDaBaixa().reduce((s, p) => s + Number(p.valor || 0), 0) - Number(valorBaixa)) > 0.01 ? (
                        <span style={{ color: "var(--red)" }}>Soma das folhas diferente do valor total</span>
                      ) : <span style={{ color: "var(--ink-soft)" }}>Folhas editadas manualmente</span>}
                      <button type="button" className="btn btn-ghost" style={{ fontSize: 11, padding: "3px 6px" }}
                        onClick={onRecalcularParcelasBaixa}>
                        Recalcular
                      </button>
                    </div>
                  )}
                </div>
              )}
            </>
          )}
          <div className="row">
            <button type="button" className="btn btn-ghost btn-block" onClick={onCancelarBaixa}>Cancelar</button>
            <button type="button" className="btn btn-primary btn-block" onClick={onConfirmarBaixa}>Confirmar</button>
          </div>
        </div>
      )}

      <div className="card" style={{ background: "var(--bg)" }}>
        <h3 style={{ fontSize: 14, marginBottom: 10 }}>Compras</h3>
        {g.pedidos.flatMap((p) => (p.itens?.length ? p.itens : [{ valor: p.valor, data: p.data }]).map((it, i) => {
          const editandoEsse = editandoItem?.pedido.id === p.id && editandoItem?.itemIndex === i;
          const percentDesconto = parseDescontoPercent(p.desconto);
          const valorComDesconto = percentDesconto > 0 ? Number(it.valor) * (1 - percentDesconto / 100) : Number(it.valor);
          return (
            <div key={p.id + "_" + i} style={{ padding: "5px 0", borderBottom: "1px solid var(--border)" }}>
              {editandoEsse ? (
                <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
                  <input className="input" type="date" style={{ padding: "4px 8px", fontSize: 13, flex: "1 1 130px" }}
                    value={editandoItem.data}
                    onChange={(e) => onSetDataEditandoItem(e.target.value)} />
                  <input className="input" type="number" step="0.01" autoFocus
                    style={{ padding: "4px 8px", fontSize: 13, flex: "1 1 100px" }}
                    value={editandoItem.valor}
                    onChange={(e) => onSetValorEditandoItem(e.target.value)} />
                  <button type="button" className="btn btn-primary" style={{ padding: "4px 10px", fontSize: 12 }} onClick={onSalvarEdicaoItem}>✓</button>
                  <button type="button" className="btn btn-ghost" style={{ padding: "4px 10px", fontSize: 12 }} onClick={onCancelarEdicaoItem}>✕</button>
                  <button type="button" className="btn btn-ghost" style={{ padding: "4px 10px", fontSize: 12, color: "var(--red)" }}
                    onClick={() => onExcluirCompra(p, i)}>🗑</button>
                </div>
              ) : (
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 13 }}>
                  <span>{formatDate(it.data)}</span>
                  <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span style={{ textAlign: "right" }}>
                      <strong>{formatCurrency(valorComDesconto)}</strong>
                      {percentDesconto > 0 && (
                        <div style={{ fontSize: 11, color: "var(--ink-soft)" }}>({formatCurrency(it.valor)})</div>
                      )}
                    </span>
                    {!somenteLeitura && (
                      <button type="button" className="btn btn-ghost" style={{ padding: "2px 8px", fontSize: 12 }}
                        onClick={() => onAbrirEdicaoItem(p, i, it.valor, it.data)} title="Editar">✎</button>
                    )}
                  </span>
                </div>
              )}
            </div>
          );
        }))}
        <div style={{ display: "flex", justifyContent: "space-between", paddingTop: 8, fontSize: 13 }}>
          <strong>Total das compras listadas</strong>
          <strong>{formatCurrency(somaComprasListadas)}</strong>
        </div>
        {compraseDivergemDoOficial && (
          <div style={{ fontSize: 11, color: "#9a6b00", background: "var(--yellow-light)", borderRadius: 8, padding: "6px 8px", marginTop: 6 }}>
            ⚠ O valor "em aberto" no card usa {formatCurrency(g.totalDevido)} (número oficial gravado no pedido),
            diferente da soma das compras acima. Em pedidos antigos importados da planilha, a lista de compras é
            uma reconstrução que às vezes não captura 100% do histórico original — o número oficial é o confiável
            pra saldo e cobrança.
          </div>
        )}
      </div>

      {pagamentosLista.length > 0 && (
        <div className="card" style={{ background: "var(--bg)" }}>
          <h3 style={{ fontSize: 14, marginBottom: 10 }}>Pagamentos</h3>
          {pagamentosLista.map((pg, i) => {
            const editandoEsse = pg.origem === "baixa" && editandoPagamento?.pedido.id === pg.pedido.id && editandoPagamento?.pagamentoIndex === pg.pagamentoIndex;
            const confirmandoEsse = pg.pendente && confirmando?.pedido.id === pg.pedido.id && confirmando?.formaIndex === pg.formaIndex;
            return (
              <div key={i} style={{ padding: "5px 0", borderBottom: "1px solid var(--border)" }}>
                {editandoEsse ? (
                  <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
                    <input className="input" type="date" style={{ padding: "4px 8px", fontSize: 13, flex: "1 1 130px" }}
                      value={editandoPagamento.data}
                      onChange={(e) => onSetDataEditandoPagamento(e.target.value)} />
                    <input className="input" type="number" step="0.01" autoFocus
                      style={{ padding: "4px 8px", fontSize: 13, flex: "1 1 100px" }}
                      value={editandoPagamento.valor}
                      onChange={(e) => onSetValorEditandoPagamento(e.target.value)} />
                    <button type="button" className="btn btn-primary" style={{ padding: "4px 10px", fontSize: 12 }} onClick={onSalvarEdicaoPagamento}>✓</button>
                    <button type="button" className="btn btn-ghost" style={{ padding: "4px 10px", fontSize: 12 }} onClick={onCancelarEdicaoPagamento}>✕</button>
                    <button type="button" className="btn btn-ghost" style={{ padding: "4px 10px", fontSize: 12, color: "var(--red)" }}
                      onClick={() => onExcluirPagamento(pg.pedido, pg.pagamentoIndex)}>🗑</button>
                  </div>
                ) : (
                  <>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 13, gap: 8 }}>
                      <span>
                        {formatDate(pg.data)} · <strong>{labelForma(pg.tipo)}</strong>
                        {pg.descricao ? ` (${pg.descricao})` : ""}
                        {pg.conta ? ` · ${pg.conta}` : ""}
                        {pg.origem === "venda" && <span style={{ color: "var(--ink-soft)" }}> · na venda</span>}
                        {pg.pendente && <span style={{ color: "#9a6b00" }}> · aguardando confirmação</span>}
                      </span>
                      <span style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
                        <strong style={pg.pendente ? { color: "var(--ink-soft)" } : undefined}>{formatCurrency(pg.valor)}</strong>
                        {!somenteLeitura && pg.origem === "baixa" && (
                          <button type="button" className="btn btn-ghost" style={{ padding: "2px 8px", fontSize: 12 }}
                            onClick={() => onAbrirEdicaoPagamento(pg.pedido, pg.pagamentoIndex, pg.original)} title="Editar">✎</button>
                        )}
                        {!somenteLeitura && pg.pendente && !confirmandoEsse && (
                          <button type="button" className="btn btn-secondary" style={{ padding: "4px 10px", fontSize: 12 }}
                            onClick={() => onAbrirConfirmar(pg.pedido, pg.formaIndex)}>Confirmar</button>
                        )}
                      </span>
                    </div>
                    {pg.parcelas?.length > 0 && (
                      <div style={{ paddingLeft: 12, marginTop: 2 }}>
                        {pg.parcelas.map((parc) => (
                          <div key={parc.numero} style={{ display: "flex", justifyContent: "space-between", fontSize: 12, color: "var(--ink-soft)" }}>
                            <span>Folha N°{parc.numero} — {formatDate(parc.data)}</span>
                            <span>{formatCurrency(parc.valor)}</span>
                          </div>
                        ))}
                      </div>
                    )}
                    {confirmandoEsse && (
                      <div style={{ background: "white", borderRadius: 10, padding: 10, marginTop: 6 }}>
                        <CampoConta conta={contaConfirmar} setConta={setContaConfirmar} identificacao={contaConfirmarId} setIdentificacao={setContaConfirmarId} />
                        <div className="row" style={{ margin: 0 }}>
                          <button type="button" className="btn btn-ghost btn-block" style={{ padding: "6px 10px", fontSize: 13 }} onClick={onCancelarConfirmar}>Cancelar</button>
                          <button type="button" className="btn btn-primary btn-block" style={{ padding: "6px 10px", fontSize: 13 }} onClick={onConfirmarPixDeposito}>Confirmar recebimento</button>
                        </div>
                      </div>
                    )}
                  </>
                )}
              </div>
            );
          })}
          <div style={{ display: "flex", justifyContent: "space-between", paddingTop: 8, fontSize: 13 }}>
            <strong>Total recebido</strong>
            <strong>{formatCurrency(somaPagamentosListados)}</strong>
          </div>
          {pagamentosDivergemDoOficial && (
            <div style={{ fontSize: 11, color: "#9a6b00", background: "var(--yellow-light)", borderRadius: 8, padding: "6px 8px", marginTop: 6 }}>
              ⚠ O "já pago" oficial gravado no pedido é {formatCurrency(g.totalPago)}, diferente da soma dos
              pagamentos listados acima. Mesma causa do aviso em Compras: reconstrução da planilha antiga.
            </div>
          )}
        </div>
      )}

      {edicoes.length > 0 && (
        <div className="card" style={{ background: "var(--bg)" }}>
          <h3 style={{ fontSize: 14, marginBottom: 10 }}>Histórico de edições</h3>
          {edicoes.map((ed, i) => {
            const ehPagamento = ed.tipo === "edicao_pagamento" || ed.tipo === "exclusao_pagamento";
            const ehExclusao = ed.tipo === "exclusao_item" || ed.tipo === "exclusao_pagamento";
            const dataRef = ehPagamento ? ed.dataPagamento : ed.dataItem;
            return (
              <div key={i} style={{ fontSize: 13, padding: "5px 0", borderBottom: "1px solid var(--border)" }}>
                <div style={{ display: "flex", justifyContent: "space-between" }}>
                  <span>{ehPagamento ? "Pagamento" : "Compra"} de {formatDate(dataRef)}{ehExclusao ? " — excluído" : ""}</span>
                  <span>{formatDate(ed.data.slice(0, 10))}</span>
                </div>
                <div style={{ color: "var(--ink-soft)" }}>
                  {ehExclusao
                    ? <>{formatCurrency(ed.valorAnterior)} removido</>
                    : <>{formatCurrency(ed.valorAnterior)} → <strong style={{ color: "var(--ink)" }}>{formatCurrency(ed.valorNovo)}</strong></>}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function CardGrupo({ g, expandido, onToggle, onAbrirGrupo, destacado, onAlternarDestaque, children }) {
  return (
    <div className="card" style={{ padding: 14, background: destacado ? "var(--yellow-light)" : "var(--card)" }}
      onContextMenu={(e) => { e.preventDefault(); onAlternarDestaque?.(g.chave); }}>
      <div style={{ display: "flex", justifyContent: "space-between", cursor: "pointer" }}
        onClick={() => onToggle(g.chave)} onDoubleClick={() => onAbrirGrupo?.(g)}>
        <div>
          <strong>{nomeGrupoOuCliente(g)} - {formatCurrency(g.saldo)}</strong>
          <div style={{ fontSize: 13, color: "var(--ink-soft)", marginTop: 2 }}>
            {[g.representante, formatDate(g.dataMaisRecente), `${g.percentual.toFixed(1)}%`].filter(Boolean).join(" - ")}
          </div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 6 }}>
          <span className={"badge " + g.tag.classe}>{g.tag.texto}</span>
          <span style={{ fontSize: 12, color: "var(--ink-soft)" }}>{expandido ? "▲" : "▼"}</span>
        </div>
      </div>
      {expandido && children}
    </div>
  );
}

// Cheque devolvido em aberto exibido junto dos vales — mesmo formato do
// CardGrupo (clica pra expandir), mas com a tag roxa "Cheque dev.".
function CardChequeDevVale({ item, expandido, onToggle, destacado, onAlternarDestaque, onAtualizado, mostrarToast }) {
  const c = item.cheque;
  return (
    <div className="card" style={{ padding: 14, background: destacado ? "var(--yellow-light)" : "var(--card)" }}
      onContextMenu={(e) => { e.preventDefault(); onAlternarDestaque?.(item.chave); }}>
      <div style={{ display: "flex", justifyContent: "space-between", cursor: "pointer" }} onClick={() => onToggle(item.chave)}>
        <div>
          <strong>{item.nome} - {formatCurrency(item.saldo)}</strong>
          <div style={{ fontSize: 13, color: "var(--ink-soft)", marginTop: 2 }}>
            {[item.representante, formatDate(c.dataRegistro), `${item.percentual.toFixed(1)}%`].filter(Boolean).join(" - ")}
          </div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 6 }}>
          <span className="badge badge-chequedev">Cheque dev.</span>
          <span style={{ fontSize: 12, color: "var(--ink-soft)" }}>{expandido ? "▲" : "▼"}</span>
        </div>
      </div>
      {expandido && (
        <div style={{ marginTop: 8, borderTop: "1px solid var(--border)", paddingTop: 8 }}>
          <DetalheChequeDevolvido cheque={c} onAtualizado={onAtualizado} mostrarToast={mostrarToast} />
        </div>
      )}
    </div>
  );
}

export default function ValesRecebidos({ alvoAbrir, onAlvoConsumido } = {}) {
  const [sub, setSub] = useState("vales"); // vales | comissoes | recebidos
  const [mostrarTotais, setMostrarTotais] = useState(false); // fica oculto até clicar em "Visualizar"

  // Marcação visual (botão direito do mouse) — só pra layout, ajuda a
  // acompanhar quem já foi revisado. Fica salvo no navegador, não no banco.
  const [destacados, setDestacados] = useState(() => {
    try {
      return new Set(JSON.parse(localStorage.getItem("egi-financeiro-destacados") || "[]"));
    } catch {
      return new Set();
    }
  });

  function salvarDestacados(novoSet) {
    setDestacados(novoSet);
    try {
      localStorage.setItem("egi-financeiro-destacados", JSON.stringify([...novoSet]));
    } catch {
      // se o navegador bloquear localStorage, só não persiste — não quebra a tela
    }
  }

  function alternarDestaque(chave) {
    const novo = new Set(destacados);
    if (novo.has(chave)) novo.delete(chave); else novo.add(chave);
    salvarDestacados(novo);
  }

  function limparDestacados() {
    salvarDestacados(new Set());
  }
  const [pedidos, setPedidos] = useState([]);
  const [clientes, setClientes] = useState([]);
  const [todosChequesDevolvidos, setTodosChequesDevolvidos] = useState([]);
  const [carregando, setCarregando] = useState(true);
  const [modalAberto, setModalAberto] = useState(null); // { clientes, grupoNome }

  const [filtro, setFiltro] = useState("");
  const [ordenacao, setOrdenacao] = useState("data_desc");
  // Filtros da aba Vales (múltipla escolha). Status entre si = "OU";
  // Representantes / Sem grupo / Sem prazo = "E" (refinam o resultado).
  const [filtrosVales, setFiltrosVales] = useState(new Set());
  const [repFiltro, setRepFiltro] = useState("");
  function alternarFiltroVales(chave) {
    setFiltrosVales((atual) => {
      const novo = new Set(atual);
      if (novo.has(chave)) novo.delete(chave); else novo.add(chave);
      if (chave === "representantes" && !novo.has(chave)) setRepFiltro("");
      return novo;
    });
  }
  const [expandidos, setExpandidos] = useState(new Set());

  const [pedidoBaixa, setPedidoBaixa] = useState(null);
  const [pedidosIrmaosComSaldo, setPedidosIrmaosComSaldo] = useState([]);
  const [valorBaixa, setValorBaixa] = useState("");
  const [dataBaixa, setDataBaixa] = useState(todayISO());
  const [formaBaixa, setFormaBaixa] = useState("pix_ted");
  const [contaBaixa, setContaBaixa] = useState("");
  const [contaBaixaId, setContaBaixaId] = useState("");
  const [numFolhasBaixa, setNumFolhasBaixa] = useState("1");
  const [prazoUltimoChequeBaixa, setPrazoUltimoChequeBaixa] = useState("");
  const [descricaoBaixa, setDescricaoBaixa] = useState("");
  const [parcelasBaixaManual, setParcelasBaixaManual] = useState(null);
  const [editandoItem, setEditandoItem] = useState(null); // { pedido, itemIndex, valor, data }
  const [editandoPagamento, setEditandoPagamento] = useState(null); // { pedido, pagamentoIndex, valor, data }

  const [confirmando, setConfirmando] = useState(null);
  const [contaConfirmar, setContaConfirmar] = useState("");
  const [contaConfirmarId, setContaConfirmarId] = useState("");

  const [selecionadosComissao, setSelecionadosComissao] = useState(new Set());

  const [toast, setToast] = useState("");

  async function carregar({ silencioso = false } = {}) {
    if (!silencioso) setCarregando(true);
    const [lista, listaClientes] = await Promise.all([listarPedidos(), listarClientes()]);
    setPedidos(lista);
    setClientes(listaClientes);
    setCarregando(false);
    return lista;
  }

  useEffect(() => { carregar(); }, []);
  function recarregarChequesDevolvidos() {
    return listarChequesDevolvidos().then(setTodosChequesDevolvidos);
  }
  useEffect(() => { recarregarChequesDevolvidos(); }, []);

  useEffect(() => {
    if (!alvoAbrir || pedidos.length === 0) return;
    const chaveAlvo = (alvoAbrir.clienteGrupo || "").trim().toLowerCase() || `cli_${alvoAbrir.clienteId}`;
    setSub("vales");
    setExpandidos(new Set([chaveAlvo]));
    onAlvoConsumido?.();
  }, [alvoAbrir, pedidos]);

  function mostrarToast(msg) {
    setToast(msg);
    setTimeout(() => setToast(""), 3000);
  }

  function toggleExpandido(chave) {
    setExpandidos((atual) => {
      const novo = new Set(atual);
      if (novo.has(chave)) novo.delete(chave); else novo.add(chave);
      return novo;
    });
    setPedidoBaixa(null);
    setConfirmando(null);
  }

  // Resolve os cadastros reais (com id, cnpj, etc.) dos clientes que
  // compõem o grupo clicado — os pedidos só guardam uma cópia do nome/id
  // no momento da venda, então buscamos o cadastro atual pra editar.
  function abrirGrupo(g) {
    const encontrados = clientes.filter((c) => g.clientesIds.has(c.id));
    if (encontrados.length === 0) {
      mostrarToast("Cadastro do cliente não encontrado na Base de Dados.");
      return;
    }
    setModalAberto({ clientes: encontrados, grupoNome: nomeExibicao(g) });
  }

  function aplicarFiltroOrdenacao(lista, campoNome, campoData, campoValor, campoPercentual, campoRepresentante) {
    let out = lista;
    if (filtro.trim()) {
      const f = filtro.toLowerCase();
      out = out.filter((item) => campoNome(item).toLowerCase().includes(f));
    }
    const [campo, dir] = ordenacao.split("_");
    const mult = dir === "asc" ? 1 : -1;
    out = [...out].sort((a, b) => {
      if (campo === "nome") return mult * campoNome(a).localeCompare(campoNome(b), "pt-BR");
      if (campo === "percentual" && campoPercentual) return mult * (campoPercentual(a) - campoPercentual(b));
      if (campo === "representante" && campoRepresentante) {
        return mult * (campoRepresentante(a) || "").localeCompare(campoRepresentante(b) || "", "pt-BR");
      }
      const va = campo === "data" ? new Date(campoData(a)) : campoValor(a);
      const vb = campo === "data" ? new Date(campoData(b)) : campoValor(b);
      return dir === "asc" ? va - vb : vb - va;
    });
    return out;
  }

  const pedidosAtivos = pedidos.filter((p) => !p.arquivado);
  // Cadastro "efetivo": quem está sem prazo/desconto assume o do grupo.
  // (A edição de cadastro continua usando a lista crua `clientes`.)
  const clientesPorId = {};
  herdarCondicoesDoGrupo(clientes).forEach((c) => { clientesPorId[c.id] = c; });
  // Mesma correção de "sempre usar o cadastro atual" que já fizemos pro nome/grupo:
  // se o representante foi adicionado/editado no cadastro DEPOIS do pedido já
  // existir, o pedido tem que passar a contar como comissão também — não fica
  // preso em Vales só porque a cópia antiga do pedido estava vazia.
  function representanteAtualDoPedido(p) {
    return clientesPorId[p.clienteId]?.representante || p.clienteRepresentante;
  }
  const pedidosComissao = pedidosAtivos.filter((p) => p.status === "pago" && representanteAtualDoPedido(p));
  const pedidosVales = pedidosAtivos.filter((p) => !(p.status === "pago" && representanteAtualDoPedido(p)));
  const pedidosRecebidos = pedidos.filter((p) => p.arquivado === true);

  // Total geral em aberto e previsão de recebimento nos próximos 30 dias
  // (valor integral pra prazo de 30 dias, proporcional pra prazos maiores
  // — ver contribuicao30Dias). Calculado sobre todos os vales, sem levar
  // em conta o filtro de busca da tela.
  const totalAReceberGeral = pedidosVales.reduce((soma, p) => {
    const saldo = saldoDoPedido(p);
    return soma + Math.max(saldo, 0);
  }, 0);
  const totalProximos30Dias = pedidosVales.reduce((soma, p) => {
    const saldo = saldoDoPedido(p);
    if (saldo <= 0) return soma;
    return soma + contribuicao30Dias(saldo, clientesPorId[p.clienteId]?.prazo ?? p.clientePrazo);
  }, 0);

  // "Data (antiga)" ordena pelo pedido em aberto mais antigo do cliente;
  // "Data (recente)" continua pelo último pedido lançado.
  const campoDataVales = (g) => (ordenacao === "data_asc" ? (g.dataMaisAntigaAberto ?? g.dataMaisRecente) : g.dataMaisRecente);

  const gruposVales = aplicarFiltroOrdenacao(
    agruparPorCliente(pedidosVales, clientesPorId),
    (g) => nomeExibicao(g),
    campoDataVales,
    (g) => g.saldo,
    (g) => g.percentual,
    (g) => g.representante
  );
  // Cheques devolvidos em aberto entram na lista de Vales (tag roxa), com a
  // mesma busca e ordenação dos grupos. Não entram nos totais do topo.
  const chequesDevVales = todosChequesDevolvidos
    .filter((c) => c.status === "aberto")
    .map((c) => {
      const cad = clientesPorId[c.clienteId];
      const grupo = (cad?.grupo ?? c.clienteGrupo ?? "").trim();
      const saldo = (Number(c.valorCheque) || 0) - (Number(c.valorPago) || 0);
      return {
        ehChequeDev: true,
        chave: `chdev_${c.id}`,
        cheque: c,
        nome: grupo || cad?.nome || c.clienteNome,
        nomeGrupo: grupo,
        representante: cad?.representante || c.clienteRepresentante || "",
        saldo,
        percentual: calcularPercentualAberto(saldo, Number(c.valorCheque) || 0),
      };
    });
  const itensValesTodos = aplicarFiltroOrdenacao(
    [...agruparPorCliente(pedidosVales, clientesPorId), ...chequesDevVales],
    (x) => (x.ehChequeDev ? (x.representante ? `${x.nome} (${x.representante})` : x.nome) : nomeExibicao(x)),
    (x) => (x.ehChequeDev ? x.cheque.dataRegistro : campoDataVales(x)),
    (x) => x.saldo,
    (x) => x.percentual,
    (x) => x.representante
  );

  const STATUS_FILTRO = { Pago: "pago", "Em aberto": "aberto", Atrasado: "atrasado" };
  function statusDoItem(x) {
    return x.ehChequeDev ? "chequeDev" : STATUS_FILTRO[x.tag?.texto] || "outro";
  }
  // Sem prazo = grupo em que NENHUM cadastro tem prazo. Como o prazo de um
  // cadastro vale pro grupo todo (herança acima), basta checar o efetivo.
  function semPrazo(cad) {
    if (!cad) return true;
    const vazio = cad.prazo === undefined || cad.prazo === null || cad.prazo === "";
    return vazio && !cad.prazoModelo;
  }
  function clientesDoItem(x) {
    if (x.ehChequeDev) return [clientesPorId[x.cheque.clienteId]];
    return Array.from(x.clientesIds || []).map((id) => clientesPorId[id]);
  }
  const statusSelecionados = ["pago", "aberto", "atrasado", "chequeDev"].filter((k) => filtrosVales.has(k));
  const representantesVales = [...new Set(itensValesTodos.map((x) => x.representante).filter(Boolean))]
    .sort((a, b) => a.localeCompare(b, "pt-BR"));
  const itensVales = itensValesTodos.filter((x) => {
    if (statusSelecionados.length && !statusSelecionados.includes(statusDoItem(x))) return false;
    if (filtrosVales.has("representantes")) {
      if (!x.representante) return false;
      if (repFiltro && x.representante !== repFiltro) return false;
    }
    if (filtrosVales.has("semGrupo") && x.nomeGrupo) return false;
    if (filtrosVales.has("semPrazo") && !clientesDoItem(x).some(semPrazo)) return false;
    return true;
  });
  const gruposRecebidos = aplicarFiltroOrdenacao(
    agruparPorCliente(pedidosRecebidos, clientesPorId),
    (g) => nomeExibicao(g),
    (g) => g.dataMaisRecente,
    (g) => g.totalPago,
    (g) => g.percentual,
    (g) => g.representante
  );
  const comissoesFiltradas = aplicarFiltroOrdenacao(
    pedidosComissao,
    (p) => clientesPorId[p.clienteId]?.nome || p.clienteNome,
    (p) => p.data,
    (p) => p.valor,
    null,
    (p) => representanteAtualDoPedido(p)
  );

  function abrirBaixa(pedido, todosComSaldo = []) {
    const saldo = saldoDoPedido(pedido);
    setPedidoBaixa(pedido);
    // Outros pedidos do mesmo cliente ainda em aberto — se o valor digitado
    // for maior que o saldo deste pedido, oferecemos aplicar a diferença
    // neles em vez de deixar o excesso "sobrando" só neste (o que fechava
    // um pedido e deixava o outro parado pra sempre, sem ir pra comissão).
    setPedidosIrmaosComSaldo(todosComSaldo.filter((p) => p.id !== pedido.id));
    setValorBaixa(saldo.toFixed(2));
    setDataBaixa(todayISO());
    setFormaBaixa("pix_ted");
    setContaBaixa("");
    setContaBaixaId("");
    setNumFolhasBaixa("1");
    setPrazoUltimoChequeBaixa("");
    setDescricaoBaixa("");
    setParcelasBaixaManual(null);
  }

  function parcelasDaBaixa() {
    return parcelasBaixaManual || calcularParcelasCheque(prazoUltimoChequeBaixa, numFolhasBaixa, valorBaixa);
  }

  function editarParcelaBaixa(index, campo, valor) {
    const base = parcelasDaBaixa();
    const novas = campo === "data"
      ? redistribuirDatasCheque(base, index, valor)
      : base.map((p, i) => (i === index ? { ...p, valor: Number(valor) } : p));
    setParcelasBaixaManual(novas);
    // mantém o campo "Prazo do último cheque" igual à data da última folha
    if (campo === "data" && novas.length) setPrazoUltimoChequeBaixa(novas[novas.length - 1].data);
  }

  async function confirmarBaixa() {
    if (!valorBaixa || Number(valorBaixa) <= 0) {
      mostrarToast("Informe um valor válido");
      return;
    }
    const ehCheque = formaBaixa === "cheque";
    if (ehCheque && (!prazoUltimoChequeBaixa || Number(numFolhasBaixa) < 1)) {
      mostrarToast("Informe o prazo do último cheque e o número de folhas");
      return;
    }
    if (formaBaixa === "conta_terceiros" && !descricaoBaixa.trim()) {
      mostrarToast("Informe de quem é a conta");
      return;
    }

    const valorDigitado = Number(valorBaixa);
    const saldoPedidoAtual = saldoDoPedido(pedidoBaixa);
    const excedente = valorDigitado - saldoPedidoAtual;

    const dadosBase = {
      data: dataBaixa,
      formaPagamento: formaBaixa,
      conta: FORMAS_COM_CONTA.includes(formaBaixa) ? montarConta(contaBaixa, contaBaixaId) : null,
      ...(formaBaixa === "conta_terceiros" ? { descricao: descricaoBaixa.trim() } : {}),
    };
    // Parcelas de cheque: no caso normal (sem dividir com outro pedido),
    // respeita qualquer folha que o usuário tenha editado manualmente. Só
    // quando o valor É dividido entre pedidos é que recalculamos as folhas
    // a partir de cada valor aplicado — a edição manual foi feita em cima
    // do total digitado e não tem como ser dividida de volta com sentido.
    function comParcelas(dados, valor, recalcularDoZero) {
      if (!ehCheque) return dados;
      const parcelas = recalcularDoZero ? calcularParcelasCheque(prazoUltimoChequeBaixa, numFolhasBaixa, valor) : parcelasDaBaixa();
      return { ...dados, numFolhas: Number(numFolhasBaixa), prazoUltimoCheque: prazoUltimoChequeBaixa, parcelas };
    }

    // Sobrou valor além do que ESTE pedido deve, e tem outro pedido do mesmo
    // cliente em aberto: pergunta se aplica a diferença nele(s) — é
    // exatamente o caso de registrar de uma vez o total de dois pedidos.
    let aplicarNosIrmaos = false;
    if (excedente > 0.01 && pedidosIrmaosComSaldo.length > 0) {
      aplicarNosIrmaos = window.confirm(
        `O valor digitado é ${formatCurrency(excedente)} maior que o saldo deste pedido (${formatCurrency(saldoPedidoAtual)}).

` +
        `Aplicar a diferença no(s) outro(s) pedido(s) em aberto de ${pedidoBaixa.clienteNome || "este cliente"}?`
      );
    }

    if (aplicarNosIrmaos) {
      let resto = valorDigitado;
      const valorNesteAgora = Math.min(resto, saldoPedidoAtual);
      await registrarBaixa(pedidoBaixa.id, pedidoBaixa, { ...comParcelas(dadosBase, valorNesteAgora, true), valor: valorNesteAgora });
      resto -= valorNesteAgora;

      const irmaosOrdenados = [...pedidosIrmaosComSaldo].sort((a, b) => new Date(a.data) - new Date(b.data));
      for (const irmao of irmaosOrdenados) {
        if (resto <= 0.01) break;
        const saldoIrmao = saldoDoPedido(irmao);
        const valorIrmao = Math.min(resto, saldoIrmao);
        // eslint-disable-next-line no-await-in-loop -- baixas em sequência, uma depende da anterior já ter sido gravada
        await registrarBaixa(irmao.id, irmao, { ...comParcelas(dadosBase, valorIrmao, true), valor: valorIrmao });
        resto -= valorIrmao;
      }
      mostrarToast(resto > 0.01
        ? `Pagamento registrado! Sobrou ${formatCurrency(resto)} sem pedido em aberto desse cliente pra aplicar.`
        : "Pagamento registrado nos pedidos em aberto desse cliente!");
    } else {
      await registrarBaixa(pedidoBaixa.id, pedidoBaixa, { ...comParcelas(dadosBase, valorDigitado, false), valor: valorDigitado });
      mostrarToast("Pagamento registrado!");
    }

    setPedidoBaixa(null);
    setPedidosIrmaosComSaldo([]);
    carregar({ silencioso: true });
  }

  function abrirEdicaoItem(pedido, itemIndex, valorAtual, dataAtual) {
    setEditandoItem({ pedido, itemIndex, valor: String(valorAtual), data: dataAtual });
  }

  function setValorEditandoItem(valor) {
    setEditandoItem((atual) => (atual ? { ...atual, valor } : atual));
  }

  function setDataEditandoItem(data) {
    setEditandoItem((atual) => (atual ? { ...atual, data } : atual));
  }

  async function salvarEdicaoItem() {
    if (!editandoItem || !editandoItem.valor || Number(editandoItem.valor) <= 0) {
      mostrarToast("Informe um valor válido");
      return;
    }
    await editarItemPedido(editandoItem.pedido.id, editandoItem.pedido, editandoItem.itemIndex, {
      valor: Number(editandoItem.valor),
      data: editandoItem.data,
    });
    mostrarToast("Compra atualizada!");
    setEditandoItem(null);
    carregar({ silencioso: true });
  }

  async function excluirCompra(pedido, itemIndex) {
    if (!window.confirm("Excluir essa compra? Essa ação fica registrada no histórico de alterações.")) return;
    await excluirItemPedido(pedido.id, pedido, itemIndex);
    mostrarToast("Compra excluída.");
    setEditandoItem(null);
    carregar({ silencioso: true });
  }

  function abrirEdicaoPagamento(pedido, pagamentoIndex, pagamentoAtual) {
    setEditandoPagamento({ pedido, pagamentoIndex, valor: String(pagamentoAtual.valor), data: pagamentoAtual.data });
  }

  function setValorEditandoPagamento(valor) {
    setEditandoPagamento((atual) => (atual ? { ...atual, valor } : atual));
  }

  function setDataEditandoPagamento(data) {
    setEditandoPagamento((atual) => (atual ? { ...atual, data } : atual));
  }

  async function salvarEdicaoPagamento() {
    if (!editandoPagamento || !editandoPagamento.valor || Number(editandoPagamento.valor) <= 0) {
      mostrarToast("Informe um valor válido");
      return;
    }
    await editarPagamento(editandoPagamento.pedido.id, editandoPagamento.pedido, editandoPagamento.pagamentoIndex, {
      valor: Number(editandoPagamento.valor),
      data: editandoPagamento.data,
    });
    mostrarToast("Pagamento atualizado!");
    setEditandoPagamento(null);
    carregar({ silencioso: true });
  }

  async function excluirPagamentoAction(pedido, pagamentoIndex) {
    if (!window.confirm("Excluir esse pagamento? O saldo do pedido volta a ficar em aberto por esse valor. Essa ação fica registrada no histórico.")) return;
    await excluirPagamento(pedido.id, pedido, pagamentoIndex);
    mostrarToast("Pagamento excluído.");
    setEditandoPagamento(null);
    carregar({ silencioso: true });
  }

  function abrirConfirmar(pedido, formaIndex) {
    setConfirmando({ pedido, formaIndex });
    setContaConfirmar("");
    setContaConfirmarId("");
  }

  async function confirmarPixDeposito() {
    const { pedido, formaIndex } = confirmando;
    await confirmarFormaPagamento(pedido.id, pedido, formaIndex, montarConta(contaConfirmar, contaConfirmarId));
    mostrarToast("Pagamento confirmado e baixado!");
    setConfirmando(null);
    carregar({ silencioso: true });
  }

  async function moverParaRecebidos(g) {
    await arquivarPedidos(g.pedidos.map((p) => p.id));
    mostrarToast("Cliente movido para Recebidos!");
    setExpandidos((atual) => { const n = new Set(atual); n.delete(g.chave); return n; });
    carregar({ silencioso: true });
  }

  async function moverParaComissoes(g) {
    await marcarComoPago(g.pedidos.map((p) => p.id));
    mostrarToast("Cliente movido para Comissões!");
    setExpandidos((atual) => { const n = new Set(atual); n.delete(g.chave); return n; });
    carregar({ silencioso: true });
  }

  function toggleSelecaoComissao(id) {
    setSelecionadosComissao((atual) => {
      const novo = new Set(atual);
      if (novo.has(id)) novo.delete(id); else novo.add(id);
      return novo;
    });
  }

  async function confirmarComissaoPaga() {
    await arquivarPedidos(Array.from(selecionadosComissao), { comissaoPaga: true });
    mostrarToast(`${selecionadosComissao.size} pedido(s) movido(s) para Recebidos!`);
    setSelecionadosComissao(new Set());
    carregar({ silencioso: true });
  }

  return (
    <div>
      {toast && <div className="toast">{toast}</div>}

      <div className="card" style={{ padding: 8, display: "flex", gap: 8 }}>
        <button className={"btn " + (sub === "vales" ? "btn-primary" : "btn-ghost")} style={{ flex: 1, fontSize: 13 }} onClick={() => setSub("vales")}>
          Vales ({gruposVales.length})
        </button>
        <button className={"btn " + (sub === "comissoes" ? "btn-primary" : "btn-ghost")} style={{ flex: 1, fontSize: 13 }} onClick={() => setSub("comissoes")}>
          Comissões ({pedidosComissao.length})
        </button>
        <button className={"btn " + (sub === "recebidos" ? "btn-primary" : "btn-ghost")} style={{ flex: 1, fontSize: 13 }} onClick={() => setSub("recebidos")}>
          Recebidos ({gruposRecebidos.length})
        </button>
        <button className={"btn " + (sub === "chequesDevolvidos" ? "btn-primary" : "btn-ghost")} style={{ flex: 1, fontSize: 13 }} onClick={() => setSub("chequesDevolvidos")}>
          Cheques Devolvidos{todosChequesDevolvidos.filter((c) => c.status === "aberto").length > 0 ? ` (${todosChequesDevolvidos.filter((c) => c.status === "aberto").length})` : ""}
        </button>
      </div>

      <div className="card" style={{ padding: 12 }}>
        <div className="row" style={{ marginBottom: 0 }}>
          <div className="field" style={{ marginBottom: 0 }}>
            <input className="input" placeholder="Buscar por cliente ou grupo" value={filtro} onChange={(e) => setFiltro(e.target.value)} />
          </div>
          <div className="field" style={{ marginBottom: 0, flex: "0 0 180px" }}>
            <select className="input" value={ordenacao} onChange={(e) => setOrdenacao(e.target.value)}>
              <option value="data_desc">Data (recente)</option>
              <option value="data_asc">Data (antiga)</option>
              <option value="valor_desc">Valor (maior)</option>
              <option value="valor_asc">Valor (menor)</option>
              <option value="nome_asc">Nome (A-Z)</option>
              <option value="nome_desc">Nome (Z-A)</option>
              <option value="percentual_desc">% em aberto (maior)</option>
              <option value="percentual_asc">% em aberto (menor)</option>
              <option value="representante_asc">Representante (A-Z)</option>
              <option value="representante_desc">Representante (Z-A)</option>
            </select>
          </div>
        </div>
      </div>

      {sub === "vales" && (
        <div className="card">
          <div style={{ display: "flex", gap: 16, flexWrap: "wrap", alignItems: "center" }}>
            {!mostrarTotais ? (
              <button type="button" className="btn btn-secondary" onClick={() => setMostrarTotais(true)}>
                👁 Visualizar totais
              </button>
            ) : (
              <>
                <div>
                  <div style={{ fontSize: 13, color: "var(--ink-soft)" }}>Total a receber</div>
                  <strong style={{ fontSize: 22 }}>{formatCurrency(totalAReceberGeral)}</strong>
                </div>
                <div title="Estimativa: pedidos com prazo de 30 dias entram integralmente; prazos maiores entram proporcionalmente (ex: prazo de 90 dias conta 1/3 do saldo). Pedidos sem prazo definido entram integralmente.">
                  <div style={{ fontSize: 13, color: "var(--ink-soft)" }}>
                    Previsto p/ próximos 30 dias <span style={{ cursor: "help" }}>ⓘ</span>
                  </div>
                  <strong style={{ fontSize: 22, color: "var(--grape)" }}>{formatCurrency(totalProximos30Dias)}</strong>
                </div>
              </>
            )}
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
              {[
                { chave: "pago", texto: "Pagos", classe: "badge-pago" },
                { chave: "aberto", texto: "Em aberto", classe: "badge-aberto" },
                { chave: "atrasado", texto: "Atrasado", classe: "badge-atraso" },
                { chave: "chequeDev", texto: "Cheque dev.", classe: "badge-chequedev" },
                { chave: "representantes", texto: "Representantes", classe: "badge-neutro" },
                { chave: "semGrupo", texto: "Sem grupo", classe: "badge-neutro" },
                { chave: "semPrazo", texto: "Sem prazo", classe: "badge-neutro" },
              ].map((f) => (
                <button key={f.chave} type="button"
                  className={"badge filtro-chip " + f.classe + (filtrosVales.has(f.chave) ? " filtro-ativo" : "")}
                  onClick={() => alternarFiltroVales(f.chave)}>
                  {filtrosVales.has(f.chave) ? "✓ " : ""}{f.texto}
                </button>
              ))}
              {filtrosVales.has("representantes") && (
                <select className="input" style={{ width: "auto", padding: "4px 8px", fontSize: 12 }}
                  value={repFiltro} onChange={(e) => setRepFiltro(e.target.value)}>
                  <option value="">Todos os representantes</option>
                  {representantesVales.map((r) => <option key={r} value={r}>{r}</option>)}
                </select>
              )}
              {filtrosVales.size > 0 && (
                <>
                  <span style={{ fontSize: 12, color: "var(--ink-soft)" }}>{itensVales.length} de {itensValesTodos.length}</span>
                  <button type="button" className="btn btn-ghost" style={{ fontSize: 12, padding: "4px 8px" }}
                    onClick={() => { setFiltrosVales(new Set()); setRepFiltro(""); }}>
                    Limpar filtros
                  </button>
                </>
              )}
            </div>
            <div style={{ marginLeft: "auto", display: "flex", gap: 8, alignItems: "center" }}>
              {destacados.size > 0 && (
                <button type="button" className="btn btn-ghost" style={{ fontSize: 12, padding: "6px 10px" }}
                  onClick={limparDestacados}>
                  Voltar para fundo branco
                </button>
              )}
              {mostrarTotais && (
                <button type="button" className="btn btn-ghost" style={{ fontSize: 12, padding: "6px 10px" }}
                  onClick={() => setMostrarTotais(false)}>
                  Ocultar
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {carregando && <div className="empty-state">Carregando...</div>}

      {!carregando && sub === "vales" && (
        itensVales.length === 0 ? (
          <div className="empty-state">{filtrosVales.size > 0 ? "Nenhum card com esses filtros." : "Nenhuma conta em aberto 🎉"}</div>
        ) : (
          <div className="lista-grid">
            {itensVales.map((g) => g.ehChequeDev ? (
              <CardChequeDevVale key={g.chave} item={g} expandido={expandidos.has(g.chave)} onToggle={toggleExpandido}
                destacado={destacados.has(g.chave)} onAlternarDestaque={alternarDestaque}
                onAtualizado={recarregarChequesDevolvidos} mostrarToast={mostrarToast} />
            ) : (
              <CardGrupo key={g.chave} g={g} expandido={expandidos.has(g.chave)} onToggle={toggleExpandido} onAbrirGrupo={abrirGrupo}
                destacado={destacados.has(g.chave)} onAlternarDestaque={alternarDestaque}>
                <DetalheExpandido
                  g={g}
                  clientesPorId={clientesPorId} chequesDevolvidos={todosChequesDevolvidos}
                  pedidoBaixa={pedidoBaixa} onAbrirBaixa={abrirBaixa} onCancelarBaixa={() => { setPedidoBaixa(null); setPedidosIrmaosComSaldo([]); }} onConfirmarBaixa={confirmarBaixa}
                  valorBaixa={valorBaixa} setValorBaixa={setValorBaixa} dataBaixa={dataBaixa} setDataBaixa={setDataBaixa}
                  formaBaixa={formaBaixa} setFormaBaixa={setFormaBaixa}
                  numFolhasBaixa={numFolhasBaixa} setNumFolhasBaixa={setNumFolhasBaixa}
                  prazoUltimoChequeBaixa={prazoUltimoChequeBaixa} setPrazoUltimoChequeBaixa={setPrazoUltimoChequeBaixa}
                  parcelasBaixaManual={parcelasBaixaManual} parcelasDaBaixa={parcelasDaBaixa}
                  onEditarParcelaBaixa={editarParcelaBaixa} onRecalcularParcelasBaixa={() => setParcelasBaixaManual(null)}
                  descricaoBaixa={descricaoBaixa} setDescricaoBaixa={setDescricaoBaixa}
                  editandoItem={editandoItem} onAbrirEdicaoItem={abrirEdicaoItem} onCancelarEdicaoItem={() => setEditandoItem(null)}
                  onSalvarEdicaoItem={salvarEdicaoItem}
                  onSetValorEditandoItem={setValorEditandoItem} onSetDataEditandoItem={setDataEditandoItem}
                  onExcluirCompra={excluirCompra}
                  editandoPagamento={editandoPagamento} onAbrirEdicaoPagamento={abrirEdicaoPagamento}
                  onCancelarEdicaoPagamento={() => setEditandoPagamento(null)} onSalvarEdicaoPagamento={salvarEdicaoPagamento}
                  onSetValorEditandoPagamento={setValorEditandoPagamento} onSetDataEditandoPagamento={setDataEditandoPagamento}
                  onExcluirPagamento={excluirPagamentoAction}
                  contaBaixa={contaBaixa} setContaBaixa={setContaBaixa} contaBaixaId={contaBaixaId} setContaBaixaId={setContaBaixaId}
                  confirmando={confirmando} onAbrirConfirmar={abrirConfirmar} onCancelarConfirmar={() => setConfirmando(null)} onConfirmarPixDeposito={confirmarPixDeposito}
                  contaConfirmar={contaConfirmar} setContaConfirmar={setContaConfirmar} contaConfirmarId={contaConfirmarId} setContaConfirmarId={setContaConfirmarId}
                  onMoverRecebidos={moverParaRecebidos}
                  onMoverComissoes={moverParaComissoes}
                />
              </CardGrupo>
            ))}
          </div>
        )
      )}

      {!carregando && sub === "comissoes" && (
        comissoesFiltradas.length === 0 ? (
          <div className="empty-state">Nenhum pedido pago aguardando comissão.</div>
        ) : (
          <>
            {selecionadosComissao.size > 0 && (() => {
              const totalVales = comissoesFiltradas
                .filter((p) => selecionadosComissao.has(p.id))
                .reduce((s, p) => s + (Number(p.valor) || 0), 0);
              const totalComissao = totalVales * 0.05;
              return (
                <button className="btn btn-primary btn-block" style={{ marginBottom: 12, height: "auto", padding: "10px 16px" }}
                  onClick={confirmarComissaoPaga}>
                  <div>Comissão paga ({selecionadosComissao.size} selecionado{selecionadosComissao.size > 1 ? "s" : ""})</div>
                  <div style={{ fontSize: 12, fontWeight: 400, opacity: 0.9, marginTop: 2 }}>
                    Total dos vales: {formatCurrency(totalVales)} · A pagar (5%): {formatCurrency(totalComissao)}
                  </div>
                </button>
              );
            })()}
            <div className="lista-grid">
              {comissoesFiltradas.map((p) => (
                <div key={p.id} className="list-item" onClick={() => toggleSelecaoComissao(p.id)}
                  onContextMenu={(e) => { e.preventDefault(); alternarDestaque("comissao_" + p.id); }}
                  style={{ alignItems: "center", background: destacados.has("comissao_" + p.id) ? "var(--yellow-light)" : "var(--card)" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <input type="checkbox" checked={selecionadosComissao.has(p.id)} onChange={() => toggleSelecaoComissao(p.id)} onClick={(e) => e.stopPropagation()} />
                    <div>
                      <strong>{clientesPorId[p.clienteId]?.nome || p.clienteNome}</strong>
                      <div style={{ fontSize: 13, color: "var(--ink-soft)" }}>
                        Rep: {representanteAtualDoPedido(p)} · {formatDate(p.data)} · {formatCurrency(p.valor)}
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </>
        )
      )}

      {sub === "chequesDevolvidos" && (
        <ChequesDevolvidos clientes={clientes} pedidos={pedidos} mostrarToast={mostrarToast} onMudou={setTodosChequesDevolvidos} />
      )}

      {!carregando && sub === "recebidos" && (
        gruposRecebidos.length === 0 ? (
          <div className="empty-state">Nenhum recebimento ainda.</div>
        ) : (
          <div className="lista-grid">
            {gruposRecebidos.map((g) => (
              <CardGrupo key={g.chave} g={{ ...g, tag: { texto: "Pago", classe: "badge-pago" } }} expandido={expandidos.has(g.chave)} onToggle={toggleExpandido} onAbrirGrupo={abrirGrupo}>
                <DetalheExpandido
                  g={g}
                  pedidoBaixa={null} onAbrirBaixa={() => {}} onCancelarBaixa={() => {}} onConfirmarBaixa={() => {}}
                  valorBaixa="" setValorBaixa={() => {}} dataBaixa="" setDataBaixa={() => {}}
                  formaBaixa="" setFormaBaixa={() => {}}
                  contaBaixa="" setContaBaixa={() => {}} contaBaixaId="" setContaBaixaId={() => {}}
                  confirmando={null} onAbrirConfirmar={() => {}} onCancelarConfirmar={() => {}} onConfirmarPixDeposito={() => {}}
                  contaConfirmar="" setContaConfirmar={() => {}} contaConfirmarId="" setContaConfirmarId={() => {}}
                  onMoverRecebidos={() => {}}
                  onMoverComissoes={() => {}}
                  somenteLeitura
                />
              </CardGrupo>
            ))}
          </div>
        )
      )}

      {modalAberto && (
        <ClienteCadastroModal
          clientes={modalAberto.clientes}
          grupoNome={modalAberto.grupoNome}
          onClose={() => setModalAberto(null)}
          onSaved={() => carregar({ silencioso: true })}
        />
      )}
    </div>
  );
}
