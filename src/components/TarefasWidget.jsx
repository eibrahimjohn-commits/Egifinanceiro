import { useEffect, useRef, useState } from "react";
import { listarTarefas, criarTarefa, marcarTarefa, excluirTarefa } from "../lib/tarefas";
import { todayISO, formatDate } from "../lib/constants";

// Painel de tarefas/anotações estilo "Lembretes" do celular — fica ao lado
// da marca "EGI Financeiro". Texto livre, data opcional, marca como feita
// (some da lista, com "desfazer" logo depois) ou apaga de vez.
export default function TarefasWidget() {
  const [aberto, setAberto] = useState(false);
  const [tarefas, setTarefas] = useState([]);
  const [carregado, setCarregado] = useState(false);
  const [texto, setTexto] = useState("");
  const [data, setData] = useState("");
  const [verConcluidas, setVerConcluidas] = useState(false);
  const ref = useRef(null);

  async function carregar() {
    setTarefas(await listarTarefas());
    setCarregado(true);
  }
  useEffect(() => { carregar(); }, []);

  // fecha ao clicar fora
  useEffect(() => {
    function aoClicarFora(e) {
      if (ref.current && !ref.current.contains(e.target)) setAberto(false);
    }
    if (aberto) document.addEventListener("mousedown", aoClicarFora);
    return () => document.removeEventListener("mousedown", aoClicarFora);
  }, [aberto]);

  async function adicionar() {
    const limpo = texto.trim();
    if (!limpo) return;
    setTexto("");
    const dataEscolhida = data;
    setData("");
    const idTemp = "tmp_" + Date.now();
    setTarefas((t) => [...t, { id: idTemp, texto: limpo, dataVencimento: dataEscolhida || null, feita: false }]);
    const idReal = await criarTarefa({ texto: limpo, dataVencimento: dataEscolhida || null });
    setTarefas((t) => t.map((x) => (x.id === idTemp ? { ...x, id: idReal } : x)));
  }

  async function alternar(id, feita) {
    setTarefas((t) => t.map((x) => (x.id === id ? { ...x, feita } : x)));
    await marcarTarefa(id, feita);
  }

  async function apagar(id) {
    setTarefas((t) => t.filter((x) => x.id !== id));
    await excluirTarefa(id);
  }

  const hoje = todayISO();
  const pendentes = tarefas.filter((t) => !t.feita).sort((a, b) => {
    // com data primeiro (mais próxima primeiro), sem data por último
    if (a.dataVencimento && !b.dataVencimento) return -1;
    if (!a.dataVencimento && b.dataVencimento) return 1;
    if (!a.dataVencimento) return 0;
    return a.dataVencimento.localeCompare(b.dataVencimento);
  });
  const concluidas = tarefas.filter((t) => t.feita)
    .sort((a, b) => (b.concluidaEm?.seconds || 0) - (a.concluidaEm?.seconds || 0))
    .slice(0, 20);
  const vencidas = pendentes.filter((t) => t.dataVencimento && t.dataVencimento < hoje).length;

  return (
    <div ref={ref} style={{ position: "relative" }}>
      <button type="button" className="tarefas-botao" onClick={() => setAberto((a) => !a)} title="Tarefas e anotações">
        📝 Tarefas
        {carregado && pendentes.length > 0 && (
          <span className={"tarefas-contador" + (vencidas > 0 ? " tarefas-contador-atraso" : "")}>{pendentes.length}</span>
        )}
      </button>

      {aberto && (
        <div className="tarefas-painel">
          <div style={{ display: "flex", gap: 6, marginBottom: 10 }}>
            <input className="input" style={{ flex: 1, fontSize: 13, padding: "6px 8px" }} placeholder="Nova tarefa ou anotação..."
              value={texto} onChange={(e) => setTexto(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") adicionar(); }} autoFocus />
            <input type="date" className="input" style={{ width: 130, fontSize: 12, padding: "6px 8px" }}
              value={data} onChange={(e) => setData(e.target.value)} title="Data (opcional)" />
          </div>
          <button type="button" className="btn btn-primary btn-block" style={{ padding: "6px 10px", fontSize: 13, marginBottom: 10 }}
            onClick={adicionar} disabled={!texto.trim()}>
            Adicionar
          </button>

          <div style={{ maxHeight: 320, overflowY: "auto", display: "flex", flexDirection: "column", gap: 6 }}>
            {!carregado ? (
              <div style={{ fontSize: 12, color: "var(--ink-soft)", textAlign: "center", padding: 10 }}>Carregando...</div>
            ) : pendentes.length === 0 ? (
              <div style={{ fontSize: 12, color: "var(--ink-soft)", textAlign: "center", padding: 10 }}>Nenhuma tarefa pendente 🎉</div>
            ) : (
              pendentes.map((t) => {
                const atrasada = t.dataVencimento && t.dataVencimento < hoje;
                const ehHoje = t.dataVencimento === hoje;
                return (
                  <div key={t.id} style={{ display: "flex", alignItems: "flex-start", gap: 8, padding: "6px 4px", borderBottom: "1px solid var(--border)" }}>
                    <input type="checkbox" style={{ marginTop: 3, cursor: "pointer" }} checked={false} onChange={() => alternar(t.id, true)} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13, wordBreak: "break-word" }}>{t.texto}</div>
                      {t.dataVencimento && (
                        <div style={{ fontSize: 11, color: atrasada ? "var(--red)" : ehHoje ? "#9a6b00" : "var(--ink-soft)" }}>
                          {atrasada ? "Atrasada · " : ehHoje ? "Hoje · " : ""}{formatDate(t.dataVencimento)}
                        </div>
                      )}
                    </div>
                    <button type="button" className="btn btn-ghost" style={{ padding: "2px 6px", fontSize: 12, color: "var(--red)" }}
                      onClick={() => apagar(t.id)} title="Excluir">🗑</button>
                  </div>
                );
              })
            )}
          </div>

          {concluidas.length > 0 && (
            <div style={{ marginTop: 10, borderTop: "1px solid var(--border)", paddingTop: 8 }}>
              <button type="button" className="btn btn-ghost" style={{ fontSize: 12, padding: "2px 4px" }}
                onClick={() => setVerConcluidas((v) => !v)}>
                {verConcluidas ? "▲" : "▼"} Concluídas ({concluidas.length})
              </button>
              {verConcluidas && (
                <div style={{ display: "flex", flexDirection: "column", gap: 4, marginTop: 6, maxHeight: 160, overflowY: "auto" }}>
                  {concluidas.map((t) => (
                    <div key={t.id} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: "var(--ink-soft)" }}>
                      <span style={{ flex: 1, textDecoration: "line-through", wordBreak: "break-word" }}>{t.texto}</span>
                      <button type="button" className="btn btn-ghost" style={{ padding: "1px 6px", fontSize: 11 }}
                        onClick={() => alternar(t.id, false)} title="Desfazer">↺</button>
                      <button type="button" className="btn btn-ghost" style={{ padding: "1px 6px", fontSize: 11, color: "var(--red)" }}
                        onClick={() => apagar(t.id)} title="Excluir">🗑</button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
