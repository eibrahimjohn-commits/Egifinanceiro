const MESES = [
  "Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho",
  "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro",
];

function partes(mesStr) {
  const [ano, mes] = mesStr.split("-").map(Number);
  return { ano, mes };
}

function montar(ano, mes) {
  return `${ano}-${String(mes).padStart(2, "0")}`;
}

// anoMinimo: normalmente o ano do histórico mais antigo já importado, pra não
// listar décadas de opções vazias no dropdown.
export default function SeletorPeriodo({ mesInicio, mesFim, onChange, anoMinimo }) {
  const anoAtual = new Date().getFullYear();
  const primeiroAno = Math.min(anoMinimo || anoAtual - 3, anoAtual);
  const anos = [];
  for (let a = anoAtual; a >= primeiroAno; a--) anos.push(a);

  const ini = partes(mesInicio);
  const fim = partes(mesFim);

  function atalho(mesesAtras) {
    const fimD = new Date();
    const iniD = new Date();
    iniD.setMonth(iniD.getMonth() - mesesAtras);
    onChange(montar(iniD.getFullYear(), iniD.getMonth() + 1), montar(fimD.getFullYear(), fimD.getMonth() + 1));
  }

  function esteAno() {
    onChange(montar(anoAtual, 1), montar(anoAtual, new Date().getMonth() + 1));
  }

  function anoPassado() {
    onChange(montar(anoAtual - 1, 1), montar(anoAtual - 1, 12));
  }

  function tudo() {
    onChange(montar(primeiroAno, 1), montar(anoAtual, new Date().getMonth() + 1));
  }

  return (
    <div className="card">
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 12 }}>
        <button type="button" className="btn btn-ghost" style={{ fontSize: 12, padding: "6px 10px" }} onClick={() => atalho(2)}>Últimos 3 meses</button>
        <button type="button" className="btn btn-ghost" style={{ fontSize: 12, padding: "6px 10px" }} onClick={() => atalho(11)}>Últimos 12 meses</button>
        <button type="button" className="btn btn-ghost" style={{ fontSize: 12, padding: "6px 10px" }} onClick={esteAno}>Este ano</button>
        <button type="button" className="btn btn-ghost" style={{ fontSize: 12, padding: "6px 10px" }} onClick={anoPassado}>Ano passado</button>
        <button type="button" className="btn btn-ghost" style={{ fontSize: 12, padding: "6px 10px" }} onClick={tudo}>Todo o histórico</button>
      </div>
      <div className="row" style={{ alignItems: "flex-end" }}>
        <div className="field">
          <label>De</label>
          <div style={{ display: "flex", gap: 6 }}>
            <select className="input" value={ini.mes} onChange={(e) => onChange(montar(ini.ano, Number(e.target.value)), mesFim)}>
              {MESES.map((m, i) => <option key={i} value={i + 1}>{m}</option>)}
            </select>
            <select className="input" style={{ maxWidth: 100 }} value={ini.ano} onChange={(e) => onChange(montar(Number(e.target.value), ini.mes), mesFim)}>
              {anos.map((a) => <option key={a} value={a}>{a}</option>)}
            </select>
          </div>
        </div>
        <div className="field">
          <label>Até</label>
          <div style={{ display: "flex", gap: 6 }}>
            <select className="input" value={fim.mes} onChange={(e) => onChange(mesInicio, montar(fim.ano, Number(e.target.value)))}>
              {MESES.map((m, i) => <option key={i} value={i + 1}>{m}</option>)}
            </select>
            <select className="input" style={{ maxWidth: 100 }} value={fim.ano} onChange={(e) => onChange(mesInicio, montar(Number(e.target.value), fim.mes))}>
              {anos.map((a) => <option key={a} value={a}>{a}</option>)}
            </select>
          </div>
        </div>
      </div>
    </div>
  );
}
