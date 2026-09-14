import { useRegisterSW } from "virtual:pwa-register/react";

// Verifica por atualização a cada 30 minutos, além da checagem automática
// que já acontece ao abrir o app. Útil pra quem deixa a aba aberta o dia
// inteiro sem recarregar.
const INTERVALO_CHECAGEM_MS = 30 * 60 * 1000;

export default function AtualizarApp() {
  const {
    needRefresh: [needRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    onRegisteredSW(swUrl, registration) {
      if (!registration) return;
      setInterval(() => registration.update(), INTERVALO_CHECAGEM_MS);
    },
  });

  if (!needRefresh) return null;

  return (
    <button
      type="button"
      onClick={() => updateServiceWorker(true)}
      style={{
        background: "white",
        color: "var(--pink)",
        border: "none",
        borderRadius: 999,
        padding: "6px 14px",
        fontSize: 12,
        fontWeight: 700,
        cursor: "pointer",
        whiteSpace: "nowrap",
      }}
      title="Uma versão nova já foi baixada — clique pra usar"
    >
      🔄 Nova versão disponível — Atualizar
    </button>
  );
}
