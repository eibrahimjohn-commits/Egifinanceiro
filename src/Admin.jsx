import React, { useState, useEffect, useRef, Suspense, lazy } from "react";
import {
  Plus, Pencil, Trash2, X, Search, ClipboardList, Package, Store, Check, ImageOff,
  Tags, Upload, FileSpreadsheet, Loader2, ChevronRight as ChevronRightIcon, ChevronLeft as ChevronLeftIcon, Eye, EyeOff, Copy, Crop, LogOut, Lock, BarChart3, Printer, Download, Users, Phone, CreditCard, MapPin, UsersRound, Image as ImageIcon, Undo2, Sparkles, FileDown, Camera,
} from "lucide-react";
import {
  subscribeProducts, subscribeOrders, saveProduct, deleteProduct, uid,
  subscribeCategories, saveCategory, deleteCategory, bulkImportProducts, setProductActive,
  updateOrderStatus, computeSalesByProduct, computeCustomers,
  subscribeCustomerInfo, saveCustomerLocation, subscribeClientGroups, saveClientGroup, deleteClientGroup,
  subscribeClients, bulkImportClients, deleteClientRecord,
} from "./data";
import { ADMIN_PASSWORD } from "./adminPassword";
import FilterBar from "./FilterBar";
import { uploadImageToCloudinary } from "./uploadImage";
const ImageCropModal = lazy(() => import("./ImageCropModal"));
import { downloadAllPhotos } from "./bulkPhotoDownload";
import { bulkEnhancePhotos, bulkRevertPhotos } from "./bulkImageEnhance";
import { generateCatalogPdf, isHairOrBijuCategory } from "./catalogPdf";
import {
  PALETTE, currency, normalizeText, activeVariations, cld, CLD_THUMB, CLD_TINY, LoadingBlock, EmptyState, Field, ErrorBanner,
  btnPrimary, btnSecondarySmall, inputBase, inputSmall, iconBtn,
  overlayStyle, modalStyle, modalHeaderStyle, FONT_IMPORT,
} from "./shared";

const SESSION_KEY = "egi_admin_unlocked";

// toca um bipe curto quando chega pedido novo — não precisa de nenhum
// arquivo de áudio, é gerado na hora
function playOrderBeep() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    [880, 1175].forEach((freq, i) => {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.connect(g); g.connect(ctx.destination);
      o.type = "sine";
      o.frequency.value = freq;
      const start = ctx.currentTime + i * 0.16;
      g.gain.setValueAtTime(0.001, start);
      g.gain.exponentialRampToValueAtTime(0.18, start + 0.02);
      g.gain.exponentialRampToValueAtTime(0.001, start + 0.18);
      o.start(start);
      o.stop(start + 0.2);
    });
    setTimeout(() => ctx.close(), 500);
  } catch { /* navegador pode bloquear áudio sem interação prévia — sem problema */ }
}

