import React, { useState, useEffect, useMemo, useRef, Suspense, lazy } from "react";
import {
  Search, ShoppingCart, ImageOff, X, Check, ChevronLeft, ChevronRight,
  Trash2, Plus, LayoutList, Rows3, ChevronDown, User, LogOut, Package, Share2, FileDown,
} from "lucide-react";
import {
  subscribeProducts, subscribeCategories, createOrder,
  subscribeAuth, signOutUser,
} from "./data";
import FilterBar from "./FilterBar";
import { generateCatalogPdf } from "./catalogPdf";
// carregado só quando alguém realmente clica em "Entrar" ou "Minha conta" —
// a maioria das pessoas que só navega e compra nunca baixa esse código.
const AuthModal = lazy(() => import("./CustomerAccount").then((m) => ({ default: m.AuthModal })));
const MyOrdersModal = lazy(() => import("./CustomerAccount").then((m) => ({ default: m.MyOrdersModal })));
import {
  PALETTE, currency, normalizeText, activeVariations, minPrice, unitPriceOf, cld, CLD_THUMB, CLD_DETAIL, CLD_FULL, LoadingBlock, EmptyState, Field, ErrorBanner,
  btnPrimary, btnSecondarySmall, inputBase, inputSmall, iconBtn,
  overlayStyle, modalStyle, modalHeaderStyle, FONT_IMPORT,
} from "./shared";

const WHATSAPP_NUMBER = "5511998808099";

async function shareProduct(product, onCopied) {
  const price = minPrice(product);
  const url = `${window.location.origin}${window.location.pathname}?produto=${product.id}`;
  const shareData = { title: product.name, text: `${product.name} — ${currency(price)}`, url };
  if (navigator.share) {
    try { await navigator.share(shareData); } catch { /* usuário cancelou, tudo bem */ }
    return;
  }
  try {
    await navigator.clipboard.writeText(url);
    onCopied && onCopied();
  } catch {
    onCopied && onCopied("Não foi possível copiar o link.");
  }
}

function buildFlatImages(products) {
  const flat = [];
  products.forEach((p) => {
    const imgs = p.images?.length ? p.images : (p.image ? [p.image] : []);
    imgs.forEach((url, imgIndex) => flat.push({ url, product: p, imgIndex }));
  });
  return flat;
}

