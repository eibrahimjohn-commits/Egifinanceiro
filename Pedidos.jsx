import { useState } from "react";
import "../components/ui.css";
import { buscarCliente, salvarCliente, consultarCnpj } from "../lib/clientes";
import { criarPedido } from "../lib/pedidos";
import { FORMAS_PAGAMENTO, ESTADOS_BR, todayISO } from "../lib/constants";

const CLIENTE_VAZIO = {
  codigo: "",
  nome: "",
  razaoSocial: "",
  cnpj: "",
  cidade: "",
  estado: "",
  representante: "",
  formaPagamentoPadrao: "",
  descontoPadrao: "",
};

const PEDIDO_VAZIO = {
  valor: "",
  data: todayISO(),
  desconto: "",
  formaPagamento: "pix",
  chequePrazoDias: "",
  chequeParcelas: "1",
  jaPago: false,
};

export default function Pedidos() {
  const [busca, setBusca] = useState("");
  const [buscando, setBuscando] = useState(false);
  const [cliente, setCliente] = useState(null); // cliente selecionado {id, ...} ou null
  const [clienteNovo, setClienteNovo] = useState(CLIENTE_VAZIO); // form de cadastro rápido
  const [matches, setMatches] = useState([]);
  const [modoCadastro, setModoCadastro] = useState(false);
  const [pedido, setPedido] = useState(PEDIDO_VAZIO);
  const [salvando, setSalvando] = useState(false);
  const [toast, setToast] = useState("");
  const [buscandoCnpj, setBuscandoCnpj] = useState(false);

  function mostrarToast(msg) {
    setToast(msg);
    setTimeout(() => setToast(""), 3000);
  }

  async function handleBuscar() {
    if (!busca.trim()) return;
    setBuscando(true);
    setMatches([]);
    setCliente(null);
    try {
      const { exact, matches } = await buscarCliente(busca);
      if (exact) {
        setCliente(exact);
        setModoCadastro(false);
      } else if (matches.length === 1) {
        setCliente(matches[0]);
        setModoCadastro(false);
      } else if (matches.length > 1) {
        setMatches(matches);
      } else {
        // não encontrado -> abre cadastro rápido
        setModoCadastro(true);
        setClienteNovo({ ...CLIENTE_VAZIO, codigo: /^\d+$/.test(busca) ? busca : "", cnpj: busca.replace(/\D/g, "").length >= 11 ? busca : "" });
      }
    } finally {
      setBuscando(false);
    }
  }

  async function handleConsultarCnpj() {
    if (!clienteNovo.cnpj) return;
    setBuscandoCnpj(true);
    try {
      const dados = await consultarCnpj(clienteNovo.cnpj);
      setClienteNovo((c) => ({ ...c, ...dados }));
      mostrarToast("Dados do CNPJ preenchidos");
    } catch (e) {
      mostrarToast(e.message);
    } finally {
      setBuscandoCnpj(false);
    }
  }

  function selecionarMatch(c) {
    setCliente(c);
    setMatches([]);
    setModoCadastro(false);
  }

  function resetTudo() {
    setBusca("");
    setCliente(null);
    setClienteNovo(CLIENTE_VAZIO);
    setMatches([]);
    setModoCadastro(false);
    setPedido(PEDIDO_VAZIO);
  }

  async function handleSalvarPedido(e) {
    e.preventDefault();
    setSalvando(true);
    try {
      let clienteFinal = cliente;

      if (modoCadastro) {
        if (!clienteNovo.nome || !clienteNovo.codigo) {
          mostrarToast("Preencha ao menos código e nome do cliente");
          setSalvando(false);
          return;
        }
        const id = await salvarCliente(clienteNovo);
        clienteFinal = { id, ...clienteNovo };
      }

      if (!clienteFinal) {
        mostrarToast("Selecione ou cadastre um cliente");
        setSalvando(false);
        return;
      }

      const valor = Number(pedido.valor);
      if (!valor || valor <= 0) {
        mostrarToast("Informe o valor do pedido");
        setSalvando(false);
        return;
      }

      const formaPagamento = { tipo: pedido.formaPagamento };
      if (pedido.formaPagamento === "cheque") {
        formaPagamento.prazoDias = Number(pedido.chequePrazoDias) || 0;
        formaPagamento.numParcelas = Number(pedido.chequeParcelas) || 1;
      }

      await criarPedido({
        clienteId: clienteFinal.id,
        clienteCodigo: clienteFinal.codigo,
        clienteNome: clienteFinal.nome,
        clienteCidade: clienteFinal.cidade,
        clienteEstado: clienteFinal.estado,
        valor,
        valorPago: pedido.jaPago ? valor : 0,
        data: pedido.data,
        desconto: pedido.desconto,
        formaPagamento,
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
    <div>
      {toast && <div className="toast">{toast}</div>}

      {!cliente && !modoCadastro && (
        <div className="card">
          <h2 className="card-title">Buscar cliente</h2>
          <div className="field">
            <label>Código, CNPJ ou nome</label>
            <input
              className="input"
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleBuscar()}
              placeholder="Ex: 0123, 12.345.678/0001-90 ou Maria Bijuterias"
            />
          </div>
          <button className="btn btn-primary btn-block" onClick={handleBuscar} disabled={buscando}>
            {buscando ? "Buscando..." : "Buscar"}
          </button>

          {matches.length > 0 && (
            <div style={{ marginTop: 16 }}>
              <label style={{ fontSize: 13, fontWeight: 700, color: "var(--ink-soft)" }}>
                {matches.length} clientes encontrados:
              </label>
              {matches.map((m) => (
                <div key={m.id} className="list-item" onClick={() => selecionarMatch(m)}>
                  <div>
                    <strong>{m.nome}</strong>
                    <div style={{ fontSize: 13, color: "var(--ink-soft)" }}>
                      Cód {m.codigo} · {m.cidade}/{m.estado}
                    </div>
                  </div>
                  <span>→</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {modoCadastro && (
        <div className="card">
          <h2 className="card-title">Cliente não encontrado — cadastrar novo</h2>
          <div className="row">
            <div className="field">
              <label>Código *</label>
              <input className="input" value={clienteNovo.codigo}
                onChange={(e) => setClienteNovo({ ...clienteNovo, codigo: e.target.value })} />
            </div>
            <div className="field">
              <label>CNPJ</label>
              <div style={{ display: "flex", gap: 8 }}>
                <input className="input" value={clienteNovo.cnpj}
                  onChange={(e) => setClienteNovo({ ...clienteNovo, cnpj: e.target.value })} />
                <button type="button" className="btn btn-secondary" onClick={handleConsultarCnpj} disabled={buscandoCnpj}>
                  {buscandoCnpj ? "..." : "Buscar"}
                </button>
              </div>
            </div>
          </div>
          <div className="field">
            <label>Nome / Fantasia *</label>
            <input className="input" value={clienteNovo.nome}
              onChange={(e) => setClienteNovo({ ...clienteNovo, nome: e.target.value })} />
          </div>
          <div className="field">
            <label>Razão Social</label>
            <input className="input" value={clienteNovo.razaoSocial}
              onChange={(e) => setClienteNovo({ ...clienteNovo, razaoSocial: e.target.value })} />
          </div>
          <div className="row">
            <div className="field">
              <label>Cidade</label>
              <input className="input" value={clienteNovo.cidade}
                onChange={(e) => setClienteNovo({ ...clienteNovo, cidade: e.target.value })} />
            </div>
            <div className="field">
              <label>Estado</label>
              <select className="input" value={clienteNovo.estado}
                onChange={(e) => setClienteNovo({ ...clienteNovo, estado: e.target.value })}>
                <option value="">--</option>
                {ESTADOS_BR.map((uf) => <option key={uf} value={uf}>{uf}</option>)}
              </select>
            </div>
          </div>
          <div className="row">
            <div className="field">
              <label>Representante</label>
              <input className="input" value={clienteNovo.representante}
                onChange={(e) => setClienteNovo({ ...clienteNovo, representante: e.target.value })} />
            </div>
            <div className="field">
              <label>Desconto padrão (ex: 5% à vista)</label>
              <input className="input" value={clienteNovo.descontoPadrao}
                onChange={(e) => setClienteNovo({ ...clienteNovo, descontoPadrao: e.target.value })}
                placeholder="Opcional" />
            </div>
          </div>
          <div className="row">
            <button className="btn btn-ghost btn-block" onClick={resetTudo}>Cancelar</button>
            <button className="btn btn-primary btn-block"
              onClick={() => setCliente({ ...clienteNovo, id: null })}>
              Usar estes dados no pedido
            </button>
          </div>
        </div>
      )}

      {cliente && (
        <>
          <div className="card">
            <h2 className="card-title">Cliente</h2>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "start" }}>
              <div>
                <strong style={{ fontSize: 16 }}>{cliente.nome}</strong>
                <div style={{ fontSize: 13, color: "var(--ink-soft)", marginTop: 4 }}>
                  Cód {cliente.codigo || "—"} · {cliente.cidade || "—"}/{cliente.estado || "—"}
                  {cliente.representante ? ` · Rep: ${cliente.representante}` : ""}
                  {cliente.descontoPadrao ? ` · Desc: ${cliente.descontoPadrao}` : ""}
                </div>
              </div>
              <button className="btn btn-ghost" onClick={resetTudo}>Trocar</button>
            </div>
          </div>

          <form className="card" onSubmit={handleSalvarPedido}>
            <h2 className="card-title">Pedido</h2>
            <div className="row">
              <div className="field">
                <label>Valor (R$) *</label>
                <input className="input" type="number" step="0.01" min="0" value={pedido.valor}
                  onChange={(e) => setPedido({ ...pedido, valor: e.target.value })} />
              </div>
              <div className="field">
                <label>Data</label>
                <input className="input" type="date" value={pedido.data}
                  onChange={(e) => setPedido({ ...pedido, data: e.target.value })} />
              </div>
            </div>

            <div className="field">
              <label>Desconto aplicado (opcional)</label>
              <input className="input" value={pedido.desconto}
                onChange={(e) => setPedido({ ...pedido, desconto: e.target.value })}
                placeholder="Ex: 5% à vista" />
            </div>

            <div className="field">
              <label>Forma de pagamento</label>
              <select className="input" value={pedido.formaPagamento}
                onChange={(e) => setPedido({ ...pedido, formaPagamento: e.target.value })}>
                {FORMAS_PAGAMENTO.map((f) => (
                  <option key={f.value} value={f.value}>{f.label}</option>
                ))}
              </select>
            </div>

            {pedido.formaPagamento === "cheque" && (
              <div className="row">
                <div className="field">
                  <label>Prazo total (dias)</label>
                  <input className="input" type="number" min="0" value={pedido.chequePrazoDias}
                    onChange={(e) => setPedido({ ...pedido, chequePrazoDias: e.target.value })} />
                </div>
                <div className="field">
                  <label>Número de parcelas</label>
                  <input className="input" type="number" min="1" value={pedido.chequeParcelas}
                    onChange={(e) => setPedido({ ...pedido, chequeParcelas: e.target.value })} />
                </div>
              </div>
            )}

            <div className="field">
              <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer" }}>
                <input type="checkbox" checked={pedido.jaPago}
                  onChange={(e) => setPedido({ ...pedido, jaPago: e.target.checked })} />
                Pagamento já recebido (senão fica em aberto em "Vales")
              </label>
            </div>

            <button className="btn btn-primary btn-block" type="submit" disabled={salvando}>
              {salvando ? "Salvando..." : "Lançar pedido"}
            </button>
          </form>
        </>
      )}
    </div>
  );
}
