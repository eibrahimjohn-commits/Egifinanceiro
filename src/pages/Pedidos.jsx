import { useState } from "react";
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
} from "../lib/constants";

const CLIENTE_VAZIO = {
  id: null,
  codigo: "",
  nome: "",
  razaoSocial: "",
  cnpj: "",
  representante: "",
  descontoPadrao: "",
  cidade: "",
  estado: "",
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
  const [buscandoCampo, setBuscandoCampo] = useState(null);
  const [buscandoCnpj, setBuscandoCnpj] = useState(false);

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

  // Busca ao sair de um dos 4 campos-chave (código, nome, razão social, cnpj)
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
      // se não achar nada, mantém o que a pessoa digitou (cadastro novo)
    } finally {
      setBuscandoCampo(null);
    }
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
      cidade: c.cidade || "",
      estado: c.estado || "",
    });
    setMatches([]);
  }

  async function handleConsultarCnpj() {
    if (!cliente.cnpj) return;
    setBuscandoCnpj(true);
    try {
      const dados = await consultarCnpj(cliente.cnpj);
      setCliente((c) => ({ ...c, ...dados }));
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
    setItens([novoItem()]);
    setFormas([novaForma()]);
  }

  // --- Itens (valor + data), múltiplos ---
  function addItem() {
    setItens((arr) => [...arr, novoItem()]);
  }
  function removeItem(i) {
    setItens((arr) => arr.filter((_, idx) => idx !== i));
  }
  function updateItem(i, campo, valor) {
    setItens((arr) => arr.map((it, idx) => (idx === i ? { ...it, [campo]: valor } : it)));
  }

  // --- Formas de pagamento, múltiplas ---
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
  const valorAlocado = formas.reduce((s, f) => {
    return s + (f.tipo === "cheque" ? Number(f.valorTotal) || 0 : Number(f.valor) || 0);
  }, 0);
  const diferenca = valorTotalPedido - valorAlocado;

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
          cidade: cliente.cidade,
          estado: cliente.estado,
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

      const valorPago = formasPagamento
        .filter((f) => FORMAS_RECEBIMENTO_IMEDIATO.includes(f.tipo))
        .reduce((s, f) => s + f.valor, 0);

      await criarPedido({
        clienteId,
        clienteCodigo: cliente.codigo,
        clienteNome: cliente.nome,
        clienteCidade: cliente.cidade,
        clienteEstado: cliente.estado,
        itens: itens.map((it) => ({ valor: Number(it.valor) || 0, data: it.data })),
        valor: valorTotalPedido,
        valorPago,
        data: itens[0]?.data || todayISO(),
        desconto: cliente.descontoPadrao,
        formasPagamento,
      });

      mostrarToast("Pedido lançado com sucesso!");
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

      {/* BLOCO 1: CLIENTE */}
      <div className="card">
        <h2 className="card-title">Cliente</h2>
        <div className="row">
          <div className="field">
            <label>Código</label>
            <input className="input" value={cliente.codigo}
              onChange={(e) => atualizarCliente("codigo", e.target.value)}
              onBlur={() => handleBlurCampo("codigo")} />
          </div>
          <div className="field">
            <label>Nome do cliente</label>
            <input className="input" value={cliente.nome}
              onChange={(e) => atualizarCliente("nome", e.target.value)}
              onBlur={() => handleBlurCampo("nome")} />
          </div>
        </div>
        <div className="row">
          <div className="field">
            <label>Razão social</label>
            <input className="input" value={cliente.razaoSocial}
              onChange={(e) => atualizarCliente("razaoSocial", e.target.value)}
              onBlur={() => handleBlurCampo("razaoSocial")} />
          </div>
          <div className="field">
            <label>CNPJ</label>
            <div style={{ display: "flex", gap: 8 }}>
              <input className="input" value={cliente.cnpj}
                onChange={(e) => atualizarCliente("cnpj", e.target.value)}
                onBlur={() => handleBlurCampo("cnpj")} />
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

        <div style={{ fontWeight: 700, fontSize: 16, margin: "16px 0 8px" }}>
          Total do pedido: {formatCurrency(valorTotalPedido)}
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
          <div style={{
            marginTop: 14, fontSize: 14, fontWeight: 600,
            color: Math.abs(diferenca) < 0.01 ? "var(--green)" : "var(--red)",
          }}>
            {Math.abs(diferenca) < 0.01
              ? "✓ Valor do pedido totalmente alocado nas formas de pagamento"
              : diferenca > 0
              ? `Faltam ${formatCurrency(diferenca)} para alocar`
              : `Alocado ${formatCurrency(-diferenca)} a mais que o pedido`}
          </div>
        )}

        <button className="btn btn-primary btn-block" type="submit" disabled={salvando} style={{ marginTop: 16 }}>
          {salvando ? "Salvando..." : "Lançar pedido"}
        </button>
      </div>
    </form>
  );
}
