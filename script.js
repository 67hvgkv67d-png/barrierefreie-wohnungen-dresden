const state = {
  apartments: [],
  lastUpdated: "",
};

const elements = {
  form: document.querySelector("#filters"),
  apartments: document.querySelector("#apartments"),
  otherApartments: document.querySelector("#other-apartments"),
  otherCount: document.querySelector("#other-count"),
  visibleCount: document.querySelector("#visible-count"),
  lastUpdated: document.querySelector("#last-updated"),
  resultSummary: document.querySelector("#result-summary"),
  emptyMessage: document.querySelector("#empty-message"),
  errorMessage: document.querySelector("#error-message"),
};

const euroFormatter = new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR" });
const dateFormatter = new Intl.DateTimeFormat("de-DE", { dateStyle: "medium" });

function formatDate(value) {
  if (!value) return "nicht ausgewiesen";
  return dateFormatter.format(new Date(`${value}T00:00:00`));
}

function formatDistance(meters) {
  if (!Number.isFinite(meters)) return "nicht berechnet";
  return meters >= 1000
    ? `${(meters / 1000).toLocaleString("de-DE", { maximumFractionDigits: 1 })} km`
    : `${meters} m`;
}

function formatMoney(value) {
  return Number.isFinite(value) ? euroFormatter.format(value) : "nicht ausgewiesen";
}

function formatNumber(value, suffix = "") {
  return Number.isFinite(value) ? `${value.toLocaleString("de-DE")}${suffix}` : "nicht ausgewiesen";
}

function getFilters() {
  const formData = new FormData(elements.form);
  return Object.fromEntries(formData.entries());
}

function applyFilters(apartments) {
  const filters = getFilters();
  return apartments
    .filter((apartment) => apartment.dataStatus !== "inactive")
    .filter((apartment) => filters.district === "all" || apartment.district === filters.district)
    .filter((apartment) => filters.accessibility === "all" || apartment.accessibilityCategory === filters.accessibility)
    .filter((apartment) => filters.wbs === "all" || apartment.wbs === filters.wbs)
    .sort((a, b) => {
      if (filters.sort === "rent") {
        const rentA = Number.isFinite(a.warmRent) ? a.warmRent : Number.POSITIVE_INFINITY;
        const rentB = Number.isFinite(b.warmRent) ? b.warmRent : Number.POSITIVE_INFINITY;
        return rentA - rentB;
      }
      if (filters.sort === "newest") return new Date(b.firstFound) - new Date(a.firstFound);
      const distanceA = Number.isFinite(a.distanceMeters) ? a.distanceMeters : Number.POSITIVE_INFINITY;
      const distanceB = Number.isFinite(b.distanceMeters) ? b.distanceMeters : Number.POSITIVE_INFINITY;
      return distanceA - distanceB;
    });
}

function createFact(label, value) {
  return `<div class="fact"><dt>${label}</dt><dd>${value}</dd></div>`;
}

function categoryDisplay(apartment) {
  const symbols = { A: "🟢", B: "🟡", C: "⚪" };
  return `${symbols[apartment.accessibilityCategory] || "⚪"} ${apartment.accessibilityCategory} – ${apartment.accessibilityLabel}`;
}

function wbsDisplay(apartment) {
  if (apartment.wbs !== "erforderlich") return apartment.wbs;
  return apartment.wbsType ? `erforderlich – Typ ${apartment.wbsType}` : "erforderlich";
}

function renderApartment(apartment) {
  const features = (apartment.accessibilityFeatures || []).map((feature) => `<li>${feature}</li>`).join("");
  const badge = apartment.dataStatus === "live" ? "ECHTES ANGEBOT" : "BEISPIEL";
  return `
    <article class="apartment-card" aria-labelledby="${apartment.id}-title">
      <span class="badge">${badge}</span>
      <h3 class="card-title" id="${apartment.id}-title">${apartment.title}</h3>
      <dl class="fact-grid">
        ${createFact("Stadtteil", apartment.district)}
        ${createFact("Adresse oder Lage", apartment.location)}
        ${createFact("Entfernung zur Referenzadresse", formatDistance(apartment.distanceMeters))}
        ${createFact("Zimmerzahl", formatNumber(apartment.rooms))}
        ${createFact("Wohnfläche", formatNumber(apartment.areaSqm, " m²"))}
        ${createFact("Kaltmiete", formatMoney(apartment.netColdRent))}
        ${createFact("Nebenkosten", formatMoney(apartment.coldOperatingCosts))}
        ${createFact("Bruttokaltmiete", formatMoney(apartment.grossColdRent))}
        ${createFact("Heizkosten", formatMoney(apartment.heatingCosts))}
        ${createFact("Gesamtmiete", formatMoney(apartment.warmRent))}
        ${createFact("Barrierefreiheit", categoryDisplay(apartment))}
        ${createFact("Wohnberechtigungsschein", wbsDisplay(apartment))}
        ${createFact("Anbieter", apartment.provider)}
        ${createFact("Datum des ersten Fundes", formatDate(apartment.firstFound))}
        ${createFact("Datum der letzten Prüfung", formatDate(apartment.lastChecked))}
        ${createFact("Kontaktangabe", apartment.contact || "nicht ausgewiesen")}
      </dl>
      <div>
        <strong>Erkannte Hinweise zur Barrierefreiheit:</strong>
        <ul class="feature-list">${features || "<li>Im Angebot wurden keine belastbaren Hinweise gefunden.</li>"}</ul>
      </div>
      <a class="card-link" href="${apartment.originalUrl}" target="_blank" rel="noopener noreferrer" aria-label="${apartment.originalLabel}: ${apartment.title}">${apartment.originalLabel}</a>
    </article>
  `;
}

function render() {
  const filtered = applyFilters(state.apartments);
  const accessible = filtered.filter((apartment) => apartment.accessibilityCategory === "A" || apartment.accessibilityCategory === "B");
  const unclear = filtered.filter((apartment) => apartment.accessibilityCategory === "C");

  elements.visibleCount.textContent = filtered.length;
  elements.resultSummary.textContent = `${filtered.length} von ${state.apartments.length} Wohnungen passen zu den Filtern.`;
  elements.emptyMessage.hidden = filtered.length !== 0;
  elements.apartments.innerHTML = accessible.map(renderApartment).join("");
  elements.otherApartments.innerHTML = unclear.map(renderApartment).join("");
  elements.otherCount.textContent = unclear.length;
}

async function loadApartments() {
  try {
    const response = await fetch("data/wohnungen.json", { cache: "no-store" });
    if (!response.ok) throw new Error(`HTTP-Status ${response.status}`);
    const data = await response.json();
    state.apartments = data.apartments || [];
    state.lastUpdated = data.lastUpdated;
    elements.lastUpdated.textContent = formatDate(state.lastUpdated);
    render();
  } catch (error) {
    elements.lastUpdated.textContent = "nicht verfügbar";
    elements.resultSummary.textContent = "Die Wohnungsdaten konnten nicht geladen werden.";
    elements.errorMessage.hidden = false;
    elements.errorMessage.textContent = `Fehler: Die Datei data/wohnungen.json konnte nicht geladen werden. (${error.message})`;
  }
}

elements.form.addEventListener("change", render);
elements.form.addEventListener("reset", () => window.setTimeout(render, 0));

loadApartments();
