import { Component } from "react";

// Sem isso, um erro de JavaScript em QUALQUER parte da tela — mesmo algo
// pequeno, tipo uma conta com data inválida no meio da digitação — apagava a
// página inteira e deixava só o fundo branco, sem pista nenhuma do que
// aconteceu. Agora mostra uma mensagem com o erro (pra poder tirar print e
// mandar pra correção) e um botão de recarregar, sem perder o que já foi
// salvo no banco até ali.
export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { erro: null };
  }

  static getDerivedStateFromError(erro) {
    return { erro };
  }

  componentDidCatch(erro, info) {
    console.error("Erro capturado pelo ErrorBoundary:", erro, info);
  }

  render() {
    if (!this.state.erro) return this.props.children;
    return (
      <div style={{
        minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center",
        padding: 24, fontFamily: "system-ui, sans-serif", background: "#fdf2f2",
      }}>
        <div style={{ maxWidth: 480, background: "white", borderRadius: 16, padding: 28, boxShadow: "0 8px 30px rgba(0,0,0,0.12)" }}>
          <div style={{ fontSize: 32, marginBottom: 8 }}>⚠️</div>
          <h1 style={{ fontSize: 18, marginBottom: 8 }}>Algo deu errado nessa tela</h1>
          <p style={{ fontSize: 14, color: "#555", marginBottom: 16 }}>
            Nada que já foi salvo se perdeu. Recarregue a página — se continuar travando no mesmo
            lugar, tire um print desta mensagem (incluindo o texto técnico abaixo) e mande pra correção.
          </p>
          <button type="button" onClick={() => window.location.reload()}
            style={{ background: "#dc2626", color: "white", border: "none", borderRadius: 8, padding: "10px 18px", fontSize: 14, cursor: "pointer", marginBottom: 16 }}>
            Recarregar
          </button>
          <details style={{ fontSize: 12, color: "#888" }}>
            <summary style={{ cursor: "pointer" }}>Detalhes técnicos</summary>
            <pre style={{ whiteSpace: "pre-wrap", wordBreak: "break-word", marginTop: 8 }}>
              {String(this.state.erro?.message || this.state.erro)}
              {this.state.erro?.stack ? `\n\n${this.state.erro.stack}` : ""}
            </pre>
          </details>
        </div>
      </div>
    );
  }
}
