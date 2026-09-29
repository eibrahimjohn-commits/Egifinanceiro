import { useEffect, useState } from "react";
import "../components/ui.css";
import { listarPedidos, importarHistoricoPedidos, marcarConferido } from "../lib/pedidos";
import { listarChequesDevolvidos } from "../lib/chequesDevolvidos";
import { listarClientes, registrarContatoInativo, marcarTelefoneIndisponivel, reativarTelefone, marcarTelefoneVerificado, desmarcarTelefoneVerificado, definirStatusGrupoWhatsapp } from "../lib/clientes";
import { lerHistoricoPedidos } from "../lib/importarHistorico";
import { formatCurrency, formatDate, pedidoEstaAtrasado, linkWhatsAppInativo, saldoDoPedido, situacaoEmAbertoDoPedido, normalizarTelefone, ehTelefoneFixo, linkLigar, herdarCondicoesDoGrupo, STATUS_GRUPO_WHATSAPP, statusGrupoWhatsappDe, valorDevidoDoPedido } from "../lib/constants";
import ClienteCadastroModal from "../components/ClienteCadastroModal";

const DIAS_INATIVO = 60;
const DIAS_COOLDOWN_CONTATO = 14;

export default function Analises({ onAbrirNoVales }) {
  const [pedidos, setPedidos] = useState([]);
  const [clientes, setClientes] = useState([]);
  const [chequesDevolvidosRanking, setChequesDevolvidosRanking] = useState([]);
  const [limiteRanking, setLimiteRanking] = useState(100);
  const [pesosRanking, setPesosRanking] = useState({ capitalSocial: 25, ticketMedio: 25, frequencia: 25, chequesDevolvidos: 25 });
  const [carregando, setCarregando] = useState(true);
  const [modalAberto, setModalAberto] = useState(null); // { clientes, grupoNome }
  const [ordenacaoInativos, setOrdenacaoInativos] = useState("nome_asc");
  const [ordenacaoSemContato, setOrdenacaoSemContato] = useState("ultimaCompra_desc");
  // Qual análise está aberta — lembrada no navegador entre uma visita e outra.
  const [analiseAtiva, setAnaliseAtivaState] = useState(() => {
    try { return localStorage.getItem("egi-analise-ativa") || "inativos"; } catch { return "inativos"; }
  });
  function setAnaliseAtiva(v) {
    setAnaliseAtivaState(v);
    try { localStorage.setItem("egi-analise-ativa", v); } catch { /* sem storage, só não lembra */ }
  }
  const [expandidosInativos, setExpandidosInativos] = useState(new Set());

  function toggleExpandidoInativo(chave) {
    setExpandidosInativos((atual) => {
      const novo = new Set(atual);
      if (novo.has(chave)) novo.delete(chave); else novo.add(chave);
      return novo;
    });
  }
  const [toast, setToast] = useState("");

  const [previewHist, setPreviewHist] = useState(null); // { pedidos, ignoradas, abasEncontradas }
  const [importandoHist, setImportandoHist] = useState(false);
  const [progressoHist, setProgressoHist] = useState(null);
  const [resultadoHist, setResultadoHist] = useState(null);
  const [mostrarIgnoradas, setMostrarIgnoradas] = useState(false);
  const [mostrarImportarHist, setMostrarImportarHist] = useState(false);

  async function carregarTudo({ silencioso = false } = {}) {
    if (!silencioso) setCarregando(true);
    const [p, c, ch] = await Promise.all([listarPedidos(), listarClientes(), listarChequesDevolvidos()]);
    setPedidos(p);
    setClientes(c);
    setChequesDevolvidosRanking(ch);
    setCarregando(false);
  }

  useEffect(() => { carregarTudo(); }, []);

  if (carregando) return <div className="empty-state">Carregando análises...</div>;

  async function handleConferido(pedidoId) {
    await marcarConferido([pedidoId]);
    // Atualiza localmente pra sumir da lista na hora, sem recarregar tudo.
    const ate = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    setPedidos((atual) => atual.map((p) => (p.id === pedidoId ? { ...p, conferidoAte: ate } : p)));
    mostrarToastGenerico("Marcado como conferido — volta a aparecer em 24h.");
  }

  async function handleContatoRealizado(clienteId) {
    await registrarContatoInativo(clienteId);
    setClientes((atual) => atual.map((c) => (c.id === clienteId ? { ...c, ultimoContatoInativo: new Date().toISOString().slice(0, 10) } : c)));
  }

  // Telefone indisponível: grava em todos os cadastros do grupo que têm esse
  // número e atualiza a tela na hora (sem recarregar tudo).
  function digitosDe(numero) {
    return String(numero || "").replace(/\D/g, "");
  }
  async function handleTelefoneIndisponivel(g, numero) {
    if (!window.confirm(`Marcar ${numero} como indisponível? Ele deixa de aparecer nas listas de contato.`)) return;
    const digitos = digitosDe(numero);
    const ids = g.clientes.filter((c) => telefonesDoCliente(c).some((t) => digitosDe(t.numero) === digitos)).map((c) => c.id);
    const alvo = ids.length ? ids : g.clientes.map((c) => c.id);
    await marcarTelefoneIndisponivel(alvo, digitos);
    setClientes((atual) => atual.map((c) => (alvo.includes(c.id)
      ? { ...c, telefonesIndisponiveis: [...new Set([...(c.telefonesIndisponiveis || []), digitos])] }
      : c)));
    mostrarToastGenerico("Telefone marcado como indisponível.");
  }
  async function handleReativarTelefone(g, digitos) {
    const ids = g.clientes.filter((c) => (c.telefonesIndisponiveis || []).includes(digitos)).map((c) => c.id);
    await reativarTelefone(ids, digitos);
    setClientes((atual) => atual.map((c) => (ids.includes(c.id)
      ? { ...c, telefonesIndisponiveis: (c.telefonesIndisponiveis || []).filter((d) => d !== digitos) }
      : c)));
    mostrarToastGenerico("Telefone reativado.");
  }

  async function handleTelefoneVerificado(g, numero) {
    const digitos = digitosDe(numero);
    const ids = g.clientes.filter((c) => telefonesDoCliente(c).some((t) => digitosDe(t.numero) === digitos)).map((c) => c.id);
    const alvo = ids.length ? ids : g.clientes.map((c) => c.id);
    await marcarTelefoneVerificado(alvo, digitos);
    setClientes((atual) => atual.map((c) => (alvo.includes(c.id)
      ? { ...c, telefonesVerificados: [...new Set([...(c.telefonesVerificados || []), digitos])] }
      : c)));
  }
  async function handleDesfazerVerificado(g, numero) {
    const digitos = digitosDe(numero);
    const ids = g.clientes.filter((c) => (c.telefonesVerificados || []).includes(digitos)).map((c) => c.id);
    await desmarcarTelefoneVerificado(ids, digitos);
    setClientes((atual) => atual.map((c) => (ids.includes(c.id)
      ? { ...c, telefonesVerificados: (c.telefonesVerificados || []).filter((d) => d !== digitos) }
      : c)));
  }

  // Status no grupo de WhatsApp: grava em todos os cadastros do grupo de
  // clientes e atualiza a tela na hora.
  async function handleStatusGrupoWhatsapp(g, status) {
    const ids = g.clientes.map((c) => c.id);
    await definirStatusGrupoWhatsapp(ids, status);
    setClientes((atual) => atual.map((c) => (ids.includes(c.id) ? { ...c, grupoWhatsapp: status } : c)));
  }

  async function handleArquivoHistorico(e) {
    const file = e.target.files[0];
    e.target.value = "";
    if (!file) return;
    setResultadoHist(null);
    try {
      const resultado = await lerHistoricoPedidos(file);
      if (resultado.pedidos.length === 0) {
        setResultadoHist({ erro: "Não encontrei as abas Pranchteta/PAGOS, ou nenhuma linha válida nelas." });
        return;
      }
      setPreviewHist(resultado);
    } catch (err) {
      setResultadoHist({ erro: err.message });
    }
  }

  async function confirmarImportacaoHistorico() {
    if (!previewHist) return;
    setImportandoHist(true);
    setProgressoHist({ feitos: 0, total: previewHist.pedidos.length });
    try {
      const resultado = await importarHistoricoPedidos(
        previewHist.pedidos,
        clientes,
        (feitos, total, clientesCriados) => setProgressoHist({ feitos, total, clientesCriados })
      );
      setResultadoHist({ sucesso: true, ...resultado, ignoradas: previewHist.ignoradas.length });
      setPreviewHist(null);
      // recarrega pedidos/clientes pra refletir na tela
      await carregarTudo({ silencioso: true });
    } catch (err) {
      setResultadoHist({ erro: err.message });
    } finally {
      setImportandoHist(false);
      setProgressoHist(null);
    }
  }

  const hoje = new Date();

  // Clientes com pagamento atrasado (parcela de cheque com data já vencida)
  // Mapa do cadastro atual por id — usado tanto pra exibir nome/cidade corretos
  // quanto pra saber o prazo de pagamento vigente de cada cliente.
  const clientesPorId = {};
  clientes.forEach((c) => { clientesPorId[c.id] = c; });
  // Pra calcular atraso, quem está sem prazo assume o prazo do grupo.
  const clientesEfetivosPorId = {};
  herdarCondicoesDoGrupo(clientes).forEach((c) => { clientesEfetivosPorId[c.id] = c; });

  const atrasados = pedidos.filter((p) => pedidoEstaAtrasado(p, clientesEfetivosPorId[p.clienteId]));

  // Clientes inativos: última compra há mais de 60 dias, sem vale em aberto
  const ultimaCompraPorCliente = {};
  pedidos.forEach((p) => {
    const atual = ultimaCompraPorCliente[p.clienteId];
    if (!atual || new Date(p.data) > new Date(atual)) {
      ultimaCompraPorCliente[p.clienteId] = p.data;
    }
  });
  const temValeAberto = new Set(pedidos.filter((p) => p.status === "aberto").map((p) => p.clienteId));

  // Cheque conta como "recebido" na hora da venda (mesmo com a compensação só
  // acontecendo depois) — então um pedido pago só em cheque já nasce com
  // status "pago", mesmo que a folha ainda não tenha vencido. Sem esse
  // segundo check, um cliente com cheque de 90 dias pendente podia aparecer
  // como "inativo" antes mesmo do cheque compensar.
  const temChequeFuturo = new Set();
  pedidos.forEach((p) => {
    const parcelas = [
      ...(p.formasPagamento || []).filter((f) => f.tipo === "cheque").flatMap((f) => f.parcelas || []),
      ...(p.pagamentos || []).filter((pg) => pg.formaPagamento === "cheque" && pg.parcelas).flatMap((pg) => pg.parcelas || []),
    ];
    if (parcelas.some((parc) => parc.data && new Date(parc.data + "T00:00:00") > hoje)) {
      temChequeFuturo.add(p.clienteId);
    }
  });

  const [campoOrdInativos, dirOrdInativos] = ordenacaoInativos.split("_");
  const multOrdInativos = dirOrdInativos === "asc" ? 1 : -1;

  function chaveGrupoCliente(c) {
    return (c.grupo || "").trim().toLowerCase() || `cli_${c.id}`;
  }
  function nomeGrupoOuCliente(g) {
    return g.nomeGrupo || g.clientes[0]?.nome || "";
  }
  function ultimaCompraDoCliente(c) {
    return ultimaCompraPorCliente[c.id] || c.ultimaCompraPlanilha || "";
  }

  // IMPORTANTE: agrupamos TODOS os clientes primeiro (não só os que parecem
  // inativos individualmente) — a decisão de "parou de comprar" tem que olhar
  // o grupo inteiro. Se um cliente tem 5 CNPJs e só 1 deles comprou semana
  // passada, o grupo inteiro ainda está ativo, mesmo que os outros 4 estejam
  // parados há meses. Filtrar CNPJ por CNPJ antes de agrupar (como era antes)
  // fazia grupos com relação ativa aparecerem como inativos.
  const gruposTodos = new Map();
  clientes.forEach((c) => {
    const chave = chaveGrupoCliente(c);
    if (!gruposTodos.has(chave)) {
      gruposTodos.set(chave, { chave, nomeGrupo: (c.grupo || "").trim(), clientes: [], representante: "" });
    }
    const g = gruposTodos.get(chave);
    g.clientes.push(c);
    if (!g.representante && c.representante) g.representante = c.representante;
  });

  // --- Ranking de Clientes/Grupo ------------------------------------------
  // Percentil (0-100) da posição de "valor" dentro de "valores" — empate usa
  // a média das posições empatadas. Base padrão de comparação de indicador
  // de escalas bem diferentes entre si (capital social em milhões, ticket
  // médio em centenas, frequência em unidades).
  function percentilDe(valor, valoresOrdenados) {
    const n = valoresOrdenados.length;
    if (n <= 1) return 100;
    let menores = 0;
    let iguais = 0;
    valoresOrdenados.forEach((v) => { if (v < valor) menores++; else if (v === valor) iguais++; });
    return ((menores + (iguais - 1) / 2) / (n - 1)) * 100;
  }

  const PENALIDADE_POR_CHEQUE_DEVOLVIDO = 25; // cada cheque devolvido tira 25 pontos (0 a 100)

  const chequesDevPorCliente = new Map();
  chequesDevolvidosRanking.forEach((ch) => {
    if (!ch.clienteId) return;
    chequesDevPorCliente.set(ch.clienteId, (chequesDevPorCliente.get(ch.clienteId) || 0) + 1);
  });

  // Só entra no ranking quem já comprou alguma vez — ticket médio e
  // frequência não fazem sentido pra quem nunca teve pedido.
  const baseRanking = Array.from(gruposTodos.values())
    .map((g) => {
      const idsDoGrupo = new Set(g.clientes.map((c) => c.id));
      const pedidosDoGrupo = pedidos.filter((p) => idsDoGrupo.has(p.clienteId));
      const qtdPedidos = pedidosDoGrupo.length;
      const faturamentoTotal = pedidosDoGrupo.reduce((s, p) => s + valorDevidoDoPedido(p), 0);
      const capitaisSociais = g.clientes.map((c) => c.infoExtra?.capitalSocial).filter((v) => v != null);
      const qtdChequesDevolvidos = g.clientes.reduce((s, c) => s + (chequesDevPorCliente.get(c.id) || 0), 0);
      return {
        ...g,
        qtdPedidos,
        ticketMedio: qtdPedidos ? faturamentoTotal / qtdPedidos : 0,
        capitalSocial: capitaisSociais.length ? capitaisSociais.reduce((s, v) => s + v, 0) : null,
        qtdChequesDevolvidos,
      };
    })
    .filter((g) => g.qtdPedidos > 0);

  const valoresCapitalSocial = baseRanking.map((g) => g.capitalSocial).filter((v) => v != null).sort((a, b) => a - b);
  const valoresTicketMedio = baseRanking.map((g) => g.ticketMedio).sort((a, b) => a - b);
  const valoresFrequencia = baseRanking.map((g) => g.qtdPedidos).sort((a, b) => a - b);

  const rankingClientes = baseRanking
    .map((g) => {
      // Sem capital social cadastrado: nota neutra (50), pra não punir quem
      // simplesmente ainda não teve o CNPJ consultado.
      const notaCapitalSocial = g.capitalSocial != null ? percentilDe(g.capitalSocial, valoresCapitalSocial) : 50;
      const notaTicketMedio = percentilDe(g.ticketMedio, valoresTicketMedio);
      const notaFrequencia = percentilDe(g.qtdPedidos, valoresFrequencia);
      const notaChequesDevolvidos = Math.max(0, 100 - g.qtdChequesDevolvidos * PENALIDADE_POR_CHEQUE_DEVOLVIDO);
      const pesos = pesosRanking;
      const somaPesos = pesos.capitalSocial + pesos.ticketMedio + pesos.frequencia + pesos.chequesDevolvidos;
      const score = somaPesos > 0
        ? (notaCapitalSocial * pesos.capitalSocial + notaTicketMedio * pesos.ticketMedio
          + notaFrequencia * pesos.frequencia + notaChequesDevolvidos * pesos.chequesDevolvidos) / somaPesos
        : 0;
      return { ...g, notaCapitalSocial, notaTicketMedio, notaFrequencia, notaChequesDevolvidos, score };
    })
    .sort((a, b) => b.score - a.score);

  // Busca rápida da nota por grupo, pra mostrar ao lado do nome em qualquer
  // lista desta tela (mesma chave usada em gruposTodos em toda a página).
  const notaPorChave = new Map(rankingClientes.map((g) => [g.chave, g.score]));
  function BadgeNota({ chave }) {
    const nota = notaPorChave.get(chave);
    if (nota == null) return null;
    const cor = nota >= 70 ? "badge-pago" : nota >= 40 ? "badge-aberto" : "badge-atraso";
    return <span className={"badge " + cor} title="Nota no Ranking de Clientes/Grupo">⭐ {nota.toFixed(0)}</span>;
  }

  const gruposInativos = Array.from(gruposTodos.values())
    .map((g) => {
      const ultimaCompra = g.clientes.reduce((max, c) => {
        const u = ultimaCompraDoCliente(c);
        return u && (!max || u > max) ? u : max;
      }, "");
      const mediaCompra = g.clientes.reduce((s, c) => s + (Number(c.mediaCompra) || 0), 0);
      const temValeAbertoGrupo = g.clientes.some((c) => temValeAberto.has(c.id) || temChequeFuturo.has(c.id));
      const ultimoContatoGrupo = g.clientes.reduce((max, c) => {
        return c.ultimoContatoInativo && (!max || c.ultimoContatoInativo > max) ? c.ultimoContatoInativo : max;
      }, "");
      return { ...g, ultimaCompra, mediaCompra, temValeAbertoGrupo, ultimoContatoGrupo };
    })
    .filter((g) => {
      // qualquer CNPJ do grupo com vale em aberto já mantém a relação viva
      if (g.temValeAbertoGrupo) return false;
      // só ignora o grupo inteiro se TODOS os CNPJs estiverem baixados/suspensos
      // na Receita — aí sim a(s) empresa(s) não existe(m) mais oficialmente
      const todosBaixados = g.clientes.every((c) => {
        const situacao = (c.infoExtra?.situacaoCadastral || "").toUpperCase();
        return situacao && !situacao.includes("ATIVA");
      });
      if (todosBaixados) return false;
      if (!g.ultimaCompra) return false; // nunca comprou - não é "parou de comprar"
      // sem nenhum número ativo não tem como abordar — vai pra lista
      // "Clientes sem contato ativo" em vez de ficar aqui
      if (telefonesAtivosDoGrupo(g).length === 0) return false;
      const dias = (hoje - new Date(g.ultimaCompra)) / 86400000;
      if (dias < DIAS_INATIVO) return false;
      // se já entramos em contato recentemente (e ninguém do grupo comprou depois
      // disso), não repete na lista até passar o prazo de reabordagem
      if (g.ultimoContatoGrupo) {
        const diasContato = (hoje - new Date(g.ultimoContatoGrupo)) / 86400000;
        const contatoDepoisDaCompra = new Date(g.ultimoContatoGrupo) > new Date(g.ultimaCompra);
        if (contatoDepoisDaCompra && diasContato < DIAS_COOLDOWN_CONTATO) return false;
      }
      return true;
    });

  const gruposInativosOrdenados = [...gruposInativos].sort((a, b) => {
    if (campoOrdInativos === "ultimaCompra") {
      return multOrdInativos * (new Date(a.ultimaCompra || 0) - new Date(b.ultimaCompra || 0));
    }
    if (campoOrdInativos === "mediaCompra") {
      return multOrdInativos * (a.mediaCompra - b.mediaCompra);
    }
    return multOrdInativos * nomeGrupoOuCliente(a).localeCompare(nomeGrupoOuCliente(b), "pt-BR");
  });

  // Junta os telefones de todos os CNPJs do grupo num só lugar, sem duplicar
  // o mesmo número que apareça em mais de um cadastro do grupo.
  function telefonesDoGrupo(g) {
    const vistos = new Set();
    const todos = [];
    g.clientes.forEach((c) => {
      telefonesDoCliente(c).forEach((t) => {
        const digitos = String(t.numero || "").replace(/\D/g, "");
        if (!vistos.has(digitos)) { vistos.add(digitos); todos.push(t); }
      });
    });
    return todos;
  }

  function indisponiveisDoGrupo(g) {
    return new Set(g.clientes.flatMap((c) => c.telefonesIndisponiveis || []));
  }
  function telefonesAtivosDoGrupo(g) {
    const bloqueados = indisponiveisDoGrupo(g);
    return telefonesDoGrupo(g).filter((t) => !bloqueados.has(String(t.numero || "").replace(/\D/g, "")));
  }

  // Clientes sem contato ativo: grupo (ou cliente sem grupo) sem nenhum
  // número cadastrado, ou com todos os números marcados como indisponíveis.
  const gruposSemContato = Array.from(gruposTodos.values())
    .filter((g) => telefonesAtivosDoGrupo(g).length === 0)
    .map((g) => {
      const ultimaCompra = g.clientes.reduce((max, c) => {
        const u = ultimaCompraDoCliente(c);
        return u && (!max || u > max) ? u : max;
      }, "");
      const indisponiveis = telefonesDoGrupo(g).filter((t) => indisponiveisDoGrupo(g).has(String(t.numero || "").replace(/\D/g, "")));
      return { ...g, ultimaCompra, indisponiveis };
    })
    .sort((a, b) => {
      const [campo, dir] = ordenacaoSemContato.split("_");
      const mult = dir === "asc" ? 1 : -1;
      if (campo === "nome") return mult * nomeGrupoOuCliente(a).localeCompare(nomeGrupoOuCliente(b), "pt-BR");
      // quem nunca comprou fica sempre no fim, nas duas direções
      if (!a.ultimaCompra || !b.ultimaCompra) return (a.ultimaCompra ? -1 : 1) - (b.ultimaCompra ? -1 : 1);
      return mult * a.ultimaCompra.localeCompare(b.ultimaCompra);
    });

  async function handleContatoRealizadoGrupo(g) {
    await Promise.all(g.clientes.map((c) => handleContatoRealizado(c.id)));
  }

  // Mapa pra resolver o cadastro completo do cliente a partir de um pedido
  // (o pedido só guarda uma cópia do nome/id no momento da venda).

  function mostrarToastGenerico(msg) {
    setToast(msg);
    setTimeout(() => setToast(""), 3000);
  }

  function abrirClientePorId(clienteId, clienteNome) {
    const c = clientesPorId[clienteId];
    if (!c) {
      mostrarToastGenerico(`Cadastro de "${clienteNome}" não encontrado na Base de Dados.`);
      return;
    }
    setModalAberto({ clientes: [c] });
  }

  function abrirCliente(c) {
    setModalAberto({ clientes: [c] });
  }

  // Junta todos os telefones do cadastro (principal, alternativo, WhatsApp e
  // os que vieram da consulta pública de CNPJ), sem duplicar o mesmo número
  // vindo de fontes diferentes.
  function telefonesDoCliente(c) {
    const candidatos = [
      { numero: c.whatsapp, rotulo: "WhatsApp" },
      { numero: c.telefones?.[0], rotulo: "Telefone" },
      { numero: c.telefones?.[1], rotulo: "Telefone alternativo" },
      ...(c.infoExtra?.telefones || []).map((t) => ({ numero: t, rotulo: "Receita Federal" })),
    ];
    const vistos = new Set();
    return candidatos
      .map(({ numero, rotulo }) => {
        const { numero: ajustado, ajustado: foiAjustado } = normalizarTelefone(numero);
        return { numero: ajustado || numero, rotulo, foiAjustado };
      })
      .filter(({ numero }) => {
        const digitos = String(numero || "").replace(/\D/g, "");
        if (digitos.length < 8 || vistos.has(digitos)) return false;
        vistos.add(digitos);
        return true;
      });
  }

  // Heatmap por cidade/estado — usa o cadastro ATUAL do cliente (não a cópia
  // gravada no pedido), pra não ficar preso em cidades desatualizadas se o
  // cadastro for corrigido depois. Mostra até 20 cidades (não só as 10 mais
  // vendidas), pra dar uma visão mais completa da distribuição real.
  const porCidade = {};
  pedidos.forEach((p) => {
    const cliente = clientesPorId[p.clienteId];
    const cidade = cliente?.cidade || p.clienteCidade || "?";
    const estado = cliente?.estado || p.clienteEstado || "?";
    const chave = `${cidade}/${estado}`;
    porCidade[chave] = (porCidade[chave] || 0) + Number(p.valor || 0);
  });
  const cidadesOrdenadas = Object.entries(porCidade).sort((a, b) => b[1] - a[1]).slice(0, 20);
  const maxValor = cidadesOrdenadas[0]?.[1] || 1;

  return (
    <div>
      {toast && <div className="toast">{toast}</div>}

      {!previewHist && !importandoHist && !resultadoHist && !mostrarImportarHist ? (
        <button type="button" className="card" style={{ border: "2px solid var(--pink)", width: "100%", textAlign: "left", cursor: "pointer", background: "none" }}
          onClick={() => setMostrarImportarHist(true)}>
          <strong>📤 Importar vales e compras pagas (planilha antiga)</strong>
        </button>
      ) : (
      <div className="card" style={{ border: "2px solid var(--pink)" }}>
        <h2 className="card-title">📤 Importar vales e compras pagas (planilha antiga)</h2>

        {!previewHist && !importandoHist && (
          <>
            <p style={{ fontSize: 13, color: "var(--ink-soft)", marginBottom: 12 }}>
              Envie o arquivo com as abas "Pranchteta" (contas em aberto) e "PAGOS" (histórico
              de pedidos já quitados). Vincula automaticamente pelo código do cliente já cadastrado.
            </p>
            <label className="btn btn-secondary btn-block" style={{ cursor: "pointer" }}>
              Escolher arquivo .xlsx
              <input type="file" accept=".xlsx,.xls" style={{ display: "none" }} onChange={handleArquivoHistorico} />
            </label>
          </>
        )}

        {importandoHist && (
          <div className="empty-state">
            Importando... {progressoHist ? `${progressoHist.feitos}/${progressoHist.total}` : ""}
            {progressoHist?.clientesCriados > 0 && ` · ${progressoHist.clientesCriados} clientes novos criados`}
          </div>
        )}

        {previewHist && !importandoHist && (
          <>
            <div style={{ background: "var(--bg)", borderRadius: 12, padding: 12, marginBottom: 12, fontSize: 13, color: "var(--ink-soft)", lineHeight: 1.8 }}>
              <div>Abas encontradas: <strong style={{ color: "var(--ink)" }}>{previewHist.abasEncontradas.join(", ")}</strong></div>
              <div>Pedidos a importar: <strong style={{ color: "var(--ink)" }}>{previewHist.pedidos.length}</strong></div>
              <div>Linhas ignoradas (quebradas): <strong style={{ color: "var(--red)" }}>{previewHist.ignoradas.length}</strong></div>
              {previewHist.itensComDataImplausivel > 0 && (
                <div>
                  Células com data inválida (ex: anos 1900-1902) ignoradas: <strong style={{ color: "var(--yellow)" }}>{previewHist.itensComDataImplausivel}</strong>
                  <div style={{ fontSize: 12 }}>
                    Provavelmente erro de formatação na planilha antiga. O valor total do cliente
                    (coluna "Total Pedidos") não é afetado — só essas linhas específicas do
                    detalhamento de compras não entram no histórico.
                  </div>
                </div>
              )}
            </div>

            {previewHist.ignoradas.length > 0 && (
              <>
                <button type="button" className="btn btn-ghost" style={{ marginBottom: 10, fontSize: 13 }}
                  onClick={() => setMostrarIgnoradas((v) => !v)}>
                  {mostrarIgnoradas ? "Esconder" : "Ver"} linhas ignoradas
                </button>
                {mostrarIgnoradas && (
                  <div style={{ maxHeight: 200, overflowY: "auto", marginBottom: 12 }}>
                    {previewHist.ignoradas.map((ig, i) => (
                      <div key={i} style={{ fontSize: 12, color: "var(--ink-soft)", padding: "3px 0", borderBottom: "1px solid var(--border)" }}>
                        {ig.aba} linha {ig.linha} · {ig.cliente} · {ig.motivo}
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}

            <div style={{ fontSize: 13, fontWeight: 700, color: "var(--ink-soft)", marginBottom: 4 }}>Prévia:</div>
            {previewHist.pedidos.slice(0, 5).map((p, i) => (
              <div key={i} style={{ fontSize: 13, color: "var(--ink-soft)", padding: "4px 0", borderBottom: "1px solid var(--border)" }}>
                {p.codigo || "(sem cód)"} · {p.nome} · {p.situacao} · {formatCurrency(p.totalPedidos)}
              </div>
            ))}

            <div className="row" style={{ marginTop: 14 }}>
              <button className="btn btn-ghost btn-block" onClick={() => setPreviewHist(null)}>Cancelar</button>
              <button className="btn btn-primary btn-block" onClick={confirmarImportacaoHistorico}>
                Importar {previewHist.pedidos.length} pedidos
              </button>
            </div>
          </>
        )}

        {resultadoHist && (
          <div className="card" style={{
            marginTop: 12, background: resultadoHist.erro ? "var(--red-light)" : "var(--green-light)",
            color: resultadoHist.erro ? "var(--red)" : "#158a45", fontSize: 13,
          }}>
            {resultadoHist.erro
              ? resultadoHist.erro
              : `${resultadoHist.processados} pedidos importados! ${resultadoHist.clientesCriados} clientes novos criados. ${resultadoHist.ignoradas} linhas ignoradas.`}
          </div>
        )}

        {!previewHist && !importandoHist && (
          <button type="button" className="btn btn-ghost" style={{ marginTop: 10, fontSize: 13 }}
            onClick={() => { setMostrarImportarHist(false); setResultadoHist(null); }}>
            Recolher
          </button>
        )}
      </div>
      )}

      <div className="card" style={{ padding: 12, display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <label style={{ fontSize: 13, color: "var(--ink-soft)" }}>Análise</label>
        <select className="input" style={{ width: "auto", minWidth: 260 }} value={analiseAtiva} onChange={(e) => setAnaliseAtiva(e.target.value)}>
          <option value="atrasados">🔴 Pagamentos atrasados ({atrasados.length})</option>
          <option value="inativos">😴 Clientes inativos ({gruposInativosOrdenados.length})</option>
          <option value="semContato">📵 Clientes sem contato ativo ({gruposSemContato.length})</option>
          <option value="mapaCalor">🗺️ Mapa de calor — cidade/estado</option>
          <option value="ranking">🏆 Ranking de Clientes/Grupo ({rankingClientes.length})</option>
        </select>
      </div>

      <div>
        {analiseAtiva === "atrasados" && (
        <div className="card" id="secao-atrasados">
          <h2 className="card-title">Pagamentos atrasados ({atrasados.length})</h2>
          <div className="analises-lista">
            {atrasados.length === 0 ? (
              <div className="empty-state" style={{ padding: 12 }}>Nenhum pagamento atrasado.</div>
            ) : (
              atrasados.map((p) => {
                const situacao = situacaoEmAbertoDoPedido(p);
                return (
                  <div key={p.id} className="list-item"
                    onDoubleClick={() => abrirClientePorId(p.clienteId, p.clienteNome)}
                    style={{ flexDirection: "column", alignItems: "stretch", gap: 6, cursor: "default" }}
                    title="Duplo clique para abrir o cadastro do cliente">
                    <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                      <strong>{clientesPorId[p.clienteId]?.nome || p.clienteNome}</strong>
                      <span className="badge badge-atraso" style={{ flexShrink: 0 }}>Atrasado</span>
                    </div>
                    <div style={{ fontSize: 13, color: "var(--ink-soft)" }}>
                      Em aberto desde {formatDate(situacao?.dataRef || p.data)} · {formatCurrency(saldoDoPedido(p))}
                    </div>
                    <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                      <button className="btn btn-secondary" style={{ fontSize: 12, padding: "6px 10px" }}
                        onClick={() => handleConferido(p.id)}>
                        Conferido (24h)
                      </button>
                      <button className="btn btn-ghost" style={{ fontSize: 12, padding: "6px 10px" }}
                        onClick={() => onAbrirNoVales?.(p)}>
                        Ver no Vales →
                      </button>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
        )}

        {analiseAtiva === "inativos" && (
        <div className="card" id="secao-inativos">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, marginBottom: 14 }}>
            <h2 className="card-title" style={{ marginBottom: 0 }}>Clientes inativos (+{DIAS_INATIVO} dias, sem pendências)</h2>
            <select className="input" style={{ width: "auto", padding: "6px 10px", fontSize: 12 }}
              value={ordenacaoInativos} onChange={(e) => setOrdenacaoInativos(e.target.value)}>
              <option value="nome_asc">Nome (A-Z)</option>
              <option value="nome_desc">Nome (Z-A)</option>
              <option value="ultimaCompra_desc">Última compra (recente)</option>
              <option value="ultimaCompra_asc">Última compra (antiga)</option>
              <option value="mediaCompra_desc">Valor médio (maior)</option>
              <option value="mediaCompra_asc">Valor médio (menor)</option>
            </select>
          </div>
          <div className="analises-lista">
            {gruposInativosOrdenados.length === 0 ? (
              <div className="empty-state" style={{ padding: 12 }}>Nenhum cliente inativo no momento.</div>
            ) : (
              gruposInativosOrdenados.map((g) => {
                const telefones = telefonesAtivosDoGrupo(g);
                const qtdIndisponiveis = telefonesDoGrupo(g).length - telefones.length;
                const expandido = expandidosInativos.has(g.chave);
                const multiplos = g.clientes.length > 1;
                return (
                  <div key={g.chave} className="list-item"
                    onDoubleClick={() => (multiplos ? toggleExpandidoInativo(g.chave) : abrirCliente(g.clientes[0]))}
                    style={{ flexDirection: "column", alignItems: "stretch", gap: 6, cursor: "default" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
                      <strong>{nomeGrupoOuCliente(g)}</strong>
                      <span style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0 }}>
                        {multiplos && (
                          <span style={{ fontSize: 12, color: "var(--ink-soft)" }}>{g.clientes.length} CNPJs</span>
                        )}
                        <BadgeNota chave={g.chave} />
                      </span>
                    </div>
                    {g.representante && (
                      <div style={{ fontSize: 13, color: "var(--ink-soft)" }}>Rep: {g.representante}</div>
                    )}
                    <div style={{ fontSize: 13, color: "var(--ink-soft)" }}>
                      Última compra: {formatDate(g.ultimaCompra)}
                      {g.mediaCompra > 0 && ` · Ticket médio ${formatCurrency(g.mediaCompra)}`}
                    </div>
                    <label style={{ fontSize: 12, color: "var(--ink-soft)", display: "flex", alignItems: "center", gap: 6 }}
                      onClick={(e) => e.stopPropagation()}>
                      Grupo do WhatsApp:
                      <select className="input" style={{ width: "auto", padding: "2px 6px", fontSize: 12 }}
                        value={statusGrupoWhatsappDe(g.clientes)}
                        onChange={(e) => handleStatusGrupoWhatsapp(g, e.target.value)}>
                        {STATUS_GRUPO_WHATSAPP.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                      </select>
                    </label>
                    {telefones.length > 0 && (
                      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                        {telefones.map(({ numero, rotulo, foiAjustado }) => {
                          const fixo = ehTelefoneFixo(numero);
                          const verificado = g.clientes.some((c) => (c.telefonesVerificados || []).includes(digitosDe(numero)));
                          return (
                            <div key={numero} style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                              <span style={{ fontSize: 13, color: "var(--ink-soft)" }}>
                                📞 {numero} <span style={{ fontSize: 11 }}>({rotulo}{fixo ? " · fixo" : ""}{foiAjustado ? " · 9 adicionado" : ""})</span>
                              </span>
                              {fixo ? (
                                <a href={linkLigar(numero)} className="btn btn-secondary" style={{ fontSize: 12, padding: "4px 10px" }}
                                  onClick={(e) => e.stopPropagation()}>
                                  Ligar
                                </a>
                              ) : (
                                <a href={linkWhatsAppInativo(numero, nomeGrupoOuCliente(g), statusGrupoWhatsappDe(g.clientes) === "nao")} target="_blank" rel="noopener noreferrer"
                                  className="btn btn-secondary" style={{ fontSize: 12, padding: "4px 10px" }}
                                  onClick={(e) => e.stopPropagation()}>
                                  Mandar mensagem
                                </a>
                              )}
                              {verificado ? (
                                <span className="badge badge-pago" style={{ cursor: "pointer" }} title="Clique para desfazer a verificação"
                                  onClick={(e) => { e.stopPropagation(); handleDesfazerVerificado(g, numero); }}>
                                  ✓ Verificado
                                </span>
                              ) : (
                                <>
                                  <button type="button" className="btn btn-success" style={{ fontSize: 12, padding: "4px 10px" }}
                                    onClick={(e) => { e.stopPropagation(); handleTelefoneVerificado(g, numero); }}>
                                    Telefone verificado
                                  </button>
                                  <button type="button" className="btn btn-danger" style={{ fontSize: 12, padding: "4px 10px" }}
                                    onClick={(e) => { e.stopPropagation(); handleTelefoneIndisponivel(g, numero); }}>
                                    Telefone indisponível
                                  </button>
                                </>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    )}
                    {qtdIndisponiveis > 0 && (
                      <div style={{ fontSize: 11, color: "var(--ink-soft)" }}>
                        Indisponível:{" "}
                        {telefonesDoGrupo(g).filter((t) => indisponiveisDoGrupo(g).has(String(t.numero).replace(/\D/g, ""))).map((t) => (
                          <button key={t.numero} type="button" className="btn btn-ghost" style={{ fontSize: 11, padding: "1px 6px" }}
                            onClick={() => handleReativarTelefone(g, String(t.numero).replace(/\D/g, ""))}>
                            ↺ {t.numero}
                          </button>
                        ))}
                      </div>
                    )}
                    {multiplos && expandido && (
                      <div style={{ borderTop: "1px solid var(--border)", marginTop: 4, paddingTop: 6, display: "flex", flexDirection: "column", gap: 4 }}>
                        {g.clientes.map((c) => (
                          <div key={c.id} onClick={() => abrirCliente(c)} style={{ fontSize: 13, cursor: "pointer" }}>
                            {c.nome} — Cód {c.codigo} · última compra {formatDate(ultimaCompraDoCliente(c))}
                          </div>
                        ))}
                      </div>
                    )}
                    <button className="btn btn-secondary" style={{ fontSize: 12, padding: "6px 10px", alignSelf: "flex-start" }}
                      onClick={() => handleContatoRealizadoGrupo(g)}>
                      Contato realizado
                    </button>
                  </div>
                );
              })
            )}
          </div>
        </div>
        )}

        {analiseAtiva === "mapaCalor" && (
        <div className="card" id="secao-mapa-calor">
          <h2 className="card-title">Mapa de calor — por cidade/estado</h2>
          <div className="analises-lista">
            {cidadesOrdenadas.length === 0 ? (
              <div className="empty-state" style={{ padding: 12 }}>Sem dados de pedidos ainda.</div>
            ) : (
              cidadesOrdenadas.map(([cidade, valor]) => (
                <div key={cidade} style={{ marginBottom: 10 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, marginBottom: 4 }}>
                    <span>{cidade}</span>
                    <strong>{formatCurrency(valor)}</strong>
                  </div>
                  <div style={{ background: "var(--pink-light)", borderRadius: 8, height: 10 }}>
                    <div style={{
                      width: `${(valor / maxValor) * 100}%`,
                      background: "linear-gradient(90deg, var(--pink), var(--grape))",
                      height: "100%",
                      borderRadius: 8,
                    }} />
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
        )}

        {analiseAtiva === "semContato" && (
        <div className="card" id="secao-sem-contato">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, marginBottom: 14 }}>
            <h2 className="card-title" style={{ marginBottom: 0 }}>Clientes sem contato ativo ({gruposSemContato.length})</h2>
            <select className="input" style={{ width: "auto", padding: "6px 10px", fontSize: 12 }}
              value={ordenacaoSemContato} onChange={(e) => setOrdenacaoSemContato(e.target.value)}>
              <option value="ultimaCompra_desc">Última compra (recente)</option>
              <option value="ultimaCompra_asc">Última compra (antiga)</option>
              <option value="nome_asc">Nome (A-Z)</option>
              <option value="nome_desc">Nome (Z-A)</option>
            </select>
          </div>
          <div className="analises-lista">
            {gruposSemContato.length === 0 ? (
              <div className="empty-state" style={{ padding: 12 }}>Todos os clientes têm pelo menos um número ativo.</div>
            ) : (
              gruposSemContato.map((g) => (
                <div key={g.chave} className="list-item" style={{ flexDirection: "column", alignItems: "stretch", gap: 6, cursor: "default" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
                    <strong>{nomeGrupoOuCliente(g)}</strong>
                    <span style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0 }}>
                      {g.clientes.length > 1 && <span style={{ fontSize: 12, color: "var(--ink-soft)" }}>{g.clientes.length} CNPJs</span>}
                      <BadgeNota chave={g.chave} />
                    </span>
                  </div>
                  {g.representante && <div style={{ fontSize: 13, color: "var(--ink-soft)" }}>Rep: {g.representante}</div>}
                  <div style={{ fontSize: 13, color: "var(--ink-soft)" }}>
                    Última compra: <strong style={{ color: "var(--ink)" }}>{g.ultimaCompra ? formatDate(g.ultimaCompra) : "nunca comprou"}</strong>
                  </div>
                  {g.indisponiveis.length === 0 ? (
                    <div style={{ fontSize: 12, color: "var(--red)" }}>Nenhum número cadastrado</div>
                  ) : (
                    g.indisponiveis.map((t) => (
                      <div key={t.numero} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: "var(--ink-soft)" }}>
                        <span style={{ textDecoration: "line-through" }}>📞 {t.numero}</span>
                        <span>({t.rotulo} · indisponível)</span>
                        <button type="button" className="btn btn-ghost" style={{ fontSize: 11, padding: "2px 8px" }}
                          onClick={() => handleReativarTelefone(g, String(t.numero).replace(/\D/g, ""))}>
                          Reativar
                        </button>
                      </div>
                    ))
                  )}
                  <button type="button" className="btn btn-secondary" style={{ fontSize: 12, padding: "6px 10px", alignSelf: "flex-start" }}
                    onClick={() => setModalAberto({ clientes: g.clientes, grupoNome: g.nomeGrupo || undefined })}>
                    Abrir cadastro
                  </button>
                </div>
              ))
            )}
          </div>
        </div>
        )}

        {analiseAtiva === "ranking" && (
        <div className="card" id="secao-ranking">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, marginBottom: 10 }}>
            <h2 className="card-title" style={{ marginBottom: 0 }}>Ranking de Clientes/Grupo ({rankingClientes.length})</h2>
          </div>
          <p style={{ fontSize: 13, color: "var(--ink-soft)", marginBottom: 14 }}>
            Cada indicador vira uma nota de 0 a 100 (posição relativa entre os clientes, exceto cheques
            devolvidos, que começa em 100 e perde {PENALIDADE_POR_CHEQUE_DEVOLVIDO} pontos por cheque). O placar final é a
            média dessas notas, pesada como você ajustar abaixo. Sem capital social cadastrado conta nota
            neutra (50) — não penaliza quem ainda não teve o CNPJ consultado. Só entra quem já comprou
            alguma vez.
          </p>
          <div style={{ display: "flex", gap: 16, flexWrap: "wrap", marginBottom: 16, background: "var(--bg)", borderRadius: 10, padding: 12 }}>
            {[
              { chave: "capitalSocial", label: "Capital social" },
              { chave: "ticketMedio", label: "Ticket médio" },
              { chave: "frequencia", label: "Frequência" },
              { chave: "chequesDevolvidos", label: "Cheques devolvidos" },
            ].map((item) => (
              <label key={item.chave} style={{ fontSize: 12, color: "var(--ink-soft)", display: "flex", flexDirection: "column", gap: 4 }}>
                {item.label} (peso {pesosRanking[item.chave]})
                <input type="range" min={0} max={100} value={pesosRanking[item.chave]}
                  onChange={(e) => setPesosRanking((p) => ({ ...p, [item.chave]: Number(e.target.value) }))}
                  style={{ width: 140 }} />
              </label>
            ))}
          </div>
          <div className="analises-lista">
            {rankingClientes.length === 0 ? (
              <div className="empty-state" style={{ padding: 12 }}>Nenhum cliente com pedido lançado ainda.</div>
            ) : (
              rankingClientes.slice(0, limiteRanking).map((g, i) => (
                <div key={g.chave} className="list-item" style={{ flexDirection: "column", alignItems: "stretch", gap: 6, cursor: "pointer" }}
                  onClick={() => setModalAberto({ clientes: g.clientes, grupoNome: g.nomeGrupo || undefined })}>
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "center" }}>
                    <span><strong>#{i + 1} · {nomeGrupoOuCliente(g)}</strong></span>
                    <span className="badge badge-pago">{g.score.toFixed(0)} pts</span>
                  </div>
                  {g.representante && <div style={{ fontSize: 12, color: "var(--ink-soft)" }}>Rep: {g.representante}</div>}
                  <div style={{ display: "flex", gap: 14, flexWrap: "wrap", fontSize: 12, color: "var(--ink-soft)" }}>
                    <span>💰 {g.capitalSocial != null ? formatCurrency(g.capitalSocial) : "sem dado"} (nota {g.notaCapitalSocial.toFixed(0)})</span>
                    <span>🎯 Ticket médio {formatCurrency(g.ticketMedio)} (nota {g.notaTicketMedio.toFixed(0)})</span>
                    <span>🔁 {g.qtdPedidos} pedido(s) (nota {g.notaFrequencia.toFixed(0)})</span>
                    <span style={g.qtdChequesDevolvidos > 0 ? { color: "var(--red)" } : undefined}>
                      🚫 {g.qtdChequesDevolvidos} cheque(s) devolvido(s) (nota {g.notaChequesDevolvidos.toFixed(0)})
                    </span>
                  </div>
                </div>
              ))
            )}
          </div>
          {rankingClientes.length > limiteRanking && (
            <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", marginTop: 10 }}>
              <span style={{ fontSize: 12, color: "var(--ink-soft)" }}>Mostrando {limiteRanking} de {rankingClientes.length}.</span>
              <button type="button" className="btn btn-secondary" style={{ fontSize: 12, padding: "6px 12px" }}
                onClick={() => setLimiteRanking((l) => l + 100)}>
                Carregar mais 100
              </button>
            </div>
          )}
        </div>
        )}
      </div>

      {modalAberto && (
        <ClienteCadastroModal
          clientes={modalAberto.clientes}
          grupoNome={modalAberto.grupoNome}
          onClose={() => setModalAberto(null)}
          onSaved={() => carregarTudo({ silencioso: true })}
        />
      )}
    </div>
  );
}
