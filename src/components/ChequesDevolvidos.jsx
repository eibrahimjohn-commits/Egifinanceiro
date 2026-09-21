import { useEffect, useState } from "react";
import {
  listarChequesDevolvidos, listarChequesDoCliente, registrarChequeDevolvido,
  registrarPagamentoChequeDevolvido, MOTIVOS_DEVOLUCAO,
} from "../lib/chequesDevolvidos";
import { formatCurrency, formatDate, todayISO, FORMAS_PAGAMENTO } from "../lib/constants";
import CampoConta from "./CampoConta";

const FORMAS_COM_CONTA = ["pix_ted", "deposito"];

export default function ChequesDevolvidos({ clientes, pedidos, mostrarToast, onMudou }) {
  const [cheques, setCheques] = useState([]);
  const [carregando, setCarregando] = useState(true);
  const [mostrarForm, setMostrarForm] = useState(false);
  const [busca, setBusca] = useState("");
  const [filtro, setFiltro] = useState("aberto"); // aberto | pago | todos

  async function carregar() {
    setCarregando(true);
    const lista = await listarChequesDevolvidos();
    setCheques(lista);
    setCarregando(false);
    onMudou?.(lista); // mantém os cards roxos da aba Vales em dia
  }
  useEffect(() => { carregar(); }, []);

  const visiveis = cheques.filter((c) => {
    if (filtro !== "todos" && c.status !== filtro) return false;
    if (busca && !c.clienteNome?.toLowerCase().includes(busca.toLowerCase())) return false;
    return true;
  });

  const totalAberto = cheques.filter((c) => c.status === "aberto").reduce((s, c) => s + (c.valorCheque - (c.valorPago || 0)), 0);

  return (
    <div>
      <div className="card" style={{ display: "flex", gap: 24, flexWrap: "wrap", alignItems: "center" }}>
        <div>
          <div style={{ fontSize: 13, color: "var(--ink-soft)" }}>Total em aberto (cheques devolvidos)</div>
          <strong style={{ fontSize: 22, color: "var(--red)" }}>{formatCurrency(totalAberto)}</strong>
        </div>
        <button className="btn btn-primary" style={{ marginLeft: "auto" }} onClick={() => setMostrarForm((v) => !v)}>
          {mostrarForm ? "Cancelar" : "+ Registrar cheque devolvido"}
        </button>
      </div>

      {mostrarForm && (
        <FormularioNovoCheque
          clientes={clientes} pedidos={pedidos}
          onSalvo={() => { setMostrarForm(false); carregar(); mostrarToast("Cheque devolvido registrado."); }}
        />
      )}

      <div className="card" style={{ padding: 12 }}>
        <div className="row">
          <div className="field">
            <input className="input" placeholder="Buscar por cliente..." value={busca} onChange={(e) => setBusca(e.target.value)} />
          </div>
          <div className="field" style={{ maxWidth: 200 }}>
            <select className="input" value={filtro} onChange={(e) => setFiltro(e.target.value)}>
              <option value="aberto">Em aberto</option>
              <option value="pago">Pagos</option>
              <option value="todos">Todos</option>
            </select>
          </div>
        </div>
      </div>

      {carregando ? (
        <div className="empty-state">Carregando...</div>
      ) : visiveis.length === 0 ? (
        <div className="empty-state">Nenhum cheque devolvido {filtro === "aberto" ? "em aberto" : filtro === "pago" ? "pago" : "registrado"}.</div>
      ) : (
        <div className="lista-grid">
          {visiveis.map((c) => (
            <CardChequeDevolvido key={c.id} cheque={c} onAtualizado={carregar} mostrarToast={mostrarToast} />
          ))}
        </div>
      )}
    </div>
  );
}