export default function StoreApp() {
  const [products, setProducts] = useState([]);
  const [categories, setCategories] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [search, setSearch] = useState("");
  const [selectedCategories, setSelectedCategories] = useState([]);
  const [subcategory, setSubcategory] = useState("Todas");
  const [sort, setSort] = useState("nome");
  const [catalogMode, setCatalogMode] = useState(true);
  const [cart, setCart] = useState([]);
  const [activeProduct, setActiveProduct] = useState(null);
  const [cartOpen, setCartOpen] = useState(false);
  const [checkoutOpen, setCheckoutOpen] = useState(false);
  const [confirmedOrder, setConfirmedOrder] = useState(null);
  const [toast, setToast] = useState("");
  const [gridFullscreenIndex, setGridFullscreenIndex] = useState(null);
  const gridRefs = useRef({});
  const [pdfConfirmOpen, setPdfConfirmOpen] = useState(false);
  const [pdfProgress, setPdfProgress] = useState(null); // { current, total }
  const pdfCancelRef = useRef(false);

  // conta do cliente (opcional)
  const [user, setUser] = useState(null);
  const [authOpen, setAuthOpen] = useState(false);
  const [myOrdersOpen, setMyOrdersOpen] = useState(false);

  useEffect(() => subscribeAuth(setUser), []);

  useEffect(() => {
    const unsub1 = subscribeProducts(
      (list) => { setProducts(list); setLoading(false); },
      () => { setLoadError("Não foi possível carregar o catálogo. Tente recarregar a página."); setLoading(false); }
    );
    const unsub2 = subscribeCategories(setCategories, () => {});
    return () => { unsub1(); unsub2(); };
  }, []);

  // se chegou por um link compartilhado (?produto=ID), abre a ficha do
  // produto sozinho, uma única vez, assim que ele existir na lista.
  const openedFromLink = useRef(false);
  useEffect(() => {
    if (openedFromLink.current || products.length === 0) return;
    const params = new URLSearchParams(window.location.search);
    const targetId = params.get("produto");
    if (!targetId) { openedFromLink.current = true; return; }
    const found = products.find((p) => p.id === targetId);
    if (found) setActiveProduct(found);
    openedFromLink.current = true;
  }, [products]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(""), 1800);
    return () => clearTimeout(t);
  }, [toast]);

  const activeProducts = useMemo(() => products.filter((p) => p.active !== false), [products]);
  const topCategoryNames = useMemo(
    () => Array.from(new Set(activeProducts.map((p) => p.category).filter(Boolean))),
    [activeProducts]
  );
  const subcategoryNames = useMemo(() => {
    // subcategoria só faz sentido com exatamente uma categoria escolhida
    if (selectedCategories.length !== 1) return [];
    const cat = selectedCategories[0];
    const subs = Array.from(new Set(
      activeProducts.filter((p) => p.category === cat && p.subcategory).map((p) => p.subcategory)
    ));
    return subs.length ? ["Todas", ...subs] : [];
  }, [activeProducts, selectedCategories]);

  const filtered = useMemo(() => {
    const nq = normalizeText(search);
    let list = activeProducts.filter((p) => {
      const matchesSearch = normalizeText(p.name).includes(nq) || normalizeText(p.code).includes(nq);
      const matchesCategory = selectedCategories.length === 0 || selectedCategories.includes(p.category);
      const matchesSub = subcategory === "Todas" || p.subcategory === subcategory;
      return matchesSearch && matchesCategory && matchesSub;
    });
    const priceOf = (p) => (minPrice(p));
    if (sort === "nome") list = list.slice().sort((a, b) => a.name.localeCompare(b.name));
    if (sort === "preco_asc") list = list.slice().sort((a, b) => priceOf(a) - priceOf(b));
    if (sort === "preco_desc") list = list.slice().sort((a, b) => priceOf(b) - priceOf(a));
    if (sort === "categoria") list = list.slice().sort((a, b) => (a.category || "").localeCompare(b.category || ""));
    if (sort === "novidades") list = list.slice().sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
    return list;
  }, [activeProducts, search, selectedCategories, subcategory, sort]);

  const addToCart = (product, variation, qty, note, { silent } = {}) => {
    const price = variation ? variation.price : product.basePrice;
    const lineId = `${product.id}_${variation ? variation.id : "base"}`;
    setCart((prev) => {
      const idx = prev.findIndex((l) => l.lineId === lineId);
      if (idx >= 0) {
        const next = [...prev];
        next[idx] = { ...next[idx], qty: next[idx].qty + qty, note: note || next[idx].note };
        return next;
      }
      return [...prev, {
        lineId, productId: product.id, code: product.code, name: product.name,
        variation: variation ? `${variation.color}${variation.size ? " / " + variation.size : ""}` : "",
        price, qty, note: note || "", unit: product.unit || "",
      }];
    });
    if (silent) setToast(`${product.name} adicionado ao carrinho`);
    else { setActiveProduct(null); setCartOpen(true); }
  };

  const [quickAddProduct, setQuickAddProduct] = useState(null);
  const openQuickAdd = (product) => setQuickAddProduct(product);

  // chamado pelo popup: entries = [{ variationId, label, price, qty }, ...]
  const confirmQuickAdd = (product, entries, note) => {
    entries.forEach((entry) => {
      if (entry.qty <= 0) return;
      const variation = entry.variationId
        ? { id: entry.variationId, color: entry.color, size: entry.size, price: entry.price }
        : null;
      addToCart(product, variation, entry.qty, note, { silent: true });
    });
    setQuickAddProduct(null);
  };

  const gridFlatImages = useMemo(() => buildFlatImages(filtered), [filtered]);
  const openGridFullscreen = (productId, imgIndex = 0) => {
    const idx = gridFlatImages.findIndex((f) => f.product.id === productId && f.imgIndex === imgIndex);
    if (idx >= 0) setGridFullscreenIndex(idx);
  };
  const closeGridFullscreen = (lastProductId) => {
    setGridFullscreenIndex(null);
    const el = gridRefs.current[lastProductId];
    if (el) requestAnimationFrame(() => el.scrollIntoView({ block: "center", behavior: "instant" }));
  };

  const updateQty = (lineId, qty) => {
    if (qty <= 0) { setCart((prev) => prev.filter((l) => l.lineId !== lineId)); return; }
    setCart((prev) => prev.map((l) => (l.lineId === lineId ? { ...l, qty } : l)));
  };
  const updateNote = (lineId, note) => setCart((prev) => prev.map((l) => (l.lineId === lineId ? { ...l, note } : l)));
  const removeLine = (lineId) => setCart((prev) => prev.filter((l) => l.lineId !== lineId));
  const total = cart.reduce((s, l) => s + l.price * l.qty, 0);

  const PDF_WARN_THRESHOLD = 150;
  const [pdfCategoryModalOpen, setPdfCategoryModalOpen] = useState(false);
  const [pdfSelectedProducts, setPdfSelectedProducts] = useState(null);

  const requestPdfDownload = () => {
    if (activeProducts.length === 0) return;
    setPdfCategoryModalOpen(true);
  };
  const handlePdfCategoriesConfirmed = (selectedCategories) => {
    setPdfCategoryModalOpen(false);
    const list = selectedCategories.length === 0
      ? activeProducts
      : activeProducts.filter((p) => selectedCategories.includes(p.category));
    if (list.length === 0) return;
    setPdfSelectedProducts(list);
    if (list.length > PDF_WARN_THRESHOLD) setPdfConfirmOpen(true);
    else startPdfGeneration(list);
  };
  const confirmPdfGenerationAfterWarning = () => {
    startPdfGeneration(pdfSelectedProducts);
  };
  const startPdfGeneration = async (list) => {
    const products = list || pdfSelectedProducts || [];
    setPdfConfirmOpen(false);
    pdfCancelRef.current = false;
    setPdfProgress({ current: 0, total: products.length });
    try {
      await generateCatalogPdf(products, {
        onProgress: (current, total) => setPdfProgress({ current, total }),
        cancelRef: pdfCancelRef,
      });
    } catch (e) {
      console.error(e);
      setToast("Não foi possível gerar o PDF. Tente novamente.");
    } finally {
      setPdfProgress(null);
    }
  };
  const cancelPdfGeneration = () => { pdfCancelRef.current = true; };

  const handleFinalize = async ({ companyName, phone, document }, waWindow) => {
    const order = await createOrder({
      companyName, phone, document, items: cart, total,
      userId: user ? user.uid : null,
    });
    const lines = cart.map((l) =>
      `• ${l.qty}x ${l.name}${l.variation ? " (" + l.variation + ")" : ""}${l.code ? ` [${l.code}]` : ""} — ${currency(l.price * l.qty)}${l.note ? `\n   Obs: ${l.note}` : ""}`
    ).join("\n");
    const msg = `*Novo pedido #${order.orderNumber}*\nEmpresa/Cliente: ${companyName}\nTelefone: ${phone}\nCPF/CNPJ: ${document}\n\n${lines}\n\n*Total: ${currency(total)}*`;
    const waUrl = `https://wa.me/${WHATSAPP_NUMBER}?text=${encodeURIComponent(msg)}`;
    // A aba já foi aberta (em branco) no exato clique do botão, antes desta
    // função assíncrona rodar — é o que evita o navegador bloquear o pop-up.
    // Aqui só preenchemos o endereço final nela.
    if (waWindow && !waWindow.closed) {
      waWindow.location.href = waUrl;
    } else {
      window.open(waUrl, "_blank");
    }
    setConfirmedOrder(order);
    setCart([]);
    setCheckoutOpen(false);
    setCartOpen(false);
  };

  return (
    <div style={{ fontFamily: "'Nunito', sans-serif", minHeight: "100vh", background: PALETTE.paper, color: PALETTE.ink }}>
      <style>{FONT_IMPORT}</style>
      <StoreHeader
        search={search} setSearch={setSearch}
        cartCount={cart.reduce((s, l) => s + l.qty, 0)} onCartClick={() => setCartOpen(true)}
        catalogMode={catalogMode} setCatalogMode={setCatalogMode}
        user={user} onAuthClick={() => setAuthOpen(true)} onMyOrdersClick={() => setMyOrdersOpen(true)}
        onDownloadPdf={requestPdfDownload}
      />
      <ErrorBanner message={loadError} />
      <main style={{ maxWidth: catalogMode ? 720 : 1180, margin: "0 auto", padding: "22px 20px 90px" }}>
        <FilterBar
          categories={topCategoryNames} selectedCategories={selectedCategories} setSelectedCategories={setSelectedCategories}
          subcategories={subcategoryNames} subcategory={subcategory} setSubcategory={setSubcategory}
          sort={sort} setSort={setSort}
        />
        {loading ? (
          <LoadingBlock label="Carregando vitrine..." />
        ) : filtered.length === 0 ? (
          <EmptyState text="Nenhum produto encontrado com esses filtros." />
        ) : catalogMode ? (
          <CatalogMode products={filtered} />
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: 18, marginTop: 20 }}>
            {filtered.map((p) => (
              <ProductCard
                key={p.id} product={p}
                cardRef={(el) => { gridRefs.current[p.id] = el; }}
                onOpen={() => setActiveProduct(p)}
                onImageClick={(imgIndex) => openGridFullscreen(p.id, imgIndex)}
                onQuickAdd={() => openQuickAdd(p)}
                onShare={() => shareProduct(p, (err) => setToast(err || "Link do produto copiado!"))}
              />
            ))}
          </div>
        )}
      </main>

      {activeProduct && (
        <ProductDetail product={activeProduct} onClose={() => setActiveProduct(null)} onAdd={addToCart}
          onShare={() => shareProduct(activeProduct, (err) => setToast(err || "Link do produto copiado!"))} />
      )}
      {quickAddProduct && (
        <AddToCartModal product={quickAddProduct} onClose={() => setQuickAddProduct(null)} onConfirm={confirmQuickAdd} />
      )}
      {gridFullscreenIndex !== null && (
        <FullscreenPhotoViewer
          items={gridFlatImages} initialIndex={gridFullscreenIndex} onClose={closeGridFullscreen}
          onAddToCart={(p, v, q, n) => addToCart(p, v, q, n, { silent: true })}
        />
      )}
      {cartOpen && (
        <CartDrawer cart={cart} total={total} onClose={() => setCartOpen(false)}
          onUpdateQty={updateQty} onRemove={removeLine} onUpdateNote={updateNote}
          onCheckout={() => { setCartOpen(false); setCheckoutOpen(true); }} />
      )}
      {checkoutOpen && <CheckoutModal total={total} user={user} onClose={() => setCheckoutOpen(false)} onConfirm={handleFinalize} />}
      {confirmedOrder && <OrderConfirmedModal order={confirmedOrder} loggedIn={!!user} onClose={() => setConfirmedOrder(null)} />}
      {authOpen && (
        <Suspense fallback={null}><AuthModal onClose={() => setAuthOpen(false)} /></Suspense>
      )}
      {myOrdersOpen && user && (
        <Suspense fallback={null}><MyOrdersModal user={user} onClose={() => setMyOrdersOpen(false)} /></Suspense>
      )}
      {pdfCategoryModalOpen && (
        <PdfCategoryModal categories={topCategoryNames} onCancel={() => setPdfCategoryModalOpen(false)} onConfirm={handlePdfCategoriesConfirmed} />
      )}
      {pdfConfirmOpen && (
        <PdfConfirmModal count={pdfSelectedProducts?.length || 0} onCancel={() => setPdfConfirmOpen(false)} onConfirm={confirmPdfGenerationAfterWarning} />
      )}
      {pdfProgress && (
        <PdfProgressModal progress={pdfProgress} onCancel={cancelPdfGeneration} />
      )}
      {toast && (
        <div className="egi-sans" style={{ position: "fixed", bottom: 24, left: "50%", transform: "translateX(-50%)", background: PALETTE.ink, color: "#fff", padding: "10px 18px", borderRadius: 999, fontSize: 13, zIndex: 90, display: "flex", alignItems: "center", gap: 8, boxShadow: "0 8px 24px rgba(0,0,0,0.25)" }}>
          <Check size={14} /> {toast}
        </div>
      )}
    </div>
  );
}

