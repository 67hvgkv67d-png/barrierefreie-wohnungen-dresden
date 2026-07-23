"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import L from "leaflet";
import { type Wohnung, type Wohnungsdaten } from "./types";

const euro = new Intl.NumberFormat("de-DE", {
  style: "currency",
  currency: "EUR",
});

const decimal = new Intl.NumberFormat("de-DE", {
  minimumFractionDigits: 0,
  maximumFractionDigits: 2,
});

type DistrictFilter = "alle" | "Johannstadt" | "Gorbitz";
type RatingFilter = "alle" | Wohnung["bewertung"];
type ViewMode = "aktiv" | "ausgeblendet";
type SortMode = "kdu" | "nkm-auf" | "nkm-ab";

function districtName(stadtteil: string) {
  return stadtteil.startsWith("Gorbitz") ? "Gorbitz" : "Johannstadt";
}

const regionalstellen = {
  Gorbitz: {
    name: "Regionalstelle Gorbitz",
    adresse: "Leutewitzer Ring 31, 01169 Dresden",
    breitengrad: 51.0453213,
    laengengrad: 13.6735842,
  },
  Johannstadt: {
    name: "Regionalstelle Johannstadt",
    adresse: "Pfeifferhannsstraße 11, 01307 Dresden",
    breitengrad: 51.0572401,
    laengengrad: 13.7649334,
  },
} as const;

function statusClass(bewertung: Wohnung["bewertung"]) {
  if (bewertung === "ausdrücklich geeignet") return "status-good";
  if (bewertung === "möglicherweise geeignet") return "status-maybe";
  return "status-check";
}

function ageLabel(date: string) {
  const firstSeen = new Date(`${date}T12:00:00`);
  if (Number.isNaN(firstSeen.getTime())) return null;

  const today = new Date();
  const todayUtc = Date.UTC(
    today.getFullYear(),
    today.getMonth(),
    today.getDate(),
  );
  const firstSeenUtc = Date.UTC(
    firstSeen.getFullYear(),
    firstSeen.getMonth(),
    firstSeen.getDate(),
  );
  const days = Math.max(
    0,
    Math.round((todayUtc - firstSeenUtc) / (24 * 60 * 60 * 1000)),
  );

  if (days === 0) return "Heute hinzugefügt";
  if (days === 1) return "Seit 1 Tag erfasst";
  return `Seit ${days} Tagen erfasst`;
}