function FormularioNovoCheque({ clientes, pedidos, onSalvo }) {
  const [buscaCliente, setBuscaCliente] = useState("");
  const [clienteSelecionado, setClienteSelecionado] = useState(null);
  const [chequeSelecionado, setChequeSelecionado] = useState(null);
  const [valorManual, setValorManual] = useState("");
  const [dataManual, setDataManual] = useState("");
  const [fornecedor, setFornecedor] = useState("");
  const [motivo, setMotivo] = useState("sem_fundo");
  const [motivoDetalhe, setMotivoDetalhe] = useState("");
  const [dataRegistro, setDataRegistro] = useState(todayISO());
  const [salvando, setSalvando] = useState(false);

  const sugestoes = buscaCliente.length >= 2
    ? clientes.filter((c) => c.nome?.toLowerCase().includes(buscaCliente.toLowerCase())).slice(0, 8)
    : [];

  const pedidosDoCliente = clienteSelecionado
    ? pedidos.filter((p) => p.clienteId === clienteSelecionado.id
        || (clienteSelecionado.grupo && p.clienteGrupo?.trim().toLowerCase() === clienteSelecionado.grupo.trim().toLowerCase()))
    : [];
  const chequesConhecidos = clienteSelecionado ? listarChequesDoCliente(pedidosDoCliente) : [];

  function selecionarCliente(c) {
    setClienteSelecionado(c);
    setBuscaCliente(c.nome);
    setChequeSelecionado(null);
    setValorManual("");
    setDataManual("");
  }

  async function salvar() {
    const valor = chequeSelecionado && chequeSelecionado !== "manual" ? chequeSelecionado.valor : Number(valorManual);
    const data = chequeSelecionado && chequeSelecionado !== "manual" ? chequeSelecionado.data : dataManual;
    if (!clienteSelecionado) { alert("Selecione o cliente."); return; }
    if (!valor || valor <= 0) { alert("Informe o valor do cheque."); return; }
    if (!data) { alert("Informe a data do cheque."); return; }

    setSalvando(true);
    try {
      await registrarChequeDevolvido({
        clienteId: clienteSelecionado.id,
        clienteNome: clienteSelecionado.nome,
        clienteGrupo: clienteSelecionado.grupo || "",
        clienteRepresentante: clienteSelecionado.representante || "",
        valorCheque: valor,
        dataCheque: data,
        fornecedor,
        motivo,
        motivoDetalhe,
        dataRegistro,
      });
      onSalvo();
    } finally {
      setSalvando(false);
    }
  }

  return (
    <div className="card" style={{ background: "var(--bg)" }}>
      <h3 style={{ fontSize: 14, marginBottom: 10 }}>Registrar cheque devolvido</h3>

      <div className="field" style={{ position: "relative" }}>
        <label>Cliente</label>
        <input className="input" value={buscaCliente}
          onChange={(e) => { setBuscaCliente(e.target.value); setClienteSelecionado(null); }}
          placeholder="Buscar por nome..." />
        {sugestoes.length > 0 && !clienteSelecionado && (
          <div style={{ position: "absolute", zIndex: 5, background: "white", border: "1px solid var(--border)", borderRadius: 10, marginTop: 4, width: "100%", maxHeight: 220, overflowY: "auto" }}>
            {sugestoes.map((c) => (
              <div key={c.id} style={{ padding: "8px 12px", cursor: "pointer", fontSize: 13 }} onClick={() => selecionarCliente(c)}>
                {c.nome} {c.grupo && <span style={{ color: "var(--ink-soft)" }}>· {c.grupo}</span>}
              </div>
            ))}
          </div>
        )}
      </div>

      {clienteSelecionado && (
        <>
          <div className="field">
            <label>Qual cheque voltou</label>
            {chequesConhecidos.length > 0 ? (
              <div style={{ border: "1px solid var(--border)", borderRadius: 10, maxHeight: 180, overflowY: "auto" }}>
                {chequesConhecidos.map((ch, i) => (
                  <div key={i}
                    onClick={() => setChequeSelecionado(ch)}
                    style={{
                      padding: "8px 12px", cursor: "pointer", fontSize: 13,
                      background: chequeSelecionado === ch ? "var(--pink-light)" : "transparent",
                      borderBottom: i < chequesConhecidos.length - 1 ? "1px solid var(--border)" : "none",
                    }}>
                    {formatDate(ch.data)} · {formatCurrency(ch.valor)} <span style={{ color: "var(--ink-soft)" }}>({ch.origem})</span>
                  </div>
                ))}
                <div onClick={() => setChequeSelecionado("manual")}
                  style={{ padding: "8px 12px", cursor: "pointer", fontSize: 13, color: "var(--grape)", background: chequeSelecionado === "manual" ? "var(--pink-light)" : "transparent" }}>
                  Não está na lista — informar manualmente
                </div>
              </div>
            ) : (
              <div style={{ fontSize: 12, color: "var(--ink-soft)", marginBottom: 6 }}>
                Nenhum cheque encontrado nos pedidos desse cliente — informe manualmente abaixo.
              </div>
            )}
          </div>

          {(chequeSelecionado === "manual" || (chequesConhecidos.length === 0 && !chequeSelecionado)) && (
            <div className="row">
              <div className="field">
                <label>Valor do cheque</label>
                <input className="input" type="number" step="0.01" value={valorManual} onChange={(e) => setValorManual(e.target.value)} />
              </div>
              <div className="field">
                <label>Data do cheque</label>
                <input className="input" type="date" value={dataManual} onChange={(e) => setDataManual(e.target.value)} />
              </div>
            </div>
          )}

          <div className="row">
            <div className="field">
              <label>Motivo</label>
              <select className="input" value={motivo} onChange={(e) => setMotivo(e.target.value)}>
                {MOTIVOS_DEVOLUCAO.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
              </select>
            </div>
            <div className="field">
              <label>Voltou via (fornecedor/banco), opcional</label>
              <input className="input" value={fornecedor} onChange={(e) => setFornecedor(e.target.value)}
                placeholder="Ex: repassado como pagamento ao Fornecedor X" />
            </div>
          </div>

          {motivo === "outro" && (
            <div className="field">
              <label>Detalhe do motivo</label>
              <input className="input" value={motivoDetalhe} onChange={(e) => setMotivoDetalhe(e.target.value)} />
            </div>
          )}

          <div className="field">
            <label>Data do registro</label>
            <input className="input" type="date" value={dataRegistro} onChange={(e) => setDataRegistro(e.target.value)} />
          </div>

          <button className="btn btn-primary btn-block" onClick={salvar} disabled={salvando}>
            {salvando ? "Registrando..." : "Registrar cheque devolvido"}
          </button>
        </>
      )}
    </div>
  );
}

function CardChequeDevolvido({ cheque, onAtualizado, mostrarToast }) {
  return (
    <div className="card" style={{ padding: 14 }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
        <strong>{cheque.clienteNome}</strong>
        <span className={"badge " + (cheque.status === "pago" ? "badge-pago" : "badge-atraso")}>
          {cheque.status === "pago" ? "Pago" : "Em aberto"}
        </span>
      </div>
      <DetalheChequeDevolvido cheque={cheque} onAtualizado={onAtualizado} mostrarToast={mostrarToast} />
    </div>
  );
}

// Informações + histórico + "Registrar pagamento" de um cheque devolvido.
// Usado aqui (sub-aba Cheques Devolvidos) e nos cards roxos da aba Vales.
export function DetalheChequeDevolvido({ cheque, onAtualizado, mostrarToast }) {
  const [abrindoBaixa, setAbrindoBaixa] = useState(false);
  const [valorBaixa, setValorBaixa] = useState("");
  const [dataBaixa, setDataBaixa] = useState(todayISO());
  const [formaBaixa, setFormaBaixa] = useState("pix_ted");
  const [contaBaixa, setContaBaixa] = useState("");
  const [contaBaixaId, setContaBaixaId] = useState("");
  const [salvando, setSalvando] = useState(false);

  const saldo = cheque.valorCheque - (cheque.valorPago || 0);
  const motivoLabel = MOTIVOS_DEVOLUCAO.find((m) => m.value === cheque.motivo)?.label || cheque.motivo;

  async function confirmar() {
    if (!valorBaixa || Number(valorBaixa) <= 0) { mostrarToast("Informe um valor válido"); return; }
    setSalvando(true);
    try {
      await registrarPagamentoChequeDevolvido(cheque.id, cheque, {
        valor: Number(valorBaixa), data: dataBaixa, formaPagamento: formaBaixa,
        conta: contaBaixa ? `${contaBaixa}${contaBaixaId ? " - " + contaBaixaId : ""}` : "",
      });
      mostrarToast("Pagamento registrado!");
      setAbrindoBaixa(false);
      onAtualizado();
    } finally {
      setSalvando(false);
    }
  }

  return (
    <div onClick={(e) => e.stopPropagation()}>
      <div style={{ fontSize: 13, color: "var(--ink-soft)", margin: "6px 0" }}>
        Cheque de {formatDate(cheque.dataCheque)} · {formatCurrency(cheque.valorCheque)}
      </div>
      <div style={{ fontSize: 13 }}>
        Motivo: <strong>{motivoLabel}</strong>{cheque.motivoDetalhe && ` — ${cheque.motivoDetalhe}`}
      </div>
      {cheque.fornecedor && <div style={{ fontSize: 13, color: "var(--ink-soft)" }}>Via: {cheque.fornecedor}</div>}
      <div style={{ fontSize: 13, marginTop: 4 }}>Registrado em {formatDate(cheque.dataRegistro)}</div>

      {cheque.status === "aberto" && (
        <div style={{ fontSize: 13, marginTop: 6 }}>Saldo em aberto: <strong>{formatCurrency(saldo)}</strong></div>
      )}

      {cheque.pagamentos?.length > 0 && (
        <div style={{ marginTop: 8, borderTop: "1px solid var(--border)", paddingTop: 8 }}>
          {cheque.pagamentos.map((pg, i) => (
            <div key={i} style={{ fontSize: 12, color: "var(--ink-soft)" }}>
              {formatDate(pg.data)} · {pg.formaPagamento} · {formatCurrency(pg.valor)}
            </div>
          ))}
        </div>
      )}

      {cheque.status === "aberto" && (
        abrindoBaixa ? (
          <div style={{ marginTop: 10, borderTop: "1px solid var(--border)", paddingTop: 10 }}>
            <div className="row">
              <div className="field">
                <label>Valor recebido</label>
                <input className="input" type="number" step="0.01" value={valorBaixa} onChange={(e) => setValorBaixa(e.target.value)} />
              </div>
              <div className="field">
                <label>Data</label>
                <input className="input" type="date" value={dataBaixa} onChange={(e) => setDataBaixa(e.target.value)} />
              </div>
            </div>
            <div className="field">
              <label>Forma de pagamento</label>
              <select className="input" value={formaBaixa} onChange={(e) => setFormaBaixa(e.target.value)}>
                {FORMAS_PAGAMENTO.map((f) => <option key={f.value} value={f.value}>{f.label}</option>)}
              </select>
            </div>
            {FORMAS_COM_CONTA.includes(formaBaixa) && (
              <CampoConta conta={contaBaixa} setConta={setContaBaixa} identificacao={contaBaixaId} setIdentificacao={setContaBaixaId} />
            )}
            <div style={{ display: "flex", gap: 8 }}>
              <button className="btn btn-primary" onClick={confirmar} disabled={salvando}>
                {salvando ? "Salvando..." : "Confirmar"}
              </button>
              <button className="btn btn-ghost" onClick={() => setAbrindoBaixa(false)}>Cancelar</button>
            </div>
          </div>
        ) : (
          <button className="btn btn-secondary btn-block" style={{ marginTop: 10 }} onClick={() => setAbrindoBaixa(true)}>
            Registrar pagamento
          </button>
        )
      )}
    </div>
  );
}
