import { useState, useRef, useEffect } from "react";
import "../components/ui.css";
import { buscarCliente, salvarCliente, consultarCnpj, gerarCodigoUnico, listarClientesDoGrupo, listarGruposUnicos } from "../lib/clientes";
import { criarPedido, buscarPendenciasCliente } from "../lib/pedidos";
import { listarChequesDevolvidos } from "../lib/chequesDevolvidos";
import {
  FORMAS_PAGAMENTO,
  FORMAS_RECEBIMENTO_IMEDIATO,
  ESTADOS_BR,
  todayISO,
  formatCurrency,
  formatDate,
  calcularParcelasCheque,
  prazoPadraoUltimoCheque,
  redistribuirDatasCheque,
  calcularValorDevido,
  podeIrDireitoParaRecebidos,
  OPCOES_PRAZO,
  idPrazoAtual,
  parseDescontoCampos,
  condicoesDoGrupo,
  aplicarCondicoesDoGrupo,
  montarDescontoTexto,
  descontoAplicavelAoPedido,
} from "../lib/constants";

const CLIENTE_VAZIO = {
  id: null,
  codigo: "",
  nome: "",
  razaoSocial: "",
  cnpj: "",
  representante: "",
  descontoPadrao: "",
  prazo: "",
  prazoModelo: "",
  cidade: "",
  estado: "",
  grupo: "",
  observacao: "",
};

function novoItem() {
  return { valor: "", data: todayISO() };
}

function novaForma() {
  return { tipo: "pix_ted", valor: "", valorTotal: "", numFolhas: "1", prazoUltimoCheque: "" };
}

