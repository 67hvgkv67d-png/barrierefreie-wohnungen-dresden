const state = {
  apartments: [],
  lastUpdated: "",
};

const elements = {
  form: document.querySelector("#filters"),
  apartments: document.querySelector("#apartments"),
  visibleCount: document.querySelector("#visible-count"),
  lastUpdated: document.querySelector("#last-updated"),
  resultSummary: document.querySelector("#result-summary"),
  emptyMessage: document.querySelector("#empty-message"),
  errorMessage: document.querySelector("#error-message"),
};

const euroFormatter = new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR" });
const dateFormatter = new Intl.DateTimeFormat("de-DE", { dateStyle: "medium" });

function formatDate(value) {
  return dateFormatter.format(new Date(`${value}T00:00:00`));
}

function formatDistance(meters) {
  return meters >= 1000 ? `${(meters / 1000).toLocaleString("de-DE", { maximumFractionDigits: 1 })} km` : `${meters} m`;
}

function getFilters() {
  const formData = new FormData(elements.form);
  return Object.fromEntries(formData.entries());
}

function applyFilters(apartments) {
  const filters = getFilters();
  return apartments
    .filter((apartment) => filters.district === "all" || apartment.district === filters.district)
    .filter((apartment) => filters.accessibility === "all" || apartment.accessibilityCategory === filters.accessibility)
    .filter((apartment) => filters.persons === "all" || String(apartment.suitableFor) === filters.persons)
    .filter((apartment) => filters.kdu === "all" || apartment.kduAssessment === filters.kdu)
    .filter((apartment) => filters.wbs === "all" || apartment.wbs === filters.wbs)
    .sort((a, b) => {
      if (filters.sort === "rent") return a.warmRent - b.warmRent;
      if (filters.sort === "newest") return new Date(b.firstFound) - new Date(a.firstFound);
      return a.distanceMeters - b.distanceMeters;
    });
}

function createFact(label, value) {
  return `<div class="fact"><dt>${label}</dt><dd>${value}</dd></div>`;
}

function renderApartment(apartment) {
  const features = apartment.accessibilityFeatures.map((feature) => `<li>${feature}</li>`).join("");
  return `
    <article class="apartment-card" aria-labelledby="${apartment.id}-title">
      <span class="badge">BEISPIEL</span>
      <h3 class="card-title" id="${apartment.id}-title">${apartment.title}</h3>
      <dl class="fact-grid">
        ${createFact("Stadtteil", apartment.district)}
        ${createFact("Adresse oder Lage", apartment.location)}
        ${createFact("Entfernung zur Referenzadresse", formatDistance(apartment.distanceMeters))}
        ${createFact("Zimmerzahl", apartment.rooms.toLocaleString("de-DE"))}
        ${createFact("Wohnfläche", `${apartment.areaSqm.toLocaleString("de-DE")} m²`)}
        ${createFact("Mögliche Personenzahl", `${apartment.suitableFor} Person${apartment.suitableFor > 1 ? "en" : ""}`)}
        ${createFact("Nettokaltmiete", euroFormatter.format(apartment.netColdRent))}
        ${createFact("Kalte Betriebskosten", euroFormatter.format(apartment.coldOperatingCosts))}
        ${createFact("Bruttokaltmiete", euroFormatter.format(apartment.grossColdRent))}
        ${createFact("Heizkosten", euroFormatter.format(apartment.heatingCosts))}
        ${createFact("Warmmiete", euroFormatter.format(apartment.warmRent))}
        ${createFact("Barrierefreiheitskategorie", `${apartment.accessibilityCategory} – ${apartment.accessibilityLabel}`)}
        ${createFact("KdU-Einschätzung", apartment.kduAssessment)}
        ${createFact("Wohnberechtigungsschein", apartment.wbs)}
        ${createFact("Anbieter", apartment.provider)}
        ${createFact("Datum des ersten Fundes", formatDate(apartment.firstFound))}
        ${createFact("Datum der letzten Prüfung", formatDate(apartment.lastChecked))}
        ${createFact("Kontaktangabe", apartment.contact)}
      </dl>
      <div>
        <strong>Genannte Barrierefreiheitsmerkmale:</strong>
        <ul class="feature-list">${features}</ul>
      </div>
      <a class="card-link" href="${apartment.originalUrl}" aria-label="${apartment.originalLabel}: ${apartment.title}">${apartment.originalLabel}</a>
    </article>
  `;
}

function render() {
  const filtered = applyFilters(state.apartments);
  elements.visibleCount.textContent = filtered.length;
  elements.resultSummary.textContent = `${filtered.length} von ${state.apartments.length} Wohnungen passen zu den Filtern.`;
  elements.emptyMessage.hidden = filtered.length !== 0;
  elements.apartments.innerHTML = filtered.map(renderApartment).join("");
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
    elements.errorMessage.textContent = `Fehler: Die Datei data/wohnungen.json konnte nicht geladen werden. Bitte prüfen Sie die Veröffentlichung der GitHub-Pages-Seite. (${error.message})`;
  }
}

elements.form.addEventListener("change", render);
elements.form.addEventListener("reset", () => window.setTimeout(render, 0));

loadApartments();
