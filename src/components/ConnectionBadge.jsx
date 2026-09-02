import { useConnectionStatus } from "../lib/connectionStatus";
import "./ConnectionBadge.css";

const CONFIG = {
  offline: { label: "Sem conexão", dotClass: "dot-red" },
  syncing: { label: "Sincronizando…", dotClass: "dot-yellow" },
  synced: { label: "Sincronizado", dotClass: "dot-green" },
};

export default function ConnectionBadge() {
  const { syncStatus } = useConnectionStatus();
  const { label, dotClass } = CONFIG[syncStatus];

  // Quando está tudo sincronizado, não precisa gritar isso na tela o
  // tempo todo — só mostra um pontinho verde discreto. Offline e
  // sincronizando aparecem com texto, porque são os estados que o
  // usuário realmente precisa notar.
  const showLabel = syncStatus !== "synced";

  return (
    <span
      className={"connection-badge" + (showLabel ? " connection-badge-alert" : "")}
      title={
        syncStatus === "offline"
          ? "Sem internet — os dados ficam salvos neste aparelho e sincronizam sozinhos quando a conexão voltar"
          : syncStatus === "syncing"
          ? "Conectado de novo — enviando o que ficou pendente"
          : "Tudo sincronizado com o servidor"
      }
    >
      <span className={"connection-dot " + dotClass} />
      {showLabel && <span className="connection-label">{label}</span>}
    </span>
  );
}
