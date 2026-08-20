import { initializeApp } from "firebase/app";
import {
  initializeFirestore, persistentLocalCache, persistentMultipleTabManager,
  collection, doc, setDoc, deleteDoc, addDoc, getDoc,
  onSnapshot, runTransaction,
} from "firebase/firestore";
import {
  getAuth, signInWithEmailAndPassword, createUserWithEmailAndPassword,
  signOut as firebaseSignOut, onAuthStateChanged,
} from "firebase/auth";
import { firebaseConfig } from "./firebaseConfig";

const app = initializeApp(firebaseConfig);

// Cache local persistente: o navegador guarda os dados já baixados no
// próprio aparelho. Numa segunda visita, a vitrine abre a partir do que
// está guardado e o Firestore busca só o que MUDOU desde então, em vez de
// baixar os ~1400 produtos de novo. É de longe a maior economia de
// leituras possível sem mexer em nenhuma funcionalidade — e de quebra a
// vitrine abre bem mais rápido no celular.
//
// persistentMultipleTabManager permite ter o site aberto em várias abas
// ao mesmo tempo compartilhando o mesmo cache (sem isso, a segunda aba
// falharia ao iniciar).
export const db = initializeFirestore(app, {
  localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
});
export const auth = getAuth(app);

/* ---------------- autenticação ---------------- */

export function subscribeAuth(callback) {
  return onAuthStateChanged(auth, callback);
}

export async function signIn(email, password) {
  await signInWithEmailAndPassword(auth, email, password);
}
export async function signUp(email, password) {
  await createUserWithEmailAndPassword(auth, email, password);
}
export async function signOutUser() {
  await firebaseSignOut(auth);
}

