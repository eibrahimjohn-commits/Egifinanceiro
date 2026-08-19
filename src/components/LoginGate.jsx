import { useState } from "react";
import { SITE_PASSWORD } from "../sitePassword";
import "./ui.css";

const SESSION_KEY = "egiFinanceiroAuth";

export function estaAutenticado() {
  return sessionStorage.getItem(SESSION_KEY) === "ok";
}

export default function LoginGate({ onEntrar }) {
  const [senha, setSenha] = useState("");
  const [erro, setErro] = useState(false);

  function handleSubmit(e) {
    e.preventDefault();
    if (senha === SITE_PASSWORD) {
      sessionStorage.setItem(SESSION_KEY, "ok");
      onEntrar();
    } else {
      setErro(true);
    }
  }

  return (
    <div style={{
      minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center",
      background: "linear-gradient(135deg, var(--pink), var(--grape))", padding: 20,
    }}>
      <form onSubmit={handleSubmit} className="card" style={{ maxWidth: 340, width: "100%" }}>
        <h2 className="card-title" style={{ textAlign: "center" }}>EGI Financeiro</h2>
        <div className="field">
          <label>Senha de acesso</label>
          <input
            className="input"
            type="password"
            autoFocus
            value={senha}
            onChange={(e) => { setSenha(e.target.value); setErro(false); }}
          />
          {erro && <div style={{ color: "var(--red)", fontSize: 13, marginTop: 6 }}>Senha incorreta</div>}
        </div>
        <button className="btn btn-primary btn-block" type="submit">Entrar</button>
      </form>
    </div>
  );
}
