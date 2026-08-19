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

// CNAEs comuns pro ramo da EGI (bijuterias, cosméticos, armarinho, presentes).
// O campo aceita digitar outro código também.
export const CNAES_SUGERIDOS = [
  { codigo: "4772500", label: "4772-5/00 · Perfumaria e cosméticos" },
  { codigo: "4789005", label: "4789-0/05 · Bijuterias e artesanato" },
  { codigo: "4783101", label: "4783-1/01 · Artigos de joalheria" },
  { codigo: "4783102", label: "4783-1/02 · Artigos de bijuteria e relógios" },
  { codigo: "4755502", label: "4755-5/02 · Armarinho" },
  { codigo: "4761003", label: "4761-0/03 · Papelaria" },
  { codigo: "4772500", label: "4772-5/00 · Cosméticos, perfumaria e higiene" },
];

// Busca empresas na API pública Base Empresarial (dados abertos da Receita Federal).
// Sem chave, sem cadastro. Como não consegui testar o formato exato de resposta,
// essa função tenta reconhecer variações comuns de nomes de campo.
export async function buscarEmpresas({ cidadeNome, cnae }) {
  const params = new URLSearchParams();
  if (cnae) params.append("cnaes[]", cnae);
  params.append("per_page", "50");
  if (cidadeNome) params.append("city", cidadeNome);

  const url = `https://app.baseempresarial.com.br/api/v1/establishments?${params.toString()}`;
  const resp = await fetch(url);
  if (!resp.ok) {
    throw new Error(`A busca falhou (${resp.status}). Tente novamente ou ajuste os filtros.`);
  }
  const data = await resp.json();

  const bruto = data.data || data.results || data.items || (Array.isArray(data) ? data : []);

  return bruto.map((e) => ({
    cnpj: e.cnpj || e.cnpj_completo || "",
    razaoSocial: e.razao_social || e.razaoSocial || e.nome || "",
    nomeFantasia: e.nome_fantasia || e.nomeFantasia || "",
    cidade: e.municipio || e.city || e.cidade || cidadeNome || "",
    estado: e.uf || e.estado || "",
    cnae: e.cnae_principal?.codigo || e.cnae || cnae || "",
    telefone: e.telefone || e.ddd_telefone_1 || "",
    situacaoCadastral: e.situacao_cadastral || e.descricao_situacao_cadastral || "",
    _bruto: e,
  }));
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
