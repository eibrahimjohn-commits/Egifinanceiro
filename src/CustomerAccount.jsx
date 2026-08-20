import React, { useState, useEffect } from "react";
import { X } from "lucide-react";
import { signIn, signUp, subscribeMyOrders } from "./data";
import {
  PALETTE, currency, LoadingBlock, EmptyState, Field,
  btnPrimary, inputBase, iconBtn, overlayStyle, modalStyle, modalHeaderStyle,
} from "./shared";

export function AuthModal({ onClose }) {
  const [mode, setMode] = useState("entrar");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setError("");
    if (!email.trim() || !password) { setError("Preencha e-mail e senha."); return; }
    if (mode === "criar" && password.length < 6) { setError("A senha precisa ter pelo menos 6 caracteres."); return; }
    setBusy(true);
    try {
      if (mode === "entrar") await signIn(email.trim(), password);
      else await signUp(email.trim(), password);
      onClose();
    } catch (err) {
      console.error(err);
      const code = err?.code || "";
      if (code.includes("email-already-in-use")) setError("Esse e-mail já tem cadastro. Tente entrar.");
      else if (code.includes("invalid-credential") || code.includes("wrong-password") || code.includes("user-not-found")) setError("E-mail ou senha incorretos.");
      else if (code.includes("invalid-email")) setError("E-mail inválido.");
      else setError("Não foi possível continuar. Tente novamente.");
      setBusy(false);
    }
  };

  return (
    <div style={overlayStyle} onClick={busy ? undefined : onClose}>
      <div style={{ ...modalStyle, maxWidth: 400 }} onClick={(e) => e.stopPropagation()}>
        <div style={modalHeaderStyle}>
          <h2 className="egi-display" style={{ margin: 0, fontSize: 19, fontWeight: 700 }}>
            {mode === "entrar" ? "Entrar na sua conta" : "Criar conta"}
          </h2>
          {!busy && <button onClick={onClose} style={iconBtn}><X size={18} /></button>}
        </div>
        <div style={{ padding: 24 }} className="egi-sans">
          <p style={{ fontSize: 12.5, color: "#8a7a6f", marginTop: 0, marginBottom: 18, lineHeight: 1.5 }}>
            A conta é opcional — serve só para você acompanhar seus pedidos anteriores. Dá para comprar normalmente sem entrar.
          </p>
          <Field label="E-mail">
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} style={inputBase} autoFocus />
          </Field>
          <div style={{ marginTop: 12 }}>
            <Field label="Senha">
              <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} style={inputBase}
                onKeyDown={(e) => e.key === "Enter" && submit()} />
            </Field>
          </div>
          {error && <div style={{ color: PALETTE.bad, fontSize: 13, marginTop: 12 }}>{error}</div>}
          <button onClick={submit} disabled={busy} style={{ ...btnPrimary, width: "100%", justifyContent: "center", marginTop: 18, opacity: busy ? 0.7 : 1 }}>
            {busy ? "Aguarde..." : mode === "entrar" ? "Entrar" : "Criar conta"}
          </button>
          <button
            onClick={() => { setMode(mode === "entrar" ? "criar" : "entrar"); setError(""); }}
            style={{ background: "none", border: "none", cursor: "pointer", width: "100%", marginTop: 14, fontSize: 12.5, color: PALETTE.plum, textDecoration: "underline" }}
          >
            {mode === "entrar" ? "Ainda não tenho conta — criar agora" : "Já tenho conta — entrar"}
          </button>
        </div>
      </div>
    </div>
  );
}

export function MyOrdersModal({ user, onClose }) {
  const [orders, setOrders] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    return subscribeMyOrders(user.uid, setOrders, () => {
      setError("Não foi possível carregar seu histórico agora.");
      setOrders([]);
    });
  }, [user.uid]);

  return (
    <div style={overlayStyle} onClick={onClose}>
      <div style={{ ...modalStyle, maxWidth: 560 }} onClick={(e) => e.stopPropagation()}>
        <div style={modalHeaderStyle}>
          <h2 className="egi-display" style={{ margin: 0, fontSize: 19, fontWeight: 700 }}>Meus pedidos</h2>
          <button onClick={onClose} style={iconBtn}><X size={18} /></button>
        </div>
        <div style={{ padding: 20, overflowY: "auto" }} className="egi-sans">
          {error && <div style={{ color: PALETTE.bad, fontSize: 13, marginBottom: 12 }}>{error}</div>}
          {orders === null ? (
            <LoadingBlock label="Carregando..." />
          ) : orders.length === 0 ? (
            <EmptyState text="Você ainda não tem pedidos registrados nesta conta. Pedidos feitos sem estar logado não aparecem aqui." />
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              {orders.map((o) => (
                <div key={o.id} style={{ background: "#fff", border: `1px solid ${PALETTE.line}`, borderRadius: 12, padding: 16 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: 8, marginBottom: 8 }}>
                    <div>
                      <div style={{ fontWeight: 700, fontSize: 14, color: PALETTE.plum }}>#{o.orderNumber}</div>
                      <div style={{ fontSize: 11.5, color: "#8a7a6f" }}>{new Date(o.createdAt).toLocaleString("pt-BR")}</div>
                    </div>
                    <div style={{ textAlign: "right" }}>
                      <StatusBadge status={o.status} />
                      <div style={{ fontWeight: 700, fontSize: 15, marginTop: 4 }}>{currency(o.total)}</div>
                    </div>
                  </div>
                  <div style={{ borderTop: `1px dashed ${PALETTE.line}`, paddingTop: 8, display: "flex", flexDirection: "column", gap: 3 }}>
                    {(o.items || []).map((it, i) => (
                      <div key={i} style={{ fontSize: 12.5, display: "flex", justifyContent: "space-between", gap: 10 }}>
                        <span>{it.qty}x {it.name}{it.variation ? ` (${it.variation})` : ""}</span>
                        <span>{currency(it.price * it.qty)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function StatusBadge({ status }) {
  const enviado = status === "enviado";
  return (
    <span className="egi-sans" style={{
      display: "inline-block", padding: "3px 10px", borderRadius: 999, fontSize: 11, fontWeight: 700,
      background: enviado ? "#e6f0e8" : "#f5efe2",
      color: enviado ? PALETTE.good : PALETTE.brass,
      border: `1px solid ${enviado ? PALETTE.good : PALETTE.brass}`,
    }}>
      {enviado ? "Enviado" : "Em aberto"}
    </span>
  );
}
