import { useEffect, useState } from "react";
import { onSnapshotsInSync } from "firebase/firestore";
import { db } from "./firebase";

/**
 * Estado de conexão do app, combinando duas coisas:
 *
 * 1. `online` — o navegador tem internet agora (navigator.onLine + eventos
 *    online/offline). Isso é só sobre a rede, não sobre o Firestore.
 *
 * 2. `syncStatus` — o que o Firestore está fazendo com os dados locais:
 *      "synced"  → tudo que foi lido/escrito localmente já foi confirmado
 *                  pelo servidor (estado normal, não precisa mostrar nada)
 *      "syncing" → a internet voltou e o Firestore está enviando/buscando
 *                  o que ficou pendente enquanto estava offline
 *      "offline" → sem internet; leituras vêm do cache local e qualquer
 *                  escrita fica na fila até a conexão voltar
 *
 * Isso é o suficiente pra um app pequeno: não precisamos contar quantos
 * documentos estão pendentes, só avisar com honestidade "isso ainda não
 * chegou no servidor" sempre que fizer sentido.
 */
export function useConnectionStatus() {
  const [online, setOnline] = useState(navigator.onLine);
  const [syncStatus, setSyncStatus] = useState(
    navigator.onLine ? "synced" : "offline"
  );

  useEffect(() => {
    function handleOnline() {
      setOnline(true);
      // Assim que a internet volta, ainda não sabemos se o Firestore já
      // terminou de sincronizar o que ficou pendente — só quando
      // onSnapshotsInSync disparar de novo é que sabemos que sim.
      setSyncStatus("syncing");
    }
    function handleOffline() {
      setOnline(false);
      setSyncStatus("offline");
    }

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);

    // Dispara toda vez que o cache local e o servidor ficam alinhados —
    // inclusive logo depois de reconectar e terminar de mandar as
    // alterações pendentes.
    const unsubscribe = onSnapshotsInSync(db, () => {
      setSyncStatus((prev) => (prev === "offline" ? prev : "synced"));
    });

    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
      unsubscribe();
    };
  }, []);

  return { online, syncStatus };
}
