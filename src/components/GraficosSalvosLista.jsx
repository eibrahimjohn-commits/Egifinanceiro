import { useEffect, useState } from "react";
import { listarGraficosSalvos, excluirGraficoSalvo } from "../lib/graficosSalvos";
import { formatDate } from "../lib/constants";

function formatarMes(mes) {
  if (!mes) return "";
  const [ano, m] = mes.split("-");
  return `${m}/${ano}`;
}

function rotuloPeriodo(g) {
  return g.mesInicio === g.mesFim ? formatarMes(g.mesInicio) : `${formatarMes(g.mesInicio)} a ${formatarMes(g.mesFim)}`;
}

export default function GraficosSalvosLista({ tipo, onAbrir }) {
  const [lista, setLista] = useState([]);
  const [carregando, setCarregando] = useState(true);

  async function carregar() {
    setCarregando(true);
    setLista(await listarGraficosSalvos(tipo));
    setCarregando(false);
  }
  useEffect(() => { carregar(); }, [tipo]);

  async function excluir(id) {
    await excluirGraficoSalvo(id);
    carregar();
  }

  if (carregando) return <div className="empty-state">Carregando...</div>;
  if (lista.length === 0) {
    return <div className="empty-state">Nenhum gráfico salvo ainda — toda vez que você visualiza um período aqui, ele fica guardado automaticamente pra abrir de novo sem gastar consulta.</div>;
  }

  return (
    <div className="lista-grid">
      {lista.map((g) => (
        <div key={g.id} className="card" style={{ padding: 14 }}>
          <strong>{rotuloPeriodo(g)}</strong>
          {g.comparacoes?.length > 0 && (
            <div style={{ fontSize: 12, color: "var(--ink-soft)", marginTop: 4 }}>
              Comparando com: {g.comparacoes.map((c, i) => <span key={i}>{i > 0 && ", "}{rotuloPeriodo(c)}</span>)}
            </div>
          )}
          <div style={{ fontSize: 12, color: "var(--ink-soft)", marginTop: 4 }}>
            {g.atualizadoEm?.seconds && `Última vez visto: ${formatDate(new Date(g.atualizadoEm.seconds * 1000).toISOString().slice(0, 10))}`}
          </div>
          <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
            <button className="btn btn-primary" style={{ fontSize: 12, padding: "6px 12px" }}
              onClick={() => onAbrir(g)}>
              Abrir
            </button>
            <button className="btn btn-ghost" style={{ fontSize: 12, padding: "6px 12px", color: "var(--red)" }}
              onClick={() => excluir(g.id)}>
              Excluir
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
