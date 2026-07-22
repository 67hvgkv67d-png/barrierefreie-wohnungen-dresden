const KDU_LIMIT_PER_PERSON = 450.5;

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
  if (!value) return "nicht ausgewiesen";
  return dateFormatter.format(new Date(`${value}T00:00:00`));
}

function formatDistance(meters) {
  if (!Number.isFinite(meters)) return "nicht berechnet";
  return meters >= 1000 ? `${(meters / 1000).toLocaleString("de-DE", { maximumFractionDigits: 1 })} km` : `${meters} m`;
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

function hasCompleteColdRentData(apartment) {
  return Number.isFinite(apartment.netColdRent) && Number.isFinite(apartment.coldOperatingCosts) && Number.isFinite(apartment.grossColdRent);
}

function calculateKduAssessment(apartment, persons) {
  if (!hasCompleteColdRentData(apartment) || !Number.isFinite(persons) || persons < 1) {
    return { persons, status: "nicht prüfbar – Mietbestandteile fehlen" };
  }

  const totalLimit = persons * KDU_LIMIT_PER_PERSON;
  const sharePerPerson = apartment.grossColdRent / persons;
  const isWithinLimit = apartment.grossColdRent <= totalLimit;

  return {
    persons,
    grossColdRent: apartment.grossColdRent,
    sharePerPerson,
    totalLimit,
    status: isWithinLimit ? "innerhalb der WG-KdU-Grenze" : "über der WG-KdU-Grenze – Einzelfallprüfung erforderlich",
    isWithinLimit,
  };
}

function getKduAssessments(apartment) {
  return [...(apartment.suitableForPersons || [])]
    .sort((a, b) => a - b)
    .map((persons) => calculateKduAssessment(apartment, Number(persons)));
}

function getKduFilterCategory(apartment) {
  const assessments = getKduAssessments(apartment);
  if (assessments.length === 0 || assessments.some((assessment) => assessment.status === "nicht prüfbar – Mietbestandteile fehlen")) return "not-checkable";
  return assessments.some((assessment) => assessment.isWithinLimit) ? "any-within" : "none-within";
}

function applyFilters(apartments) {
  const filters = getFilters();
  return apartments
    .filter((apartment) => apartment.dataStatus !== "inactive")
    .filter((apartment) => filters.district === "all" || apartment.district === filters.district)
    .filter((apartment) => filters.accessibility === "all" || apartment.accessibilityCategory === filters.accessibility)
    .filter((apartment) => filters.persons === "all" || (apartment.suitableForPersons || []).includes(Number(filters.persons)))
    .filter((apartment) => filters.kdu === "all" || getKduFilterCategory(apartment) === filters.kdu)
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

function formatPersons(persons) {
  return `${persons} ${persons === 1 ? "Person" : "getrennte Personen"}`;
}

function renderKduAssessment(apartment) {
  const assessments = getKduAssessments(apartment);
  if (assessments.length === 0) {
    return `<section class="kdu-section" aria-label="Rechnerische KdU-Einschätzung"><h4>Rechnerische KdU-Einschätzung</h4><p>Keine belastbare Personenzahl oder keine getrennten Mietbestandteile ausgewiesen. Bitte das Originalangebot prüfen.</p></section>`;
  }

  const rows = assessments.map((assessment) => {
    if (assessment.status === "nicht prüfbar – Mietbestandteile fehlen") {
      return `<li><strong>${formatPersons(assessment.persons)}:</strong> Ergebnis: ${assessment.status}</li>`;
    }

    return `
      <li>
        <strong>${formatPersons(assessment.persons)}:</strong>
        <dl>
          <dt>Bruttokaltmiete gesamt</dt><dd>${euroFormatter.format(assessment.grossColdRent)}</dd>
          <dt>Rechnerischer Anteil</dt><dd>${euroFormatter.format(assessment.sharePerPerson)} pro Person</dd>
          <dt>Maximale Gesamtgrenze</dt><dd>${euroFormatter.format(assessment.totalLimit)}</dd>
          <dt>Ergebnis</dt><dd>${assessment.status}</dd>
        </dl>
      </li>`;
  }).join("");

  return `
    <section class="kdu-section" aria-label="Rechnerische KdU-Einschätzung">
      <h4>Rechnerische KdU-Einschätzung für eine WG ohne gemeinsame Bedarfsgemeinschaft</h4>
      <ul class="kdu-list">${rows}</ul>
      <p class="kdu-note">Die Berechnung setzt eine gleichmäßige Aufteilung der Bruttokaltmiete voraus. Maßgeblich sind die tatsächlichen Mietanteile und die Prüfung durch den zuständigen Leistungsträger.</p>
    </section>`;
}

function renderApartment(apartment) {
  const features = (apartment.accessibilityFeatures || []).map((feature) => `<li>${feature}</li>`).join("");
  const persons = [...(apartment.suitableForPersons || [])].sort((a, b) => a - b).join(", ") || "nicht ausgewiesen";
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
        ${createFact("Mögliche Personenzahlen", persons)}
        ${createFact("Nettokaltmiete", formatMoney(apartment.netColdRent))}
        ${createFact("Kalte Betriebskosten", formatMoney(apartment.coldOperatingCosts))}
        ${createFact("Bruttokaltmiete", formatMoney(apartment.grossColdRent))}
        ${createFact("Heizkosten", formatMoney(apartment.heatingCosts))}
        ${createFact("Warmmiete", formatMoney(apartment.warmRent))}
        ${createFact("Barrierefreiheitskategorie", `${apartment.accessibilityCategory} – ${apartment.accessibilityLabel}`)}
        ${createFact("Wohnberechtigungsschein", apartment.wbs)}
        ${createFact("Anbieter", apartment.provider)}
        ${createFact("Datum des ersten Fundes", formatDate(apartment.firstFound))}
        ${createFact("Datum der letzten Prüfung", formatDate(apartment.lastChecked))}
        ${createFact("Kontaktangabe", apartment.contact || "nicht ausgewiesen")}
      </dl>
      ${renderKduAssessment(apartment)}
      <div>
        <strong>Genannte Barrierefreiheitsmerkmale:</strong>
        <ul class="feature-list">${features || "<li>Bitte im Originalangebot prüfen.</li>"}</ul>
      </div>
      <a class="card-link" href="${apartment.originalUrl}" target="_blank" rel="noopener noreferrer" aria-label="${apartment.originalLabel}: ${apartment.title}">${apartment.originalLabel}</a>
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