export default function Pedidos() {
  const [cliente, setCliente] = useState(CLIENTE_VAZIO);
  // Grupos já cadastrados — sugestões no campo "Grupo de cliente".
  const [gruposExistentes, setGruposExistentes] = useState([]);
  useEffect(() => { listarGruposUnicos().then(setGruposExistentes).catch(() => {}); }, []);
  const [descontoNumero, setDescontoNumero] = useState("");
  const [descontoCondicao, setDescontoCondicao] = useState("avista");
  const [matches, setMatches] = useState([]);
  const [sugestoesNome, setSugestoesNome] = useState([]);
  const [buscandoCampo, setBuscandoCampo] = useState(null);
  const [buscandoCnpj, setBuscandoCnpj] = useState(false);
  const nomeDebounceRef = useRef(null);

  const [itens, setItens] = useState([novoItem()]);
  const [formas, setFormas] = useState([novaForma()]);

  const [salvando, setSalvando] = useState(false);
  const [toast, setToast] = useState("");
  const [aviso, setAviso] = useState(null); // { valesAbertos, chequesACair, nomeCliente }
  const [resumoCliente, setResumoCliente] = useState(null); // { mediaCompra, ultimasCompras, chequesDevolvidos }

  function mostrarToast(msg) {
    setToast(msg);
    setTimeout(() => setToast(""), 3500);
  }

  function atualizarCliente(campo, valor) {
    setCliente((c) => ({ ...c, [campo]: valor }));
  }

  function atualizarDesconto(numero, condicao) {
    setDescontoNumero(numero);
    setDescontoCondicao(condicao);
    atualizarCliente("descontoPadrao", montarDescontoTexto(numero, condicao));
  }

  // Busca ao sair de código, razão social ou CNPJ
  async function handleBlurCampo(campo) {
    const termo = cliente[campo];
    if (!termo || !termo.trim()) return;

    // Código e CNPJ só podem casar por igualdade exata — nunca por um pedaço
    // de texto encontrado dentro do nome de outro cliente qualquer (isso já
    // causou o formulário inteiro preencher sozinho com o cliente errado).
    const modo = campo === "codigo" ? "codigo" : campo === "cnpj" ? "cnpj" : "nome";

    setBuscandoCampo(campo);
    setMatches([]);
    try {
      const { exact, matches: encontrados } = await buscarCliente(termo, modo);
      if (exact) {
        preencherCliente(exact);
      } else if (modo === "nome" && encontrados.length > 1) {
        setMatches(encontrados);
      }
    } finally {
      setBuscandoCampo(null);
    }
  }

  // Busca em tempo real (debounced) enquanto digita o nome, mostrando lista suspensa
  function handleChangeNome(valor) {
    atualizarCliente("nome", valor);
    if (nomeDebounceRef.current) clearTimeout(nomeDebounceRef.current);
    if (!valor || valor.trim().length < 2) {
      setSugestoesNome([]);
      return;
    }
    nomeDebounceRef.current = setTimeout(async () => {
      const { matches: encontrados } = await buscarCliente(valor, "nome");
      setSugestoesNome(encontrados);
    }, 300);
  }

  // Cliente sem prazo/desconto assume o do grupo (se algum cadastro do
  // grupo tiver). Busca os colegas de grupo e completa o formulário; o valor
  // herdado fica gravado no cadastro deste CNPJ quando o pedido é salvo.
  async function completarComGrupo(c) {
    if (!c.grupo) return;
    const semPrazo = (c.prazo === undefined || c.prazo === null || c.prazo === "") && !c.prazoModelo;
    const semDesconto = !c.descontoPadrao;
    if (!semPrazo && !semDesconto) return;
    try {
      const colegas = await listarClientesDoGrupo(c.grupo);
      const efetivo = aplicarCondicoesDoGrupo(c, condicoesDoGrupo(colegas));
      if (!efetivo.prazoHerdadoDoGrupo && !efetivo.descontoHerdadoDoGrupo) return;
      setCliente((atual) => (atual.id !== c.id ? atual : {
        ...atual,
        ...(efetivo.prazoHerdadoDoGrupo ? { prazo: efetivo.prazo ?? "", prazoModelo: efetivo.prazoModelo || "" } : {}),
        ...(efetivo.descontoHerdadoDoGrupo ? { descontoPadrao: efetivo.descontoPadrao } : {}),
      }));
      if (efetivo.descontoHerdadoDoGrupo) {
        const { numero, condicao } = parseDescontoCampos(efetivo.descontoPadrao);
        setDescontoNumero(numero);
        setDescontoCondicao(condicao);
      }
    } catch {
      // sem conexão: segue com o cadastro como está
    }
  }

  function preencherCliente(c) {
    completarComGrupo(c);
    setCliente({
      id: c.id,
      codigo: c.codigo || "",
      nome: c.nome || "",
      razaoSocial: c.razaoSocial || "",
      cnpj: c.cnpj || "",
      representante: c.representante || "",
      descontoPadrao: c.descontoPadrao || "",
      prazo: c.prazo ?? "",
      prazoModelo: c.prazoModelo || "",
      cidade: c.cidade || "",
      estado: c.estado || "",
      grupo: c.grupo || "",
      observacao: c.observacao || "",
    });
    const { numero, condicao } = parseDescontoCampos(c.descontoPadrao);
    setDescontoNumero(numero);
    setDescontoCondicao(condicao);
    setMatches([]);
    setSugestoesNome([]);
    verificarPendencias(c);
  }

  async function verificarPendencias(c) {
    try {
      const [{ valesAbertos, chequesACair, mediaCompra, ultimasCompras }, todosChequesDevolvidos] = await Promise.all([
        buscarPendenciasCliente({ clienteId: c.id, grupo: c.grupo }),
        listarChequesDevolvidos(),
      ]);
      if (valesAbertos.length > 0 || chequesACair.length > 0) {
        setAviso({ valesAbertos, chequesACair, nomeCliente: c.nome });
      }
      const grupoNorm = (c.grupo || "").trim().toLowerCase();
      const chequesDevolvidosDoCliente = todosChequesDevolvidos.filter((ch) =>
        ch.clienteId === c.id || (grupoNorm && ch.clienteGrupo?.trim().toLowerCase() === grupoNorm)
      );
      setResumoCliente({ mediaCompra, ultimasCompras, chequesDevolvidos: chequesDevolvidosDoCliente.length, observacao: c.observacao || "" });
    } catch {
      // se falhar a checagem, não trava o lançamento do pedido
    }
  }

  // Consulta pública de CNPJ: preenche razão social/cidade/estado, mas NUNCA sobrescreve
  // o campo Nome do Cliente se ele já tiver algo digitado.
  async function handleConsultarCnpj() {
    if (!cliente.cnpj) return;
    setBuscandoCnpj(true);
    try {
      const dados = await consultarCnpj(cliente.cnpj);
      setCliente((c) => ({
        ...c,
        razaoSocial: dados.razaoSocial || c.razaoSocial,
        cidade: dados.cidade || c.cidade,
        estado: dados.estado || c.estado,
        nome: c.nome || dados.nomeFantasia,
      }));
      mostrarToast("Dados do CNPJ preenchidos");
    } catch (e) {
      mostrarToast(e.message);
    } finally {
      setBuscandoCnpj(false);
    }
  }

  function resetTudo() {
    setCliente(CLIENTE_VAZIO);
    setDescontoNumero("");
    setDescontoCondicao("avista");
    setMatches([]);
    setSugestoesNome([]);
    setItens([novoItem()]);
    setFormas([novaForma()]);
    setAviso(null);
    setResumoCliente(null);
  }

  // Só limpa o bloco Cliente — pra quando a pessoa selecionou/digitou o
  // cliente errado e quer trocar, sem perder o que já preencheu no pedido.
  function limparCliente() {
    setCliente(CLIENTE_VAZIO);
    setDescontoNumero("");
    setDescontoCondicao("avista");
    setMatches([]);
    setSugestoesNome([]);
    setAviso(null);
    setResumoCliente(null);
  }

  function addItem() {
    setItens((arr) => [...arr, novoItem()]);
  }
  function removeItem(i) {
    setItens((arr) => arr.filter((_, idx) => idx !== i));
  }
  function updateItem(i, campo, valor) {
    setItens((arr) => arr.map((it, idx) => (idx === i ? { ...it, [campo]: valor } : it)));
  }

  function addForma() {
    setFormas((arr) => [...arr, novaForma()]);
  }
  function removeForma(i) {
    setFormas((arr) => arr.filter((_, idx) => idx !== i));
  }
  function updateForma(i, campo, valor) {
    setFormas((arr) => arr.map((f, idx) => {
      if (idx !== i) return f;
      // Mudar valor total, número de folhas ou prazo refaz a divisão
      // automática do zero — qualquer edição manual feita antes é descartada,
      // já que os parâmetros de base mudaram.
      const limpaEdicaoManual = ["valorTotal", "numFolhas", "prazoUltimoCheque"].includes(campo);
      const novaForma = { ...f, [campo]: valor, ...(limpaEdicaoManual ? { parcelasManual: null } : {}) };
      // Ao trocar o tipo pra cheque, já sugere um prazo padrão de 30 dias pro
      // último cheque (com 1 folha, é o próprio cheque; com mais folhas, dá o
      // ponto de partida pra distribuir) — em vez de deixar em branco.
      if (campo === "tipo" && valor === "cheque" && !f.prazoUltimoCheque) {
        novaForma.prazoUltimoCheque = prazoPadraoUltimoCheque(f.numFolhas);
      }
      // Mudou o número de folhas: prazo do último volta pro padrão de 30 dias
      // por folha (30/60/90...). Dá pra ajustar o prazo manualmente depois.
      if (campo === "numFolhas") {
        novaForma.prazoUltimoCheque = prazoPadraoUltimoCheque(valor);
      }
      return novaForma;
    }));
  }

  // As parcelas de um cheque começam sempre calculadas automaticamente
  // (valor dividido igualmente, datas espaçadas até o prazo do último
  // cheque) — mas dá pra editar cada folha individualmente depois. A edição
  // manual fica guardada em parcelasManual até os campos de base mudarem.
  function parcelasDaForma(f) {
    return f.parcelasManual || calcularParcelasCheque(f.prazoUltimoCheque, f.numFolhas, f.valorTotal);
  }

  // Mudar a data da primeira ou da última folha redistribui as do meio
  // igualmente entre as duas; folha do meio muda só ela.
  function atualizarParcela(i, parcelaIndex, campo, valor) {
    setFormas((arr) => arr.map((f, idx) => {
      if (idx !== i) return f;
      const base = parcelasDaForma(f);
      const novasParcelas = campo === "data"
        ? redistribuirDatasCheque(base, parcelaIndex, valor)
        : base.map((p, pi) => (pi === parcelaIndex ? { ...p, valor: Number(valor) } : p));
      return {
        ...f,
        parcelasManual: novasParcelas,
        ...(campo === "data" && novasParcelas.length ? { prazoUltimoCheque: novasParcelas[novasParcelas.length - 1].data } : {}),
      };
    }));
  }

  function recalcularParcelasAutomaticamente(i) {
    setFormas((arr) => arr.map((f, idx) => (idx === i ? { ...f, parcelasManual: null } : f)));
  }

  const valorTotalPedido = itens.reduce((s, it) => s + (Number(it.valor) || 0), 0);
  // O desconto do cadastro só vale pra esse pedido se a condição bater: "fixo"
  // sempre vale, "à vista" só se o prazo escolhido aqui for de até 7 dias.
  const descontoDoPedido = descontoAplicavelAoPedido(cliente.descontoPadrao, cliente.prazo);
  const valorEsperado = calcularValorDevido(valorTotalPedido, descontoDoPedido);
  const valorAlocado = formas.reduce((s, f) => {
    return s + (f.tipo === "cheque" ? Number(f.valorTotal) || 0 : Number(f.valor) || 0);
  }, 0);
  const diferenca = valorEsperado - valorAlocado;
  const margemOk = Math.abs(diferenca) <= valorEsperado * 0.005;

  async function handleSalvar(e) {
    e.preventDefault();

    if (!cliente.nome) {
      mostrarToast("Preencha ao menos o nome do cliente");
      return;
    }
    if (valorTotalPedido <= 0) {
      mostrarToast("Informe ao menos um valor de pedido");
      return;
    }
    const formaContaTerceirosSemDescricao = formas.find((f) => f.tipo === "conta_terceiros" && !f.descricao?.trim());
    if (formaContaTerceirosSemDescricao) {
      mostrarToast("Informe de quem é a conta em 'Conta de 3º'");
      return;
    }

    setSalvando(true);
    try {
      // Cliente novo sem código (não cadastrado no sistema da empresa) recebe um
      // código único de 8 dígitos gerado automaticamente.
      let codigoFinal = cliente.codigo?.trim() || "";
      if (!codigoFinal && !cliente.id) {
        codigoFinal = await gerarCodigoUnico();
      }

      const clienteId = await salvarCliente(
        {
          codigo: codigoFinal,
          nome: cliente.nome,
          razaoSocial: cliente.razaoSocial,
          cnpj: cliente.cnpj,
          representante: cliente.representante,
          descontoPadrao: cliente.descontoPadrao,
          prazo: cliente.prazo,
          prazoModelo: cliente.prazoModelo,
          cidade: cliente.cidade,
          estado: cliente.estado,
          grupo: cliente.grupo,
          observacao: cliente.observacao,
        },
        cliente.id
      );

      const formasPagamento = formas
        .filter((f) => (f.tipo === "cheque" ? Number(f.valorTotal) > 0 : Number(f.valor) > 0))
        .map((f) => {
          if (f.tipo === "cheque") {
            const parcelas = parcelasDaForma(f);
            return {
              tipo: "cheque",
              valor: Number(f.valorTotal),
              numFolhas: Number(f.numFolhas),
              prazoUltimoCheque: f.prazoUltimoCheque,
              parcelas,
            };
          }
          return { tipo: f.tipo, valor: Number(f.valor), ...(f.tipo === "conta_terceiros" ? { descricao: f.descricao || "" } : {}) };
        });

      // Reconciliação automática: se o alocado não bater com (valor - desconto),
      // com margem de 0,5%, o restante vira Vale.
      const totalAlocado = formasPagamento.reduce((s, f) => s + f.valor, 0);
      const faltante = valorEsperado - totalAlocado;
      const margem = valorEsperado * 0.005;
      let avisoVale = null;
      if (faltante > margem) {
        const valorVale = Number(faltante.toFixed(2));
        formasPagamento.push({ tipo: "vale", valor: valorVale });
        avisoVale = `Diferença de ${formatCurrency(valorVale)} lançada como vale.`;
      }

      const valorPago = formasPagamento
        .filter((f) => FORMAS_RECEBIMENTO_IMEDIATO.includes(f.tipo))
        .reduce((s, f) => s + f.valor, 0);

      // Se sobrou 5% ou menos em aberto e nenhuma forma usada precisa de
      // confirmação futura (PIX/Depósito), o pedido já nasce quitado — não
      // precisa passar por Vales. Isso só vale no momento do lançamento;
      // depois disso, mover pra Recebidos/Comissões continua manual.
      // Cliente COM representante nunca vai direto pra Recebidos — nesse
      // caso vai direto pra Comissões, porque ainda tem uma comissão a pagar.
      const abertoNoLancamento = valorEsperado - valorPago;
      const percentualAbertoNoLancamento = valorEsperado > 0 ? (abertoNoLancamento / valorEsperado) * 100 : 0;
      const quitadoNoLancamento = podeIrDireitoParaRecebidos(percentualAbertoNoLancamento, formasPagamento);
      const temRepresentante = !!cliente.representante?.trim();
      const vaiDireitoParaRecebidos = quitadoNoLancamento && !temRepresentante;
      const vaiDireitoParaComissoes = quitadoNoLancamento && temRepresentante;

      await criarPedido({
        clienteId,
        clienteCodigo: codigoFinal,
        clienteNome: cliente.nome,
        clienteCidade: cliente.cidade,
        clienteEstado: cliente.estado,
        clienteGrupo: cliente.grupo || "",
        clienteRepresentante: cliente.representante || "",
        itens: itens.map((it) => ({ valor: Number(it.valor) || 0, data: it.data })),
        valor: valorTotalPedido,
        valorDevido: valorEsperado,
        valorPago,
        data: itens[0]?.data || todayISO(),
        desconto: descontoDoPedido,
        clientePrazo: cliente.prazo,
        clientePrazoModelo: cliente.prazoModelo || "",
        formasPagamento,
        ...(vaiDireitoParaRecebidos ? { arquivado: true } : {}),
        ...(vaiDireitoParaComissoes ? { forcarPago: true } : {}),
      });

      const avisoCodigo = !cliente.codigo?.trim() && !cliente.id ? ` Código gerado: ${codigoFinal}.` : "";
      const avisoRecebidos = vaiDireitoParaRecebidos ? " Já foi direto pra Recebidos (pago à vista)."
        : vaiDireitoParaComissoes ? " Já foi direto pra Comissões (pago à vista)." : "";
      mostrarToast((avisoVale || "Pedido lançado com sucesso!") + avisoRecebidos + avisoCodigo);
      resetTudo();
    } catch (err) {
      mostrarToast("Erro ao salvar: " + err.message);
    } finally {
      setSalvando(false);
    }
  }

  return (
    <>
      {aviso && (
        <div style={{
          position: "fixed", inset: 0, background: "rgba(43,33,64,0.5)", zIndex: 100,
          display: "flex", alignItems: "center", justifyContent: "center", padding: 20,
        }} onClick={() => setAviso(null)}>
          <div className="card" style={{ maxWidth: 420, width: "100%", maxHeight: "80vh", overflowY: "auto" }}
            onClick={(e) => e.stopPropagation()}>
            <h2 className="card-title" style={{ color: "var(--red)" }}>⚠️ Atenção: {aviso.nomeCliente}</h2>

            {aviso.valesAbertos.length > 0 && (
              <div style={{ marginBottom: 14 }}>
                <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 6 }}>Vale(s) em aberto:</div>
                {aviso.valesAbertos.map((v, i) => (
                  <div key={i} style={{ display: "flex", justifyContent: "space-between", fontSize: 14, padding: "4px 0" }}>
                    <span>{formatDate(v.data)}</span>
                    <strong style={{ color: "var(--red)" }}>{formatCurrency(v.saldo)}</strong>
                  </div>
                ))}
              </div>
            )}

            {aviso.chequesACair.length > 0 && (
              <div style={{ marginBottom: 14 }}>
                <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 6 }}>Cheque(s) a cair:</div>
                {aviso.chequesACair.map((c, i) => (
                  <div key={i} style={{ display: "flex", justifyContent: "space-between", fontSize: 14, padding: "4px 0" }}>
                    <span>N°{c.numero} — {formatDate(c.data)}</span>
                    <strong>{formatCurrency(c.valor)}</strong>
                  </div>
                ))}
              </div>
            )}

            <button className="btn btn-primary btn-block" onClick={() => setAviso(null)}>Entendi</button>
          </div>
        </div>
      )}
    <form onSubmit={handleSalvar}>
      {toast && <div className="toast">{toast}</div>}

      <div className="pedidos-grid">
      {/* BLOCO 1: CLIENTE */}
      <div className="card">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <h2 className="card-title" style={{ marginBottom: 0 }}>Cliente</h2>
          {(cliente.id || cliente.codigo || cliente.nome) && (
            <button type="button" className="btn btn-ghost" style={{ fontSize: 12, padding: "6px 10px" }} onClick={limparCliente}>
              Limpar dados
            </button>
          )}
        </div>
        <div className="row">
          <div className="field">
            <label>Código</label>
            <input className="input" value={cliente.codigo}
              onChange={(e) => atualizarCliente("codigo", e.target.value)}
              onBlur={() => handleBlurCampo("codigo")}
              onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), handleBlurCampo("codigo"))} />
          </div>
          <div className="field" style={{ position: "relative" }}>
            <label>Nome do cliente</label>
            <input className="input" value={cliente.nome} autoComplete="off"
              onChange={(e) => handleChangeNome(e.target.value)}
              onFocus={() => cliente.nome.length >= 2 && handleChangeNome(cliente.nome)} />
            {sugestoesNome.length > 0 && (
              <div style={{
                position: "absolute", top: "100%", left: 0, right: 0, zIndex: 10,
                background: "white", border: "1.5px solid var(--border)", borderRadius: 12,
                marginTop: 4, maxHeight: 220, overflowY: "auto",
                boxShadow: "0 8px 24px rgba(0,0,0,0.1)",
              }}>
                {sugestoesNome.map((m) => (
                  <div key={m.id} className="list-item" style={{ margin: 0, borderRadius: 0, border: "none", borderBottom: "1px solid var(--border)" }}
                    onClick={() => preencherCliente(m)}>
                    <div>
                      <strong>{m.nome}</strong>
                      <div style={{ fontSize: 13, color: "var(--ink-soft)" }}>Cód {m.codigo}{m.estado ? ` · ${m.estado}` : ""}</div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
        <div className="row">
          <div className="field">
            <label>Razão social</label>
            <input className="input" value={cliente.razaoSocial}
              onChange={(e) => atualizarCliente("razaoSocial", e.target.value)}
              onBlur={() => handleBlurCampo("razaoSocial")}
              onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), handleBlurCampo("razaoSocial"))} />
          </div>
          <div className="field">
            <label>CNPJ</label>
            <div style={{ display: "flex", gap: 8 }}>
              <input className="input" value={cliente.cnpj}
                onChange={(e) => atualizarCliente("cnpj", e.target.value)}
                onBlur={() => handleBlurCampo("cnpj")}
                onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), handleBlurCampo("cnpj"))} />
              <button type="button" className="btn btn-secondary" onClick={handleConsultarCnpj} disabled={buscandoCnpj}>
                {buscandoCnpj ? "..." : "CNPJ"}
              </button>
            </div>
          </div>
        </div>

        {buscandoCampo && <div style={{ fontSize: 13, color: "var(--ink-soft)" }}>Buscando na base...</div>}

        {matches.length > 0 && (
          <div style={{ marginBottom: 14 }}>
            <label style={{ fontSize: 13, fontWeight: 700, color: "var(--ink-soft)" }}>
              {matches.length} clientes encontrados — selecione:
            </label>
            {matches.map((m) => (
              <div key={m.id} className="list-item" onClick={() => preencherCliente(m)}>
                <div>
                  <strong>{m.nome}</strong>
                  <div style={{ fontSize: 13, color: "var(--ink-soft)" }}>Cód {m.codigo}{m.estado ? ` · ${m.estado}` : ""}</div>
                </div>
                <span>→</span>
              </div>
            ))}
          </div>
        )}

        <div className="row">
          <div className="field">
            <label>Representante comercial</label>
            <input className="input" value={cliente.representante}
              onChange={(e) => atualizarCliente("representante", e.target.value)} />
          </div>
          <div className="field">
            <label>Prazo de pagamento</label>
            <select className="input" value={idPrazoAtual(cliente.prazoModelo, cliente.prazo)}
              onChange={(e) => {
                const opcao = OPCOES_PRAZO.find((o) => o.id === e.target.value);
                setCliente((c) => ({ ...c, prazoModelo: opcao?.id || "", prazo: opcao?.dias ?? "" }));
              }}>
              <option value="" disabled>Selecione...</option>
              {OPCOES_PRAZO.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
              {!idPrazoAtual(cliente.prazoModelo, cliente.prazo) && cliente.prazo !== undefined && cliente.prazo !== null && cliente.prazo !== "" && (
                <option value="">{cliente.prazo} dias (personalizado — escolha um modelo acima)</option>
              )}
            </select>
          </div>
        </div>
        <div className="row">
          <div className="field">
            <label>Desconto</label>
            <input className="input" type="number" step="0.01" min="0" value={descontoNumero}
              onChange={(e) => atualizarDesconto(e.target.value, descontoCondicao)}
              placeholder="Ex: 5" />
          </div>
          <div className="field">
            <label>Condição</label>
            <select className="input" value={descontoCondicao}
              onChange={(e) => atualizarDesconto(descontoNumero, e.target.value)}>
              <option value="avista">À vista</option>
              <option value="fixo">Fixo</option>
            </select>
          </div>
        </div>
        {descontoNumero > 0 && (
          <div style={{ fontSize: 12, color: descontoDoPedido ? "var(--green)" : "var(--yellow)", marginTop: -8, marginBottom: 14 }}>
            {descontoDoPedido
              ? `✓ Desconto de ${descontoNumero}% será aplicado nesse pedido.`
              : `Esse pedido NÃO leva o desconto (condição "à vista" exige prazo de até 7 dias).`}
          </div>
        )}
        <div className="row">
          <div className="field">
            <label>Cidade</label>
            <input className="input" value={cliente.cidade}
              onChange={(e) => atualizarCliente("cidade", e.target.value)} />
          </div>
          <div className="field">
            <label>Estado</label>
            <select className="input" value={cliente.estado}
              onChange={(e) => atualizarCliente("estado", e.target.value)}>
              <option value="">--</option>
              {ESTADOS_BR.map((uf) => <option key={uf} value={uf}>{uf}</option>)}
            </select>
          </div>
        </div>
        <div className="row">
          <div className="field">
            <label>Grupo de cliente <span style={{ fontWeight: 400, color: "var(--ink-soft)" }}>(opcional, para juntar CNPJs do mesmo grupo)</span></label>
            <input className="input" list="lista-grupos-pedido" value={cliente.grupo}
              onChange={(e) => {
                const valor = e.target.value;
                atualizarCliente("grupo", valor);
                // escolheu um grupo que já existe: puxa prazo/desconto dele
                // se este cliente ainda não tiver os seus
                if (gruposExistentes.includes(valor)) completarComGrupo({ ...cliente, grupo: valor });
              }}
              placeholder="Digite ou escolha um grupo existente" />
            <datalist id="lista-grupos-pedido">
              {gruposExistentes.map((g) => <option key={g} value={g} />)}
            </datalist>
          </div>
          <div className="field">
            <label>Observação</label>
            <input className="input" value={cliente.observacao}
              onChange={(e) => atualizarCliente("observacao", e.target.value)}
              placeholder="Anotações livres sobre esse cliente..." />
          </div>
        </div>
        {!cliente.id && (cliente.codigo || cliente.nome) && (
          <div style={{ fontSize: 13, color: "var(--grape)", fontWeight: 600 }}>
            Cliente novo — será cadastrado automaticamente ao salvar o pedido.
          </div>
        )}
      </div>

      {/* BLOCO 2: PEDIDO */}
      <div className="card">
        <h2 className="card-title">Pedido</h2>

        {itens.map((it, i) => (
          <div className="row" key={i} style={{ alignItems: "flex-end" }}>
            <div className="field">
              <label>Valor (R$) {itens.length > 1 ? `— pedido ${i + 1}` : ""}</label>
              <input className="input" type="number" step="0.01" min="0" value={it.valor}
                onChange={(e) => updateItem(i, "valor", e.target.value)} />
            </div>
            <div className="field">
              <label>Data</label>
              <input className="input" type="date" value={it.data}
                onChange={(e) => updateItem(i, "data", e.target.value)} />
            </div>
            {itens.length > 1 && (
              <button type="button" className="btn btn-ghost" style={{ marginBottom: 14 }}
                onClick={() => removeItem(i)}>✕</button>
            )}
          </div>
        ))}
        <button type="button" className="btn btn-secondary" onClick={addItem} style={{ marginBottom: 6 }}>
          + Adicionar outro pedido
        </button>

        <div style={{ margin: "16px 0 8px" }}>
          <div style={{ fontWeight: 700, fontSize: 16 }}>Total do pedido: {formatCurrency(valorTotalPedido)}</div>
          {valorEsperado < valorTotalPedido - 0.01 && (
            <div style={{ fontSize: 13, color: "var(--ink-soft)" }}>
              Valor esperado com desconto: <strong>{formatCurrency(valorEsperado)}</strong>
            </div>
          )}
        </div>

        <h3 style={{ fontSize: 15, margin: "8px 0" }}>Forma(s) de pagamento</h3>
        {formas.map((f, i) => (
          <div key={i} className="card" style={{ background: "var(--bg)", marginBottom: 10, padding: 14 }}>
            <div className="row" style={{ alignItems: "flex-end" }}>
              <div className="field">
                <label>Tipo</label>
                <select className="input" value={f.tipo} onChange={(e) => updateForma(i, "tipo", e.target.value)}>
                  {FORMAS_PAGAMENTO.map((fp) => <option key={fp.value} value={fp.value}>{fp.label}</option>)}
                </select>
              </div>
              {f.tipo !== "cheque" && (
                <div className="field">
                  <label>Valor (R$)</label>
                  <input className="input" type="number" step="0.01" min="0" value={f.valor}
                    onChange={(e) => updateForma(i, "valor", e.target.value)} />
                </div>
              )}
              {formas.length > 1 && (
                <button type="button" className="btn btn-ghost" style={{ marginBottom: 14 }}
                  onClick={() => removeForma(i)}>✕</button>
              )}
            </div>

            {f.tipo === "conta_terceiros" && (
              <div className="field">
                <label>De quem é a conta</label>
                <input className="input" value={f.descricao || ""}
                  onChange={(e) => updateForma(i, "descricao", e.target.value)}
                  placeholder="Ex: conta do irmão do cliente, João Silva" />
              </div>
            )}

            {f.tipo === "cheque" && (
              <>
                <div className="row">
                  <div className="field">
                    <label>Valor total em cheque (R$)</label>
                    <input className="input" type="number" step="0.01" min="0" value={f.valorTotal}
                      onChange={(e) => updateForma(i, "valorTotal", e.target.value)} />
                  </div>
                  <div className="field">
                    <label>Número de folhas</label>
                    <input className="input" type="number" min="1" value={f.numFolhas}
                      onChange={(e) => updateForma(i, "numFolhas", e.target.value)} />
                  </div>
                </div>
                <div className="field">
                  <label>Prazo do último cheque</label>
                  <input className="input" type="date" value={f.prazoUltimoCheque}
                    onChange={(e) => (f.parcelasManual
                      ? atualizarParcela(i, f.parcelasManual.length - 1, "data", e.target.value)
                      : updateForma(i, "prazoUltimoCheque", e.target.value))} />
                </div>
                {f.valorTotal && f.prazoUltimoCheque && Number(f.numFolhas) > 0 && (
                  <div style={{ marginTop: 4 }}>
                    {parcelasDaForma(f).map((p, pi) => (
                      <div key={p.numero} style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 6 }}>
                        <span style={{ fontSize: 13, color: "var(--ink-soft)", flexShrink: 0, width: 34 }}>N°{p.numero}</span>
                        <input className="input" type="number" step="0.01" value={p.valor}
                          onChange={(e) => atualizarParcela(i, pi, "valor", e.target.value)}
                          style={{ flex: 1 }} />
                        <input className="input" type="date" value={p.data}
                          onChange={(e) => atualizarParcela(i, pi, "data", e.target.value)}
                          style={{ flex: 1 }} />
                      </div>
                    ))}
                    {f.parcelasManual && (
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 12, marginTop: 2 }}>
                        {Math.abs(parcelasDaForma(f).reduce((s, p) => s + Number(p.valor || 0), 0) - Number(f.valorTotal)) > 0.01 ? (
                          <span style={{ color: "var(--red)" }}>
                            Soma das folhas ({formatCurrency(parcelasDaForma(f).reduce((s, p) => s + Number(p.valor || 0), 0))}) diferente do valor total em cheque
                          </span>
                        ) : <span style={{ color: "var(--ink-soft)" }}>Folhas editadas manualmente</span>}
                        <button type="button" className="btn btn-ghost" style={{ fontSize: 12, padding: "4px 8px" }}
                          onClick={() => recalcularParcelasAutomaticamente(i)}>
                          Recalcular automaticamente
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </>
            )}
          </div>
        ))}
        <button type="button" className="btn btn-secondary btn-block" onClick={addForma}>
          + Adicionar forma de pagamento
        </button>

        {valorTotalPedido > 0 && (
          <div style={{ marginTop: 14, fontSize: 14, fontWeight: 600, color: margemOk ? "var(--green)" : "var(--yellow)" }}>
            {margemOk
              ? "✓ Valor alocado bate com o esperado (após desconto)"
              : diferenca > 0
              ? `Faltam ${formatCurrency(diferenca)} — a diferença será lançada como vale ao salvar`
              : `Alocado ${formatCurrency(-diferenca)} a mais que o esperado`}
          </div>
        )}

        <button className="btn btn-primary btn-block" type="submit" disabled={salvando} style={{ marginTop: 16 }}>
          {salvando ? "Salvando..." : "Lançar pedido"}
        </button>
      </div>

      {resumoCliente && cliente.id && (
        <div className="card" style={{ background: "var(--bg)" }}>
          <h3 style={{ fontSize: 14, marginBottom: 10 }}>Resumo do cliente</h3>
          <div style={{ display: "flex", gap: 20, flexWrap: "wrap", marginBottom: 12 }}>
            <div>
              <div style={{ fontSize: 12, color: "var(--ink-soft)" }}>Valor médio das compras</div>
              <strong style={{ fontSize: 15 }}>{formatCurrency(resumoCliente.mediaCompra)}</strong>
            </div>
            <div>
              <div style={{ fontSize: 12, color: "var(--ink-soft)" }}>Cheques que já voltaram</div>
              <strong style={{ fontSize: 15, color: resumoCliente.chequesDevolvidos > 0 ? "var(--red)" : "var(--ink)" }}>
                {resumoCliente.chequesDevolvidos}
              </strong>
            </div>
          </div>
          {resumoCliente.ultimasCompras.length > 0 && (
            <div style={{ marginBottom: 10 }}>
              <div style={{ fontSize: 12, color: "var(--ink-soft)", marginBottom: 4 }}>Últimas compras</div>
              {resumoCliente.ultimasCompras.map((c, i) => (
                <div key={i} style={{ display: "flex", justifyContent: "space-between", fontSize: 13 }}>
                  <span>{formatDate(c.data)}</span>
                  <strong>{formatCurrency(c.valor)}</strong>
                </div>
              ))}
            </div>
          )}
          {resumoCliente.observacao && (
            <div>
              <div style={{ fontSize: 12, color: "var(--ink-soft)", marginBottom: 4 }}>Observação</div>
              <div style={{ fontSize: 13 }}>{resumoCliente.observacao}</div>
            </div>
          )}
        </div>
      )}
      </div>
    </form>
    </>
  );
}
