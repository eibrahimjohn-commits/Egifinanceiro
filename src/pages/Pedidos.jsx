import { useState, useRef } from "react";
import "../components/ui.css";
import { buscarCliente, salvarCliente, consultarCnpj } from "../lib/clientes";
import { criarPedido } from "../lib/pedidos";
import {
  FORMAS_PAGAMENTO,
  FORMAS_RECEBIMENTO_IMEDIATO,
  ESTADOS_BR,
  todayISO,
  formatCurrency,
  formatDate,
  calcularParcelasCheque,
  calcularValorDevido,
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
  cidade: "",
  estado: "",
  grupo: "",
};

function novoItem() {
  return { valor: "", data: todayISO() };
}

function novaForma() {
  return { tipo: "pix_ted", valor: "", valorTotal: "", numFolhas: "1", prazoUltimoCheque: "" };
}

export default function Pedidos() {
  const [cliente, setCliente] = useState(CLIENTE_VAZIO);
  const [matches, setMatches] = useState([]);
  const [sugestoesNome, setSugestoesNome] = useState([]);
  const [buscandoCampo, setBuscandoCampo] = useState(null);
  const [buscandoCnpj, setBuscandoCnpj] = useState(false);
  const nomeDebounceRef = useRef(null);

  const [itens, setItens] = useState([novoItem()]);
  const [formas, setFormas] = useState([novaForma()]);

  const [salvando, setSalvando] = useState(false);
  const [toast, setToast] = useState("");

  function mostrarToast(msg) {
    setToast(msg);
    setTimeout(() => setToast(""), 3500);
  }

  function atualizarCliente(campo, valor) {
    setCliente((c) => ({ ...c, [campo]: valor }));
  }

  // Busca ao sair de código, razão social ou CNPJ
  async function handleBlurCampo(campo) {
    const termo = cliente[campo];
    if (!termo || !termo.trim()) return;

    setBuscandoCampo(campo);
    setMatches([]);
    try {
      const { exact, matches: encontrados } = await buscarCliente(termo);
      if (exact) {
        preencherCliente(exact);
      } else if (encontrados.length === 1) {
        preencherCliente(encontrados[0]);
      } else if (encontrados.length > 1) {
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
      const { exact, matches: encontrados } = await buscarCliente(valor);
      setSugestoesNome(exact ? [exact] : encontrados);
    }, 300);
  }

  function preencherCliente(c) {
    setCliente({
      id: c.id,
      codigo: c.codigo || "",
      nome: c.nome || "",
      razaoSocial: c.razaoSocial || "",
      cnpj: c.cnpj || "",
      representante: c.representante || "",
      descontoPadrao: c.descontoPadrao || "",
      prazo: c.prazo || "",
      cidade: c.cidade || "",
      estado: c.estado || "",
      grupo: c.grupo || "",
    });
    setMatches([]);
    setSugestoesNome([]);
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
    setMatches([]);
    setSugestoesNome([]);
    setItens([novoItem()]);
    setFormas([novaForma()]);
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
    setFormas((arr) => arr.map((f, idx) => (idx === i ? { ...f, [campo]: valor } : f)));
  }

  const valorTotalPedido = itens.reduce((s, it) => s + (Number(it.valor) || 0), 0);
  const valorEsperado = calcularValorDevido(valorTotalPedido, cliente.descontoPadrao);
  const valorAlocado = formas.reduce((s, f) => {
    return s + (f.tipo === "cheque" ? Number(f.valorTotal) || 0 : Number(f.valor) || 0);
  }, 0);
  const diferenca = valorEsperado - valorAlocado;
  const margemOk = Math.abs(diferenca) <= valorEsperado * 0.005;

  async function handleSalvar(e) {
    e.preventDefault();

    if (!cliente.codigo || !cliente.nome) {
      mostrarToast("Preencha ao menos código e nome do cliente");
      return;
    }
    if (valorTotalPedido <= 0) {
      mostrarToast("Informe ao menos um valor de pedido");
      return;
    }

    setSalvando(true);
    try {
      const clienteId = await salvarCliente(
        {
          codigo: cliente.codigo,
          nome: cliente.nome,
          razaoSocial: cliente.razaoSocial,
          cnpj: cliente.cnpj,
          representante: cliente.representante,
          descontoPadrao: cliente.descontoPadrao,
          prazo: cliente.prazo,
          cidade: cliente.cidade,
          estado: cliente.estado,
          grupo: cliente.grupo,
        },
        cliente.id
      );

      const formasPagamento = formas
        .filter((f) => (f.tipo === "cheque" ? Number(f.valorTotal) > 0 : Number(f.valor) > 0))
        .map((f) => {
          if (f.tipo === "cheque") {
            const parcelas = calcularParcelasCheque(f.prazoUltimoCheque, f.numFolhas, f.valorTotal);
            return {
              tipo: "cheque",
              valor: Number(f.valorTotal),
              numFolhas: Number(f.numFolhas),
              prazoUltimoCheque: f.prazoUltimoCheque,
              parcelas,
            };
          }
          return { tipo: f.tipo, valor: Number(f.valor) };
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

      await criarPedido({
        clienteId,
        clienteCodigo: cliente.codigo,
        clienteNome: cliente.nome,
        clienteCidade: cliente.cidade,
        clienteEstado: cliente.estado,
        clienteGrupo: cliente.grupo || "",
        itens: itens.map((it) => ({ valor: Number(it.valor) || 0, data: it.data })),
        valor: valorTotalPedido,
        valorDevido: valorEsperado,
        valorPago,
        data: itens[0]?.data || todayISO(),
        desconto: cliente.descontoPadrao,
        clientePrazo: cliente.prazo,
        formasPagamento,
      });

      mostrarToast(avisoVale || "Pedido lançado com sucesso!");
      resetTudo();
    } catch (err) {
      mostrarToast("Erro ao salvar: " + err.message);
    } finally {
      setSalvando(false);
    }
  }

  return (
    <form onSubmit={handleSalvar}>
      {toast && <div className="toast">{toast}</div>}

      <div className="pedidos-grid">
      {/* BLOCO 1: CLIENTE */}
      <div className="card">
        <h2 className="card-title">Cliente</h2>
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
                      <div style={{ fontSize: 13, color: "var(--ink-soft)" }}>Cód {m.codigo}</div>
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
                  <div style={{ fontSize: 13, color: "var(--ink-soft)" }}>Cód {m.codigo}</div>
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
            <label>Desconto</label>
            <input className="input" value={cliente.descontoPadrao}
              onChange={(e) => atualizarCliente("descontoPadrao", e.target.value)}
              placeholder="Ex: 5% à vista" />
          </div>
        </div>
        <div className="row">
          <div className="field">
            <label>Prazo de pagamento (dias)</label>
            <input className="input" type="number" min="0" value={cliente.prazo}
              onChange={(e) => atualizarCliente("prazo", e.target.value)}
              placeholder="Ex: 30" />
          </div>
        </div>
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
        <div className="field">
          <label>Grupo de cliente <span style={{ fontWeight: 400, color: "var(--ink-soft)" }}>(opcional, para juntar CNPJs do mesmo grupo)</span></label>
          <input className="input" value={cliente.grupo}
            onChange={(e) => atualizarCliente("grupo", e.target.value)}
            placeholder="Ex: Rede Bijoux Ltda" />
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
                    onChange={(e) => updateForma(i, "prazoUltimoCheque", e.target.value)} />
                </div>
                {f.valorTotal && f.prazoUltimoCheque && Number(f.numFolhas) > 0 && (
                  <div style={{ fontSize: 13, color: "var(--ink-soft)" }}>
                    {calcularParcelasCheque(f.prazoUltimoCheque, f.numFolhas, f.valorTotal).map((p) => (
                      <div key={p.numero}>
                        Folha {p.numero}: {formatCurrency(p.valor)} em {formatDate(p.data)}
                      </div>
                    ))}
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
      </div>
    </form>
  );
}
