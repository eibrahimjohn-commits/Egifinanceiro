import { CONTAS_PADRAO } from "../lib/constants";

export default function CampoConta({ conta, setConta, identificacao, setIdentificacao }) {
  return (
    <>
      <div className="field">
        <label>Conta</label>
        <select className="input" value={conta} onChange={(e) => setConta(e.target.value)}>
          <option value="">Selecione...</option>
          {CONTAS_PADRAO.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
      </div>
      {conta === "Terceiros" && (
        <div className="field">
          <label>Identificação</label>
          <input className="input" value={identificacao} onChange={(e) => setIdentificacao(e.target.value)}
            placeholder="Nome da pessoa/conta de terceiro" />
        </div>
      )}
    </>
  );
}