/* ==================== CABEÇALHO ==================== */

function PdfCategoryModal({ categories, onCancel, onConfirm }) {
  const [selected, setSelected] = useState(() => new Set());

  const toggle = (cat) => setSelected((prev) => {
    const next = new Set(prev);
    if (next.has(cat)) next.delete(cat); else next.add(cat);
    return next;
  });
  const allSelected = selected.size === 0 || selected.size === categories.length;
  const toggleAll = () => setSelected((prev) => (prev.size === categories.length ? new Set() : new Set(categories)));

  return (
    <div style={overlayStyle} onClick={onCancel}>
      <div style={{ ...modalStyle, maxWidth: 420 }} onClick={(e) => e.stopPropagation()}>
        <div style={modalHeaderStyle}>
          <h2 className="egi-display" style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>Baixar PDF</h2>
          <button onClick={onCancel} style={iconBtn}><X size={18} /></button>
        </div>
        <div style={{ padding: 22 }} className="egi-sans">
          <p style={{ fontSize: 13, color: "#5c4c43", marginTop: 0, marginBottom: 16 }}>
            Escolha uma ou mais categorias para incluir no PDF. Deixe tudo desmarcado para baixar o catálogo inteiro.
          </p>
          <label style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 4px", fontWeight: 700, fontSize: 13, cursor: "pointer", borderBottom: `1px solid ${PALETTE.line}`, marginBottom: 6 }}>
            <input type="checkbox" checked={allSelected} onChange={toggleAll} />
            Todas as categorias
          </label>
          <div style={{ maxHeight: 260, overflowY: "auto", display: "flex", flexDirection: "column", gap: 2 }}>
            {categories.map((cat) => (
              <label key={cat} style={{ display: "flex", alignItems: "center", gap: 8, padding: "7px 4px", fontSize: 13.5, cursor: "pointer" }}>
                <input type="checkbox" checked={selected.has(cat)} onChange={() => toggle(cat)} />
                {cat}
              </label>
            ))}
          </div>
          <button onClick={() => onConfirm(Array.from(selected))} style={{ ...btnPrimary, width: "100%", justifyContent: "center", marginTop: 20 }}>
            <FileDown size={16} /> Gerar PDF
          </button>
        </div>
      </div>
    </div>
  );
}

function PdfConfirmModal({ count, onCancel, onConfirm }) {
  return (
    <div style={overlayStyle} onClick={onCancel}>
      <div style={{ ...modalStyle, maxWidth: 400, textAlign: "center" }} onClick={(e) => e.stopPropagation()}>
        <div style={{ padding: "32px 26px" }} className="egi-sans">
          <FileDown size={30} color={PALETTE.brass} style={{ marginBottom: 12 }} />
          <h2 className="egi-display" style={{ fontSize: 18, fontWeight: 700, margin: "0 0 10px" }}>Catálogo grande</h2>
          <p style={{ fontSize: 13.5, color: "#5c4c43", lineHeight: 1.6, marginBottom: 8 }}>
            Isso vai gerar um PDF com <strong>{count} produtos</strong> — produtos com mais de uma foto geram uma página por foto, então o arquivo pode ficar maior que isso. Pode demorar alguns minutos e usar bastante memória do celular.
          </p>
          <p style={{ fontSize: 12.5, color: "#8a7a6f", lineHeight: 1.5, marginBottom: 22 }}>
            Se quiser algo mais rápido e leve, feche esta janela e filtre por uma categoria antes de baixar.
          </p>
          <div style={{ display: "flex", gap: 10 }}>
            <button onClick={onCancel} style={{ ...btnSecondarySmall, flex: 1, justifyContent: "center" }}>Cancelar</button>
            <button onClick={onConfirm} style={{ ...btnPrimary, flex: 1, justifyContent: "center" }}>Gerar mesmo assim</button>
          </div>
        </div>
      </div>
    </div>
  );
}