export default function AdminApp() {
  // Trava simples por senha — nada de login/Firebase Auth aqui.
  // Fica "lembrado" só nesta aba do navegador (sessionStorage), então
  // fechar e reabrir o navegador pede a senha de novo.
  const [unlocked, setUnlocked] = useState(() => sessionStorage.getItem(SESSION_KEY) === "1");

  const [products, setProducts] = useState([]);
  const [orders, setOrders] = useState([]);
  const [categories, setCategories] = useState([]);
  const [customerInfo, setCustomerInfo] = useState({});
  const [groups, setGroups] = useState([]);
  const [importedClients, setImportedClients] = useState([]);
  const [tab, setTab] = useState("produtos");
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [editing, setEditing] = useState(null);
  const [importOpen, setImportOpen] = useState(false);
  const [loadingTimedOut, setLoadingTimedOut] = useState(false);
  const [newOrderAlert, setNewOrderAlert] = useState(null);
  const [notifPermission, setNotifPermission] = useState(
    typeof Notification !== "undefined" ? Notification.permission : "unsupported"
  );
  const seenOrderIds = useRef(new Set());
  const firstOrdersLoad = useRef(true);

  useEffect(() => {
    if (!loading) { setLoadingTimedOut(false); return; }
    const t = setTimeout(() => setLoadingTimedOut(true), 10000);
    return () => clearTimeout(t);
  }, [loading]);

  useEffect(() => {
    if (!unlocked) return;
    let got = { p: false };
    const check = () => { if (got.p) setLoading(false); };
    const onErr = (label) => (err) => {
      console.error(label, err);
      setLoadError(`Não foi possível carregar "${label}". Detalhe técnico: ${err?.code || err?.message || "erro desconhecido"}. As demais seções continuam funcionando.`);
      setLoading(false);
    };
    const safety = setTimeout(() => {
      if (!got.p) {
        setLoadError("A conexão com o banco de dados está demorando mais que o normal. Recarregue a página para tentar de novo.");
        setLoading(false);
      }
    }, 15000);
    const unsub1 = subscribeProducts((list) => { setProducts(list); got.p = true; check(); }, onErr("produtos"));
    const unsub2 = subscribeOrders((list) => {
      if (firstOrdersLoad.current) {
        list.forEach((o) => seenOrderIds.current.add(o.id));
        firstOrdersLoad.current = false;
      } else {
        const newOnes = list.filter((o) => !seenOrderIds.current.has(o.id));
        if (newOnes.length > 0) {
          newOnes.forEach((o) => seenOrderIds.current.add(o.id));
          const latest = newOnes.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))[0];
          setNewOrderAlert(latest);
          playOrderBeep();
          if (typeof Notification !== "undefined" && Notification.permission === "granted" && document.hidden) {
            try {
              new Notification("Novo pedido — EGI", { body: `#${latest.orderNumber} · ${currency(latest.total)}` });
            } catch { /* alguns navegadores podem recusar, sem problema */ }
          }
        }
      }
      setOrders(list);
    }, onErr("pedidos"));
    const unsub3 = subscribeCategories((list) => { setCategories(list); }, onErr("categorias"));
    return () => { clearTimeout(safety); unsub1(); unsub2(); unsub3(); };
  }, [unlocked]);

  // Dados de CRM (localização, grupos e clientes importados) ficam num
  // lugar só, compartilhados por Clientes e Regiões — antes cada aba
  // assinava as mesmas coleções por conta própria, relendo tudo a cada
  // troca de aba. Além disso, só carregam quando você realmente abre uma
  // dessas abas: quem só mexe em produtos e pedidos nunca paga por isso.
  const crmNeeded = tab === "clientes" || tab === "regioes";
  const [crmLoaded, setCrmLoaded] = useState(false);
  useEffect(() => {
    if (!unlocked || !crmNeeded || crmLoaded) return;
    setCrmLoaded(true);
  }, [unlocked, crmNeeded, crmLoaded]);

  useEffect(() => {
    if (!crmLoaded) return;
    const unsub1 = subscribeCustomerInfo(setCustomerInfo, () => {});
    const unsub2 = subscribeClientGroups(setGroups, () => {});
    const unsub3 = subscribeClients(setImportedClients, () => {});
    return () => { unsub1(); unsub2(); unsub3(); };
  }, [crmLoaded]);

  const handleSaveProduct = async (product) => { await saveProduct(product); setEditing(null); };
  const handleDeleteProduct = async (id) => { await deleteProduct(id); };
  const handleToggleActive = async (product) => { await setProductActive(product, product.active === false); };
  const handleDuplicate = (product) => {
    const clone = {
      ...product,
      id: uid("p"),
      code: product.code,
      name: product.name,
      variations: product.variations?.map((v) => ({ ...v, id: uid("v") })) || [],
      images: [...(product.images || [])],
      __duplicate: true,
    };
    setEditing(clone);
  };
  const handleLogout = () => {
    sessionStorage.removeItem(SESSION_KEY);
    setUnlocked(false);
  };

  if (!unlocked) {
    return <PasswordGate onUnlock={() => { sessionStorage.setItem(SESSION_KEY, "1"); setUnlocked(true); }} />;
  }

  return (
    <div style={{ fontFamily: "'Nunito', sans-serif", minHeight: "100vh", background: PALETTE.paper, color: PALETTE.ink }}>
      <style>{FONT_IMPORT}</style>
      <AdminHeader
        tab={tab} setTab={setTab} onLogout={handleLogout}
        notifPermission={notifPermission}
        onEnableNotifications={() => {
          if (typeof Notification === "undefined") return;
          Notification.requestPermission().then(setNotifPermission);
        }}
      />
      <ErrorBanner message={loadError} />
      {newOrderAlert && (
        <div className="egi-sans" style={{
          maxWidth: 1180, margin: "16px auto 0", padding: "0 20px",
        }}>
          <div style={{
            display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap",
            background: "#eef4ee", border: `1px solid ${PALETTE.good}`, borderRadius: 10, padding: "12px 16px",
          }}>
            <span style={{ fontSize: 20 }}>🔔</span>
            <div style={{ flex: 1, minWidth: 180 }}>
              <div style={{ fontWeight: 700, fontSize: 13.5, color: PALETTE.good }}>Novo pedido recebido!</div>
              <div style={{ fontSize: 12.5, color: "#5c4c43" }}>#{newOrderAlert.orderNumber} · {newOrderAlert.companyName} · {currency(newOrderAlert.total)}</div>
            </div>
            <button onClick={() => { setTab("pedidos"); setNewOrderAlert(null); }} style={btnSecondarySmall}>Ver pedido</button>
            <button onClick={() => setNewOrderAlert(null)} style={iconBtn}><X size={16} /></button>
          </div>
        </div>
      )}
      <main style={{ maxWidth: 1180, margin: "0 auto", padding: "28px 20px 80px" }}>
        {loading && loadingTimedOut ? (
          <div className="egi-sans" style={{ textAlign: "center", padding: "70px 20px", maxWidth: 460, margin: "0 auto" }}>
            <div style={{ width: 48, height: 48, borderRadius: "50%", background: PALETTE.bad, color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 16px" }}><Lock size={22} /></div>
            <div style={{ fontWeight: 700, fontSize: 16, marginBottom: 8 }}>Está demorando mais que o normal</div>
            <p style={{ fontSize: 13, color: "#8a7a6f", lineHeight: 1.6, marginBottom: 20 }}>
              Isso costuma ser a conexão com o banco de dados sendo bloqueada pela rede atual (Wi-Fi, antivírus ou operadora).
              Tente trocar de rede (ex: usar os dados móveis do celular) ou aguarde alguns segundos e tente de novo.
            </p>
            <button onClick={() => window.location.reload()} style={{ ...btnPrimary, width: "100%", justifyContent: "center" }}>Tentar novamente</button>
          </div>
        ) : loading ? (
          <LoadingBlock label="Carregando painel..." />
        ) : tab === "produtos" ? (
          <ProductsPanel
            products={products} categories={categories}
            onNew={() => setEditing("new")} onEdit={(p) => setEditing(p)} onDelete={handleDeleteProduct}
            onImport={() => setImportOpen(true)} onToggleActive={handleToggleActive} onDuplicate={handleDuplicate}
          />
        ) : tab === "categorias" ? (
          <CategoriesPanel categories={categories} />
        ) : tab === "vendidos" ? (
          <SalesPanel orders={orders} />
        ) : tab === "clientes" ? (
          <ClientsPanel orders={orders} customerInfo={customerInfo} groups={groups} importedClients={importedClients} />
        ) : tab === "regioes" ? (
          <RegionsPanel orders={orders} customerInfo={customerInfo} groups={groups} importedClients={importedClients} />
        ) : (
          <OrdersPanel orders={orders} />
        )}
      </main>
      {editing && (
        <ProductEditor
          key={editing === "new" ? "new" : editing.id}
          product={editing === "new" ? null : editing}
          categories={categories}
          onClose={() => setEditing(null)}
          onSave={handleSaveProduct}
        />
      )}
      {importOpen && <ImportModal onClose={() => setImportOpen(false)} />}
    </div>
  );
}

function PasswordGate({ onUnlock }) {
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");

  const submit = (e) => {
    e.preventDefault();
    if (password === ADMIN_PASSWORD) {
      onUnlock();
    } else {
      setError("Senha incorreta.");
    }
  };

  return (
    <div style={{ fontFamily: "'Nunito', sans-serif", minHeight: "100vh", background: PALETTE.ink, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
      <style>{FONT_IMPORT}</style>
      <form onSubmit={submit} className="egi-sans" style={{ background: PALETTE.paper, borderRadius: 16, padding: 32, width: "100%", maxWidth: 340, boxShadow: "0 20px 60px rgba(0,0,0,0.4)" }}>
        <div style={{ display: "flex", justifyContent: "center", marginBottom: 16 }}>
          <div style={{ width: 48, height: 48, borderRadius: "50%", background: PALETTE.brass, color: "#fff", display: "flex", alignItems: "center", justifyContent: "center" }}><Lock size={22} /></div>
        </div>
        <h1 className="egi-display" style={{ textAlign: "center", fontSize: 20, fontWeight: 700, margin: "0 0 4px" }}>Painel EGI</h1>
        <p style={{ textAlign: "center", fontSize: 12.5, color: "#8a7a6f", margin: "0 0 22px" }}>Acesso restrito à equipe interna</p>
        <Field label="Senha">
          <input type="password" value={password} onChange={(e) => { setPassword(e.target.value); setError(""); }} style={inputBase} autoFocus required />
        </Field>
        {error && <div style={{ color: PALETTE.bad, fontSize: 13, marginTop: 12 }}>{error}</div>}
        <button type="submit" style={{ ...btnPrimary, width: "100%", justifyContent: "center", marginTop: 18 }}>Entrar</button>
      </form>
    </div>
  );
}

function AdminHeader({ tab, setTab, onLogout, notifPermission, onEnableNotifications }) {
  return (
    <header style={{ background: PALETTE.ink, color: PALETTE.paper, borderBottom: `3px solid ${PALETTE.brass}` }}>
      <div style={{ maxWidth: 1180, margin: "0 auto", padding: "20px 20px 0", display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 12 }}>
        <div>
          <div className="egi-sans" style={{ fontSize: 11, letterSpacing: 2, color: PALETTE.brassLight, textTransform: "uppercase" }}>Painel interno</div>
          <div className="egi-display" style={{ fontSize: 30, fontWeight: 700 }}>Gestão EGI</div>
        </div>
        <a href="/" className="egi-sans" style={{ color: PALETTE.paper, opacity: 0.8, fontSize: 13, textDecoration: "none", display: "flex", alignItems: "center", gap: 6, border: `1px solid rgba(244,238,230,0.3)`, padding: "8px 14px", borderRadius: 999 }}>
          <Store size={15} /> Ver vitrine do cliente
        </a>
        {notifPermission !== "unsupported" && notifPermission !== "granted" && (
          <button onClick={onEnableNotifications} className="egi-sans" title="Receber aviso mesmo com o painel em segundo plano" style={{ color: PALETTE.paper, opacity: 0.8, fontSize: 13, background: "none", cursor: "pointer", display: "flex", alignItems: "center", gap: 6, border: `1px solid rgba(244,238,230,0.3)`, padding: "8px 14px", borderRadius: 999 }}>
            🔔 Ativar avisos
          </button>
        )}
        <button onClick={onLogout} className="egi-sans" style={{ color: PALETTE.paper, opacity: 0.8, fontSize: 13, background: "none", cursor: "pointer", display: "flex", alignItems: "center", gap: 6, border: `1px solid rgba(244,238,230,0.3)`, padding: "8px 14px", borderRadius: 999 }}>
          <LogOut size={15} /> Sair
        </button>
        <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
      </div>
      <nav className="egi-tabs-scroll" style={{ maxWidth: 1180, margin: "0 auto", padding: "18px 20px 0", display: "flex", gap: 4, overflowX: "auto", WebkitOverflowScrolling: "touch", scrollbarWidth: "none" }}>
        {[
          { id: "produtos", label: "Produtos", icon: Package },
          { id: "categorias", label: "Categorias", icon: Tags },
          { id: "pedidos", label: "Pedidos", icon: ClipboardList },
          { id: "clientes", label: "Clientes", icon: Users },
          { id: "regioes", label: "Regiões", icon: MapPin },
          { id: "vendidos", label: "Vendidos", icon: BarChart3 },
        ].map(({ id, label, icon: Icon }) => (
          <button key={id} onClick={() => setTab(id)} className="egi-sans" style={{
            display: "flex", alignItems: "center", gap: 8, padding: "10px 20px", border: "none", cursor: "pointer",
            background: tab === id ? PALETTE.paper : "transparent", color: tab === id ? PALETTE.ink : PALETTE.paper,
            borderRadius: "10px 10px 0 0", fontSize: 14, fontWeight: 600, opacity: tab === id ? 1 : 0.65,
            whiteSpace: "nowrap", flexShrink: 0,
          }}>
            <Icon size={16} /> {label}
          </button>
        ))}
      </nav>
      <style>{`.egi-tabs-scroll::-webkit-scrollbar { display: none; }`}</style>
    </header>
  );
}

function unitPriceOf(product) {
  const qty = Number(product.packageQty) || 1;
  if (qty <= 1) return null;
  return (Number(product.basePrice) || 0) / qty;
}

/* ==================== PRODUTOS ==================== */

function ProductsPanel({ products, categories, onNew, onEdit, onDelete, onImport, onToggleActive, onDuplicate }) {
  const [query, setQuery] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(null);
  const [showInactive, setShowInactive] = useState(false);
  const [onlyWithoutPhoto, setOnlyWithoutPhoto] = useState(false);
  const [selectedCategories, setSelectedCategories] = useState([]);
  const [subcategory, setSubcategory] = useState("Todas");
  const [sort, setSort] = useState("nome");
  const [photoConfirmOpen, setPhotoConfirmOpen] = useState(false);
  const [photoProgress, setPhotoProgress] = useState(null);
  const photoCancelRef = useRef(false);
  const [enhanceConfirmOpen, setEnhanceConfirmOpen] = useState(false);
  const [enhanceProgress, setEnhanceProgress] = useState(null);
  const enhanceCancelRef = useRef(false);
  const [revertConfirmOpen, setRevertConfirmOpen] = useState(false);
  const [revertProgress, setRevertProgress] = useState(null);
  const revertCancelRef = useRef(false);
  const [pdfProgress, setPdfProgress] = useState(null);
  const pdfCancelRef = useRef(false);
  const nq = normalizeText(query);
  const PHOTO_WARN_THRESHOLD = 100;

  const visibleByStatus = products.filter((p) => showInactive || p.active !== false);

  const topCategoryNames = React.useMemo(
    () => Array.from(new Set(visibleByStatus.map((p) => p.category).filter(Boolean))),
    [visibleByStatus]
  );
  const subcategoryNames = React.useMemo(() => {
    // subcategoria só faz sentido com exatamente uma categoria escolhida
    if (selectedCategories.length !== 1) return [];
    const cat = selectedCategories[0];
    const subs = Array.from(new Set(
      visibleByStatus.filter((p) => p.category === cat && p.subcategory).map((p) => p.subcategory)
    ));
    return subs.length ? ["Todas", ...subs] : [];
  }, [visibleByStatus, selectedCategories]);

  let filtered = visibleByStatus
    .filter((p) => normalizeText(p.name).includes(nq) || normalizeText(p.code).includes(nq))
    .filter((p) => selectedCategories.length === 0 || selectedCategories.includes(p.category))
    .filter((p) => subcategory === "Todas" || p.subcategory === subcategory)
    .filter((p) => !onlyWithoutPhoto || !((p.images?.length || 0) > 0 || p.image));

  const priceOf = (p) => (activeVariations(p).length ? Math.min(...activeVariations(p).map((v) => v.price)) : p.basePrice);
  if (sort === "nome") filtered = filtered.slice().sort((a, b) => a.name.localeCompare(b.name));
  if (sort === "preco_asc") filtered = filtered.slice().sort((a, b) => priceOf(a) - priceOf(b));
  if (sort === "preco_desc") filtered = filtered.slice().sort((a, b) => priceOf(b) - priceOf(a));
  if (sort === "categoria") filtered = filtered.slice().sort((a, b) => (a.category || "").localeCompare(b.category || ""));
  if (sort === "novidades") filtered = filtered.slice().sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));

  const requestPhotoDownload = () => {
    if (filtered.length === 0) return;
    setPhotoConfirmOpen(true);
  };
  const startPhotoDownload = async (hqOriginal) => {
    setPhotoConfirmOpen(false);
    photoCancelRef.current = false;
    setPhotoProgress({ current: 0, total: filtered.length });
    try {
      await downloadAllPhotos(filtered, {
        onProgress: (current, total) => setPhotoProgress({ current, total }),
        cancelRef: photoCancelRef,
        hqOriginal,
      });
    } catch (e) {
      console.error(e);
    } finally {
      setPhotoProgress(null);
    }
  };
  const cancelPhotoDownload = () => { photoCancelRef.current = true; };

  const requestPhotoEnhance = () => {
    if (filtered.length === 0) return;
    setEnhanceConfirmOpen(true);
  };
  const startPhotoEnhance = async ({ skipAlreadyDone, doText, doBackground }) => {
    setEnhanceConfirmOpen(false);
    enhanceCancelRef.current = false;
    setEnhanceProgress({ current: 0, total: filtered.length });
    try {
      await bulkEnhancePhotos(filtered, {
        onProgress: (current, total) => setEnhanceProgress({ current, total }),
        cancelRef: enhanceCancelRef,
        skipAlreadyDone,
        doText,
        doBackground,
      });
    } catch (e) {
      console.error(e);
    } finally {
      setEnhanceProgress(null);
    }
  };
  const cancelPhotoEnhance = () => { enhanceCancelRef.current = true; };

  const requestPhotoRevert = () => {
    if (filtered.length === 0) return;
    setRevertConfirmOpen(true);
  };
  const startPhotoRevert = async () => {
    setRevertConfirmOpen(false);
    revertCancelRef.current = false;
    setRevertProgress({ current: 0, total: filtered.length });
    try {
      await bulkRevertPhotos(filtered, {
        onProgress: (current, total) => setRevertProgress({ current, total }),
        cancelRef: revertCancelRef,
      });
    } catch (e) {
      console.error(e);
    } finally {
      setRevertProgress(null);
    }
  };
  const cancelPhotoRevert = () => { revertCancelRef.current = true; };

  const runPdfExport = async (list) => {
    if (list.length === 0) return;
    pdfCancelRef.current = false;
    setPdfProgress({ current: 0, total: list.length });
    try {
      await generateCatalogPdf(list, {
        onProgress: (current, total) => setPdfProgress({ current, total }),
        cancelRef: pdfCancelRef,
      });
    } catch (e) {
      console.error(e);
    } finally {
      setPdfProgress(null);
    }
  };
  const startPdfExport = () => runPdfExport(filtered);
  // os dois PDFs padrão sempre usam TODO o catálogo ativo, sem depender
  // do filtro que estiver na tela — são exportações fixas, sempre
  // completas dentro do seu grupo de categorias
  const startPdfExportHairBiju = () => runPdfExport(products.filter((p) => p.active !== false && isHairOrBijuCategory(p.category)));
  const startPdfExportRest = () => runPdfExport(products.filter((p) => p.active !== false && !isHairOrBijuCategory(p.category)));
  const cancelPdfExport = () => { pdfCancelRef.current = true; };

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20, flexWrap: "wrap", gap: 12 }}>
        <div>
          <h1 className="egi-display" style={{ fontSize: 26, margin: 0, fontWeight: 700 }}>Catálogo de produtos</h1>
          <p className="egi-sans" style={{ margin: "4px 0 0", color: "#6b5a52", fontSize: 14 }}>{products.length} produtos cadastrados</p>
        </div>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <button onClick={startPdfExport} className="egi-sans" style={btnSecondarySmall} title="Gera o catálogo em PDF dos produtos filtrados abaixo"><FileDown size={14} /> Exportar PDF</button>
          <button onClick={startPdfExportHairBiju} className="egi-sans" style={btnSecondarySmall} title="PDF padrão com todo o catálogo ativo de acessórios de cabelo e bijuterias"><FileDown size={14} /> PDF 1: Cabelo & Bijus</button>
          <button onClick={startPdfExportRest} className="egi-sans" style={btnSecondarySmall} title="PDF padrão com o restante do catálogo ativo (cosméticos, armarinhos, variedades...)"><FileDown size={14} /> PDF 2: Demais categorias</button>
          <button onClick={requestPhotoDownload} className="egi-sans" style={btnSecondarySmall} title="Baixa as fotos dos produtos filtrados abaixo, nomeadas com código e nome"><ImageIcon size={14} /> Baixar fotos</button>
          <button onClick={requestPhotoEnhance} className="egi-sans" style={btnSecondarySmall} title="Apaga texto e equilibra o tom do fundo das fotos dos produtos filtrados abaixo"><Sparkles size={14} /> Melhorar fotos</button>
          <button onClick={requestPhotoRevert} className="egi-sans" style={btnSecondarySmall} title="Volta as fotos dos produtos filtrados abaixo para as versões originais"><Undo2 size={14} /> Reverter fotos</button>
          <button onClick={onImport} className="egi-sans" style={btnSecondarySmall}><FileSpreadsheet size={14} /> Importar planilha</button>
          <button onClick={onNew} className="egi-sans" style={btnPrimary}><Plus size={16} /> Novo produto</button>
        </div>
      </div>

      <div style={{ display: "flex", gap: 14, alignItems: "center", marginBottom: 20, flexWrap: "wrap" }}>
        <div style={{ position: "relative", maxWidth: 360, flex: "1 1 260px" }}>
          <Search size={16} style={{ position: "absolute", left: 14, top: 12, color: "#9c8a7f" }} />
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Buscar por nome ou código..." className="egi-sans" style={{ ...inputBase, paddingLeft: 38 }} />
        </div>
        <label className="egi-sans" style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 12.5, color: "#5c4c43", cursor: "pointer" }}>
          <input type="checkbox" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} />
          Mostrar produtos inativos
        </label>
        <label className="egi-sans" style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 12.5, color: "#5c4c43", cursor: "pointer" }}>
          <input type="checkbox" checked={onlyWithoutPhoto} onChange={(e) => setOnlyWithoutPhoto(e.target.checked)} />
          Só cadastros sem foto
        </label>
      </div>

      <div style={{ marginBottom: 20 }}>
        <FilterBar
          categories={topCategoryNames} selectedCategories={selectedCategories} setSelectedCategories={setSelectedCategories}
          subcategories={subcategoryNames} subcategory={subcategory} setSubcategory={setSubcategory}
          sort={sort} setSort={setSort}
        />
      </div>

      {filtered.length === 0 ? (
        <EmptyState text="Nenhum produto encontrado. Cadastre o primeiro item do seu catálogo, ou importe uma planilha." />
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(230px, 1fr))", gap: 16 }}>
          {filtered.map((p) => {
            const cover = p.images?.[0] || p.image;
            const isActive = p.active !== false;
            const unitPrice = unitPriceOf(p);
            return (
              <div key={p.id} style={{ background: "#fff", border: `1px solid ${PALETTE.line}`, borderRadius: 14, overflow: "hidden", opacity: isActive ? 1 : 0.55 }}>
                <div style={{ aspectRatio: "1", background: PALETTE.paperDeep, display: "flex", alignItems: "center", justifyContent: "center", position: "relative" }}>
                  {cover ? <img src={cld(cover, CLD_THUMB)} alt={p.name} style={{ width: "100%", height: "100%", objectFit: "cover" }} loading="lazy" decoding="async" onError={(e) => { e.target.style.display = "none"; }} /> : <ImageOff size={26} color="#b3a494" />}
                  {!isActive && (
                    <span className="egi-sans" style={{ position: "absolute", top: 8, left: 8, background: PALETTE.ink, color: "#fff", fontSize: 10.5, fontWeight: 700, padding: "3px 9px", borderRadius: 999 }}>INATIVO</span>
                  )}
                </div>
                <div style={{ padding: 14 }}>
                  <div className="egi-sans" style={{ fontSize: 11, color: PALETTE.brass, fontWeight: 700, letterSpacing: 0.5 }}>{p.code}</div>
                  <div className="egi-display" style={{ fontSize: 16, fontWeight: 600, margin: "3px 0 6px", lineHeight: 1.25 }}>{p.name}</div>
                  <div className="egi-sans" style={{ fontSize: 12, color: "#7a6a60", marginBottom: 6 }}>
                    {p.category}{p.subcategory ? ` › ${p.subcategory}` : ""} · {p.variations?.length || 0} variações
                  </div>
                  <div className="egi-sans" style={{ fontSize: 15, fontWeight: 700, color: PALETTE.plum }}>
                    {currency(Math.min(...(p.variations?.length ? p.variations.map((v) => v.price) : [p.basePrice])))}
                  </div>
                  {unitPrice != null && (
                    <div className="egi-sans" style={{ fontSize: 11.5, color: "#8a7a6f", marginBottom: 8 }}>Unitário: {currency(unitPrice)}</div>
                  )}
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: unitPrice != null ? 0 : 10 }}>
                    <button onClick={() => onEdit(p)} className="egi-sans" style={btnSecondarySmall}><Pencil size={13} /> Editar</button>
                    <button onClick={() => onDuplicate(p)} className="egi-sans" style={btnSecondarySmall} title="Duplicar produto"><Copy size={13} /></button>
                    <button onClick={() => onToggleActive(p)} className="egi-sans" style={btnSecondarySmall} title={isActive ? "Desativar (some da vitrine)" : "Ativar (volta pra vitrine)"}>
                      {isActive ? <EyeOff size={13} /> : <Eye size={13} />}
                    </button>
                    {confirmDelete === p.id ? (
                      <button onClick={() => { onDelete(p.id); setConfirmDelete(null); }} className="egi-sans" style={{ ...btnSecondarySmall, background: PALETTE.bad, color: "#fff", borderColor: PALETTE.bad }}>Confirmar</button>
                    ) : (
                      <button onClick={() => setConfirmDelete(p.id)} className="egi-sans" style={{ ...btnSecondarySmall, width: 32, justifyContent: "center" }}><Trash2 size={13} /></button>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
      {photoConfirmOpen && (
        <PhotoDownloadConfirmModal count={filtered.length} threshold={PHOTO_WARN_THRESHOLD} onCancel={() => setPhotoConfirmOpen(false)} onConfirm={startPhotoDownload} />
      )}
      {photoProgress && (
        <PhotoDownloadProgressModal progress={photoProgress} onCancel={cancelPhotoDownload} />
      )}
      {enhanceConfirmOpen && (
        <PhotoEnhanceConfirmModal count={filtered.length} onCancel={() => setEnhanceConfirmOpen(false)} onConfirm={startPhotoEnhance} />
      )}
      {enhanceProgress && (
        <PhotoEnhanceProgressModal progress={enhanceProgress} onCancel={cancelPhotoEnhance} />
      )}
      {revertConfirmOpen && (
        <PhotoRevertConfirmModal count={filtered.length} onCancel={() => setRevertConfirmOpen(false)} onConfirm={startPhotoRevert} />
      )}
      {revertProgress && (
        <PhotoRevertProgressModal progress={revertProgress} onCancel={cancelPhotoRevert} />
      )}
      {pdfProgress && (
        <PdfExportProgressModal progress={pdfProgress} onCancel={cancelPdfExport} />
      )}
    </div>
  );
}

function PhotoDownloadConfirmModal({ count, threshold, onCancel, onConfirm }) {
  const [hqOriginal, setHqOriginal] = useState(false);
  const isLarge = count > threshold;
  return (
    <div style={overlayStyle} onClick={onCancel}>
      <div style={{ ...modalStyle, maxWidth: 400, textAlign: "center" }} onClick={(e) => e.stopPropagation()}>
        <div style={{ padding: "32px 26px" }} className="egi-sans">
          <ImageIcon size={30} color={PALETTE.brass} style={{ marginBottom: 12 }} />
          <h2 className="egi-display" style={{ fontSize: 18, fontWeight: 700, margin: "0 0 10px" }}>Baixar fotos</h2>
          <p style={{ fontSize: 13.5, color: "#5c4c43", lineHeight: 1.6, marginBottom: isLarge ? 8 : 16 }}>
            Isso vai baixar as fotos de <strong>{count} produto{count > 1 ? "s" : ""}</strong>.
          </p>
          {isLarge && (
            <p style={{ fontSize: 12.5, color: "#8a7a6f", lineHeight: 1.5, marginBottom: 16 }}>
              É bastante coisa — pode demorar. Se quiser algo mais rápido, feche esta janela e filtre por uma categoria antes.
            </p>
          )}
          <label style={{ display: "flex", alignItems: "flex-start", gap: 8, textAlign: "left", fontSize: 12.5, color: "#5c4c43", cursor: "pointer", marginBottom: 22, background: PALETTE.paperDeep, borderRadius: 10, padding: 12 }}>
            <input type="checkbox" checked={hqOriginal} onChange={(e) => setHqOriginal(e.target.checked)} style={{ marginTop: 2 }} />
            <span>
              <strong>Baixar na qualidade original</strong>
              <br />
              Por padrão as fotos saem comprimidas (mesma nitidez visível, arquivo bem menor e mais rápido). Marque aqui só se precisar do arquivo exatamente como foi enviado.
            </span>
          </label>
          <div style={{ display: "flex", gap: 10 }}>
            <button onClick={onCancel} style={{ ...btnSecondarySmall, flex: 1, justifyContent: "center" }}>Cancelar</button>
            <button onClick={() => onConfirm(hqOriginal)} style={{ ...btnPrimary, flex: 1, justifyContent: "center" }}>Baixar</button>
          </div>
        </div>
      </div>
    </div>
  );
}

function PhotoDownloadProgressModal({ progress, onCancel }) {
  const pct = progress.total ? Math.round((progress.current / progress.total) * 100) : 0;
  return (
    <div style={{ ...overlayStyle, zIndex: 95 }}>
      <div style={{ ...modalStyle, maxWidth: 360, textAlign: "center" }}>
        <div style={{ padding: "32px 26px" }} className="egi-sans">
          <h2 className="egi-display" style={{ fontSize: 17, fontWeight: 700, margin: "0 0 14px" }}>Baixando fotos...</h2>
          <div style={{ height: 8, borderRadius: 999, background: PALETTE.paperDeep, overflow: "hidden", marginBottom: 10 }}>
            <div style={{ height: "100%", width: `${pct}%`, background: PALETTE.brass, transition: "width 0.2s" }} />
          </div>
          <p style={{ fontSize: 13, color: "#5c4c43", marginBottom: 20 }}>{progress.current} de {progress.total} produtos ({pct}%)</p>
          <button onClick={onCancel} style={{ ...btnSecondarySmall, width: "100%", justifyContent: "center" }}>Cancelar</button>
        </div>
      </div>
    </div>
  );
}

function PhotoEnhanceConfirmModal({ count, onCancel, onConfirm }) {
  const [skipDone, setSkipDone] = useState(true);
  const [doText, setDoText] = useState(true);
  const [doBackground, setDoBackground] = useState(true);
  const nothingSelected = !doText && !doBackground;
  return (
    <div style={overlayStyle} onClick={onCancel}>
      <div style={{ ...modalStyle, maxWidth: 420, textAlign: "center" }} onClick={(e) => e.stopPropagation()}>
        <div style={{ padding: "32px 26px", overflowY: "auto" }} className="egi-sans">
          <Sparkles size={30} color={PALETTE.brass} style={{ marginBottom: 12 }} />
          <h2 className="egi-display" style={{ fontSize: 18, fontWeight: 700, margin: "0 0 10px" }}>Melhorar fotos em massa</h2>
          <p style={{ fontSize: 13.5, color: "#5c4c43", lineHeight: 1.6, marginBottom: 16 }}>
            Vai processar <strong>todas as fotos de {count} produto{count > 1 ? "s" : ""}</strong>.
          </p>

          <div style={{ textAlign: "left", background: PALETTE.paperDeep, borderRadius: 12, padding: 14, marginBottom: 14 }}>
            <div style={{ fontWeight: 700, fontSize: 12.5, marginBottom: 10 }}>O que fazer nas fotos</div>
            <label style={{ display: "flex", alignItems: "flex-start", gap: 8, fontSize: 12.5, color: "#5c4c43", cursor: "pointer", marginBottom: 10 }}>
              <input type="checkbox" checked={doBackground} onChange={(e) => setDoBackground(e.target.checked)} style={{ marginTop: 2 }} />
              <span><strong>Melhorar o fundo</strong><br />Equilibra o tom pra deixar o branco mais uniforme. Rápido.</span>
            </label>
            <label style={{ display: "flex", alignItems: "flex-start", gap: 8, fontSize: 12.5, color: "#5c4c43", cursor: "pointer" }}>
              <input type="checkbox" checked={doText} onChange={(e) => setDoText(e.target.checked)} style={{ marginTop: 2 }} />
              <span><strong>Apagar texto</strong><br />Identifica e cobre textos em letra preta. Bem mais lento.</span>
            </label>
          </div>

          <label style={{ display: "flex", alignItems: "flex-start", gap: 8, textAlign: "left", fontSize: 12.5, color: "#5c4c43", cursor: "pointer", marginBottom: 16, background: PALETTE.paperDeep, borderRadius: 12, padding: 12 }}>
            <input type="checkbox" checked={skipDone} onChange={(e) => setSkipDone(e.target.checked)} style={{ marginTop: 2 }} />
            <span>
              <strong>Pular produtos já melhorados antes</strong>
              <br />
              Desmarque só se quiser reprocessar tudo de novo.
            </span>
          </label>

          <p style={{ fontSize: 11.5, color: "#9c8a7f", marginBottom: 18 }}>
            A foto original de cada uma é sempre guardada — dá pra reverter depois, individualmente ou em massa.
          </p>
          <div style={{ display: "flex", gap: 10 }}>
            <button onClick={onCancel} style={{ ...btnSecondarySmall, flex: 1, justifyContent: "center" }}>Cancelar</button>
            <button
              onClick={() => onConfirm({ skipAlreadyDone: skipDone, doText, doBackground })}
              disabled={nothingSelected}
              style={{ ...btnPrimary, flex: 1, justifyContent: "center", opacity: nothingSelected ? 0.5 : 1 }}
            >
              Começar
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function PhotoEnhanceProgressModal({ progress, onCancel }) {
  const pct = progress.total ? Math.round((progress.current / progress.total) * 100) : 0;
  return (
    <div style={{ ...overlayStyle, zIndex: 95 }}>
      <div style={{ ...modalStyle, maxWidth: 360, textAlign: "center" }}>
        <div style={{ padding: "32px 26px" }} className="egi-sans">
          <h2 className="egi-display" style={{ fontSize: 17, fontWeight: 700, margin: "0 0 14px" }}>Melhorando fotos...</h2>
          <div style={{ height: 8, borderRadius: 999, background: PALETTE.paperDeep, overflow: "hidden", marginBottom: 10 }}>
            <div style={{ height: "100%", width: `${pct}%`, background: PALETTE.brass, transition: "width 0.2s" }} />
          </div>
          <p style={{ fontSize: 13, color: "#5c4c43", marginBottom: 20 }}>{progress.current} de {progress.total} produtos ({pct}%)</p>
          <button onClick={onCancel} style={{ ...btnSecondarySmall, width: "100%", justifyContent: "center" }}>Cancelar</button>
        </div>
      </div>
    </div>
  );
}

function PhotoRevertConfirmModal({ count, onCancel, onConfirm }) {
  return (
    <div style={overlayStyle} onClick={onCancel}>
      <div style={{ ...modalStyle, maxWidth: 400, textAlign: "center" }} onClick={(e) => e.stopPropagation()}>
        <div style={{ padding: "32px 26px" }} className="egi-sans">
          <Undo2 size={30} color={PALETTE.brass} style={{ marginBottom: 12 }} />
          <h2 className="egi-display" style={{ fontSize: 18, fontWeight: 700, margin: "0 0 10px" }}>Reverter fotos</h2>
          <p style={{ fontSize: 13.5, color: "#5c4c43", lineHeight: 1.6, marginBottom: 8 }}>
            Vai desfazer as edições feitas nas fotos de <strong>{count} produto{count > 1 ? "s" : ""}</strong>, voltando cada uma para a versão original enviada.
          </p>
          <p style={{ fontSize: 12.5, color: "#8a7a6f", lineHeight: 1.5, marginBottom: 22 }}>
            Produtos cujas fotos nunca foram editadas são ignorados. Depois de reverter, dá pra rodar a melhoria de novo quando quiser.
          </p>
          <div style={{ display: "flex", gap: 10 }}>
            <button onClick={onCancel} style={{ ...btnSecondarySmall, flex: 1, justifyContent: "center" }}>Cancelar</button>
            <button onClick={onConfirm} style={{ ...btnPrimary, flex: 1, justifyContent: "center" }}>Reverter</button>
          </div>
        </div>
      </div>
    </div>
  );
}

function PhotoRevertProgressModal({ progress, onCancel }) {
  const pct = progress.total ? Math.round((progress.current / progress.total) * 100) : 0;
  return (
    <div style={{ ...overlayStyle, zIndex: 95 }}>
      <div style={{ ...modalStyle, maxWidth: 360, textAlign: "center" }}>
        <div style={{ padding: "32px 26px" }} className="egi-sans">
          <h2 className="egi-display" style={{ fontSize: 17, fontWeight: 700, margin: "0 0 14px" }}>Revertendo fotos...</h2>
          <div style={{ height: 8, borderRadius: 999, background: PALETTE.paperDeep, overflow: "hidden", marginBottom: 10 }}>
            <div style={{ height: "100%", width: `${pct}%`, background: PALETTE.brass, transition: "width 0.2s" }} />
          </div>
          <p style={{ fontSize: 13, color: "#5c4c43", marginBottom: 20 }}>{progress.current} de {progress.total} produtos ({pct}%)</p>
          <button onClick={onCancel} style={{ ...btnSecondarySmall, width: "100%", justifyContent: "center" }}>Cancelar</button>
        </div>
      </div>
    </div>
  );
}

function PdfExportProgressModal({ progress, onCancel }) {
  const pct = progress.total ? Math.round((progress.current / progress.total) * 100) : 0;
  return (
    <div style={{ ...overlayStyle, zIndex: 95 }}>
      <div style={{ ...modalStyle, maxWidth: 360, textAlign: "center" }}>
        <div style={{ padding: "32px 26px" }} className="egi-sans">
          <h2 className="egi-display" style={{ fontSize: 17, fontWeight: 700, margin: "0 0 14px" }}>Gerando PDF...</h2>
          <div style={{ height: 8, borderRadius: 999, background: PALETTE.paperDeep, overflow: "hidden", marginBottom: 10 }}>
            <div style={{ height: "100%", width: `${pct}%`, background: PALETTE.brass, transition: "width 0.2s" }} />
          </div>
          <p style={{ fontSize: 13, color: "#5c4c43", marginBottom: 20 }}>{progress.current} de {progress.total} produtos ({pct}%)</p>
          <button onClick={onCancel} style={{ ...btnSecondarySmall, width: "100%", justifyContent: "center" }}>Cancelar</button>
        </div>
      </div>
    </div>
  );
}

function ProductEditor({ product, categories, onClose, onSave }) {
  const isDuplicate = !!product?.__duplicate;
  const [form, setForm] = useState(() => {
    if (!product) {
      return { id: uid("p"), code: "", name: "", category: "", subcategory: "", unit: "", basePrice: "", packageQty: "", images: [], originalImages: [], description: "", variations: [], active: true };
    }
    const images = product.images?.length ? [...product.images] : (product.image ? [product.image] : []);
    // produtos antigos, cadastrados antes dessa função existir, não têm
    // "originalImages" salvo — nesse caso a própria foto atual vira a
    // referência (não tem pra onde reverter até a próxima melhoria).
    const originalImages = product.originalImages?.length ? [...product.originalImages] : [...images];
    return { ...product, images, originalImages, variations: product.variations?.map((v) => ({ ...v })) || [], packageQty: product.packageQty || "" };
  });
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  // fila de arquivos escolhidos que ainda vão passar pela tela de recorte
  // antes de subir — pendingQueue[0] é o que está sendo mostrado agora.
  const [pendingQueue, setPendingQueue] = useState([]); // [{ file, objectUrl }]
  const [cropTarget, setCropTarget] = useState(null); // { idx, src } — reeditar foto já enviada
  const fileInputRef = useRef(null);
  const cameraInputRef = useRef(null);

  const topCategories = categories.filter((c) => !c.parentId);
  const subCategories = categories.filter((c) => c.parentId && topCategories.find((t) => t.id === c.parentId)?.name === form.category);
  const unitPrice = form.packageQty && Number(form.packageQty) > 1 ? (Number(form.basePrice) || 0) / Number(form.packageQty) : null;

  const addVariation = () => setForm((f) => ({ ...f, variations: [...f.variations, { id: uid("v"), color: "", size: "", price: f.basePrice || "", stock: "" }] }));
  const updateVariation = (id, field, val) => setForm((f) => ({ ...f, variations: f.variations.map((v) => (v.id === id ? { ...v, [field]: val } : v)) }));
  const removeVariation = (id) => setForm((f) => ({ ...f, variations: f.variations.filter((v) => v.id !== id) }));

  // ao escolher arquivo(s): não sobe direto — entra numa fila e abre o
  // recorte automaticamente para cada um, um de cada vez.
  const handleFileSelect = (e) => {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;
    setError("");
    setPendingQueue((q) => [...q, ...files.map((file) => ({ file, objectUrl: URL.createObjectURL(file) }))]);
    if (fileInputRef.current) fileInputRef.current.value = "";
    if (cameraInputRef.current) cameraInputRef.current.value = "";
  };

  const currentPending = pendingQueue[0] || null;

  const handlePendingCropSave = async (croppedFile) => {
    setUploading(true);
    setError("");
    try {
      const url = await uploadImageToCloudinary(croppedFile);
      // a primeira versão enviada de cada foto vira a "original" —
      // reverter sempre volta pra ela, mesmo depois de melhorias futuras.
      setForm((f) => ({ ...f, images: [...f.images, url], originalImages: [...f.originalImages, url] }));
    } catch (err) {
      console.error(err);
      setError(err.message || "Erro ao enviar imagem.");
    } finally {
      setUploading(false);
      URL.revokeObjectURL(currentPending.objectUrl);
      setPendingQueue((q) => q.slice(1));
    }
  };

  const handlePendingCropCancel = () => {
    URL.revokeObjectURL(currentPending.objectUrl);
    setPendingQueue((q) => q.slice(1));
  };

  const removeImage = (idx) => setForm((f) => ({
    ...f,
    images: f.images.filter((_, i) => i !== idx),
    originalImages: f.originalImages.filter((_, i) => i !== idx),
  }));
  const moveImage = (idx, dir) => setForm((f) => {
    const target = idx + dir;
    if (target < 0 || target >= f.images.length) return f;
    const nextImages = [...f.images];
    const nextOriginals = [...f.originalImages];
    [nextImages[idx], nextImages[target]] = [nextImages[target], nextImages[idx]];
    [nextOriginals[idx], nextOriginals[target]] = [nextOriginals[target], nextOriginals[idx]];
    return { ...f, images: nextImages, originalImages: nextOriginals };
  });

  const handleCropSave = async (file) => {
    const url = await uploadImageToCloudinary(file);
    setForm((f) => {
      const next = [...f.images];
      next[cropTarget.idx] = url; // originalImages não muda — continua apontando pra primeira versão
      return { ...f, images: next };
    });
    setCropTarget(null);
  };

  const revertImage = (idx) => setForm((f) => {
    const next = [...f.images];
    next[idx] = f.originalImages[idx];
    return { ...f, images: next };
  });

  const revertAllImages = () => setForm((f) => ({ ...f, images: [...f.originalImages] }));
  const hasAnyEditedImage = form.originalImages.some((url, i) => url && url !== form.images[i]);

  const handleSubmit = async () => {
    if (!form.name.trim()) { setError("Preencha o nome do produto."); return; }
    if (!form.category.trim()) { setError("Escolha uma categoria."); return; }
    if (!String(form.basePrice).trim() || Number(form.basePrice) <= 0) { setError("Informe o preço do produto."); return; }
    if (!String(form.packageQty).trim() || Number(form.packageQty) <= 0) { setError("Informe a quantidade por pacote (use 1 se for vendido por unidade)."); return; }
    setSaving(true);
    try {
      const { image, __duplicate, ...rest } = form;
      await onSave({
        ...rest,
        basePrice: Number(form.basePrice) || 0,
        packageQty: Number(form.packageQty) || 1,
        variations: form.variations.map((v) => ({ ...v, price: Number(v.price) || 0, stock: Number(v.stock) || 0 })),
      });
    } catch (e) {
      console.error(e);
      setError("Não foi possível salvar. Tente novamente.");
      setSaving(false);
    }
  };

  return (
    <div style={overlayStyle} onClick={onClose}>
      <div style={{ ...modalStyle, maxWidth: 640 }} onClick={(e) => e.stopPropagation()}>
        <div style={modalHeaderStyle}>
          <h2 className="egi-display" style={{ margin: 0, fontSize: 20, fontWeight: 700 }}>
            {isDuplicate ? "Duplicar produto" : product ? "Editar produto" : "Novo produto"}
          </h2>
          <button onClick={onClose} style={iconBtn}><X size={18} /></button>
        </div>
        <div style={{ padding: "20px 24px", overflowY: "auto", flex: 1 }} className="egi-sans">
          {isDuplicate && (
            <div style={{ background: "#eef2f8", border: `1px solid #b9c8e0`, borderRadius: 10, padding: "10px 14px", marginBottom: 16, fontSize: 12.5, color: "#3d4f6b" }}>
              Cópia de <strong>{product.name}</strong>. Ajuste o código e o que for necessário antes de salvar como um novo produto.
            </div>
          )}
          <div style={{
            display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10,
            background: form.active !== false ? "#eef4ee" : "#f5eeee", border: `1px solid ${form.active !== false ? PALETTE.good : PALETTE.bad}`,
            borderRadius: 10, padding: "10px 14px", marginBottom: 16,
          }}>
            <div>
              <div style={{ fontWeight: 700, fontSize: 13, color: form.active !== false ? PALETTE.good : PALETTE.bad }}>
                {form.active !== false ? "Produto ativo" : "Produto inativo"}
              </div>
              <div style={{ fontSize: 11.5, color: "#7a6a60" }}>
                {form.active !== false ? "Aparece normalmente na vitrine." : "Não aparece na vitrine para os clientes."}
              </div>
            </div>
            <button onClick={() => setForm({ ...form, active: form.active === false ? true : false })} style={{ ...btnSecondarySmall, background: "#fff" }}>
              {form.active !== false ? <><EyeOff size={13} /> Desativar</> : <><Eye size={13} /> Ativar</>}
            </button>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 12 }}>
            <Field label="Código (opcional)"><input value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} style={inputBase} placeholder="ANE-001" /></Field>
            <Field label="Unidade"><input value={form.unit} onChange={(e) => setForm({ ...form, unit: e.target.value })} style={inputBase} placeholder="UN, DZ, CX..." /></Field>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 12 }}>
            <Field label="Categoria *">
              <select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value, subcategory: "" })} style={inputBase}>
                <option value="">Selecione...</option>
                {topCategories.map((c) => <option key={c.id} value={c.name}>{c.name}</option>)}
              </select>
            </Field>
            <Field label="Subcategoria (opcional)">
              <select value={form.subcategory} onChange={(e) => setForm({ ...form, subcategory: e.target.value })} style={inputBase} disabled={subCategories.length === 0}>
                <option value="">Nenhuma</option>
                {subCategories.map((c) => <option key={c.id} value={c.name}>{c.name}</option>)}
              </select>
            </Field>
          </div>
          <Field label="Nome do produto *"><input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} style={inputBase} placeholder="Presilha Bico de Pato..." /></Field>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, margin: "12px 0" }}>
            <Field label="Preço base (R$) *"><input type="number" step="0.01" value={form.basePrice} onChange={(e) => setForm({ ...form, basePrice: e.target.value })} style={inputBase} placeholder="3.50" /></Field>
            <Field label="Itens por pacote *"><input type="number" min="1" value={form.packageQty} onChange={(e) => setForm({ ...form, packageQty: e.target.value })} style={inputBase} placeholder="Ex: 12" /></Field>
          </div>
          {unitPrice != null && (
            <div style={{ fontSize: 12.5, color: PALETTE.plum, marginBottom: 12 }}>Valor unitário calculado: <strong>{currency(unitPrice)}</strong> por item (preço ÷ {form.packageQty})</div>
          )}

          <div style={{ marginTop: 16, marginBottom: 8, fontWeight: 700, fontSize: 13 }}>Fotos do produto</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 8 }}>
            {form.images.map((url, idx) => (
              <div key={idx} style={{ position: "relative", width: 72, height: 72, borderRadius: 8, overflow: "hidden", border: `1px solid ${PALETTE.line}` }}>
                <img src={cld(url, CLD_TINY)} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} loading="lazy" decoding="async" />
                {idx === 0 && <span style={{ position: "absolute", bottom: 0, left: 0, right: 0, background: "rgba(36,19,24,0.75)", color: "#fff", fontSize: 9, textAlign: "center", padding: "1px 0" }}>Capa</span>}
                <button onClick={() => setCropTarget({ idx, src: url })} title="Enquadrar/recortar" style={{ position: "absolute", top: 2, left: 2, background: "rgba(0,0,0,0.6)", border: "none", borderRadius: "50%", width: 18, height: 18, color: "#fff", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}><Crop size={10} /></button>
                {form.originalImages[idx] && form.originalImages[idx] !== url && (
                  <button onClick={() => revertImage(idx)} title="Reverter para a foto original" style={{ position: "absolute", top: 2, left: 22, background: "rgba(0,0,0,0.6)", border: "none", borderRadius: "50%", width: 18, height: 18, color: "#fff", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}><Undo2 size={10} /></button>
                )}
                <button onClick={() => removeImage(idx)} style={{ position: "absolute", top: 2, right: 2, background: "rgba(0,0,0,0.6)", border: "none", borderRadius: "50%", width: 18, height: 18, color: "#fff", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}><X size={11} /></button>
                <div style={{ position: "absolute", bottom: idx === 0 ? 14 : 2, left: 2, right: 2, display: "flex", justifyContent: "space-between" }}>
                  {idx > 0 ? (
                    <button onClick={() => moveImage(idx, -1)} title="Mover para trás" style={{ background: "rgba(0,0,0,0.6)", border: "none", borderRadius: "50%", width: 16, height: 16, color: "#fff", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}><ChevronLeftIcon size={11} /></button>
                  ) : <span />}
                  {idx < form.images.length - 1 ? (
                    <button onClick={() => moveImage(idx, 1)} title="Mover para frente" style={{ background: "rgba(0,0,0,0.6)", border: "none", borderRadius: "50%", width: 16, height: 16, color: "#fff", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}><ChevronRightIcon size={11} /></button>
                  ) : <span />}
                </div>
              </div>
            ))}
            <label title="Escolher da galeria ou arquivos" style={{ width: 72, height: 72, borderRadius: 8, border: `1px dashed ${PALETTE.line}`, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 3, cursor: "pointer", background: "#fff" }}>
              {uploading ? <Loader2 size={18} style={{ animation: "spin 1s linear infinite" }} /> : <Upload size={18} color="#9c8a7f" />}
              {!uploading && <span style={{ fontSize: 8.5, color: "#9c8a7f", fontWeight: 700 }}>Galeria</span>}
              <input ref={fileInputRef} type="file" accept="image/*" multiple onChange={handleFileSelect} style={{ display: "none" }} disabled={uploading} />
            </label>
            <label title="Tirar foto agora com a câmera" style={{ width: 72, height: 72, borderRadius: 8, border: `1px dashed ${PALETTE.line}`, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 3, cursor: "pointer", background: "#fff" }}>
              {uploading ? <Loader2 size={18} style={{ animation: "spin 1s linear infinite" }} /> : <Camera size={18} color="#9c8a7f" />}
              {!uploading && <span style={{ fontSize: 8.5, color: "#9c8a7f", fontWeight: 700 }}>Câmera</span>}
              {/* capture="environment" pede a câmera traseira direto, sem
                  passar pelo seletor de arquivos — no computador, cai no
                  seletor normal, sem quebrar nada */}
              <input ref={cameraInputRef} type="file" accept="image/*" capture="environment" onChange={handleFileSelect} style={{ display: "none" }} disabled={uploading} />
            </label>
          </div>
          <div style={{ fontSize: 11, color: "#9c8a7f", marginBottom: hasAnyEditedImage ? 8 : 12 }}>Escolha da galeria ou tire a foto na hora. A tela de recorte abre sozinha antes de enviar. Use as setinhas na miniatura pra mudar a ordem — a primeira é a capa.</div>
          {hasAnyEditedImage && (
            <button onClick={revertAllImages} className="egi-sans" style={{ ...btnSecondarySmall, marginBottom: 12 }}>
              <Undo2 size={13} /> Reverter todas as fotos para as originais
            </button>
          )}

          <Field label="Descrição"><textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} style={{ ...inputBase, minHeight: 60, resize: "vertical" }} /></Field>

          <div style={{ marginTop: 18, marginBottom: 8, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div style={{ fontWeight: 700, fontSize: 13 }}>Variações (cor / tamanho / preço)</div>
            <button onClick={addVariation} style={{ ...btnSecondarySmall }}><Plus size={13} /> Adicionar</button>
          </div>
          {form.variations.length === 0 && <div style={{ fontSize: 12, color: "#9c8a7f", marginBottom: 8 }}>Sem variações — o produto usará apenas o preço base.</div>}
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {form.variations.map((v) => (
              <div key={v.id} style={{ display: "grid", gridTemplateColumns: "1fr 1fr 0.8fr 0.8fr auto auto", gap: 6, alignItems: "center", opacity: v.active === false ? 0.5 : 1 }}>
                <input value={v.color} onChange={(e) => updateVariation(v.id, "color", e.target.value)} placeholder="Cor" style={inputSmall} />
                <input value={v.size} onChange={(e) => updateVariation(v.id, "size", e.target.value)} placeholder="Tamanho" style={inputSmall} />
                <input type="number" step="0.01" value={v.price} onChange={(e) => updateVariation(v.id, "price", e.target.value)} placeholder="Preço" style={inputSmall} />
                <input type="number" value={v.stock} onChange={(e) => updateVariation(v.id, "stock", e.target.value)} placeholder="Estoque" style={inputSmall} />
                <button onClick={() => updateVariation(v.id, "active", v.active === false ? true : false)} title={v.active === false ? "Ativar variação" : "Desativar variação (some da vitrine)"} style={{ ...iconBtn, color: v.active === false ? PALETTE.brass : PALETTE.good }}>
                  {v.active === false ? <EyeOff size={14} /> : <Eye size={14} />}
                </button>
                <button onClick={() => removeVariation(v.id)} style={{ ...iconBtn, color: PALETTE.bad }}><Trash2 size={14} /></button>
              </div>
            ))}
          </div>
          {error && <div style={{ color: PALETTE.bad, fontSize: 13, marginTop: 12 }}>{error}</div>}
        </div>
        <div style={{ padding: "14px 24px", borderTop: `1px solid ${PALETTE.line}`, display: "flex", justifyContent: "flex-end", gap: 10 }}>
          <button onClick={onClose} className="egi-sans" style={btnSecondarySmall}>Cancelar</button>
          <button onClick={handleSubmit} disabled={saving || uploading} className="egi-sans" style={{ ...btnPrimary, opacity: (saving || uploading) ? 0.7 : 1 }}>
            <Check size={15} /> {saving ? "Salvando..." : "Salvar produto"}
          </button>
        </div>
        <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
      </div>
      {cropTarget && (
        <Suspense fallback={null}>
          <ImageCropModal src={cropTarget.src} onCancel={() => setCropTarget(null)} onSave={handleCropSave} />
        </Suspense>
      )}
      {currentPending && (
        <Suspense fallback={null}>
          <ImageCropModal src={currentPending.objectUrl} onCancel={handlePendingCropCancel} onSave={handlePendingCropSave} />
        </Suspense>
      )}
    </div>
  );
}

/* ==================== CATEGORIAS ==================== */

function CategoriesPanel({ categories }) {
  const [newTop, setNewTop] = useState("");
  const [subDrafts, setSubDrafts] = useState({});
  const [confirmDelete, setConfirmDelete] = useState(null);

  const topCategories = categories.filter((c) => !c.parentId);
  const subsOf = (id) => categories.filter((c) => c.parentId === id);

  const addTop = async () => {
    if (!newTop.trim()) return;
    await saveCategory({ name: newTop.trim(), parentId: null });
    setNewTop("");
  };
  const addSub = async (parentId) => {
    const text = (subDrafts[parentId] || "").trim();
    if (!text) return;
    await saveCategory({ name: text, parentId });
    setSubDrafts((d) => ({ ...d, [parentId]: "" }));
  };

  return (
    <div>
      <h1 className="egi-display" style={{ fontSize: 26, margin: "0 0 4px", fontWeight: 700 }}>Categorias</h1>
      <p className="egi-sans" style={{ margin: "0 0 20px", color: "#6b5a52", fontSize: 14 }}>Organize seu catálogo em categorias e subcategorias.</p>

      <div style={{ display: "flex", gap: 8, marginBottom: 24, maxWidth: 420 }} className="egi-sans">
        <input value={newTop} onChange={(e) => setNewTop(e.target.value)} placeholder="Nova categoria (ex: Presilhas)" style={inputBase} onKeyDown={(e) => e.key === "Enter" && addTop()} />
        <button onClick={addTop} style={btnPrimary}><Plus size={15} /> Criar</button>
      </div>

      {topCategories.length === 0 ? (
        <EmptyState text="Nenhuma categoria cadastrada ainda. Crie a primeira acima." />
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {topCategories.map((cat) => (
            <div key={cat.id} style={{ background: "#fff", border: `1px solid ${PALETTE.line}`, borderRadius: 12, padding: 16 }} className="egi-sans">
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
                <div style={{ fontWeight: 700, fontSize: 15 }}>{cat.name}</div>
                {confirmDelete === cat.id ? (
                  <button onClick={() => { deleteCategory(cat.id); setConfirmDelete(null); }} style={{ ...btnSecondarySmall, background: PALETTE.bad, color: "#fff", borderColor: PALETTE.bad }}>Confirmar exclusão</button>
                ) : (
                  <button onClick={() => setConfirmDelete(cat.id)} style={{ ...iconBtn, color: PALETTE.bad }}><Trash2 size={14} /></button>
                )}
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 10 }}>
                {subsOf(cat.id).map((sub) => (
                  <span key={sub.id} style={{ display: "flex", alignItems: "center", gap: 6, background: PALETTE.paperDeep, borderRadius: 999, padding: "5px 10px", fontSize: 12.5 }}>
                    <ChevronRightIcon size={11} color={PALETTE.brass} /> {sub.name}
                    <button onClick={() => deleteCategory(sub.id)} style={{ ...iconBtn, padding: 0, color: "#9c8a7f" }}><X size={11} /></button>
                  </span>
                ))}
                {subsOf(cat.id).length === 0 && <span style={{ fontSize: 12, color: "#9c8a7f" }}>Sem subcategorias</span>}
              </div>
              <div style={{ display: "flex", gap: 6 }}>
                <input value={subDrafts[cat.id] || ""} onChange={(e) => setSubDrafts((d) => ({ ...d, [cat.id]: e.target.value }))}
                  placeholder="Nova subcategoria..." style={{ ...inputSmall, maxWidth: 240 }} onKeyDown={(e) => e.key === "Enter" && addSub(cat.id)} />
                <button onClick={() => addSub(cat.id)} style={btnSecondarySmall}><Plus size={12} /> Adicionar</button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ==================== IMPORTAR PLANILHA ==================== */

function ImportModal({ onClose }) {
  const [rows, setRows] = useState(null);
  const [fileName, setFileName] = useState("");
  const [importing, setImporting] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState("");

  const handleFile = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setFileName(file.name);
    setError("");
    try {
      const XLSX = await import("xlsx");
      const buffer = await file.arrayBuffer();
      const wb = XLSX.read(buffer, { type: "array" });
      const sheet = wb.Sheets[wb.SheetNames[0]];
      const raw = XLSX.utils.sheet_to_json(sheet, { defval: "" });
      const normalized = raw.map((r) => {
        const get = (keys) => {
          for (const k of Object.keys(r)) {
            if (keys.includes(k.trim().toLowerCase())) return r[k];
          }
          return "";
        };
        return {
          code: get(["código", "codigo", "code"]),
          name: get(["nome", "name", "produto"]),
          price: get(["preço", "preco", "price"]),
          category: get(["categoria", "category"]),
          unit: get(["unidade", "unit", "un"]),
        };
      }).filter((r) => r.code || r.name);
      setRows(normalized);
    } catch (err) {
      console.error(err);
      setError("Não foi possível ler essa planilha. Verifique se é um arquivo .xlsx, .xls ou .csv com as colunas código, nome, preço, categoria, unidade.");
    }
  };

  const confirmImport = async () => {
    setImporting(true);
    try {
      await bulkImportProducts(rows);
      setDone(true);
    } catch (err) {
      console.error(err);
      setError("Erro ao importar os produtos. Tente novamente.");
    } finally {
      setImporting(false);
    }
  };

  return (
    <div style={overlayStyle} onClick={importing ? undefined : onClose}>
      <div style={{ ...modalStyle, maxWidth: 640 }} onClick={(e) => e.stopPropagation()}>
        <div style={modalHeaderStyle}>
          <h2 className="egi-display" style={{ margin: 0, fontSize: 19, fontWeight: 700 }}>Importar planilha</h2>
          {!importing && <button onClick={onClose} style={iconBtn}><X size={18} /></button>}
        </div>
        <div style={{ padding: 24, overflowY: "auto" }} className="egi-sans">
          {done ? (
            <div style={{ textAlign: "center", padding: "20px 0" }}>
              <div style={{ width: 48, height: 48, borderRadius: "50%", background: PALETTE.good, color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 14px" }}><Check size={22} /></div>
              <div style={{ fontWeight: 700, fontSize: 16, marginBottom: 6 }}>{rows.length} produtos importados!</div>
              <p style={{ fontSize: 13, color: "#8a7a6f", marginBottom: 18 }}>Eles já aparecem no catálogo. Você pode editar cada um para adicionar fotos e variações.</p>
              <button onClick={onClose} style={{ ...btnPrimary, width: "100%", justifyContent: "center" }}>Fechar</button>
            </div>
          ) : !rows ? (
            <div>
              <p style={{ fontSize: 13.5, color: "#5c4c43", lineHeight: 1.6, marginBottom: 16 }}>
                Envie um arquivo <strong>.xlsx, .xls ou .csv</strong> com as colunas: <strong>código, nome, preço, categoria, unidade</strong> (nessa ordem ou não, os nomes das colunas são reconhecidos automaticamente). Os produtos entram sem foto e sem variações — você completa isso depois editando cada um.
              </p>
              <label style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 10, border: `2px dashed ${PALETTE.line}`, borderRadius: 12, padding: "36px 20px", cursor: "pointer", background: PALETTE.paperDeep }}>
                <FileSpreadsheet size={30} color={PALETTE.brass} />
                <span style={{ fontSize: 13.5, fontWeight: 600 }}>Toque para escolher a planilha</span>
                <input type="file" accept=".xlsx,.xls,.csv" onChange={handleFile} style={{ display: "none" }} />
              </label>
              {error && <div style={{ color: PALETTE.bad, fontSize: 13, marginTop: 12 }}>{error}</div>}
            </div>
          ) : (
            <div>
              <div style={{ fontSize: 13.5, marginBottom: 12 }}><strong>{fileName}</strong> — {rows.length} produtos encontrados. Confira antes de importar:</div>
              <div style={{ maxHeight: 280, overflowY: "auto", border: `1px solid ${PALETTE.line}`, borderRadius: 10 }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5 }}>
                  <thead>
                    <tr style={{ background: PALETTE.paperDeep, textAlign: "left" }}>
                      <th style={{ padding: "8px 10px" }}>Código</th><th style={{ padding: "8px 10px" }}>Nome</th><th style={{ padding: "8px 10px" }}>Preço</th><th style={{ padding: "8px 10px" }}>Categoria</th><th style={{ padding: "8px 10px" }}>Un.</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.slice(0, 50).map((r, i) => (
                      <tr key={i} style={{ borderTop: `1px solid ${PALETTE.line}` }}>
                        <td style={{ padding: "6px 10px" }}>{r.code}</td><td style={{ padding: "6px 10px" }}>{r.name}</td><td style={{ padding: "6px 10px" }}>{r.price}</td><td style={{ padding: "6px 10px" }}>{r.category}</td><td style={{ padding: "6px 10px" }}>{r.unit}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {rows.length > 50 && <div style={{ fontSize: 11.5, color: "#9c8a7f", marginTop: 6 }}>Mostrando os 50 primeiros de {rows.length}.</div>}
              {error && <div style={{ color: PALETTE.bad, fontSize: 13, marginTop: 12 }}>{error}</div>}
              <div style={{ display: "flex", gap: 10, marginTop: 18 }}>
                <button onClick={() => setRows(null)} style={btnSecondarySmall} disabled={importing}>Escolher outro arquivo</button>
                <button onClick={confirmImport} style={{ ...btnPrimary, opacity: importing ? 0.7 : 1 }} disabled={importing}>
                  {importing ? "Importando..." : `Importar ${rows.length} produtos`}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/* ==================== ITENS VENDIDOS ==================== */

/* ==================== CLIENTES (CRM) ==================== */

function mergeIntoGroups(customers, customerInfo, groups) {
  const keyToGroup = {};
  groups.forEach((g) => (g.memberKeys || []).forEach((k) => { keyToGroup[k] = g; }));
  const rows = [];
  const usedGroups = new Set();

  customers.forEach((c) => {
    const group = keyToGroup[c.key];
    if (group) {
      if (usedGroups.has(group.id)) return;
      usedGroups.add(group.id);
      const members = customers.filter((m) => (group.memberKeys || []).includes(m.key));
      const info = customerInfo[group.id] || {};
      rows.push({
        isGroup: true, key: group.id, groupId: group.id,
        name: group.name, members,
        totalSpent: members.reduce((s, m) => s + m.totalSpent, 0),
        orderCount: members.reduce((s, m) => s + m.orderCount, 0),
        lastOrderAt: Math.max(...members.map((m) => m.lastOrderAt)),
        orders: members.flatMap((m) => m.orders),
        city: info.city || "", state: info.state || "",
        phoneCnpj: info.phoneCnpj || "", cnpjStatus: info.cnpjStatus || "",
      });
    } else {
      const info = customerInfo[c.key] || {};
      rows.push({
        isGroup: false, key: c.key,
        name: c.companyName || "Cliente sem nome", phone: c.phone, document: c.document,
        members: [c], totalSpent: c.totalSpent, orderCount: c.orderCount, lastOrderAt: c.lastOrderAt,
        orders: c.orders, city: info.city || "", state: info.state || "",
        phoneCnpj: info.phoneCnpj || "", cnpjStatus: info.cnpjStatus || "",
      });
    }
  });
  return rows;
}

function LocationEditor({ rowKey, city, state, onSaved }) {
  const [c, setC] = useState(city || "");
  const [s, setS] = useState(state || "");
  const [saving, setSaving] = useState(false);

  useEffect(() => { setC(city || ""); setS(state || ""); }, [city, state]);

  const commit = async () => {
    if (c === (city || "") && s === (state || "")) return;
    setSaving(true);
    try { await saveCustomerLocation(rowKey, { city: c, state: s }); onSaved && onSaved(); }
    finally { setSaving(false); }
  };

  return (
    <div style={{ display: "flex", gap: 6, alignItems: "center" }} onClick={(e) => e.stopPropagation()}>
      <MapPin size={12} color="#9c8a7f" />
      <input value={c} onChange={(e) => setC(e.target.value)} onBlur={commit} placeholder="Cidade"
        style={{ ...inputSmall, width: 110, padding: "4px 8px", opacity: saving ? 0.6 : 1 }} />
      <input value={s} onChange={(e) => setS(e.target.value.toUpperCase().slice(0, 2))} onBlur={commit} placeholder="UF"
        style={{ ...inputSmall, width: 44, padding: "4px 8px", textAlign: "center", opacity: saving ? 0.6 : 1 }} />
    </div>
  );
}

function GroupModal({ selectedRows, existingGroups, onClose, onDone }) {
  const [mode, setMode] = useState(existingGroups.length ? "novo" : "novo");
  const [name, setName] = useState("");
  const [targetGroupId, setTargetGroupId] = useState(existingGroups[0]?.id || "");
  const [saving, setSaving] = useState(false);

  const confirm = async () => {
    setSaving(true);
    try {
      const selectedKeys = selectedRows.flatMap((r) => r.members.map((m) => m.key));
      if (mode === "novo") {
        if (!name.trim()) { setSaving(false); return; }
        await saveClientGroup({ name: name.trim(), memberKeys: selectedKeys });
      } else {
        const g = existingGroups.find((x) => x.id === targetGroupId);
        if (!g) { setSaving(false); return; }
        const merged = Array.from(new Set([...(g.memberKeys || []), ...selectedKeys]));
        await saveClientGroup({ ...g, memberKeys: merged });
      }
      onDone();
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={overlayStyle} onClick={onClose}>
      <div style={{ ...modalStyle, maxWidth: 400 }} onClick={(e) => e.stopPropagation()}>
        <div style={modalHeaderStyle}>
          <h2 className="egi-display" style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>Agrupar clientes</h2>
          <button onClick={onClose} style={iconBtn}><X size={18} /></button>
        </div>
        <div style={{ padding: 22 }} className="egi-sans">
          <p style={{ fontSize: 12.5, color: "#8a7a6f", marginTop: 0, marginBottom: 16 }}>
            {selectedRows.length} selecionado{selectedRows.length > 1 ? "s" : ""}. Útil quando é o mesmo cliente comprando com CNPJs ou telefones diferentes.
          </p>
          {existingGroups.length > 0 && (
            <div style={{ display: "flex", gap: 6, marginBottom: 16 }}>
              <button onClick={() => setMode("novo")} style={{ ...btnSecondarySmall, background: mode === "novo" ? PALETTE.plum : "#fff", color: mode === "novo" ? "#fff" : PALETTE.ink }}>Criar grupo novo</button>
              <button onClick={() => setMode("existente")} style={{ ...btnSecondarySmall, background: mode === "existente" ? PALETTE.plum : "#fff", color: mode === "existente" ? "#fff" : PALETTE.ink }}>Somar a um grupo</button>
            </div>
          )}
          {mode === "novo" ? (
            <Field label="Nome do grupo">
              <input value={name} onChange={(e) => setName(e.target.value)} style={inputBase} placeholder="Ex: Salão Beleza Ana (todas as filiais)" autoFocus />
            </Field>
          ) : (
            <Field label="Grupo existente">
              <select value={targetGroupId} onChange={(e) => setTargetGroupId(e.target.value)} style={inputBase}>
                {existingGroups.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
              </select>
            </Field>
          )}
          <button onClick={confirm} disabled={saving} style={{ ...btnPrimary, width: "100%", justifyContent: "center", marginTop: 20, opacity: saving ? 0.7 : 1 }}>
            {saving ? "Salvando..." : "Confirmar"}
          </button>
        </div>
      </div>
    </div>
  );
}

function ClientsPanel({ orders, customerInfo, groups, importedClients }) {
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState("recentes");
  const [expanded, setExpanded] = useState(null);
  const [selected, setSelected] = useState(() => new Set());
  const [groupModalOpen, setGroupModalOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [inactiveDays, setInactiveDays] = useState("");
  const [confirmDeleteKey, setConfirmDeleteKey] = useState(null);

  const customers = React.useMemo(() => computeCustomers(orders, importedClients), [orders, importedClients]);
  const rows = React.useMemo(() => mergeIntoGroups(customers, customerInfo, groups), [customers, customerInfo, groups]);

  const nq = normalizeText(query);
  let visible = rows.filter((r) =>
    normalizeText(r.name || "").includes(nq) ||
    normalizeText(r.phone || "").includes(nq) ||
    normalizeText(r.document || "").includes(nq) ||
    r.members.some((m) => normalizeText(m.phone || "").includes(nq) || normalizeText(m.document || "").includes(nq))
  );
  const inactiveDaysNum = Number(inactiveDays);
  if (inactiveDaysNum > 0) {
    const cutoff = Date.now() - inactiveDaysNum * 24 * 60 * 60 * 1000;
    // clientes com pelo menos um pedido, mas nenhum recente — cliente sem
    // nenhum pedido ainda (só importado) não entra aqui, já que não dá
    // pra falar em "parou de comprar" de quem nunca comprou
    visible = visible.filter((r) => r.orderCount > 0 && r.lastOrderAt < cutoff);
  }
  if (sort === "recentes") visible = visible.slice().sort((a, b) => b.lastOrderAt - a.lastOrderAt);
  if (sort === "gasto") visible = visible.slice().sort((a, b) => b.totalSpent - a.totalSpent);
  if (sort === "pedidos") visible = visible.slice().sort((a, b) => b.orderCount - a.orderCount);
  if (sort === "nome") visible = visible.slice().sort((a, b) => (a.name || "").localeCompare(b.name || ""));

  const totalClientes = rows.length;
  const totalGasto = customers.reduce((s, c) => s + c.totalSpent, 0);
  const ticketMedio = customers.length ? totalGasto / customers.reduce((s, c) => s + c.orderCount, 0) : 0;

  const toggleSelect = (row) => setSelected((prev) => {
    const next = new Set(prev);
    if (next.has(row.key)) next.delete(row.key); else next.add(row.key);
    return next;
  });
  const selectedRows = visible.filter((r) => selected.has(r.key));

  const removeMemberFromGroup = async (group, memberKey) => {
    const remaining = group.members.map((m) => m.key).filter((k) => k !== memberKey);
    if (remaining.length <= 1) await deleteClientGroup(group.groupId);
    else await saveClientGroup({ id: group.groupId, name: group.name, memberKeys: remaining });
  };

  const handleDeleteClient = async (row) => {
    if (row.isGroup) {
      await deleteClientGroup(row.groupId);
      await Promise.all(row.members.map((m) => deleteClientRecord(m.key)));
    } else {
      await deleteClientRecord(row.key);
    }
    setConfirmDeleteKey(null);
  };

  if (orders.length === 0 && importedClients.length === 0) return <EmptyState text="Nenhum pedido recebido ainda, e nenhum cliente importado. Assim que os primeiros pedidos chegarem (ou você importar uma planilha), seus clientes aparecem aqui." />;

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 12, marginBottom: 4 }}>
        <div>
          <h1 className="egi-display" style={{ fontSize: 26, margin: 0, fontWeight: 700 }}>Clientes</h1>
          <p className="egi-sans" style={{ margin: "4px 0 0", color: "#6b5a52", fontSize: 14 }}>
            Montado a partir dos pedidos recebidos e de clientes importados. Cidade/estado é preenchido sozinho quando o cliente usa CNPJ.
          </p>
        </div>
        <button onClick={() => setImportOpen(true)} className="egi-sans" style={btnSecondarySmall}>
          <FileSpreadsheet size={14} /> Importar clientes
        </button>
      </div>
      <div style={{ marginBottom: 16 }} />

      <div style={{ display: "flex", gap: 14, flexWrap: "wrap", marginBottom: 20 }} className="egi-sans">
        <div style={{ background: "#fff", border: `1px solid ${PALETTE.line}`, borderRadius: 12, padding: "14px 20px", flex: "1 1 160px" }}>
          <div style={{ fontSize: 11, color: "#8a7a6f", fontWeight: 700, textTransform: "uppercase" }}>Clientes</div>
          <div className="egi-display" style={{ fontSize: 26, fontWeight: 700, color: PALETTE.plum }}>{totalClientes}</div>
        </div>
        <div style={{ background: "#fff", border: `1px solid ${PALETTE.line}`, borderRadius: 12, padding: "14px 20px", flex: "1 1 160px" }}>
          <div style={{ fontSize: 11, color: "#8a7a6f", fontWeight: 700, textTransform: "uppercase" }}>Total gasto (todos)</div>
          <div className="egi-display" style={{ fontSize: 26, fontWeight: 700, color: PALETTE.plum }}>{currency(totalGasto)}</div>
        </div>
        <div style={{ background: "#fff", border: `1px solid ${PALETTE.line}`, borderRadius: 12, padding: "14px 20px", flex: "1 1 160px" }}>
          <div style={{ fontSize: 11, color: "#8a7a6f", fontWeight: 700, textTransform: "uppercase" }}>Ticket médio</div>
          <div className="egi-display" style={{ fontSize: 26, fontWeight: 700, color: PALETTE.plum }}>{currency(ticketMedio)}</div>
        </div>
      </div>

      <div style={{ display: "flex", gap: 14, alignItems: "center", marginBottom: 14, flexWrap: "wrap" }} className="egi-sans">
        <div style={{ position: "relative", maxWidth: 320, flex: "1 1 240px" }}>
          <Search size={16} style={{ position: "absolute", left: 14, top: 12, color: "#9c8a7f" }} />
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Buscar por nome, telefone ou CPF/CNPJ..." style={{ ...inputBase, paddingLeft: 38 }} />
        </div>
        <select value={sort} onChange={(e) => setSort(e.target.value)} style={inputSmall}>
          <option value="recentes">Compra mais recente</option>
          <option value="gasto">Maior valor gasto</option>
          <option value="pedidos">Mais pedidos</option>
          <option value="nome">Nome (A-Z)</option>
        </select>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{ fontSize: 12.5, color: "#5c4c43", whiteSpace: "nowrap" }}>Sem comprar há mais de</span>
          <input type="number" min="1" value={inactiveDays} onChange={(e) => setInactiveDays(e.target.value)} placeholder="dias" style={{ ...inputSmall, width: 70 }} />
          <span style={{ fontSize: 12.5, color: "#5c4c43" }}>dias</span>
          {inactiveDaysNum > 0 && <button onClick={() => setInactiveDays("")} style={{ ...iconBtn, padding: 2 }} title="Limpar filtro"><X size={14} /></button>}
        </div>
      </div>

      {selected.size > 0 && (
        <div className="egi-sans" style={{ display: "flex", alignItems: "center", gap: 10, background: PALETTE.paperDeep, border: `1px solid ${PALETTE.line}`, borderRadius: 10, padding: "10px 14px", marginBottom: 16 }}>
          <span style={{ fontSize: 12.5, fontWeight: 700 }}>{selected.size} selecionado{selected.size > 1 ? "s" : ""}</span>
          <button onClick={() => setGroupModalOpen(true)} style={btnSecondarySmall}><UsersRound size={13} /> Agrupar</button>
          <button onClick={() => setSelected(new Set())} style={{ ...btnSecondarySmall, marginLeft: "auto" }}>Limpar seleção</button>
        </div>
      )}

      {visible.length === 0 ? (
        <EmptyState text="Nenhum cliente encontrado com essa busca." />
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {visible.map((r) => {
            const isOpen = expanded === r.key;
            return (
              <div key={r.key} style={{ background: "#fff", border: `1px solid ${selected.has(r.key) ? PALETTE.plum : PALETTE.line}`, borderRadius: 12, overflow: "hidden" }} className="egi-sans">
                <div style={{ display: "flex", alignItems: "flex-start", gap: 10, padding: 16 }}>
                  <input type="checkbox" checked={selected.has(r.key)} onChange={() => toggleSelect(r)} style={{ marginTop: 4 }} />
                  <button onClick={() => setExpanded(isOpen ? null : r.key)} style={{ flex: 1, textAlign: "left", background: "none", border: "none", cursor: "pointer", padding: 0, display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, flexWrap: "wrap" }}>
                    <div>
                      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                        {r.isGroup && <UsersRound size={13} color={PALETTE.brass} />}
                        <div style={{ fontWeight: 700, fontSize: 14.5 }}>{r.name}</div>
                        {r.isGroup && <span style={{ fontSize: 10.5, color: PALETTE.brass, fontWeight: 700 }}>{r.members.length} vinculados</span>}
                        {r.cnpjStatus && (
                          <span style={{
                            fontSize: 10, fontWeight: 700, padding: "2px 8px", borderRadius: 999, textTransform: "uppercase",
                            background: r.cnpjStatus.toUpperCase() === "ATIVA" ? "#eef4ee" : "#fbeceb",
                            color: r.cnpjStatus.toUpperCase() === "ATIVA" ? PALETTE.good : PALETTE.bad,
                          }}>{r.cnpjStatus}</span>
                        )}
                      </div>
                      {!r.isGroup && (
                        <div style={{ display: "flex", gap: 14, flexWrap: "wrap", fontSize: 12, color: "#8a7a6f", marginTop: 3 }}>
                          {r.phone && <span style={{ display: "flex", alignItems: "center", gap: 4 }}><Phone size={11} /> {r.phone} <span style={{ color: "#c2b6a9" }}>(informado)</span></span>}
                          {r.phoneCnpj && r.phoneCnpj !== r.phone && <span style={{ display: "flex", alignItems: "center", gap: 4 }}><Phone size={11} /> {r.phoneCnpj} <span style={{ color: "#c2b6a9" }}>(CNPJ)</span></span>}
                          {r.document && <span style={{ display: "flex", alignItems: "center", gap: 4 }}><CreditCard size={11} /> {r.document}</span>}
                        </div>
                      )}
                      <div style={{ marginTop: 6 }}>
                        <LocationEditor rowKey={r.key} city={r.city} state={r.state} />
                      </div>
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
                      <div style={{ textAlign: "right" }}>
                        <div style={{ fontSize: 11, color: "#8a7a6f" }}>{r.orderCount} pedido{r.orderCount > 1 ? "s" : ""}</div>
                        <div style={{ fontWeight: 700, fontSize: 15, color: PALETTE.plum }}>{currency(r.totalSpent)}</div>
                      </div>
                      <ChevronRightIcon size={16} style={{ transform: isOpen ? "rotate(90deg)" : "none", transition: "transform 0.15s", color: "#9c8a7f" }} />
                    </div>
                  </button>
                  {confirmDeleteKey === r.key ? (
                    <button onClick={(e) => { e.stopPropagation(); handleDeleteClient(r); }} style={{ ...btnSecondarySmall, background: PALETTE.bad, color: "#fff", borderColor: PALETTE.bad, flexShrink: 0 }}>Confirmar exclusão</button>
                  ) : (
                    <button onClick={(e) => { e.stopPropagation(); setConfirmDeleteKey(r.key); }} title="Excluir cadastro" style={{ ...iconBtn, color: PALETTE.bad, flexShrink: 0 }}><Trash2 size={15} /></button>
                  )}
                </div>
                {isOpen && (
                  <div style={{ borderTop: `1px solid ${PALETTE.line}`, padding: 16, background: PALETTE.paperDeep }}>
                    {r.isGroup && (
                      <div style={{ marginBottom: 14 }}>
                        <div style={{ fontWeight: 700, fontSize: 12, marginBottom: 8 }}>Vinculados a este grupo</div>
                        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                          {r.members.map((m) => (
                            <div key={m.key} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", background: "#fff", border: `1px solid ${PALETTE.line}`, borderRadius: 8, padding: "8px 10px", fontSize: 12.5 }}>
                              <span>{m.companyName || "Sem nome"} · {m.phone} · {m.document}</span>
                              <button onClick={() => removeMemberFromGroup(r, m.key)} style={{ ...iconBtn, color: PALETTE.bad }} title="Remover do grupo"><X size={13} /></button>
                            </div>
                          ))}
                        </div>
                        <button onClick={() => deleteClientGroup(r.groupId)} style={{ ...btnSecondarySmall, marginTop: 10, color: PALETTE.bad }}>Desfazer grupo inteiro</button>
                      </div>
                    )}
                    <div style={{ fontWeight: 700, fontSize: 12, marginBottom: 8 }}>Pedidos</div>
                    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                      {r.orders.slice().sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0)).map((o) => (
                        <div key={o.id} style={{ background: "#fff", border: `1px solid ${PALETTE.line}`, borderRadius: 10, padding: 12 }}>
                          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12.5, marginBottom: 4 }}>
                            <span style={{ fontWeight: 700, color: PALETTE.plum }}>#{o.orderNumber}</span>
                            <span style={{ color: "#8a7a6f" }}>{new Date(o.createdAt).toLocaleDateString("pt-BR")}</span>
                          </div>
                          <div style={{ fontSize: 12, color: "#5c4c43" }}>{(o.items || []).length} itens · {currency(o.total)}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {groupModalOpen && (
        <GroupModal
          selectedRows={selectedRows} existingGroups={groups}
          onClose={() => setGroupModalOpen(false)}
          onDone={() => { setGroupModalOpen(false); setSelected(new Set()); }}
        />
      )}
      {importOpen && <ImportClientsModal onClose={() => setImportOpen(false)} />}
    </div>
  );
}

function ImportClientsModal({ onClose }) {
  const [rows, setRows] = useState(null);
  const [fileName, setFileName] = useState("");
  const [importing, setImporting] = useState(false);
  const [done, setDone] = useState(null);
  const [error, setError] = useState("");

  const handleFile = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setFileName(file.name);
    setError("");
    try {
      const XLSX = await import("xlsx");
      const buffer = await file.arrayBuffer();
      const wb = XLSX.read(buffer, { type: "array" });
      const sheet = wb.Sheets[wb.SheetNames[0]];
      const raw = XLSX.utils.sheet_to_json(sheet, { defval: "" });
      const normalized = raw.map((r) => {
        const get = (keys) => {
          for (const k of Object.keys(r)) {
            if (keys.includes(k.trim().toLowerCase())) return r[k];
          }
          return "";
        };
        return {
          companyName: get(["nome", "empresa", "cliente", "nome/empresa", "razao social", "razão social"]),
          phone: get(["telefone", "fone", "celular", "whatsapp"]),
          document: get(["cpf/cnpj", "cnpj", "cpf", "documento"]),
          city: get(["cidade", "municipio", "município"]),
          state: get(["estado", "uf"]),
        };
      }).filter((r) => r.companyName || r.phone);
      setRows(normalized);
    } catch (err) {
      console.error(err);
      setError("Não foi possível ler essa planilha. Verifique se é um arquivo .xlsx, .xls ou .csv com colunas como nome, telefone, CPF/CNPJ, cidade, estado.");
    }
  };

  const confirmImport = async () => {
    setImporting(true);
    try {
      const results = await bulkImportClients(rows);
      setDone(results.length);
    } catch (err) {
      console.error(err);
      setError("Erro ao importar os clientes. Tente novamente.");
    } finally {
      setImporting(false);
    }
  };

  return (
    <div style={overlayStyle} onClick={importing ? undefined : onClose}>
      <div style={{ ...modalStyle, maxWidth: 640 }} onClick={(e) => e.stopPropagation()}>
        <div style={modalHeaderStyle}>
          <h2 className="egi-display" style={{ margin: 0, fontSize: 19, fontWeight: 700 }}>Importar clientes</h2>
          {!importing && <button onClick={onClose} style={iconBtn}><X size={18} /></button>}
        </div>
        <div style={{ padding: 24, overflowY: "auto" }} className="egi-sans">
          {done !== null ? (
            <div style={{ textAlign: "center", padding: "20px 0" }}>
              <div style={{ width: 48, height: 48, borderRadius: "50%", background: PALETTE.good, color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 14px" }}><Check size={22} /></div>
              <div style={{ fontWeight: 700, fontSize: 16, marginBottom: 6 }}>{done} clientes importados!</div>
              <p style={{ fontSize: 13, color: "#8a7a6f", marginBottom: 18 }}>Eles já aparecem na lista, mesmo sem nenhum pedido ainda pelo portal.</p>
              <button onClick={onClose} style={{ ...btnPrimary, width: "100%", justifyContent: "center" }}>Fechar</button>
            </div>
          ) : !rows ? (
            <div>
              <p style={{ fontSize: 13.5, color: "#5c4c43", lineHeight: 1.6, marginBottom: 16 }}>
                Envie um arquivo <strong>.xlsx, .xls ou .csv</strong> com colunas como <strong>nome, telefone, CPF/CNPJ, cidade, estado</strong> (os nomes das colunas são reconhecidos automaticamente, não precisa estar nessa ordem exata — cidade e estado são opcionais).
              </p>
              <label style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 10, border: `2px dashed ${PALETTE.line}`, borderRadius: 12, padding: "36px 20px", cursor: "pointer", background: PALETTE.paperDeep }}>
                <FileSpreadsheet size={30} color={PALETTE.brass} />
                <span style={{ fontSize: 13.5, fontWeight: 600 }}>Toque para escolher a planilha</span>
                <input type="file" accept=".xlsx,.xls,.csv" onChange={handleFile} style={{ display: "none" }} />
              </label>
              {error && <div style={{ color: PALETTE.bad, fontSize: 13, marginTop: 12 }}>{error}</div>}
            </div>
          ) : (
            <div>
              <div style={{ fontSize: 13.5, marginBottom: 12 }}><strong>{fileName}</strong> — {rows.length} clientes encontrados. Confira antes de importar:</div>
              <div style={{ maxHeight: 280, overflowY: "auto", border: `1px solid ${PALETTE.line}`, borderRadius: 10 }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5 }}>
                  <thead>
                    <tr style={{ background: PALETTE.paperDeep, textAlign: "left" }}>
                      <th style={{ padding: "8px 10px" }}>Nome/Empresa</th><th style={{ padding: "8px 10px" }}>Telefone</th><th style={{ padding: "8px 10px" }}>CPF/CNPJ</th><th style={{ padding: "8px 10px" }}>Cidade</th><th style={{ padding: "8px 10px" }}>UF</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.slice(0, 50).map((r, i) => (
                      <tr key={i} style={{ borderTop: `1px solid ${PALETTE.line}` }}>
                        <td style={{ padding: "6px 10px" }}>{r.companyName}</td><td style={{ padding: "6px 10px" }}>{r.phone}</td><td style={{ padding: "6px 10px" }}>{r.document}</td><td style={{ padding: "6px 10px" }}>{r.city}</td><td style={{ padding: "6px 10px" }}>{r.state}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {rows.length > 50 && <div style={{ fontSize: 11.5, color: "#9c8a7f", marginTop: 6 }}>Mostrando os 50 primeiros de {rows.length}.</div>}
              {error && <div style={{ color: PALETTE.bad, fontSize: 13, marginTop: 12 }}>{error}</div>}
              <div style={{ display: "flex", gap: 10, marginTop: 18 }}>
                <button onClick={() => setRows(null)} style={btnSecondarySmall} disabled={importing}>Escolher outro arquivo</button>
                <button onClick={confirmImport} style={{ ...btnPrimary, opacity: importing ? 0.7 : 1 }} disabled={importing}>
                  {importing ? "Importando..." : `Importar ${rows.length} clientes`}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/* ==================== REGIÕES ==================== */

function RegionsPanel({ orders, customerInfo, groups, importedClients }) {
  const customers = React.useMemo(() => computeCustomers(orders, importedClients), [orders, importedClients]);
  const rows = React.useMemo(() => mergeIntoGroups(customers, customerInfo, groups), [customers, customerInfo, groups]);

  const byState = {};
  const byCity = {};
  let semLocalizacao = { count: 0, total: 0 };
  rows.forEach((r) => {
    if (!r.city && !r.state) {
      semLocalizacao.count += 1;
      semLocalizacao.total += r.totalSpent;
      return;
    }
    const stKey = r.state || "—";
    if (!byState[stKey]) byState[stKey] = { key: stKey, clientes: 0, total: 0, pedidos: 0 };
    byState[stKey].clientes += 1;
    byState[stKey].total += r.totalSpent;
    byState[stKey].pedidos += r.orderCount;

    const cityKey = `${r.city || "Cidade não informada"}${r.state ? " / " + r.state : ""}`;
    if (!byCity[cityKey]) byCity[cityKey] = { key: cityKey, clientes: 0, total: 0, pedidos: 0 };
    byCity[cityKey].clientes += 1;
    byCity[cityKey].total += r.totalSpent;
    byCity[cityKey].pedidos += r.orderCount;
  });
  const statesList = Object.values(byState).sort((a, b) => b.total - a.total);
  const citiesList = Object.values(byCity).sort((a, b) => b.total - a.total);

  if (orders.length === 0 && importedClients.length === 0) return <EmptyState text="Nenhum pedido recebido ainda." />;

  return (
    <div>
      <h1 className="egi-display" style={{ fontSize: 26, margin: "0 0 4px", fontWeight: 700 }}>Vendas por região</h1>
      <p className="egi-sans" style={{ margin: "0 0 20px", color: "#6b5a52", fontSize: 14 }}>
        Baseado na cidade/estado de cada cliente, preenchido automaticamente pelo CNPJ ou ajustado manualmente na aba Clientes.
      </p>

      {semLocalizacao.count > 0 && (
        <div className="egi-sans" style={{ background: "#fdf3e4", border: `1px solid ${PALETTE.brass}`, borderRadius: 10, padding: "10px 14px", marginBottom: 20, fontSize: 12.5, color: "#6b5a52" }}>
          {semLocalizacao.count} cliente{semLocalizacao.count > 1 ? "s" : ""} ainda sem cidade/estado ({currency(semLocalizacao.total)} em vendas) — geralmente são pedidos feitos com CPF, que não tem busca automática. Ajuste manualmente na aba Clientes.
        </div>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 24 }} className="egi-sans">
        <div>
          <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 10 }}>Por estado</div>
          {statesList.length === 0 ? <EmptyState text="Nenhum estado identificado ainda." /> : (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {statesList.map((s) => (
                <div key={s.key} style={{ background: "#fff", border: `1px solid ${PALETTE.line}`, borderRadius: 10, padding: "10px 14px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <div>
                    <div style={{ fontWeight: 700, fontSize: 13.5 }}>{s.key}</div>
                    <div style={{ fontSize: 11.5, color: "#8a7a6f" }}>{s.clientes} cliente{s.clientes > 1 ? "s" : ""} · {s.pedidos} pedido{s.pedidos > 1 ? "s" : ""}</div>
                  </div>
                  <div style={{ fontWeight: 700, color: PALETTE.plum }}>{currency(s.total)}</div>
                </div>
              ))}
            </div>
          )}
        </div>
        <div>
          <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 10 }}>Por cidade</div>
          {citiesList.length === 0 ? <EmptyState text="Nenhuma cidade identificada ainda." /> : (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {citiesList.map((c) => (
                <div key={c.key} style={{ background: "#fff", border: `1px solid ${PALETTE.line}`, borderRadius: 10, padding: "10px 14px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <div>
                    <div style={{ fontWeight: 700, fontSize: 13.5 }}>{c.key}</div>
                    <div style={{ fontSize: 11.5, color: "#8a7a6f" }}>{c.clientes} cliente{c.clientes > 1 ? "s" : ""} · {c.pedidos} pedido{c.pedidos > 1 ? "s" : ""}</div>
                  </div>
                  <div style={{ fontWeight: 700, color: PALETTE.plum }}>{currency(c.total)}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function SalesPanel({ orders }) {
  const [period, setPeriod] = useState("todos");
  const [query, setQuery] = useState("");

  const filteredOrders = React.useMemo(() => {
    if (period === "todos") return orders;
    const days = period === "7" ? 7 : period === "30" ? 30 : 90;
    const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
    return orders.filter((o) => (o.createdAt || 0) >= cutoff);
  }, [orders, period]);

  const sales = React.useMemo(() => computeSalesByProduct(filteredOrders), [filteredOrders]);
  const nq = normalizeText(query);
  const visible = sales.filter((s) => normalizeText(s.name).includes(nq) || normalizeText(s.code || "").includes(nq));

  const totalUnits = sales.reduce((s, i) => s + i.qty, 0);
  const totalRevenue = sales.reduce((s, i) => s + i.revenue, 0);

  return (
    <div>
      <h1 className="egi-display" style={{ fontSize: 26, margin: "0 0 4px", fontWeight: 700 }}>Itens vendidos</h1>
      <p className="egi-sans" style={{ margin: "0 0 20px", color: "#6b5a52", fontSize: 14 }}>
        Quantidade vendida de cada produto, somando todos os pedidos recebidos.
      </p>

      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 20 }} className="egi-sans">
        {[
          { id: "todos", label: "Tudo" },
          { id: "7", label: "Últimos 7 dias" },
          { id: "30", label: "Últimos 30 dias" },
          { id: "90", label: "Últimos 90 dias" },
        ].map((p) => (
          <button key={p.id} onClick={() => setPeriod(p.id)} style={{
            padding: "7px 14px", borderRadius: 999, fontSize: 12.5, fontWeight: 600, cursor: "pointer",
            border: `1px solid ${period === p.id ? PALETTE.plum : PALETTE.line}`,
            background: period === p.id ? PALETTE.plum : "#fff",
            color: period === p.id ? "#fff" : PALETTE.ink,
          }}>{p.label}</button>
        ))}
      </div>

      <div style={{ display: "flex", gap: 14, flexWrap: "wrap", marginBottom: 20 }} className="egi-sans">
        <div style={{ background: "#fff", border: `1px solid ${PALETTE.line}`, borderRadius: 12, padding: "14px 20px", flex: "1 1 180px" }}>
          <div style={{ fontSize: 11, color: "#8a7a6f", fontWeight: 700, textTransform: "uppercase" }}>Peças vendidas</div>
          <div className="egi-display" style={{ fontSize: 26, fontWeight: 700, color: PALETTE.plum }}>{totalUnits}</div>
        </div>
        <div style={{ background: "#fff", border: `1px solid ${PALETTE.line}`, borderRadius: 12, padding: "14px 20px", flex: "1 1 180px" }}>
          <div style={{ fontSize: 11, color: "#8a7a6f", fontWeight: 700, textTransform: "uppercase" }}>Valor total</div>
          <div className="egi-display" style={{ fontSize: 26, fontWeight: 700, color: PALETTE.plum }}>{currency(totalRevenue)}</div>
        </div>
        <div style={{ background: "#fff", border: `1px solid ${PALETTE.line}`, borderRadius: 12, padding: "14px 20px", flex: "1 1 180px" }}>
          <div style={{ fontSize: 11, color: "#8a7a6f", fontWeight: 700, textTransform: "uppercase" }}>Pedidos</div>
          <div className="egi-display" style={{ fontSize: 26, fontWeight: 700, color: PALETTE.plum }}>{filteredOrders.length}</div>
        </div>
      </div>

      <div style={{ position: "relative", marginBottom: 16, maxWidth: 360 }}>
        <Search size={16} style={{ position: "absolute", left: 14, top: 12, color: "#9c8a7f" }} />
        <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Buscar produto..." className="egi-sans" style={{ ...inputBase, paddingLeft: 38 }} />
      </div>

      {visible.length === 0 ? (
        <EmptyState text="Nenhuma venda registrada nesse período ainda." />
      ) : (
        <div style={{ background: "#fff", border: `1px solid ${PALETTE.line}`, borderRadius: 12, overflow: "hidden" }} className="egi-sans">
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead>
              <tr style={{ background: PALETTE.paperDeep, textAlign: "left" }}>
                <th style={{ padding: "10px 14px" }}>Produto</th>
                <th style={{ padding: "10px 14px", width: 110, textAlign: "right" }}>Qtd. vendida</th>
                <th style={{ padding: "10px 14px", width: 130, textAlign: "right" }}>Valor</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((s, i) => {
                const variations = Object.entries(s.byVariation).filter(([k]) => k !== "Padrão");
                return (
                  <tr key={i} style={{ borderTop: `1px solid ${PALETTE.line}` }}>
                    <td style={{ padding: "10px 14px" }}>
                      <div style={{ fontWeight: 600 }}>{s.name}</div>
                      <div style={{ fontSize: 11, color: PALETTE.brass }}>{s.code}</div>
                      {variations.length > 0 && (
                        <div style={{ fontSize: 11.5, color: "#8a7a6f", marginTop: 3 }}>
                          {variations.map(([v, q]) => `${v}: ${q}`).join("  ·  ")}
                        </div>
                      )}
                    </td>
                    <td style={{ padding: "10px 14px", textAlign: "right", fontWeight: 700, fontSize: 15, color: PALETTE.plum }}>{s.qty}</td>
                    <td style={{ padding: "10px 14px", textAlign: "right" }}>{currency(s.revenue)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/* ==================== PEDIDOS ==================== */

function buildOrderPrintHtml(o) {
  const status = o.status || "aberto";
  const itemsRows = (o.items || []).map((it) => `
    <tr>
      <td>${it.qty}x</td>
      <td>${it.name}${it.variation ? " (" + it.variation + ")" : ""} ${it.code ? `<span style="color:#B8863B">[${it.code}]</span>` : ""}
        ${it.note ? `<div style="font-size:11px;color:#777;font-style:italic;margin-top:2px;">Obs: ${it.note}</div>` : ""}
      </td>
      <td style="text-align:right;white-space:nowrap;">${currency(it.price)}</td>
      <td style="text-align:right;white-space:nowrap;">${currency(it.price * it.qty)}</td>
    </tr>`).join("");

  return `<!doctype html><html><head><meta charset="utf-8"><title>Pedido ${o.orderNumber}</title>
<style>
  body { font-family: Arial, Helvetica, sans-serif; padding: 28px; color: #241318; }
  h1 { font-size: 19px; margin: 0 0 2px; }
  .muted { color: #8a7a6f; font-size: 12px; margin-bottom: 14px; }
  .badge { display: inline-block; font-size: 10.5px; font-weight: bold; padding: 2px 9px; border-radius: 999px; background: #f4eee6; margin-left: 8px; }
  .info { font-size: 13px; margin-bottom: 16px; line-height: 1.7; }
  table { width: 100%; border-collapse: collapse; margin-top: 6px; }
  th, td { padding: 7px 8px; border-bottom: 1px solid #ddd; font-size: 13px; text-align: left; vertical-align: top; }
  th { background: #f4eee6; }
  .total { text-align: right; font-size: 16px; font-weight: bold; margin-top: 14px; }
  @media print { body { padding: 10mm; } }
</style></head><body>
  <h1>EGI Distribuidora — Pedido #${o.orderNumber} <span class="badge">${status === "enviado" ? "Enviado" : "Em aberto"}</span></h1>
  <div class="muted">${new Date(o.createdAt).toLocaleString("pt-BR")}</div>
  <div class="info">
    <div><strong>Cliente/Empresa:</strong> ${o.companyName}</div>
    <div><strong>Telefone:</strong> ${o.phone}</div>
    <div><strong>CPF/CNPJ:</strong> ${o.document}</div>
  </div>
  <table>
    <thead><tr><th>Qtd</th><th>Item</th><th style="text-align:right">Unit.</th><th style="text-align:right">Subtotal</th></tr></thead>
    <tbody>${itemsRows}</tbody>
  </table>
  <div class="total">Total: ${currency(o.total)}</div>
</body></html>`;
}

function printOrder(order) {
  const win = window.open("", "_blank");
  if (!win) return;
  win.document.write(buildOrderPrintHtml(order));
  win.document.close();
  win.focus();
  setTimeout(() => win.print(), 350);
}

/* ---------------- Exportar pedido (Leiaute Modelo 002) ---------------- */
// Formato exigido pelo sistema de notas/romaneio: um arquivo por pedido,
// campos separados por "|", número decimal com ponto e duas casas.
// REGISTRO 202 (item): REG|CODIGO_BARRA|REFERENCIA|VL_UNIT|QUANTIDADE|
// O campo "código" cadastrado no portal é usado como REFERENCIA — o
// portal não guarda código de barras separadamente.

function n2(value) {
  return (Number(value) || 0).toFixed(2);
}

// o leiaute proíbe o caractere "|" dentro dos campos, então qualquer "|"
// que porventura exista em nome/código/observação é removido na exportação.
function safeField(value) {
  return String(value ?? "").replace(/\|/g, "");
}

function buildModelo002(order) {
  const lines = [];
  lines.push("002|");
  lines.push(`102|${safeField(order.orderNumber)}|`);
  (order.items || []).forEach((it) => {
    lines.push(`202||${safeField(it.code)}|${n2(it.price)}|${n2(it.qty)}|`);
  });
  lines.push("302|");
  return lines.join("\r\n") + "\r\n";
}

function exportOrderModelo002(order) {
  const content = buildModelo002(order);
  const blob = new Blob([content], { type: "text/plain;charset=ascii" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${order.orderNumber}.txt`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function printOrdersBulk(orders) {
  const win = window.open("", "_blank");
  if (!win) return;
  const pages = orders.map((o, i) => {
    const inner = buildOrderPrintHtml(o).match(/<body>([\s\S]*)<\/body>/)[1];
    return `<div style="${i > 0 ? "page-break-before: always;" : ""}">${inner}</div>`;
  }).join("");
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>Pedidos</title>
<style>
  body { font-family: Arial, Helvetica, sans-serif; padding: 28px; color: #241318; }
  h1 { font-size: 19px; margin: 0 0 2px; }
  .muted { color: #8a7a6f; font-size: 12px; margin-bottom: 14px; }
  .badge { display: inline-block; font-size: 10.5px; font-weight: bold; padding: 2px 9px; border-radius: 999px; background: #f4eee6; margin-left: 8px; }
  .info { font-size: 13px; margin-bottom: 16px; line-height: 1.7; }
  table { width: 100%; border-collapse: collapse; margin-top: 6px; }
  th, td { padding: 7px 8px; border-bottom: 1px solid #ddd; font-size: 13px; text-align: left; vertical-align: top; }
  th { background: #f4eee6; }
  .total { text-align: right; font-size: 16px; font-weight: bold; margin-top: 14px; }
  @media print { body { padding: 10mm; } }
</style></head><body>${pages}</body></html>`;
  win.document.write(html);
  win.document.close();
  win.focus();
  setTimeout(() => win.print(), 400);
}

async function exportOrdersBulk(orders) {
  const JSZip = (await import("jszip")).default;
  const zip = new JSZip();
  orders.forEach((o) => {
    zip.file(`${o.orderNumber}.txt`, buildModelo002(o));
  });
  const blob = await zip.generateAsync({ type: "blob" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  const today = new Date().toISOString().slice(0, 10);
  a.download = `pedidos_${today}.zip`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function OrdersPanel({ orders }) {
  const [statusFilter, setStatusFilter] = useState("todos");
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(() => new Set());
  const [expandedItems, setExpandedItems] = useState(() => new Set());
  const toggleItemsExpanded = (id) => setExpandedItems((prev) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });
  const nq = normalizeText(query);
  const bySearch = orders.filter((o) => {
    if (!nq) return true;
    const haystack = [
      o.orderNumber, o.companyName, o.phone, o.document,
      ...(o.items || []).map((it) => `${it.name} ${it.code}`),
    ].join(" ");
    return normalizeText(haystack).includes(nq);
  });
  const filtered = statusFilter === "todos" ? bySearch : bySearch.filter((o) => (o.status || "aberto") === statusFilter);

  const toggleSelect = (id) => setSelected((prev) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });
  const allFilteredSelected = filtered.length > 0 && filtered.every((o) => selected.has(o.id));
  const toggleSelectAll = () => setSelected((prev) => {
    if (allFilteredSelected) {
      const next = new Set(prev);
      filtered.forEach((o) => next.delete(o.id));
      return next;
    }
    const next = new Set(prev);
    filtered.forEach((o) => next.add(o.id));
    return next;
  });
  const selectedOrders = orders.filter((o) => selected.has(o.id));

  if (orders.length === 0) return <EmptyState text="Nenhum pedido recebido ainda. Assim que uma cliente finalizar uma compra na vitrine, ele aparece aqui." />;
  return (
    <div>
      <h1 className="egi-display" style={{ fontSize: 26, margin: "0 0 4px", fontWeight: 700 }}>Pedidos recebidos</h1>
      <p className="egi-sans" style={{ margin: "0 0 16px", color: "#6b5a52", fontSize: 14 }}>{orders.length} pedidos no total</p>

      <div style={{ position: "relative", marginBottom: 14, maxWidth: 360 }}>
        <Search size={16} style={{ position: "absolute", left: 14, top: 12, color: "#9c8a7f" }} />
        <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Buscar por cliente, telefone, nº do pedido, produto..." className="egi-sans" style={{ ...inputBase, paddingLeft: 38 }} />
      </div>

      <div className="egi-sans" style={{ display: "flex", gap: 6, marginBottom: 14, flexWrap: "wrap", alignItems: "center" }}>
        {[["todos", "Todos"], ["aberto", "Em aberto"], ["enviado", "Enviado"]].map(([val, label]) => (
          <button key={val} onClick={() => setStatusFilter(val)} style={{
            padding: "6px 14px", borderRadius: 999, fontSize: 12.5, fontWeight: 600, cursor: "pointer",
            border: `1px solid ${statusFilter === val ? PALETTE.plum : PALETTE.line}`,
            background: statusFilter === val ? PALETTE.plum : "#fff",
            color: statusFilter === val ? "#fff" : PALETTE.ink,
          }}>{label}</button>
        ))}
        {filtered.length > 0 && (
          <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12.5, color: "#5c4c43", marginLeft: 8, cursor: "pointer" }}>
            <input type="checkbox" checked={allFilteredSelected} onChange={toggleSelectAll} />
            Selecionar todos os filtrados
          </label>
        )}
      </div>

      {selected.size > 0 && (
        <div className="egi-sans" style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", background: PALETTE.paperDeep, border: `1px solid ${PALETTE.line}`, borderRadius: 10, padding: "10px 14px", marginBottom: 16 }}>
          <span style={{ fontSize: 12.5, fontWeight: 700 }}>{selected.size} selecionado{selected.size > 1 ? "s" : ""}</span>
          <button onClick={() => printOrdersBulk(selectedOrders)} style={btnSecondarySmall}><Printer size={13} /> Imprimir selecionados</button>
          <button onClick={() => exportOrdersBulk(selectedOrders)} style={btnSecondarySmall}><Download size={13} /> Exportar selecionados (.zip)</button>
          <button onClick={() => setSelected(new Set())} style={{ ...btnSecondarySmall, marginLeft: "auto" }}>Limpar seleção</button>
        </div>
      )}

      {filtered.length === 0 ? (
        <EmptyState text="Nenhum pedido encontrado com esse filtro/busca." />
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {filtered.map((o) => {
            const status = o.status || "aberto";
            const isSelected = selected.has(o.id);
            return (
              <div key={o.id} style={{ background: "#fff", border: `1px solid ${isSelected ? PALETTE.plum : PALETTE.line}`, borderRadius: 12, padding: 18, display: "flex", gap: 12 }} className="egi-sans">
                <input type="checkbox" checked={isSelected} onChange={() => toggleSelect(o.id)} style={{ marginTop: 4, flexShrink: 0 }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: 8, marginBottom: 10 }}>
                    <div>
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <div style={{ fontWeight: 700, fontSize: 15, color: PALETTE.plum }}>#{o.orderNumber}</div>
                        <span style={{
                          fontSize: 10.5, fontWeight: 700, padding: "3px 9px", borderRadius: 999, textTransform: "uppercase",
                          background: status === "enviado" ? "#eef4ee" : "#fdf3e4",
                          color: status === "enviado" ? PALETTE.good : PALETTE.brass,
                        }}>{status === "enviado" ? "Enviado" : "Em aberto"}</span>
                      </div>
                      <div style={{ fontSize: 12, color: "#8a7a6f" }}>{new Date(o.createdAt).toLocaleString("pt-BR")}</div>
                    </div>
                    <div style={{ fontWeight: 700, fontSize: 16 }}>{currency(o.total)}</div>
                  </div>
                  <div style={{ display: "flex", gap: 18, flexWrap: "wrap", fontSize: 13, color: "#4a3d36", marginBottom: 12 }}>
                    <span><strong>Empresa/Cliente:</strong> {o.companyName}</span>
                    <span><strong>Telefone:</strong> {o.phone}</span>
                    <span><strong>CPF/CNPJ:</strong> {o.document}</span>
                  </div>
                  <button
                    onClick={() => toggleItemsExpanded(o.id)}
                    className="egi-sans"
                    style={{ display: "flex", alignItems: "center", gap: 6, width: "100%", textAlign: "left", background: "none", border: "none", cursor: "pointer", borderTop: `1px dashed ${PALETTE.line}`, paddingTop: 10, paddingBottom: 10, marginBottom: 2, fontSize: 13, color: "#5c4c43" }}
                  >
                    <ChevronRightIcon size={14} style={{ transform: expandedItems.has(o.id) ? "rotate(90deg)" : "none", transition: "transform 0.15s", flexShrink: 0 }} />
                    {o.items.length} {o.items.length === 1 ? "item" : "itens"} — {expandedItems.has(o.id) ? "ocultar" : "ver itens"}
                  </button>
                  {expandedItems.has(o.id) && (
                    <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 12, paddingLeft: 20 }}>
                      {o.items.map((it, i) => (
                        <div key={i} style={{ fontSize: 13 }}>
                          <div style={{ display: "flex", justifyContent: "space-between" }}>
                            <span>{it.qty}x {it.name} {it.variation ? `(${it.variation})` : ""} {it.code ? <span style={{ color: PALETTE.brass }}>[{it.code}]</span> : null}</span>
                            <span>{currency(it.price * it.qty)}</span>
                          </div>
                          {it.note && <div style={{ fontSize: 11.5, color: "#8a7a6f", fontStyle: "italic" }}>Obs: {it.note}</div>}
                        </div>
                      ))}
                    </div>
                  )}
                  <div style={{ display: "flex", gap: 8 }}>
                    <button
                      onClick={() => updateOrderStatus(o.id, status === "enviado" ? "aberto" : "enviado")}
                      className="egi-sans" style={btnSecondarySmall}
                    >
                      {status === "enviado" ? "Marcar como em aberto" : "Marcar como enviado"}
                    </button>
                    <button onClick={() => printOrder(o)} className="egi-sans" style={btnSecondarySmall}>
                      <Printer size={13} /> Imprimir
                    </button>
                    <button onClick={() => exportOrderModelo002(o)} className="egi-sans" style={btnSecondarySmall} title="Exportar no formato do sistema de notas/romaneio">
                      <Download size={13} /> Exportar
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
