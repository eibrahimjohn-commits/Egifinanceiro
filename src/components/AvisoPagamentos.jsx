import { useEffect, useState } from "react";
import { listarRecorrentes } from "../lib/pagamentosRecorrentes";
import { todayISO } from "../lib/constants";

// Tag amarela na faixa do topo: avisa que tem conta recorrente vencendo hoje
// ou já vencida. "Atrasado" tem prioridade sobre "hoje". Recarrega a cada 30
// min (e quando a janela volta pro foco) pra não ficar presa num dia antigo.
export default function AvisoPagamentos({ onIr }) {
  const [aviso, setAviso] = useState(null);

  useEffect(() => {
    let ativo = true;
    async function checar() {
      try {
        const lista = await listarRecorrentes();
        if (!ativo) return;
        const hoje = todayISO();
        const atrasados = lista.filter((r) => r.proximoVencimento && r.proximoVencimento < hoje);
        const doDia = lista.filter((r) => r.proximoVencimento === hoje);
        if (atrasados.length) setAviso({ texto: "Pagamento Atrasado", qtd: atrasados.length });
        else if (doDia.length) setAviso({ texto: "Pagamentos Hoje", qtd: doDia.length });
        else setAviso(null);
      } catch {
        // offline ou sem permissão: não mostra nada
      }
    }
    checar();
    const timer = setInterval(checar, 30 * 60 * 1000);
    window.addEventListener("focus", checar);
    return () => { ativo = false; clearInterval(timer); window.removeEventListener("focus", checar); };
  }, []);

  if (!aviso) return null;
  return (
    <button type="button" className="aviso-pagamentos" onClick={onIr}
      title="Ver os pagamentos recorrentes">
      ⚠ {aviso.texto}{aviso.qtd > 1 ? ` (${aviso.qtd})` : ""}
    </button>
  );
}