export function uid(prefix = "id") {
  return `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
}

/* ---------------- produtos ---------------- */

export function subscribeProducts(callback, onError) {
  return onSnapshot(
    collection(db, "products"),
    (snap) => callback(snap.docs.map((d) => ({ id: d.id, ...d.data() }))),
    (err) => { console.error("produtos:", err); onError && onError(err); }
  );
}

export async function saveProduct(product) {
  const id = product.id || uid("p");
  const { id: _drop, __duplicate, ...data } = { ...product, id };
  // createdAt é gravado só na primeira vez — é ele que define o que é
  // "novidade" no catálogo. updatedAt muda a cada edição, então não
  // serviria (um produto antigo editado hoje viraria novidade).
  const payload = { ...data, updatedAt: Date.now() };
  if (!data.createdAt) payload.createdAt = Date.now();
  await setDoc(doc(db, "products", id), payload);
}

export async function deleteProduct(id) {
  await deleteDoc(doc(db, "products", id));
}

export async function setProductActive(product, active) {
  await saveProduct({ ...product, active });
}

/* ---------------- categorias ---------------- */

export function subscribeCategories(callback, onError) {
  return onSnapshot(
    collection(db, "categories"),
    (snap) => callback(snap.docs.map((d) => ({ id: d.id, ...d.data() }))),
    (err) => { console.error("categorias:", err); onError && onError(err); }
  );
}

export async function saveCategory(category) {
  const id = category.id || uid("cat");
  const { id: _drop, ...data } = { ...category, id };
  await setDoc(doc(db, "categories", id), data);
  return id;
}

export async function deleteCategory(id) {
  await deleteDoc(doc(db, "categories", id));
}

/* ---------------- pedidos (painel) ---------------- */

// Sem orderBy na consulta: documentos antigos sem "createdAt" seriam
// silenciosamente excluídos pela ordenação. Ordenamos no navegador.
function sortByDateDesc(list) {
  return list.slice().sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
}

export function subscribeOrders(callback, onError) {
  return onSnapshot(
    collection(db, "orders"),
    (snap) => callback(sortByDateDesc(snap.docs.map((d) => ({ id: d.id, ...d.data() })))),
    (err) => { console.error("pedidos:", err); onError && onError(err); }
  );
}

export const ORDER_STATUSES = [
  { id: "aberto", label: "Em aberto" },
  { id: "enviado", label: "Enviado" },
];

export async function updateOrderStatus(orderId, status) {
  await setDoc(doc(db, "orders", orderId), { status }, { merge: true });
}

/* ---------------- histórico do cliente ----------------
   Guardado numa subcoleção do próprio cliente:
   customers/{uid}/orders

   Isso é o que torna a listagem segura: a regra do Firestore compara
   só o {uid} do caminho com o usuário logado, sem precisar avaliar
   documento por documento — que é exatamente o que quebrava antes.
-------------------------------------------------------- */

export function subscribeMyOrders(userId, callback, onError) {
  if (!userId) { callback([]); return () => {}; }
  return onSnapshot(
    collection(db, "customers", userId, "orders"),
    (snap) => callback(sortByDateDesc(snap.docs.map((d) => ({ id: d.id, ...d.data() })))),
    (err) => { console.error("meus pedidos:", err); onError && onError(err); }
  );
}

/* ---------------- criação de pedido ---------------- */

async function nextOrderNumber() {
  const counterRef = doc(db, "meta", "counter");
  const year = new Date().getFullYear();
  const n = await runTransaction(db, async (tx) => {
    const snap = await tx.get(counterRef);
    const current = snap.exists() ? snap.data().value || 0 : 0;
    const next = current + 1;
    tx.set(counterRef, { value: next });
    return next;
  });
  return `EGI-${year}-${String(n).padStart(5, "0")}`;
}

export async function createOrder(orderData) {
  const orderNumber = await nextOrderNumber();
  const full = {
    ...orderData,
    orderNumber,
    createdAt: Date.now(),
    status: "aberto",
    userId: orderData.userId || null,
  };
  const ref = await addDoc(collection(db, "orders"), full);

  // Se a cliente estiver logada, guarda uma cópia no histórico dela.
  // Se falhar, não atrapalha: o pedido já foi registrado acima.
  if (orderData.userId) {
    try {
      await setDoc(doc(db, "customers", orderData.userId, "orders", ref.id), full);
    } catch (e) {
      console.error("Não foi possível salvar no histórico do cliente:", e);
    }
  }

  // Se o documento informado é um CNPJ, busca cidade/estado sozinho numa
  // fonte pública (sem custo, sem chave de API) — a cliente não precisa
  // digitar nada. Roda em segundo plano, sem atrasar a confirmação do
  // pedido nem quebrar o checkout se a busca falhar.
  autoFillLocationFromDocument(orderData.phone, orderData.document);

  return { ...full, id: ref.id };
}

/* ---------------- contagem de itens vendidos ----------------
   Calculado no navegador a partir dos pedidos já carregados.
   Não grava nada no banco.
------------------------------------------------------------- */

export function computeSalesByProduct(orders) {
  const map = {};
  (orders || []).forEach((order) => {
    (order.items || []).forEach((it) => {
      const key = it.productId || it.code;
      if (!key) return;
      if (!map[key]) {
        map[key] = { code: it.code, name: it.name, qty: 0, revenue: 0, byVariation: {} };
      }
      const q = Number(it.qty) || 0;
      map[key].qty += q;
      map[key].revenue += (Number(it.price) || 0) * q;
      const vKey = it.variation || "Padrão";
      map[key].byVariation[vKey] = (map[key].byVariation[vKey] || 0) + q;
    });
  });
  return Object.values(map).sort((a, b) => b.qty - a.qty);
}

/* ---------------- clientes (CRM simples, montado a partir dos pedidos) ---------------- */
// Agrupa os pedidos por telefone (é o dado mais confiável e sempre
// preenchido, já que CPF/CNPJ às vezes vem com formatação diferente e
// nem todo pedido tem conta de cliente vinculada).

function normalizePhone(phone) {
  return String(phone || "").replace(/\D/g, "");
}

export function computeCustomers(orders, importedClients) {
  const map = {};
  (orders || []).forEach((order) => {
    const key = normalizePhone(order.phone) || `sem-telefone-${order.companyName || "desconhecido"}`;
    if (!map[key]) {
      map[key] = {
        key, phone: order.phone, companyName: order.companyName, document: order.document,
        orders: [], orderCount: 0, totalSpent: 0, lastOrderAt: 0,
      };
    }
    const c = map[key];
    c.orders.push(order);
    c.orderCount += 1;
    c.totalSpent += Number(order.total) || 0;
    if ((order.createdAt || 0) > c.lastOrderAt) {
      c.lastOrderAt = order.createdAt || 0;
      c.companyName = order.companyName || c.companyName;
      c.phone = order.phone || c.phone;
      c.document = order.document || c.document;
    }
  });

  // clientes importados por planilha que ainda não fizeram nenhum pedido
  // pelo portal também aparecem — com pedidos zerados — em vez de
  // ficarem escondidos até a primeira compra.
  (importedClients || []).forEach((cl) => {
    const key = normalizePhone(cl.phone) || cl.id;
    if (!map[key]) {
      map[key] = {
        key, phone: cl.phone, companyName: cl.companyName, document: cl.document,
        orders: [], orderCount: 0, totalSpent: 0, lastOrderAt: 0,
      };
    } else {
      map[key].companyName = map[key].companyName || cl.companyName;
      map[key].document = map[key].document || cl.document;
    }
  });

  return Object.values(map).sort((a, b) => b.lastOrderAt - a.lastOrderAt);
}

/* ---------------- diretório de clientes (cadastro manual/importado) ----------------
   Guarda clientes que você já tinha antes do portal, mesmo que ainda não
   tenham feito nenhum pedido por aqui. Fica numa coleção própria
   ("clients"), separada de "customers/{uid}/orders" (que é o histórico
   de pedidos do cliente logado — outra coisa).
--------------------------------------------------------------- */

export function subscribeClients(callback, onError) {
  return onSnapshot(
    collection(db, "clients"),
    (snap) => callback(snap.docs.map((d) => ({ id: d.id, ...d.data() }))),
    (err) => { console.error("clients:", err); onError && onError(err); }
  );
}

export async function saveClient(client) {
  const key = normalizePhone(client.phone) || client.id || uid("cli");
  const { id: _drop, ...data } = { ...client, id: key };
  await setDoc(doc(db, "clients", key), data, { merge: true });
  return key;
}

// importação em massa: cria/atualiza o cadastro do cliente e, se vier
// cidade/estado na planilha, preenche isso também (sem sobrescrever o
// que já estiver salvo manualmente).
export async function bulkImportClients(rows) {
  const results = [];
  for (const row of rows) {
    const phone = String(row.phone || "").trim();
    const companyName = String(row.companyName || "").trim();
    const document = String(row.document || "").trim();
    const city = String(row.city || "").trim();
    const state = String(row.state || "").trim();
    if (!phone && !companyName) continue;
    const key = await saveClient({ companyName, phone, document });
    if (city || state) {
      const existing = await getDoc(doc(db, "customerInfo", key));
      if (!existing.exists() || (!existing.data().city && !existing.data().state)) {
        await saveCustomerLocation(key, { city, state });
      }
    }
    results.push({ key, companyName, phone, document, city, state });
  }
  return results;
}

/* ---------------- localização do cliente (cidade/estado) ----------------
   Guardado à parte dos pedidos, numa coleção "customerInfo" indexada pela
   mesma chave usada em computeCustomers (telefone normalizado). Pode ser
   preenchido automaticamente (CNPJ) ou editado manualmente pelo admin.
--------------------------------------------------------------- */

export function subscribeCustomerInfo(callback, onError) {
  return onSnapshot(
    collection(db, "customerInfo"),
    (snap) => {
      const map = {};
      snap.docs.forEach((d) => { map[d.id] = d.data(); });
      callback(map);
    },
    (err) => { console.error("customerInfo:", err); onError && onError(err); }
  );
}

export async function saveCustomerLocation(key, data) {
  if (!key) return;
  await setDoc(doc(db, "customerInfo", key), data, { merge: true });
}

function onlyDigits(v) { return String(v || "").replace(/\D/g, ""); }

// Busca cidade, estado, telefone registrado e situação cadastral na
// Receita (via BrasilAPI, pública e gratuita) a partir de um CNPJ. Não
// existe equivalente para CPF (dado de pessoa física é protegido) — nesse
// caso o admin ajusta manualmente no painel.
export async function lookupCnpjInfo(document) {
  const digits = onlyDigits(document);
  if (digits.length !== 14) return null;
  try {
    const res = await fetch(`https://brasilapi.com.br/api/cnpj/v1/${digits}`);
    if (!res.ok) return null;
    const data = await res.json();
    if (!data.municipio && !data.descricao_situacao_cadastral) return null;
    const phone = data.ddd_telefone_1 ? String(data.ddd_telefone_1).trim() : "";
    return {
      city: data.municipio || "",
      state: data.uf || "",
      phoneCnpj: phone,
      cnpjStatus: data.descricao_situacao_cadastral || "",
    };
  } catch (e) {
    console.warn("Não foi possível consultar o CNPJ:", e);
    return null;
  }
}

