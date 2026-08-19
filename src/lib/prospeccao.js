import {
  collection,
  doc,
  getDocs,
  addDoc,
  updateDoc,
  query,
  orderBy,
  serverTimestamp,
} from "firebase/firestore";
import { db } from "./firebase";
import { onlyDigits } from "./clientes";

const prospeccoesRef = collection(db, "prospeccoes");

// CNAEs do varejo que compra bijuteria/cosmético/acessório no atacado.
export const CNAES_SUGERIDOS = [
  { codigo: "4789005", label: "Bijuterias e artesanato (4789-0/05)" },
  { codigo: "4783102", label: "Bijuterias e relógios (4783-1/02)" },
  { codigo: "4772500", label: "Cosméticos e perfumaria (4772-5/00)" },
  { codigo: "4781400", label: "Vestuário e acessórios (4781-4/00)" },
  { codigo: "4755502", label: "Armarinho (4755-5/02)" },
  { codigo: "4783101", label: "Joalheria (4783-1/01)" },
  { codigo: "4761003", label: "Papelaria (4761-0/03)" },
  { codigo: "9602501", label: "Salão de beleza (9602-5/01)" },
  { codigo: "", label: "Todos os ramos" },
];

// Busca empresas através do nosso proxy serverless (/api/buscar-empresas).
// O proxy roda no servidor da Vercel, o que evita o bloqueio de CORS do navegador.
export async function buscarEmpresas({ cidadeNome, uf, cnae, pagina = 1 }) {
  const params = new URLSearchParams();
  if (cidadeNome) params.append("cidade", cidadeNome);
  if (uf) params.append("uf", uf);
  if (cnae) params.append("cnae", cnae);
  params.append("pagina", String(pagina));

  const resp = await fetch(`/api/buscar-empresas?${params.toString()}`);
  const data = await resp.json();

  if (!resp.ok) {
    const detalhe = data?.tentativas
      ? " Detalhe técnico: " + JSON.stringify(data.tentativas).slice(0, 400)
      : "";
    throw new Error((data?.erro || `Falha na busca (${resp.status}).`) + detalhe);
  }

  return data.empresas || [];
}

export async function listarProspeccoes() {
  const snap = await getDocs(query(prospeccoesRef, orderBy("criadoEm", "desc")));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

export async function salvarProspeccao(empresa) {
  const payload = {
    cnpj: empresa.cnpj,
    cnpjDigits: onlyDigits(empresa.cnpj),
    razaoSocial: empresa.razaoSocial || "",
    nomeFantasia: empresa.nomeFantasia || "",
    cidade: empresa.cidade || "",
    estado: empresa.estado || "",
    cnae: empresa.cnae || "",
    telefone: empresa.telefone || "",
    status: "novo",
    observacao: "",
    criadoEm: serverTimestamp(),
    atualizadoEm: serverTimestamp(),
  };
  const docRef = await addDoc(prospeccoesRef, payload);
  return docRef.id;
}

export async function atualizarProspeccao(id, dados) {
  await updateDoc(doc(db, "prospeccoes", id), { ...dados, atualizadoEm: serverTimestamp() });
}

export const STATUS_PROSPECCAO = [
  { value: "novo", label: "Novo", color: "var(--ink-soft)" },
  { value: "contato_iniciado", label: "Contato iniciado", color: "#9a6b00" },
  { value: "em_negociacao", label: "Em negociação", color: "var(--grape)" },
  { value: "convertido", label: "Convertido em cliente", color: "var(--green)" },
  { value: "descartado", label: "Descartado", color: "var(--red)" },
];