function PdfProgressModal({ progress, onCancel }) {
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

function StoreHeader({ search, setSearch, cartCount, onCartClick, catalogMode, setCatalogMode, user, onAuthClick, onMyOrdersClick, onDownloadPdf }) {
  const [menuOpen, setMenuOpen] = useState(false);
  return (
    <header style={{ background: PALETTE.plumDeep, color: PALETTE.paper, position: "sticky", top: 0, zIndex: 30, borderRadius: "0 0 28px 28px", overflow: "hidden" }}>
      <div style={{ position: "absolute", right: -30, top: -30, width: 120, height: 120, background: PALETTE.brass, borderRadius: "50%", opacity: 0.35, pointerEvents: "none" }} />
      <div style={{ position: "absolute", left: "55%", bottom: -40, width: 80, height: 80, background: PALETTE.sun, borderRadius: "50%", opacity: 0.3, pointerEvents: "none" }} />
      <div style={{ maxWidth: 1180, margin: "0 auto", padding: "16px 20px", display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", position: "relative" }}>
        <div style={{ flex: "0 0 auto" }}>
          <div className="egi-display" style={{ fontSize: 24, fontWeight: 800 }}>EGI ✦ bijus & cia</div>
          <div className="egi-sans" style={{ fontSize: 11.5, fontWeight: 600, color: "#F4D9EA" }}>tudo pro seu salão brilhar mais</div>
        </div>

        <div style={{ position: "relative", flex: "1 1 220px", minWidth: 160 }}>
          <Search size={16} style={{ position: "absolute", left: 14, top: 12, color: "#c9b8ac" }} />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Buscar produto ou código..." className="egi-sans"
            style={{ ...inputBase, paddingLeft: 38, borderRadius: 999, background: "rgba(255,255,255,0.12)", color: "#fff", border: "1px solid rgba(255,255,255,0.25)" }} />
        </div>

        <button onClick={() => setCatalogMode((v) => !v)} className="egi-sans" title="Alternar modo de exibição" style={{
          ...btnSecondarySmall, padding: "9px 16px", boxShadow: "none",
          background: catalogMode ? PALETTE.brass : "rgba(255,255,255,0.14)", color: "#fff", border: "1px solid rgba(255,255,255,0.25)",
        }}>
          {catalogMode ? <><LayoutList size={14} /> Modo loja</> : <><Rows3 size={14} /> Modo catálogo</>}
        </button>

        <button onClick={onDownloadPdf} className="egi-sans" title="Baixar catálogo em PDF para ver offline" style={{
          ...btnSecondarySmall, padding: "9px 16px", boxShadow: "none",
          background: "rgba(255,255,255,0.14)", color: "#fff", border: "1px solid rgba(255,255,255,0.25)",
        }}>
          <FileDown size={14} /> Baixar PDF
        </button>

        {user ? (
          <div style={{ position: "relative" }}>
            <button onClick={() => setMenuOpen((v) => !v)} className="egi-sans" style={{
              ...btnSecondarySmall, padding: "9px 16px", boxShadow: "none",
              background: "rgba(255,255,255,0.14)", color: "#fff", border: "1px solid rgba(255,255,255,0.25)",
            }}>
              <User size={14} /> Minha conta <ChevronDown size={13} />
            </button>
            {menuOpen && (
              <div className="egi-sans" style={{ position: "absolute", top: "calc(100% + 6px)", right: 0, background: "#fff", color: PALETTE.ink, borderRadius: 12, border: `1px solid ${PALETTE.line}`, boxShadow: "0 10px 30px rgba(0,0,0,0.2)", minWidth: 210, padding: 6, zIndex: 45 }}>
                <div style={{ padding: "8px 12px", fontSize: 11.5, color: "#8a7a6f", borderBottom: `1px solid ${PALETTE.line}`, marginBottom: 4, wordBreak: "break-all" }}>{user.email}</div>
                <button onClick={() => { setMenuOpen(false); onMyOrdersClick(); }} style={{ display: "flex", alignItems: "center", gap: 8, width: "100%", padding: "9px 12px", border: "none", background: "transparent", cursor: "pointer", fontSize: 13, borderRadius: 8, textAlign: "left" }}>
                  <Package size={14} /> Meus pedidos
                </button>
                <button onClick={() => { setMenuOpen(false); signOutUser(); }} style={{ display: "flex", alignItems: "center", gap: 8, width: "100%", padding: "9px 12px", border: "none", background: "transparent", cursor: "pointer", fontSize: 13, borderRadius: 8, color: PALETTE.bad, textAlign: "left" }}>
                  <LogOut size={14} /> Sair
                </button>
              </div>
            )}
          </div>
        ) : (
          <button onClick={onAuthClick} className="egi-sans" style={{
            ...btnSecondarySmall, padding: "9px 14px",
            background: "rgba(244,238,230,0.1)", color: "#fff", border: "1px solid rgba(244,238,230,0.25)",
          }}>
            <User size={14} /> Entrar
          </button>
        )}

        <button onClick={onCartClick} className="egi-sans" style={{ ...btnPrimary, position: "relative" }}>
          <ShoppingCart size={16} /> Carrinho
          {cartCount > 0 && (
            <span style={{ position: "absolute", top: -8, right: -8, background: PALETTE.bad, color: "#fff", fontSize: 11, fontWeight: 700, borderRadius: 999, minWidth: 20, height: 20, display: "flex", alignItems: "center", justifyContent: "center" }}>{cartCount}</span>
          )}
        </button>
      </div>
    </header>
  );
}

/* ==================== CONTA DO CLIENTE ==================== */

/* ==================== CARDS / VITRINE ==================== */

function ProductCard({ product, onOpen, onImageClick, onQuickAdd, onShare, cardRef }) {
  const price = minPrice(product);
  const images = (product.images?.length ? product.images : (product.image ? [product.image] : []));
  const unitPrice = unitPriceOf(product, price);
  const variationCount = activeVariations(product).length;
  const placeholderGradients = [
    "linear-gradient(135deg,#FBD5E8,#F7A8CF)",
    "linear-gradient(135deg,#D6C6F0,#B79AE0)",
    "linear-gradient(135deg,#FFF0BF,#FFD86B)",
    "linear-gradient(135deg,#BEF0DE,#7EDCB8)",
  ];
  const phGrad = placeholderGradients[Math.abs((product.code || product.id || "").split("").reduce((s, c) => s + c.charCodeAt(0), 0)) % placeholderGradients.length];
  return (
    <div ref={cardRef} style={{ background: "#fff", borderRadius: 20, overflow: "hidden", scrollMarginTop: 90, boxShadow: "0 4px 14px rgba(91,42,134,0.10)" }}>
      <div style={{ display: "flex", gap: 2, aspectRatio: "1", position: "relative" }}>
        {(images.length ? images : [null, null]).slice(0, 2).map((url, i) => (
          <div key={i} onClick={() => url && onImageClick(i)} style={{ flex: 1, background: url ? PALETTE.paperDeep : phGrad, display: "flex", alignItems: "center", justifyContent: "center", cursor: url ? "pointer" : "default", overflow: "hidden" }}>
            {url ? (
              <img src={cld(url, CLD_THUMB)} alt={product.name} style={{ width: "100%", height: "100%", objectFit: "cover" }} loading="lazy" decoding="async" onError={(e) => { e.target.style.display = "none"; }} />
            ) : <ImageOff size={22} color="rgba(43,27,51,0.35)" />}
          </div>
        ))}
        <button onClick={(e) => { e.stopPropagation(); onShare(); }} title="Compartilhar" style={{
          position: "absolute", top: 8, right: 8, width: 30, height: 30, borderRadius: "50%",
          background: "rgba(43,27,51,0.55)", color: "#fff", border: "none", display: "flex", alignItems: "center", justifyContent: "center",
          cursor: "pointer", backdropFilter: "blur(2px)",
        }}>
          <Share2 size={14} />
        </button>
        <button onClick={(e) => { e.stopPropagation(); onQuickAdd(); }} title="Adicionar ao carrinho" style={{
          position: "absolute", bottom: 8, right: 8, width: 34, height: 34, borderRadius: "50%",
          background: PALETTE.brass, color: "#fff", border: "none", display: "flex", alignItems: "center", justifyContent: "center",
          cursor: "pointer", boxShadow: "0 3px 0 #A31650", fontWeight: 800,
        }}>
          <Plus size={18} />
        </button>
      </div>
      <div onClick={onOpen} style={{ padding: 13, cursor: "pointer" }} className="egi-sans">
        <div style={{ fontSize: 10.5, color: PALETTE.brass, fontWeight: 700, letterSpacing: 0.5 }}>{product.code}</div>
        <div className="egi-display" style={{ fontSize: 15, fontWeight: 700, margin: "3px 0 6px", lineHeight: 1.25, minHeight: 38 }}>{product.name}</div>
        <div style={{ fontSize: 16, fontWeight: 800, color: PALETTE.plum }}>{currency(price)}</div>
        {unitPrice != null && <div style={{ fontSize: 11, color: "#8a7a6f" }}>Unitário: {currency(unitPrice)}</div>}
        {variationCount > 1 && <div style={{ fontSize: 11, color: "#8a7a6f", marginTop: 2 }}>{variationCount} variações</div>}
      </div>
    </div>
  );
}

function ImageCarousel({ images }) {
  const trackRef = useRef(null);
  const [index, setIndex] = useState(0);
  const list = images?.length ? images : [null];

  const onScroll = () => {
    const el = trackRef.current;
    if (!el) return;
    setIndex(Math.round(el.scrollLeft / el.clientWidth));
  };
  const goTo = (i) => {
    const el = trackRef.current;
    if (!el) return;
    el.scrollTo({ left: i * el.clientWidth, behavior: "smooth" });
  };

  return (
    <div style={{ position: "relative", width: 220, height: 220, flexShrink: 0 }}>
      <div ref={trackRef} onScroll={onScroll} style={{
        width: "100%", height: "100%", borderRadius: 12, display: "flex", overflowX: "auto", overflowY: "hidden",
        scrollSnapType: "x mandatory", WebkitOverflowScrolling: "touch", background: PALETTE.paperDeep,
      }}>
        {list.map((url, i) => (
          <div key={i} style={{ minWidth: "100%", height: "100%", scrollSnapAlign: "start", display: "flex", alignItems: "center", justifyContent: "center" }}>
            {url ? <img src={cld(url, CLD_DETAIL)} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} onError={(e) => { e.target.style.display = "none"; }} /> : <ImageOff size={30} color="#b3a494" />}
          </div>
        ))}
      </div>
      {list.length > 1 && (
        <>
          <div style={{ position: "absolute", bottom: 8, left: 0, right: 0, display: "flex", justifyContent: "center", gap: 5 }}>
            {list.map((_, i) => (
              <span key={i} onClick={() => goTo(i)} style={{ width: 6, height: 6, borderRadius: "50%", cursor: "pointer", background: i === index ? PALETTE.brass : "rgba(255,255,255,0.7)", border: `1px solid ${PALETTE.brass}` }} />
            ))}
          </div>
          {index > 0 && <button onClick={() => goTo(index - 1)} style={{ position: "absolute", left: 6, top: "50%", transform: "translateY(-50%)", background: "rgba(255,255,255,0.85)", border: "none", borderRadius: "50%", width: 26, height: 26, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}><ChevronLeft size={15} /></button>}
          {index < list.length - 1 && <button onClick={() => goTo(index + 1)} style={{ position: "absolute", right: 6, top: "50%", transform: "translateY(-50%)", background: "rgba(255,255,255,0.85)", border: "none", borderRadius: "50%", width: 26, height: 26, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}><ChevronRight size={15} /></button>}
        </>
      )}
    </div>
  );
}

function ProductDetail({ product, onClose, onAdd, onShare }) {
  const variationsList = activeVariations(product);
  const hasVariations = variationsList.length > 0;
  const [variationId, setVariationId] = useState(hasVariations ? variationsList[0].id : null);
  const [qty, setQty] = useState(1);
  const [note, setNote] = useState("");
  const variation = hasVariations ? variationsList.find((v) => v.id === variationId) : null;
  const price = variation ? variation.price : product.basePrice;
  const unitPrice = unitPriceOf(product, price);
  const images = product.images?.length ? product.images : (product.image ? [product.image] : []);

  return (
    <div style={overlayStyle} onClick={onClose}>
      <div style={{ ...modalStyle, maxWidth: 620 }} onClick={(e) => e.stopPropagation()}>
        <div style={modalHeaderStyle}>
          <h2 className="egi-display" style={{ margin: 0, fontSize: 19, fontWeight: 700 }}>{product.name}</h2>
          <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
            <button onClick={onShare} title="Compartilhar" style={iconBtn}><Share2 size={17} /></button>
            <button onClick={onClose} style={iconBtn}><X size={18} /></button>
          </div>
        </div>
        <div style={{ padding: 24, overflowY: "auto" }} className="egi-sans">
          <div style={{ display: "flex", gap: 20, flexWrap: "wrap" }}>
            <ImageCarousel images={images} />
            <div style={{ flex: 1, minWidth: 220 }}>
              <div style={{ fontSize: 11, color: PALETTE.brass, fontWeight: 700, marginBottom: 4 }}>
                {product.code ? `${product.code} · ` : ""}{product.category}{product.subcategory ? ` › ${product.subcategory}` : ""}
              </div>
              {product.description && <p style={{ fontSize: 13.5, color: "#5c4c43", lineHeight: 1.5, marginBottom: 12 }}>{product.description}</p>}
              <div style={{ fontSize: 22, fontWeight: 700, color: PALETTE.plum }}>
                {currency(price)}{product.unit ? <span style={{ fontSize: 12, fontWeight: 500, color: "#8a7a6f" }}> / {product.unit}</span> : null}
              </div>
              {unitPrice != null
                ? <div style={{ fontSize: 12.5, color: "#8a7a6f", marginBottom: 14 }}>Valor unitário: {currency(unitPrice)} (pacote com {product.packageQty})</div>
                : <div style={{ marginBottom: 14 }} />}

              {hasVariations && (
                <div style={{ marginBottom: 14 }}>
                  <div style={{ fontWeight: 600, fontSize: 12.5, marginBottom: 6 }}>Escolha a variação</div>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                    {variationsList.map((v) => (
                      <button key={v.id} onClick={() => setVariationId(v.id)} style={{
                        padding: "7px 12px", borderRadius: 8, fontSize: 12.5, cursor: "pointer",
                        border: `1px solid ${variationId === v.id ? PALETTE.plum : PALETTE.line}`,
                        background: variationId === v.id ? PALETTE.plum : "#fff",
                        color: variationId === v.id ? "#fff" : PALETTE.ink,
                      }}>
                        {v.color}{v.size ? ` / ${v.size}` : ""} — {currency(v.price)}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 14 }}>
                <div style={{ fontWeight: 600, fontSize: 12.5 }}>Quantidade</div>
                <div style={{ display: "flex", alignItems: "center", border: `1px solid ${PALETTE.line}`, borderRadius: 8 }}>
                  <button onClick={() => setQty((q) => Math.max(1, q - 1))} style={{ ...iconBtn, padding: "6px 10px" }}><ChevronLeft size={14} /></button>
                  <input type="number" value={qty} onChange={(e) => setQty(Math.max(1, Number(e.target.value) || 1))} style={{ width: 50, textAlign: "center", border: "none", outline: "none", fontSize: 14 }} />
                  <button onClick={() => setQty((q) => q + 1)} style={{ ...iconBtn, padding: "6px 10px" }}><ChevronRight size={14} /></button>
                </div>
              </div>

              <div style={{ marginBottom: 14 }}>
                <div style={{ fontWeight: 600, fontSize: 12.5, marginBottom: 6 }}>Observação (opcional)</div>
                <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Ex: embalar separado, cor específica..." style={inputBase} />
              </div>

              <button onClick={() => onAdd(product, variation, qty, note)} className="egi-sans" style={{ ...btnPrimary, width: "100%", justifyContent: "center" }}>
                <ShoppingCart size={16} /> Adicionar ao carrinho
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ==================== TELA CHEIA ==================== */

function FullscreenPhotoViewer({ items, initialIndex, onClose, onAddToCart }) {
  const trackRef = useRef(null);
  const [index, setIndex] = useState(initialIndex);
  const indexRef = useRef(initialIndex);
  const [variationId, setVariationId] = useState(null);
  const [qty, setQty] = useState(1);
  const current = items[index];

  useEffect(() => {
    const el = trackRef.current;
    if (!el) return;
    el.scrollTo({ top: initialIndex * el.clientHeight, behavior: "instant" });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const vars = current?.product ? activeVariations(current.product) : [];
    if (vars.length) setVariationId(vars[0].id);
    else setVariationId(null);
    setQty(1);
  }, [current?.product?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const onScroll = () => {
    const el = trackRef.current;
    if (!el) return;
    const i = Math.round(el.scrollTop / el.clientHeight);
    if (i !== indexRef.current) { indexRef.current = i; setIndex(i); }
  };

  const close = () => onClose(items[indexRef.current]?.product.id);
  const currentVariations = current?.product ? activeVariations(current.product) : [];
  const variation = currentVariations.length ? currentVariations.find((v) => v.id === variationId) : null;
  const price = variation ? variation.price : current?.product?.basePrice;

  return (
    <div style={{ position: "fixed", inset: 0, background: "#000", zIndex: 80 }} className="egi-sans">
      <div ref={trackRef} onScroll={onScroll}
        style={{ width: "100%", height: "100%", overflowY: "auto", scrollSnapType: "y mandatory", WebkitOverflowScrolling: "touch" }}>
        {items.map((item, i) => (
          <div key={i} style={{ width: "100%", height: "100%", scrollSnapAlign: "start", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <img src={cld(item.url, CLD_FULL)} alt="" style={{ maxWidth: "100%", maxHeight: "100%", objectFit: "contain" }} loading="lazy" decoding="async" />
          </div>
        ))}
      </div>

      <button onClick={close} style={{ position: "absolute", top: 18, right: 18, width: 38, height: 38, borderRadius: "50%", background: "rgba(255,255,255,0.15)", border: "none", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}>
        <X size={20} />
      </button>

      {index < items.length - 1 && (
        <div style={{ position: "absolute", bottom: 215, left: "50%", transform: "translateX(-50%)", color: "rgba(255,255,255,0.55)", display: "flex", flexDirection: "column", alignItems: "center", fontSize: 10.5 }}>
          <span>deslize para o próximo</span>
          <ChevronDown size={16} />
        </div>
      )}

      {current && (
        <div style={{ position: "absolute", bottom: 0, left: 0, right: 0, padding: "40px 18px 20px", background: "linear-gradient(to top, rgba(0,0,0,0.9), transparent)", color: "#fff" }}>
          <div className="egi-display" style={{ fontSize: 18, fontWeight: 700 }}>{current.product.name}</div>
          <div style={{ fontSize: 12, opacity: 0.75, marginTop: 2 }}>{current.product.code}</div>
          <div style={{ fontSize: 17, fontWeight: 700, color: PALETTE.brassLight, marginTop: 4 }}>{currency(price)}</div>

          {onAddToCart && currentVariations.length > 0 && (
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 10 }}>
              {currentVariations.map((v) => (
                <button key={v.id} onClick={() => setVariationId(v.id)} style={{
                  padding: "5px 11px", borderRadius: 999, fontSize: 11.5, cursor: "pointer",
                  border: `1px solid ${variationId === v.id ? PALETTE.brassLight : "rgba(255,255,255,0.35)"}`,
                  background: variationId === v.id ? PALETTE.brassLight : "rgba(255,255,255,0.08)",
                  color: variationId === v.id ? PALETTE.ink : "#fff",
                }}>
                  {v.color}{v.size ? ` / ${v.size}` : ""}
                </button>
              ))}
            </div>
          )}

          {onAddToCart && (
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 12 }}>
              <div style={{ display: "flex", alignItems: "center", border: "1px solid rgba(255,255,255,0.35)", borderRadius: 8 }}>
                <button onClick={() => setQty((q) => Math.max(1, q - 1))} style={{ ...iconBtn, color: "#fff", padding: "6px 10px" }}><ChevronLeft size={14} /></button>
                <input type="number" value={qty} onChange={(e) => setQty(Math.max(1, Number(e.target.value) || 1))}
                  style={{ width: 46, textAlign: "center", fontSize: 14, background: "transparent", border: "none", outline: "none", color: "#fff" }} />
                <button onClick={() => setQty((q) => q + 1)} style={{ ...iconBtn, color: "#fff", padding: "6px 10px" }}><ChevronRight size={14} /></button>
              </div>
              <button onClick={() => { onAddToCart(current.product, variation, qty, ""); setQty(1); }} className="egi-sans" style={{ ...btnPrimary, flex: 1, justifyContent: "center" }}>
                <ShoppingCart size={16} /> Adicionar ao carrinho
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* ==================== POPUP DE ADICIONAR (com variações) ==================== */

function AddToCartModal({ product, onClose, onConfirm }) {
  const variationsList = activeVariations(product);
  const hasVariations = variationsList.length > 0;
  const [simpleQty, setSimpleQty] = useState(1);
  const [qtyByVariation, setQtyByVariation] = useState({}); // { variationId: qty }
  const [sortidoQty, setSortidoQty] = useState(0);
  const [note, setNote] = useState("");

  const setVarQty = (id, qty) => setQtyByVariation((prev) => ({ ...prev, [id]: Math.max(0, qty) }));

  const sortidoPrice = hasVariations ? Math.min(...variationsList.map((v) => v.price)) : product.basePrice;

  const totalQty = hasVariations
    ? Object.values(qtyByVariation).reduce((s, q) => s + (q || 0), 0) + sortidoQty
    : simpleQty;

  const totalValue = hasVariations
    ? variationsList.reduce((s, v) => s + (qtyByVariation[v.id] || 0) * v.price, 0) + sortidoQty * sortidoPrice
    : simpleQty * product.basePrice;

  const confirm = () => {
    if (totalQty <= 0) return;
    if (!hasVariations) {
      onConfirm(product, [{ variationId: null, qty: simpleQty, price: product.basePrice }], note);
      return;
    }
    const entries = variationsList
      .filter((v) => (qtyByVariation[v.id] || 0) > 0)
      .map((v) => ({ variationId: v.id, color: v.color, size: v.size, price: v.price, qty: qtyByVariation[v.id] }));
    if (sortidoQty > 0) {
      entries.push({ variationId: "sortido", color: "Sortido", size: "", price: sortidoPrice, qty: sortidoQty });
    }
    onConfirm(product, entries, note);
  };

  const cover = product.images?.[0] || product.image;

  return (
    <div style={overlayStyle} onClick={onClose}>
      <div style={{ ...modalStyle, maxWidth: 440 }} onClick={(e) => e.stopPropagation()}>
        <div style={modalHeaderStyle}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div style={{ width: 40, height: 40, borderRadius: 8, overflow: "hidden", background: PALETTE.paperDeep, flexShrink: 0 }}>
              {cover ? <img src={cld(cover, CLD_THUMB)} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} /> : null}
            </div>
            <h2 className="egi-display" style={{ margin: 0, fontSize: 16, fontWeight: 700, lineHeight: 1.2 }}>{product.name}</h2>
          </div>
          <button onClick={onClose} style={iconBtn}><X size={18} /></button>
        </div>

        <div style={{ padding: 20, overflowY: "auto" }} className="egi-sans">
          {!hasVariations ? (
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
              <div>
                <div style={{ fontWeight: 600, fontSize: 13 }}>Quantidade</div>
                <div style={{ fontSize: 13, color: PALETTE.plum, fontWeight: 700, marginTop: 2 }}>{currency(product.basePrice)} cada</div>
              </div>
              <div style={{ display: "flex", alignItems: "center", border: `1px solid ${PALETTE.line}`, borderRadius: 8 }}>
                <button onClick={() => setSimpleQty((q) => Math.max(1, q - 1))} style={{ ...iconBtn, padding: "8px 12px" }}><ChevronLeft size={15} /></button>
                <input type="number" value={simpleQty} onChange={(e) => setSimpleQty(Math.max(1, Number(e.target.value) || 1))}
                  style={{ width: 50, textAlign: "center", border: "none", outline: "none", fontSize: 15 }} />
                <button onClick={() => setSimpleQty((q) => q + 1)} style={{ ...iconBtn, padding: "8px 12px" }}><ChevronRight size={15} /></button>
              </div>
            </div>
          ) : (
            <div style={{ marginBottom: 16 }}>
              <div style={{ fontWeight: 700, fontSize: 12.5, marginBottom: 8, color: "#5c4c43" }}>
                Escolha a quantidade de cada modelo
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {variationsList.map((v) => (
                  <div key={v.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, padding: "8px 10px", background: PALETTE.paperDeep, borderRadius: 10 }}>
                    <div>
                      <div style={{ fontWeight: 600, fontSize: 13 }}>{v.color}{v.size ? ` / ${v.size}` : ""}</div>
                      <div style={{ fontSize: 11.5, color: "#8a7a6f" }}>{currency(v.price)}</div>
                    </div>
                    <div style={{ display: "flex", alignItems: "center", border: `1px solid ${PALETTE.line}`, borderRadius: 8, background: "#fff" }}>
                      <button onClick={() => setVarQty(v.id, (qtyByVariation[v.id] || 0) - 1)} style={{ ...iconBtn, padding: "6px 10px" }}>−</button>
                      <input type="number" value={qtyByVariation[v.id] || 0} onChange={(e) => setVarQty(v.id, Number(e.target.value) || 0)}
                        style={{ width: 38, textAlign: "center", border: "none", outline: "none", fontSize: 13 }} />
                      <button onClick={() => setVarQty(v.id, (qtyByVariation[v.id] || 0) + 1)} style={{ ...iconBtn, padding: "6px 10px" }}>+</button>
                    </div>
                  </div>
                ))}

                {/* Sortido: sempre disponível, mesmo sem estar cadastrado como variação */}
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, padding: "8px 10px", background: "#f2ece0", borderRadius: 10, border: `1px dashed ${PALETTE.brass}` }}>
                  <div>
                    <div style={{ fontWeight: 700, fontSize: 13, color: PALETTE.brass }}>Sortido</div>
                    <div style={{ fontSize: 11.5, color: "#8a7a6f" }}>Deixa a seleção dos modelos com a gente</div>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", border: `1px solid ${PALETTE.line}`, borderRadius: 8, background: "#fff" }}>
                    <button onClick={() => setSortidoQty((q) => Math.max(0, q - 1))} style={{ ...iconBtn, padding: "6px 10px" }}>−</button>
                    <input type="number" value={sortidoQty} onChange={(e) => setSortidoQty(Math.max(0, Number(e.target.value) || 0))}
                      style={{ width: 38, textAlign: "center", border: "none", outline: "none", fontSize: 13 }} />
                    <button onClick={() => setSortidoQty((q) => q + 1)} style={{ ...iconBtn, padding: "6px 10px" }}>+</button>
                  </div>
                </div>
              </div>
            </div>
          )}

          <div style={{ marginBottom: 16 }}>
            <div style={{ fontWeight: 600, fontSize: 12.5, marginBottom: 6 }}>Observação (opcional)</div>
            <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Ex: embalar separado, cor específica..." style={inputBase} />
          </div>

          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 0", borderTop: `1px solid ${PALETTE.line}`, marginBottom: 14 }}>
            <span style={{ fontSize: 13, color: "#5c4c43" }}>{totalQty} {totalQty === 1 ? "item" : "itens"}</span>
            <span style={{ fontSize: 17, fontWeight: 700, color: PALETTE.plum }}>{currency(totalValue)}</span>
          </div>

          <button onClick={confirm} disabled={totalQty <= 0} className="egi-sans"
            style={{ ...btnPrimary, width: "100%", justifyContent: "center", opacity: totalQty <= 0 ? 0.5 : 1 }}>
            <ShoppingCart size={16} /> Adicionar ao carrinho
          </button>
        </div>
      </div>
    </div>
  );
}

/* ==================== CARRINHO / CHECKOUT ==================== */

function CartDrawer({ cart, total, onClose, onUpdateQty, onRemove, onUpdateNote, onCheckout }) {
  return (
    <div style={overlayStyle} onClick={onClose}>
      <div style={{ position: "fixed", top: 0, right: 0, height: "100%", width: "min(400px, 100%)", background: "#fff", display: "flex", flexDirection: "column", boxShadow: "-8px 0 30px rgba(0,0,0,0.15)" }} onClick={(e) => e.stopPropagation()}>
        <div style={modalHeaderStyle}>
          <h2 className="egi-display" style={{ margin: 0, fontSize: 19, fontWeight: 700 }}>Seu carrinho</h2>
          <button onClick={onClose} style={iconBtn}><X size={18} /></button>
        </div>
        <div style={{ flex: 1, overflowY: "auto", padding: 20 }} className="egi-sans">
          {cart.length === 0 ? (
            <div style={{ textAlign: "center", color: "#8a7a6f", padding: "40px 0" }}>Seu carrinho está vazio.</div>
          ) : cart.map((l) => (
            <div key={l.lineId} style={{ paddingBottom: 14, marginBottom: 14, borderBottom: `1px solid ${PALETTE.line}` }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 600, fontSize: 13.5 }}>{l.name}</div>
                  {l.variation && <div style={{ fontSize: 12, color: "#8a7a6f" }}>{l.variation}</div>}
                  <div style={{ fontSize: 11, color: PALETTE.brass }}>{l.code}</div>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 6 }}>
                    <div style={{ display: "flex", alignItems: "center", border: `1px solid ${PALETTE.line}`, borderRadius: 6 }}>
                      <button onClick={() => onUpdateQty(l.lineId, l.qty - 1)} style={{ ...iconBtn, padding: "3px 8px" }}>−</button>
                      <input type="number" value={l.qty} onChange={(e) => onUpdateQty(l.lineId, Math.max(0, Number(e.target.value) || 0))}
                        style={{ width: 40, textAlign: "center", border: "none", outline: "none", fontSize: 13 }} />
                      <button onClick={() => onUpdateQty(l.lineId, l.qty + 1)} style={{ ...iconBtn, padding: "3px 8px" }}>+</button>
                    </div>
                    <button onClick={() => onRemove(l.lineId)} style={{ ...iconBtn, color: PALETTE.bad }}><Trash2 size={13} /></button>
                  </div>
                </div>
                <div style={{ fontWeight: 700, fontSize: 13.5 }}>{currency(l.price * l.qty)}</div>
              </div>
              <input value={l.note} onChange={(e) => onUpdateNote(l.lineId, e.target.value)}
                placeholder="+ observação para este item" style={{ ...inputSmall, marginTop: 8, fontSize: 12 }} />
            </div>
          ))}
        </div>
        {cart.length > 0 && (
          <div style={{ padding: 20, borderTop: `1px solid ${PALETTE.line}` }} className="egi-sans">
            <div style={{ display: "flex", justifyContent: "space-between", fontWeight: 700, fontSize: 17, marginBottom: 14 }}>
              <span>Total</span><span>{currency(total)}</span>
            </div>
            <button onClick={onCheckout} style={{ ...btnPrimary, width: "100%", justifyContent: "center" }}>Finalizar pedido</button>
          </div>
        )}
      </div>
    </div>
  );
}

function CheckoutModal({ total, user, onClose, onConfirm }) {
  const [companyName, setCompanyName] = useState("");
  const [phone, setPhone] = useState("");
  const [document, setDocument] = useState("");
  const [error, setError] = useState("");
  const [sending, setSending] = useState(false);

  const submit = async () => {
    if (!companyName.trim() || !phone.trim() || !document.trim()) {
      setError("Preencha nome/empresa, telefone e CPF/CNPJ para continuar.");
      return;
    }
    // Abre a aba em branco AGORA, ainda dentro do clique do usuário — é o
    // que garante que o navegador não bloqueie como pop-up. O endereço
    // final é preenchido só depois, quando o pedido terminar de salvar.
    const waWindow = window.open("", "_blank");
    setSending(true);
    try {
      await onConfirm({ companyName, phone, document }, waWindow);
    } catch (e) {
      console.error(e);
      if (waWindow && !waWindow.closed) waWindow.close();
      setError("Não foi possível enviar o pedido. Tente novamente.");
      setSending(false);
    }
  };

  return (
    <div style={overlayStyle} onClick={sending ? undefined : onClose}>
      <div style={{ ...modalStyle, maxWidth: 440 }} onClick={(e) => e.stopPropagation()}>
        <div style={modalHeaderStyle}>
          <h2 className="egi-display" style={{ margin: 0, fontSize: 19, fontWeight: 700 }}>Finalizar pedido</h2>
          {!sending && <button onClick={onClose} style={iconBtn}><X size={18} /></button>}
        </div>
        <div style={{ padding: 24 }} className="egi-sans">
          <div style={{ fontSize: 14, marginBottom: 16, color: "#5c4c43" }}>Total do pedido: <strong>{currency(total)}</strong></div>
          <Field label="Nome / Empresa">
            <input value={companyName} onChange={(e) => setCompanyName(e.target.value)} style={inputBase} placeholder="Ex: Salão Beleza Ana" />
          </Field>
          <div style={{ marginTop: 12 }}>
            <Field label="Telefone para contato">
              <input value={phone} onChange={(e) => setPhone(e.target.value)} style={inputBase} placeholder="(11) 91234-5678" />
            </Field>
          </div>
          <div style={{ marginTop: 12 }}>
            <Field label="CPF/CNPJ">
              <input value={document} onChange={(e) => setDocument(e.target.value)} style={inputBase} placeholder="000.000.000-00" />
            </Field>
          </div>
          {error && <div style={{ color: PALETTE.bad, fontSize: 13, marginTop: 10 }}>{error}</div>}
          <p style={{ fontSize: 11.5, color: "#9c8a7f", marginTop: 14, lineHeight: 1.5 }}>
            Ao confirmar, seu pedido é registrado com um número único e o WhatsApp abre com a mensagem pronta — só confirmar o envio por lá.
            {!user && " Você não está logado, então este pedido não aparecerá em \"Meus pedidos\"."}
          </p>
          <button onClick={submit} disabled={sending} style={{ ...btnPrimary, width: "100%", justifyContent: "center", marginTop: 6, opacity: sending ? 0.7 : 1 }}>
            {sending ? "Enviando..." : "Confirmar e enviar pedido"}
          </button>
        </div>
      </div>
    </div>
  );
}

function OrderConfirmedModal({ order, loggedIn, onClose }) {
  return (
    <div style={overlayStyle} onClick={onClose}>
      <div style={{ ...modalStyle, maxWidth: 420, textAlign: "center" }} onClick={(e) => e.stopPropagation()}>
        <div style={{ padding: "36px 28px" }} className="egi-sans">
          <div style={{ width: 56, height: 56, borderRadius: "50%", background: PALETTE.good, color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 16px" }}>
            <Check size={26} />
          </div>
          <h2 className="egi-display" style={{ fontSize: 21, fontWeight: 700, margin: "0 0 6px" }}>Pedido registrado!</h2>
          <p style={{ fontSize: 14, color: "#5c4c43", marginBottom: 4 }}>Número do pedido</p>
          <div style={{ fontSize: 20, fontWeight: 700, color: PALETTE.plum, marginBottom: 18 }}>#{order.orderNumber}</div>
          <p style={{ fontSize: 13, color: "#8a7a6f", lineHeight: 1.5, marginBottom: 20 }}>
            Uma aba do WhatsApp foi aberta com sua mensagem pronta. Confirme o envio por lá para que a equipe receba seu pedido.
            {loggedIn && " Você também pode acompanhar este pedido em \"Meus pedidos\"."}
          </p>
          <button onClick={onClose} style={{ ...btnPrimary, width: "100%", justifyContent: "center" }}>Continuar comprando</button>
        </div>
      </div>
    </div>
  );
}

/* ==================== MODO CATÁLOGO ==================== */

function CatalogMode({ products }) {
  const blockRefs = useRef({});
  const [fullscreenIndex, setFullscreenIndex] = useState(null);

  const flatImages = useMemo(() => buildFlatImages(products), [products]);

  const openFullscreen = (productId, imgIndex) => {
    const idx = flatImages.findIndex((f) => f.product.id === productId && f.imgIndex === imgIndex);
    if (idx >= 0) setFullscreenIndex(idx);
  };

  const handleClose = (lastProductId) => {
    setFullscreenIndex(null);
    const el = blockRefs.current[lastProductId];
    if (el) requestAnimationFrame(() => el.scrollIntoView({ block: "start", behavior: "instant" }));
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 28, marginTop: 20 }}>
      {products.map((p) => {
        const price = minPrice(p);
        const unitPrice = unitPriceOf(p, price);
        const images = (p.images?.length ? p.images : (p.image ? [p.image] : [])).slice(0, 2);
        return (
          <div key={p.id} ref={(el) => { blockRefs.current[p.id] = el; }} className="egi-sans"
            style={{ border: `1px solid ${PALETTE.line}`, borderRadius: 14, overflow: "hidden", background: "#fff", scrollMarginTop: 90 }}>
            <div style={{ background: PALETTE.plumDeep, color: "#fff", padding: "14px 18px" }}>
              <div className="egi-display" style={{ fontSize: 19, fontWeight: 700 }}>{p.name}</div>
              <div style={{ fontSize: 11.5, color: PALETTE.brassLight, marginTop: 2 }}>
                {p.code ? `${p.code} · ` : ""}{p.category}{p.subcategory ? ` › ${p.subcategory}` : ""}
              </div>
            </div>
            <div style={{ display: "flex", gap: 2, background: PALETTE.line }}>
              {(images.length ? images : [null, null]).slice(0, 2).map((url, i) => (
                <div key={i} onClick={() => url && openFullscreen(p.id, i)}
                  style={{ flex: 1, aspectRatio: "1", background: PALETTE.paperDeep, display: "flex", alignItems: "center", justifyContent: "center", cursor: url ? "pointer" : "default" }}>
                  {url ? <img src={cld(url, CLD_DETAIL)} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} loading="lazy" decoding="async" /> : <ImageOff size={28} color="#b3a494" />}
                </div>
              ))}
            </div>
            <div style={{ background: PALETTE.paperDeep, padding: "14px 18px", display: "flex", flexWrap: "wrap", alignItems: "center", gap: "10px 28px" }}>
              <div><div style={{ fontSize: 10.5, color: "#8a7a6f", fontWeight: 700, textTransform: "uppercase" }}>Valor</div><div style={{ fontSize: 15, fontWeight: 700, color: PALETTE.plum }}>{currency(price)}</div></div>
              <div><div style={{ fontSize: 10.5, color: "#8a7a6f", fontWeight: 700, textTransform: "uppercase" }}>Unidade</div><div style={{ fontSize: 14, fontWeight: 600 }}>{p.unit || "—"}</div></div>
              <div><div style={{ fontSize: 10.5, color: "#8a7a6f", fontWeight: 700, textTransform: "uppercase" }}>Valor Unitário</div><div style={{ fontSize: 14, fontWeight: 600 }}>{unitPrice != null ? currency(unitPrice) : "—"}</div></div>
            </div>
          </div>
        );
      })}
      {fullscreenIndex !== null && (
        <FullscreenPhotoViewer items={flatImages} initialIndex={fullscreenIndex} onClose={handleClose} />
      )}
    </div>
  );
}
