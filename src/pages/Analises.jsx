import { useEffect, useState } from "react";
import "../components/ui.css";
import { listarPedidos } from "../lib/pedidos";
import { listarClientes } from "../lib/clientes";
import { formatCurrency, formatDate, pedidoEstaAtrasado } from "../lib/constants";

const DIAS_INATIVO = 60;

export default function Analises() {
  const [pedidos, setPedidos] = useState([]);
  const [clientes, setClientes] = useState([]);
  const [carregando, setCarregando] = useState(true);

  useEffect(() => {
    (async () => {
      setCarregando(true);
      const [p, c] = await Promise.all([listarPedidos(), listarClientes()]);
      setPedidos(p);
      setClientes(c);
      setCarregando(false);
    })();
  }, []);

  if (carregando) return <div className="empty-state">Carregando análises...</div>;

  const hoje = new Date();

  // Clientes com pagamento atrasado (parcela de cheque com data já vencida)
  const atrasados = pedidos.filter(pedidoEstaAtrasado);

  // Clientes inativos: última compra há mais de 60 dias, sem vale em aberto
  const ultimaCompraPorCliente = {};
  pedidos.forEach((p) => {
    const atual = ultimaCompraPorCliente[p.clienteId];
    if (!atual || new Date(p.data) > new Date(atual)) {
      ultimaCompraPorCliente[p.clienteId] = p.data;
    }
  });
  const temValeAberto = new Set(pedidos.filter((p) => p.status === "aberto").map((p) => p.clienteId));

  const inativos = clientes.filter((c) => {
    if (temValeAberto.has(c.id)) return false;
    // se já sabemos que o CNPJ não está ativo (baixado/suspenso), não faz sentido
    // sinalizar como "parou de comprar" — a empresa nem existe mais oficialmente
    const situacao = (c.infoExtra?.situacaoCadastral || "").toUpperCase();
    if (situacao && !situacao.includes("ATIVA")) return false;
    // considera tanto pedidos lançados no sistema quanto a data vinda da planilha
    const doSistema = ultimaCompraPorCliente[c.id];
    const daPlanilha = c.ultimaCompraPlanilha;
    const ultima = doSistema && daPlanilha
      ? (doSistema > daPlanilha ? doSistema : daPlanilha)
      : (doSistema || daPlanilha);
    if (!ultima) return false; // nunca comprou - não é "parou de comprar"
    const dias = (hoje - new Date(ultima)) / 86400000;
    return dias >= DIAS_INATIVO;
  });

  // Heatmap simples por cidade/estado (contagem de pedidos)
  const porCidade = {};
  pedidos.forEach((p) => {
    const chave = `${p.clienteCidade || "?"}/${p.clienteEstado || "?"}`;
    porCidade[chave] = (porCidade[chave] || 0) + Number(p.valor || 0);
  });
  const cidadesOrdenadas = Object.entries(porCidade).sort((a, b) => b[1] - a[1]).slice(0, 10);
  const maxValor = cidadesOrdenadas[0]?.[1] || 1;

  return (
    <div>
      <div className="analises-grid">
        <div className="card">
          <h2 className="card-title">Pagamentos atrasados ({atrasados.length})</h2>
          <div className="analises-col-scroll">
            {atrasados.length === 0 ? (
              <div className="empty-state" style={{ padding: 12 }}>Nenhum pagamento atrasado.</div>
            ) : (
              atrasados.map((p) => (
                <div key={p.id} className="list-item">
                  <div>
                    <strong>{p.clienteNome}</strong>
                    <div style={{ fontSize: 13, color: "var(--ink-soft)" }}>
                      Pedido em {formatDate(p.data)} · {formatCurrency(Number(p.valorDevido ?? p.valor) - Number(p.valorPago || 0))}
                    </div>
                  </div>
                  <span className="badge badge-atraso">Atrasado</span>
                </div>
              ))
            )}
          </div>
        </div>

        <div className="card">
          <h2 className="card-title">Clientes inativos (+{DIAS_INATIVO} dias, sem pendências)</h2>
          <div className="analises-col-scroll">
            {inativos.length === 0 ? (
              <div className="empty-state" style={{ padding: 12 }}>Nenhum cliente inativo no momento.</div>
            ) : (
              inativos.map((c) => (
                <div key={c.id} className="list-item">
                  <div>
                    <strong>{c.nome}</strong>
                    <div style={{ fontSize: 13, color: "var(--ink-soft)" }}>
                      Última compra: {formatDate(ultimaCompraPorCliente[c.id])}
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        <div className="card">
          <h2 className="card-title">Mapa de calor — por cidade/estado</h2>
          <div className="analises-col-scroll">
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
      </div>

      <div className="card">
        <h2 className="card-title">Importar planilha histórica</h2>
        <div className="empty-state" style={{ padding: 12 }}>
          Em breve: upload da sua planilha atual para carga inicial e comparação de dados. Podemos construir essa parte na sequência.
        </div>
      </div>
    </div>
  );
}
