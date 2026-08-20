import React, { useState, useRef, useEffect } from "react";
import { ChevronDown, ArrowUpDown, Check } from "lucide-react";
import { PALETTE } from "./shared";

/* Barra de filtros compacta.
   - "Categoria" permite marcar VÁRIAS ao mesmo tempo (nenhuma marcada =
     todas). "Todas" funciona como atalho pra limpar a seleção.
   - "Subcategoria" só aparece quando há exatamente UMA categoria
     escolhida e ela tem subcategorias — com várias categorias juntas,
     subcategoria deixa de fazer sentido.
   - Um botão de ordenação (escolha única). */

function useCloseOnOutside(open, setOpen) {
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return;
    const onClickOutside = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, [open, setOpen]);
  return ref;
}

const triggerStyle = (active, color) => ({
  display: "flex", alignItems: "center", gap: 7, cursor: "pointer",
  padding: "9px 14px", borderRadius: 999, fontSize: 12.5, fontWeight: 700,
  border: `1px solid ${active ? color : PALETTE.line}`,
  background: active ? color : "#fff",
  color: active ? "#fff" : PALETTE.ink,
  whiteSpace: "nowrap", fontFamily: "'Baloo 2', sans-serif",
});

const panelStyle = {
  position: "absolute", top: "calc(100% + 6px)", left: 0, zIndex: 40,
  background: "#fff", border: `1px solid ${PALETTE.line}`, borderRadius: 16,
  boxShadow: "0 10px 30px rgba(43,27,51,0.15)", minWidth: 200,
  maxHeight: 320, overflowY: "auto", padding: 6,
};

const itemStyle = (selected) => ({
  display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10,
  width: "100%", textAlign: "left", cursor: "pointer",
  padding: "9px 12px", borderRadius: 10, border: "none",
  background: selected ? PALETTE.paperDeep : "transparent",
  color: PALETTE.ink, fontSize: 13,
  fontWeight: selected ? 700 : 500,
});

// escolha única (ordenação, subcategoria)
function Dropdown({ label, value, options, onChange, accent }) {
  const [open, setOpen] = useState(false);
  const ref = useCloseOnOutside(open, setOpen);
  const color = accent || PALETTE.plum;
  const isDefault = value === options[0];

  return (
    <div ref={ref} style={{ position: "relative" }}>
      <button onClick={() => setOpen((v) => !v)} className="egi-sans" style={triggerStyle(!isDefault, color)}>
        <span style={{ opacity: isDefault ? 0.65 : 0.85, fontWeight: 500 }}>{label}:</span>
        {value}
        <ChevronDown size={14} style={{ transform: open ? "rotate(180deg)" : "none", transition: "transform 0.15s" }} />
      </button>
      {open && (
        <div className="egi-sans" style={panelStyle}>
          {options.map((opt) => (
            <button key={opt} onClick={() => { onChange(opt); setOpen(false); }} style={itemStyle(opt === value)}>
              {opt}
              {opt === value && <Check size={14} color={color} />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// escolha múltipla (categorias)
function MultiDropdown({ label, allLabel, options, selected, onToggle, onClear, accent }) {
  const [open, setOpen] = useState(false);
  const ref = useCloseOnOutside(open, setOpen);
  const color = accent || PALETTE.plum;
  const count = selected.length;
  const text = count === 0 ? allLabel : count === 1 ? selected[0] : `${count} selecionadas`;

  return (
    <div ref={ref} style={{ position: "relative" }}>
      <button onClick={() => setOpen((v) => !v)} className="egi-sans" style={triggerStyle(count > 0, color)}>
        <span style={{ opacity: count > 0 ? 0.85 : 0.65, fontWeight: 500 }}>{label}:</span>
        {text}
        <ChevronDown size={14} style={{ transform: open ? "rotate(180deg)" : "none", transition: "transform 0.15s" }} />
      </button>
      {open && (
        <div className="egi-sans" style={panelStyle}>
          <button onClick={onClear} style={itemStyle(count === 0)}>
            {allLabel}
            {count === 0 && <Check size={14} color={color} />}
          </button>
          <div style={{ height: 1, background: PALETTE.line, margin: "4px 6px" }} />
          {options.map((opt) => {
            const isOn = selected.includes(opt);
            return (
              <button key={opt} onClick={() => onToggle(opt)} style={itemStyle(isOn)}>
                {opt}
                {isOn && <Check size={14} color={color} />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

const SORT_LABELS = {
  nome: "Nome (A-Z)",
  preco_asc: "Menor preço",
  preco_desc: "Maior preço",
  categoria: "Categoria",
  novidades: "Novidades",
};

export default function FilterBar({
  categories, selectedCategories, setSelectedCategories,
  subcategories, subcategory, setSubcategory,
  sort, setSort,
}) {
  const sortOptions = Object.values(SORT_LABELS);
  const sortIdByLabel = (label) => Object.keys(SORT_LABELS).find((k) => SORT_LABELS[k] === label);

  const toggleCategory = (cat) => {
    const next = selectedCategories.includes(cat)
      ? selectedCategories.filter((c) => c !== cat)
      : [...selectedCategories, cat];
    setSelectedCategories(next);
    setSubcategory("Todas");
  };
  const clearCategories = () => { setSelectedCategories([]); setSubcategory("Todas"); };

  return (
    <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginTop: 4 }}>
      <MultiDropdown
        label="Categoria"
        allLabel="Todas"
        options={categories}
        selected={selectedCategories}
        onToggle={toggleCategory}
        onClear={clearCategories}
      />

      {subcategories.length > 1 && (
        <Dropdown
          label="Subcategoria"
          value={subcategory}
          options={subcategories}
          onChange={setSubcategory}
          accent={PALETTE.brass}
        />
      )}

      <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 6 }}>
        <ArrowUpDown size={14} color="#8a7a6f" />
        <Dropdown
          label="Ordenar"
          value={SORT_LABELS[sort]}
          options={sortOptions}
          onChange={(label) => setSort(sortIdByLabel(label))}
          accent={PALETTE.ink}
        />
      </div>
    </div>
  );
}