async function autoFillLocationFromDocument(phone, document) {
  try {
    const key = normalizePhone(phone);
    if (!key) return;
    const digits = onlyDigits(document);
    if (digits.length !== 14) return; // só CNPJ tem consulta pública
    // não sobrescreve se já existe algo salvo (ex: admin já ajustou)
    const existing = await getDoc(doc(db, "customerInfo", key));
    if (existing.exists() && (existing.data().city || existing.data().state)) return;
    const info = await lookupCnpjInfo(document);
    if (info) await saveCustomerLocation(key, info);
  } catch (e) {
    console.warn("autoFillLocationFromDocument:", e);
  }
}

// remove o cadastro extra do cliente (nome/telefone/cidade/estado
// guardados à parte) — os pedidos já feitos continuam existindo; se a
// mesma pessoa comprar de novo, ela reaparece na lista automaticamente.
export async function deleteClientRecord(key) {
  if (!key) return;
  await Promise.all([
    deleteDoc(doc(db, "clients", key)).catch(() => {}),
    deleteDoc(doc(db, "customerInfo", key)).catch(() => {}),
  ]);
}

/* ---------------- grupos de cliente ----------------
   Junta vários telefones/CNPJs (ex: matriz e filiais da mesma empresa,
   ou a mesma pessoa comprando com documentos diferentes) sob um nome só.
--------------------------------------------------------------- */

export function subscribeClientGroups(callback, onError) {
  return onSnapshot(
    collection(db, "clientGroups"),
    (snap) => callback(snap.docs.map((d) => ({ id: d.id, ...d.data() }))),
    (err) => { console.error("clientGroups:", err); onError && onError(err); }
  );
}

export async function saveClientGroup(group) {
  const id = group.id || uid("grp");
  const { id: _drop, ...data } = { ...group, id };
  await setDoc(doc(db, "clientGroups", id), data);
  return id;
}

export async function deleteClientGroup(id) {
  await deleteDoc(doc(db, "clientGroups", id));
}

/* ---------------- importação em massa (planilha) ---------------- */

export async function bulkImportProducts(rows) {
  const results = [];
  for (const row of rows) {
    const product = {
      id: uid("p"),
      code: String(row.code || "").trim(),
      name: String(row.name || "").trim(),
      category: String(row.category || "Diversos").trim(),
      subcategory: "",
      unit: String(row.unit || "").trim(),
      basePrice: Number(row.price) || 0,
      packageQty: "",
      images: [],
      description: "",
      variations: [],
      active: true,
    };
    await saveProduct(product);
    results.push(product);
  }
  return results;
}