function LocationMap({ wohnung }: { wohnung: Wohnung }) {
  const [isOpen, setIsOpen] = useState(false);
  const mapElement = useRef<HTMLDivElement>(null);
  const position = wohnung.kartenposition;
  const regionalstelle = regionalstellen[districtName(wohnung.stadtteil)];

  useEffect(() => {
    if (!isOpen || !mapElement.current || !position) return;

    const wohnungPosition: L.LatLngTuple = [
      position.breitengrad,
      position.laengengrad,
    ];
    const regionalstellePosition: L.LatLngTuple = [
      regionalstelle.breitengrad,
      regionalstelle.laengengrad,
    ];
    const map = L.map(mapElement.current, {
      scrollWheelZoom: false,
      zoomControl: true,
    });

    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution:
        '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap-Mitwirkende</a>',
      maxZoom: 19,
    }).addTo(map);

    const wohnungIcon = L.divIcon({
      className: "map-marker map-marker-home",
      html: "<span>W</span>",
      iconSize: [34, 34],
      iconAnchor: [17, 17],
    });
    const regionalstelleIcon = L.divIcon({
      className: "map-marker map-marker-office",
      html: "<span>R</span>",
      iconSize: [34, 34],
      iconAnchor: [17, 17],
    });

    L.marker(wohnungPosition, {
      icon: wohnungIcon,
      title: `Wohnung: ${wohnung.adresse}`,
    }).addTo(map);
    L.marker(regionalstellePosition, {
      icon: regionalstelleIcon,
      title: `${regionalstelle.name}: ${regionalstelle.adresse}`,
    }).addTo(map);
    L.polyline([wohnungPosition, regionalstellePosition], {
      color: "#156b4c",
      weight: 2,
      opacity: 0.55,
      dashArray: "7 7",
    }).addTo(map);

    map.fitBounds(
      L.latLngBounds([wohnungPosition, regionalstellePosition]),
      { padding: [34, 34], maxZoom: 15 },
    );

    return () => {
      map.remove();
    };
  }, [
    isOpen,
    position,
    regionalstelle,
    wohnung.adresse,
  ]);

  if (!position) {
    return (
      <div className="map-unavailable">
        Lage konnte noch nicht zuverlässig bestimmt werden.
      </div>
    );
  }

  const osmLink =
    `https://www.openstreetmap.org/?mlat=${position.breitengrad}` +
    `&mlon=${position.laengengrad}` +
    `#map=17/${position.breitengrad}/${position.laengengrad}`;

  return (
    <div className="location-map">
      <button
        type="button"
        className="map-toggle"
        aria-expanded={isOpen}
        onClick={() => setIsOpen((current) => !current)}
      >
        {isOpen ? "Karte schließen" : "Lage anzeigen"}
        <span aria-hidden="true">{isOpen ? "−" : "+"}</span>
      </button>

      {isOpen ? (
        <div className="map-content">
          <div
            ref={mapElement}
            className="map-canvas"
            aria-label={`Karte mit ${wohnung.adresse} und ${regionalstelle.name}`}
          />
          <div className="map-legend">
            <p>
              <span className="legend-marker legend-home">W</span>
              <strong>Wohnung</strong>
              <small>
                {wohnung.adresse} · {position.genauigkeit}
              </small>
            </p>
            <p>
              <span className="legend-marker legend-office">R</span>
              <strong>{regionalstelle.name}</strong>
              <small>{regionalstelle.adresse}</small>
            </p>
          </div>
          <div className="map-footer">
            <span>
              Beim Öffnen werden Kartendaten von OpenStreetMap geladen.
            </span>
            <a href={osmLink} target="_blank" rel="noreferrer">
              Große Karte öffnen ↗
            </a>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function ListingCard({
  wohnung,
  isSaved,
  isHidden,
  note,
  onToggleSaved,
  onToggleHidden,
  onNoteChange,
}: {
  wohnung: Wohnung;
  isSaved: boolean;
  isHidden: boolean;
  note: string;
  onToggleSaved: (id: string) => void;
  onToggleHidden: (id: string) => void;
  onNoteChange: (id: string, note: string) => void;
}) {
  const age = ageLabel(wohnung.erstmals_gefunden_am);

  return (
    <article className={`listing-card ${isSaved ? "listing-card-saved" : ""}`}>
      <div className="card-topline">
        <div className="card-labels">
          <span className="district-label">
            {districtName(wohnung.stadtteil)}
          </span>
          {wohnung.neu ? (
            <span className="new-badge">Neu seit letztem Lauf</span>
          ) : null}
          {age ? <span className="age-badge">{age}</span> : null}
        </div>
        <span className={`status-badge ${statusClass(wohnung.bewertung)}`}>
          {wohnung.bewertung}
        </span>
      </div>

      <div className="card-heading">
        <p className="listing-id">{wohnung.id}</p>
        <h3>{wohnung.titel}</h3>
        <p className="address">{wohnung.adresse}</p>
      </div>

      <dl className="quick-facts">
        <div>
          <dt>Zimmer</dt>
          <dd>{decimal.format(wohnung.zimmer)}</dd>
        </div>
        <div>
          <dt>Wohnfläche</dt>
          <dd>{decimal.format(wohnung.wohnflaeche_m2)} m²</dd>
        </div>
        <div>
          <dt>Nettokalt</dt>
          <dd>{euro.format(wohnung.nettokaltmiete_eur)}</dd>
        </div>
        <div>
          <dt>Warm</dt>
          <dd>{euro.format(wohnung.warmmiete_eur)}</dd>
        </div>
      </dl>

      <div className="kdu-row">
        <span className="person-number">
          {wohnung.notwendige_personenzahl_nach_kdu_limit}
        </span>
        <span>
          notwendige{" "}
          {wohnung.notwendige_personenzahl_nach_kdu_limit === 1
            ? "Person"
            : "Personen"}{" "}
          nach KdU-Limit
        </span>
        <span className={`wbs wbs-${wohnung.wbs}`}>
          WBS: {wohnung.wbs}
        </span>
      </div>

      <div className="barrier-block">
        <p>Ausdrücklich genannt</p>
        <ul>
          {wohnung.barriereangaben.map((angabe) => (
            <li key={angabe}>{angabe}</li>
          ))}
        </ul>
      </div>

      {wohnung.hinweis ? (
        <p className="listing-note">{wohnung.hinweis}</p>
      ) : null}

      <LocationMap wohnung={wohnung} />

      <div className="provider-row">
        <span>
          {wohnung.anbieter} · {wohnung.quelle}
        </span>
        <span>
          geprüft{" "}
          {new Intl.DateTimeFormat("de-DE").format(
            new Date(`${wohnung.abrufdatum}T12:00:00`),
          )}
        </span>
      </div>

      <div className="card-actions">
        <label className="save-control">
          <input
            type="checkbox"
            checked={isSaved}
            onChange={() => onToggleSaved(wohnung.id)}
          />
          <span aria-hidden="true">{isSaved ? "✓" : ""}</span>
          {isSaved ? "Favorit" : "Als Favorit"}
        </label>
        <button
          className="hide-button"
          type="button"
          onClick={() => onToggleHidden(wohnung.id)}
        >
          {isHidden ? "Wieder anzeigen" : "Ausblenden"}
        </button>
      </div>

      <details className="note-box" open={note ? true : undefined}>
        <summary>{note ? "Persönliche Notiz bearbeiten" : "Notiz hinzufügen"}</summary>
        <label>
          <span>Persönliche Notiz</span>
          <textarea
            value={note}
            onChange={(event) => onNoteChange(wohnung.id, event.target.value)}
            placeholder="Zum Beispiel: Besichtigung anfragen oder Rückruf ausstehend"
            rows={3}
          />
        </label>
        <p>Die Notiz wird nur in diesem Browser gespeichert.</p>
      </details>

      <a
        className="listing-link"
        href={wohnung.direkte_inserats_url}
        target="_blank"
        rel="noreferrer"
        aria-label={`${wohnung.titel} – direktes Inserat bei ${wohnung.quelle} öffnen`}
      >
        Direkt zum Inserat <span aria-hidden="true">↗</span>
      </a>
    </article>
  );
}

export default function Home() {
  const [daten, setDaten] = useState<Wohnungsdaten>({
    aktualisiert_am: "",
    wohnungen: [],
  });
  const [loadError, setLoadError] = useState(false);
  const [query, setQuery] = useState("");
  const [district, setDistrict] = useState<DistrictFilter>("alle");
  const [persons, setPersons] = useState("alle");
  const [rating, setRating] = useState<RatingFilter>("alle");
  const [wbs, setWbs] = useState("alle");
  const [sort, setSort] = useState<SortMode>("kdu");
  const [view, setView] = useState<ViewMode>("aktiv");
  const [savedIds, setSavedIds] = useState<Set<string>>(new Set());
  const [hiddenIds, setHiddenIds] = useState<Set<string>>(new Set());
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [hydrated, setHydrated] = useState(false);
  const wohnungen = daten.wohnungen;

  useEffect(() => {
    fetch(`${import.meta.env.BASE_URL}wohnungen.json`)
      .then((response) => {
        if (!response.ok) throw new Error("Wohnungsdaten konnten nicht geladen werden.");
        return response.json() as Promise<Wohnungsdaten>;
      })
      .then(setDaten)
      .catch(() => setLoadError(true));
  }, []);

  useEffect(() => {
    try {
      setSavedIds(
        new Set(JSON.parse(localStorage.getItem("wohnraum-saved") ?? "[]")),
      );
      setHiddenIds(
        new Set(JSON.parse(localStorage.getItem("wohnraum-hidden") ?? "[]")),
      );
      const storedNotes = JSON.parse(
        localStorage.getItem("wohnraum-notes") ?? "{}",
      );
      setNotes(
        storedNotes &&
          typeof storedNotes === "object" &&
          !Array.isArray(storedNotes)
          ? storedNotes
          : {},
      );
    } catch {
      setSavedIds(new Set());
      setHiddenIds(new Set());
      setNotes({});
    }
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    localStorage.setItem("wohnraum-saved", JSON.stringify([...savedIds]));
    localStorage.setItem("wohnraum-hidden", JSON.stringify([...hiddenIds]));
    localStorage.setItem("wohnraum-notes", JSON.stringify(notes));
  }, [savedIds, hiddenIds, hydrated, notes]);

  useEffect(() => {
    if (!hydrated || wohnungen.length === 0) return;

    const validIds = new Set(wohnungen.map((wohnung) => wohnung.id));
    setSavedIds(
      (current) => new Set([...current].filter((id) => validIds.has(id))),
    );
    setHiddenIds(
      (current) => new Set([...current].filter((id) => validIds.has(id))),
    );
    setNotes((current) =>
      Object.fromEntries(
        Object.entries(current).filter(([id]) => validIds.has(id)),
      ),
    );
  }, [hydrated, wohnungen]);

  const explicitCount = wohnungen.filter(
    (wohnung) => wohnung.bewertung === "ausdrücklich geeignet",
  ).length;
  const wbsCount = wohnungen.filter((wohnung) => wohnung.wbs === "ja").length;
  const gorbitzCount = wohnungen.filter(
    (wohnung) => districtName(wohnung.stadtteil) === "Gorbitz",
  ).length;

  const visibleWohnungen = useMemo(() => {
    const search = query.trim().toLocaleLowerCase("de-DE");

    return wohnungen
      .filter((wohnung) =>
        view === "ausgeblendet"
          ? hiddenIds.has(wohnung.id)
          : !hiddenIds.has(wohnung.id),
      )
      .filter(
        (wohnung) =>
          district === "alle" ||
          districtName(wohnung.stadtteil) === district,
      )
      .filter(
        (wohnung) =>
          persons === "alle" ||
          wohnung.notwendige_personenzahl_nach_kdu_limit === Number(persons),
      )
      .filter(
        (wohnung) =>
          rating === "alle" || wohnung.bewertung === rating,
      )
      .filter((wohnung) => wbs === "alle" || wohnung.wbs === wbs)
      .filter((wohnung) => {
        if (!search) return true;
        return [
          wohnung.titel,
          wohnung.adresse,
          wohnung.stadtteil,
          wohnung.anbieter,
          wohnung.id,
          ...wohnung.barriereangaben,
        ]
          .join(" ")
          .toLocaleLowerCase("de-DE")
          .includes(search);
      })
      .sort((a, b) => {
        if (sort === "nkm-auf")
          return a.nettokaltmiete_eur - b.nettokaltmiete_eur;
        if (sort === "nkm-ab")
          return b.nettokaltmiete_eur - a.nettokaltmiete_eur;
        return (
          a.notwendige_personenzahl_nach_kdu_limit -
            b.notwendige_personenzahl_nach_kdu_limit ||
          a.nettokaltmiete_eur - b.nettokaltmiete_eur
        );
      });
  }, [district, hiddenIds, persons, query, rating, sort, view, wbs]);

  function updateSet(
    setter: React.Dispatch<React.SetStateAction<Set<string>>>,
    id: string,
  ) {
    setter((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function resetFilters() {
    setQuery("");
    setDistrict("alle");
    setPersons("alle");
    setRating("alle");
    setWbs("alle");
    setSort("kdu");
  }

  function updateNote(id: string, note: string) {
    setNotes((current) => {
      const next = { ...current };
      if (note) next[id] = note;
      else delete next[id];
      return next;
    });
  }

  function downloadCsv() {
    const headers = [
      "ID",
      "Titel",
      "Stadtteil",
      "Adresse",
      "Zimmer",
      "Wohnfläche m²",
      "Nettokaltmiete €",
      "Warmmiete €",
      "Notwendige Personenzahl",
      "WBS",
      "Barriereangaben",
      "Bewertung",
      "Anbieter",
      "Quelle",
      "Direkte Inserats-URL",
      "Abrufdatum",
      "Erstmals gefunden",
      "Favorit",
      "Ausgeblendet",
      "Persönliche Notiz",
    ];
    const escapeCsv = (value: string | number) =>
      `"${String(value).replaceAll('"', '""')}"`;
    const rows = wohnungen.map((wohnung) => [
      wohnung.id,
      wohnung.titel,
      wohnung.stadtteil,
      wohnung.adresse,
      decimal.format(wohnung.zimmer),
      decimal.format(wohnung.wohnflaeche_m2),
      wohnung.nettokaltmiete_eur.toFixed(2).replace(".", ","),
      wohnung.warmmiete_eur.toFixed(2).replace(".", ","),
      wohnung.notwendige_personenzahl_nach_kdu_limit,
      wohnung.wbs,
      wohnung.barriereangaben.join(" | "),
      wohnung.bewertung,
      wohnung.anbieter,
      wohnung.quelle,
      wohnung.direkte_inserats_url,
      wohnung.abrufdatum,
      wohnung.erstmals_gefunden_am,
      savedIds.has(wohnung.id) ? "ja" : "nein",
      hiddenIds.has(wohnung.id) ? "ja" : "nein",
      notes[wohnung.id] ?? "",
    ]);
    const csv = [headers, ...rows]
      .map((row) => row.map(escapeCsv).join(";"))
      .join("\r\n");
    const blob = new Blob([`\uFEFF${csv}`], {
      type: "text/csv;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `mietwohnungen-dresden-${daten.aktualisiert_am || "aktuell"}.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  return (
    <main>
      <section className="hero" id="top">
        <div className="hero-copy">
          <p className="hero-date">
            Stand{" "}
            {daten.aktualisiert_am
              ? new Intl.DateTimeFormat("de-DE").format(
                  new Date(`${daten.aktualisiert_am}T12:00:00`),
                )
              : "wird geladen"}
          </p>
          <h1>Barrierefreie Wohnungen in Dresden Gorbitz und Johannstadt</h1>
        </div>

        <aside className="hero-panel" aria-label="Übersicht">
          <p className="panel-kicker">Aktueller Überblick</p>
          <div className="hero-stat-primary">
            <strong>{wohnungen.length}</strong>
            <span>aktive Direktangebote</span>
          </div>
          <div className="hero-stat-grid">
            <div>
              <strong>{wohnungen.length - gorbitzCount}</strong>
              <span>Johannstadt</span>
            </div>
            <div>
              <strong>{gorbitzCount}</strong>
              <span>Gorbitz</span>
            </div>
            <div>
              <strong>{explicitCount}</strong>
              <span>ausdrücklich geeignet</span>
            </div>
            <div>
              <strong>{wbsCount}</strong>
              <span>WBS-pflichtig</span>
            </div>
          </div>
          <p className="panel-note">
            KdU-Grenze: 450,50 € Nettokaltmiete je berücksichtigter Person
          </p>
        </aside>
      </section>

      <section className="content-section" id="angebote">
        {loadError ? (
          <div className="accessibility-note" role="alert">
            <span className="note-icon" aria-hidden="true">!</span>
            <div>
              <strong>Die Angebotsdaten konnten nicht geladen werden.</strong>
              <p>Bitte laden Sie die Seite neu oder versuchen Sie es später erneut.</p>
            </div>
          </div>
        ) : null}
        <div className="section-heading">
          <div>
            <p className="eyebrow eyebrow-dark">Geprüfte Direktangebote</p>
            <h2>Wohnungen filtern und vormerken</h2>
          </div>
          <p>
            Suche gezielt nach Stadtteil, notwendiger Personenzahl, WBS und
            Eignung. Vorgemerkte und ausgeblendete Angebote bleiben auf diesem
            Gerät gespeichert.
          </p>
        </div>

        <div className="accessibility-note" role="note">
          <span className="note-icon" aria-hidden="true">
            i
          </span>
          <div>
            <strong>Ein Aufzug allein gilt nicht als barrierefrei.</strong>
            <p>
              „Ausdrücklich geeignet“ wird nur bei klaren Angaben wie
              barrierearm, stufenlos oder bodengleiche Dusche vergeben. Kein
              Inserat bezeichnet die Wohnung ausdrücklich als
              rollstuhlgerecht.
            </p>
          </div>
        </div>

        <div className="filter-panel" aria-label="Angebote filtern">
          <div className="view-tabs" role="group" aria-label="Ansicht wählen">
            <button
              type="button"
              className={view === "aktiv" ? "active" : ""}
              aria-pressed={view === "aktiv"}
              onClick={() => setView("aktiv")}
            >
              Aktive Liste
              <span>{wohnungen.length - hiddenIds.size}</span>
            </button>
            <button
              type="button"
              className={view === "ausgeblendet" ? "active" : ""}
              aria-pressed={view === "ausgeblendet"}
              onClick={() => setView("ausgeblendet")}
            >
              Ausgeblendet
              <span>{hiddenIds.size}</span>
            </button>
          </div>

          <div className="filter-grid">
            <label className="search-field">
              <span>Suche</span>
              <input
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Adresse, Anbieter, Merkmal …"
              />
            </label>
            <label>
              <span>Stadtteil</span>
              <select
                value={district}
                onChange={(event) =>
                  setDistrict(event.target.value as DistrictFilter)
                }
              >
                <option value="alle">Alle Stadtteile</option>
                <option value="Johannstadt">Johannstadt</option>
                <option value="Gorbitz">Gorbitz</option>
              </select>
            </label>
            <label>
              <span>KdU-Personenzahl</span>
              <select
                value={persons}
                onChange={(event) => setPersons(event.target.value)}
              >
                <option value="alle">Alle</option>
                <option value="1">1 Person</option>
                <option value="2">2 Personen</option>
                <option value="10">10 Personen</option>
              </select>
            </label>
            <label>
              <span>Bewertung</span>
              <select
                value={rating}
                onChange={(event) =>
                  setRating(event.target.value as RatingFilter)
                }
              >
                <option value="alle">Alle Bewertungen</option>
                <option value="ausdrücklich geeignet">
                  ausdrücklich geeignet
                </option>
                <option value="möglicherweise geeignet">
                  möglicherweise geeignet
                </option>
                <option value="zu prüfen">zu prüfen</option>
              </select>
            </label>
            <label>
              <span>WBS</span>
              <select value={wbs} onChange={(event) => setWbs(event.target.value)}>
                <option value="alle">Alle WBS-Angaben</option>
                <option value="ja">WBS: ja</option>
                <option value="unklar">WBS: unklar</option>
              </select>
            </label>
            <label>
              <span>Sortierung</span>
              <select
                value={sort}
                onChange={(event) => setSort(event.target.value as SortMode)}
              >
                <option value="kdu">KdU-Personenzahl</option>
                <option value="nkm-auf">Nettokaltmiete aufsteigend</option>
                <option value="nkm-ab">Nettokaltmiete absteigend</option>
              </select>
            </label>
          </div>

          <div className="filter-footer">
            <p aria-live="polite">
              <strong>{visibleWohnungen.length}</strong>{" "}
              {visibleWohnungen.length === 1 ? "Angebot" : "Angebote"} angezeigt
              {savedIds.size > 0 ? ` · ${savedIds.size} vorgemerkt` : ""}
            </p>
            <div>
              <button type="button" className="text-button" onClick={resetFilters}>
                Filter zurücksetzen
              </button>
              <button type="button" className="json-button" onClick={downloadCsv}>
                CSV für Excel herunterladen
              </button>
            </div>
          </div>
        </div>

        {visibleWohnungen.length ? (
          <div className="listing-grid">
            {visibleWohnungen.map((wohnung) => (
              <ListingCard
                key={wohnung.id}
                wohnung={wohnung}
                isSaved={savedIds.has(wohnung.id)}
                isHidden={hiddenIds.has(wohnung.id)}
                note={notes[wohnung.id] ?? ""}
                onToggleSaved={(id) => updateSet(setSavedIds, id)}
                onToggleHidden={(id) => updateSet(setHiddenIds, id)}
                onNoteChange={updateNote}
              />
            ))}
          </div>
        ) : (
          <div className="empty-state">
            <span aria-hidden="true">0</span>
            <h3>Keine passenden Angebote</h3>
            <p>
              Passe die Filter an
              {view === "ausgeblendet"
                ? " oder wechsle zurück zur aktiven Liste."
                : "."}
            </p>
            <button type="button" onClick={resetFilters}>
              Filter zurücksetzen
            </button>
          </div>
        )}
      </section>

      <section className="method-section" id="methode">
        <p className="eyebrow">So wurde geprüft</p>
        <div className="method-grid">
          <div>
            <span>01</span>
            <h2>Direkt & erreichbar</h2>
            <p>
              Nur beim Abruf aktive, konkrete Inseratsseiten. Keine
              Suchergebnisse, Übersichtsseiten oder Tauschwohnungen.
            </p>
          </div>
          <div>
            <span>02</span>
            <h2>KdU transparent</h2>
            <p>
              Notwendige Personenzahl = aufgerundete Nettokaltmiete geteilt
              durch 450,50 €. Weitere Grenzen wurden nicht unterstellt.
            </p>
          </div>
          <div>
            <span>03</span>
            <h2>Nichts geschätzt</h2>
            <p>
              WBS und Barriereangaben werden nur übernommen, wenn sie
              ausdrücklich im Angebot stehen. Unklares bleibt „zu prüfen“.
            </p>
          </div>
        </div>
      </section>

      <footer>
        <p>
          Recherche-Stand{" "}
          {daten.aktualisiert_am
            ? new Intl.DateTimeFormat("de-DE").format(
                new Date(`${daten.aktualisiert_am}T12:00:00`),
              )
            : "wird geladen"}{" "}
          · Angaben ohne Gewähr · Verfügbarkeit
          bitte auf der Direktseite prüfen
        </p>
      </footer>
    </main>
  );
}
