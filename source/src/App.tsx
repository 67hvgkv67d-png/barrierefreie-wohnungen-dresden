"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import L from "leaflet";
import QRCode from "react-qr-code";
import { type Wohnung, type Wohnungsdaten } from "./types";

const euro = new Intl.NumberFormat("de-DE", {
  style: "currency",
  currency: "EUR",
});

const decimal = new Intl.NumberFormat("de-DE", {
  minimumFractionDigits: 0,
  maximumFractionDigits: 2,
});

const appVersion = "2026.08.19.5";

type DistrictFilter = "alle" | "Johannstadt" | "Gorbitz";
type DistrictName = Exclude<DistrictFilter, "alle">;
type RatingFilter = "alle" | Wohnung["bewertung"];
type ViewMode = "aktiv" | "ausgeblendet";
type SortMode = "kdu" | "nkm-auf" | "nkm-ab";

function districtName(stadtteil: string): DistrictName {
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

function ratingLabel(bewertung: Wohnung["bewertung"]) {
  if (bewertung === "ausdrücklich geeignet")
    return "Klare Barriereangaben";
  if (bewertung === "möglicherweise geeignet")
    return "Einzelne Barriereangaben";
  return "Angaben prüfen";
}

const ratingOrder: Record<Wohnung["bewertung"], number> = {
  "ausdrücklich geeignet": 0,
  "möglicherweise geeignet": 1,
  "zu prüfen": 2,
};

function ratingMarkerClass(bewertung: Wohnung["bewertung"]) {
  if (bewertung === "ausdrücklich geeignet") return "overview-marker-good";
  if (bewertung === "möglicherweise geeignet") return "overview-marker-maybe";
  return "overview-marker-check";
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

function DistrictOverviewMap({
  district,
  wohnungen,
}: {
  district: DistrictName;
  wohnungen: Wohnung[];
}) {
  const mapElement = useRef<HTMLDivElement>(null);
  const regionalstelle = regionalstellen[district];
  const districtWohnungen = useMemo(
    () =>
      wohnungen.filter(
        (wohnung) => districtName(wohnung.stadtteil) === district,
      ),
    [district, wohnungen],
  );
  const mappedWohnungen = useMemo(
    () => districtWohnungen.filter((wohnung) => wohnung.kartenposition),
    [districtWohnungen],
  );
  const unmappedCount = districtWohnungen.length - mappedWohnungen.length;

  useEffect(() => {
    if (!mapElement.current || mappedWohnungen.length === 0) return;

    const map = L.map(mapElement.current, {
      scrollWheelZoom: false,
      zoomControl: true,
    });

    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution:
        '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap-Mitwirkende</a>',
      maxZoom: 19,
    }).addTo(map);

    const bounds: L.LatLngExpression[] = [];

    mappedWohnungen.forEach((wohnung) => {
      const position = wohnung.kartenposition;
      if (!position) return;

      const markerPosition: L.LatLngTuple = [
        position.breitengrad,
        position.laengengrad,
      ];
      const marker = L.marker(markerPosition, {
        icon: L.divIcon({
          className: `map-marker overview-marker ${ratingMarkerClass(
            wohnung.bewertung,
          )}`,
          html: "<span>W</span>",
          iconSize: [34, 34],
          iconAnchor: [17, 17],
          popupAnchor: [0, -18],
        }),
        title: `${wohnung.titel}: ${wohnung.bewertung}`,
      }).addTo(map);

      const popup = document.createElement("div");
      popup.className = "overview-popup";

      const title = document.createElement("strong");
      title.textContent = wohnung.titel;
      popup.append(title);

      const address = document.createElement("span");
      address.textContent = wohnung.adresse;
      popup.append(address);

      const rating = document.createElement("span");
      rating.textContent = `Einordnung: ${ratingLabel(wohnung.bewertung)}`;
      popup.append(rating);

      const link = document.createElement("a");
      link.href = wohnung.direkte_inserats_url;
      link.target = "_blank";
      link.rel = "noreferrer";
      link.textContent = "Direktes Inserat öffnen ↗";
      popup.append(link);

      marker.bindPopup(popup);
      bounds.push(markerPosition);
    });

    const regionalstellePosition: L.LatLngTuple = [
      regionalstelle.breitengrad,
      regionalstelle.laengengrad,
    ];
    const officeMarker = L.marker(regionalstellePosition, {
      icon: L.divIcon({
        className: "map-marker overview-marker overview-marker-office",
        html: "<span>R</span>",
        iconSize: [38, 38],
        iconAnchor: [19, 19],
        popupAnchor: [0, -20],
      }),
      title: `${regionalstelle.name}: ${regionalstelle.adresse}`,
    }).addTo(map);

    const officePopup = document.createElement("div");
    officePopup.className = "overview-popup";
    const officeName = document.createElement("strong");
    officeName.textContent = regionalstelle.name;
    const officeAddress = document.createElement("span");
    officeAddress.textContent = regionalstelle.adresse;
    officePopup.append(officeName, officeAddress);
    officeMarker.bindPopup(officePopup);

    bounds.push(regionalstellePosition);
    map.fitBounds(L.latLngBounds(bounds), {
      padding: [32, 32],
      maxZoom: 15,
    });

    return () => {
      map.remove();
    };
  }, [mappedWohnungen, regionalstelle]);

  return (
    <article
      className={`overview-map-card overview-map-card-${district.toLowerCase()}`}
    >
      <div className="overview-map-heading">
        <div>
          <p>{district}</p>
          <h3>
            {mappedWohnungen.length}{" "}
            {mappedWohnungen.length === 1 ? "Wohnung" : "Wohnungen"} kartiert
          </h3>
        </div>
        <span>R = {regionalstelle.name}</span>
      </div>

      {mappedWohnungen.length ? (
        <div
          ref={mapElement}
          className="overview-map-canvas"
          aria-label={`Karte mit ${mappedWohnungen.length} Wohnungen in ${district} und ${regionalstelle.name}`}
        />
      ) : (
        <div className="overview-map-empty">
          Noch keine Wohnung mit verlässlicher Kartenposition vorhanden.
        </div>
      )}

      <div className="overview-map-meta">
        <p>
          <strong>{regionalstelle.name}</strong>
          <span>{regionalstelle.adresse}</span>
        </p>
        {unmappedCount > 0 ? (
          <p className="overview-map-warning">
            {unmappedCount}{" "}
            {unmappedCount === 1 ? "Angebot ist" : "Angebote sind"} mangels
            verlässlicher Position nicht kartiert.
          </p>
        ) : null}
      </div>
    </article>
  );
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
      className: `map-marker map-marker-home ${ratingMarkerClass(
        wohnung.bewertung,
      )}`,
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
              <span
                className={`legend-marker ${ratingMarkerClass(
                  wohnung.bewertung,
                )}`}
              >
                W
              </span>
              <strong>Wohnung</strong>
              <small>
                {wohnung.adresse} · {ratingLabel(wohnung.bewertung)} ·{" "}
                {position.genauigkeit}
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
    <article
      className={`listing-card listing-card-${districtName(wohnung.stadtteil).toLowerCase()} ${
        isSaved ? "listing-card-saved" : ""
      }`}
    >
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
          {ratingLabel(wohnung.bewertung)}
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
        <p>Im Originalinserat genannt</p>
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
          Quelle abgerufen am{" "}
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
        <p>
          Die Notiz wird nur in diesem Browser gespeichert. Bitte keine
          Gesundheitsdaten oder andere sensible personenbezogene Angaben
          eintragen.
        </p>
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

function PrintSheet({
  wohnungen,
  aktualisiertAm,
  notes,
}: {
  wohnungen: Wohnung[];
  aktualisiertAm: string;
  notes: Record<string, string>;
}) {
  const districts: DistrictName[] = ["Johannstadt", "Gorbitz"];
  const ratings: Wohnung["bewertung"][] = [
    "ausdrücklich geeignet",
    "möglicherweise geeignet",
    "zu prüfen",
  ];

  return (
    <section className="print-sheet" aria-hidden="true">
      <header className="print-header">
        <div>
          <p>Ergänzende Recherchehilfe</p>
          <h1>Wohnungsangebote mit Barriereangaben</h1>
        </div>
        <div className="print-meta">
          <strong>{wohnungen.length} gefilterte Angebote</strong>
          <span>
            Datenstand:{" "}
            {aktualisiertAm
              ? new Intl.DateTimeFormat("de-DE").format(
                  new Date(`${aktualisiertAm}T12:00:00`),
                )
              : "nicht angegeben"}
          </span>
        </div>
      </header>

      <p className="print-disclaimer">
        Recherchierte Hinweise ohne Gewähr. Keine Wohnungsvermittlung und keine
        Zusage zur Barrierefreiheit. Maßgeblich sind das Originalinserat und die
        Prüfung der Wohnung vor Ort.
      </p>

      {districts.map((districtItem) => {
        const districtWohnungen = wohnungen.filter(
          (wohnung) => districtName(wohnung.stadtteil) === districtItem,
        );
        if (!districtWohnungen.length) return null;

        return (
          <section className="print-district" key={districtItem}>
            <h2>
              {districtItem} <span>{districtWohnungen.length}</span>
            </h2>
            {ratings.map((ratingItem) => {
              const ratingWohnungen = districtWohnungen.filter(
                (wohnung) => wohnung.bewertung === ratingItem,
              );
              if (!ratingWohnungen.length) return null;

              return (
                <section className="print-rating" key={ratingItem}>
                  <h3>{ratingLabel(ratingItem)}</h3>
                  {ratingWohnungen.map((wohnung) => (
                    <article className="print-listing" key={wohnung.id}>
                      <div className="print-listing-heading">
                        <div className="print-listing-main">
                          <h4>{wohnung.titel}</h4>
                          <p>{wohnung.adresse}</p>
                          <dl>
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
                            <div>
                              <dt>KdU-Orientierung</dt>
                              <dd>
                                {wohnung.notwendige_personenzahl_nach_kdu_limit}{" "}
                                {wohnung.notwendige_personenzahl_nach_kdu_limit === 1
                                  ? "Person"
                                  : "Personen"}
                              </dd>
                            </div>
                            <div>
                              <dt>WBS</dt>
                              <dd>{wohnung.wbs}</dd>
                            </div>
                          </dl>
                        </div>
                        <div className="print-listing-aside">
                          <strong>{decimal.format(wohnung.zimmer)} Zimmer</strong>
                          <div className="print-qr">
                            <QRCode
                              value={wohnung.direkte_inserats_url}
                              size={112}
                              level="M"
                              bgColor="#ffffff"
                              fgColor="#10283a"
                              title={`QR-Code zum Originalinserat: ${wohnung.titel}`}
                            />
                            <span>Originalinserat öffnen</span>
                          </div>
                        </div>
                      </div>
                      <p className="print-barriers">
                        <strong>Im Inserat genannt:</strong>{" "}
                        {wohnung.barriereangaben.join(", ")}
                      </p>
                      {wohnung.hinweis ? (
                        <p className="print-hint">{wohnung.hinweis}</p>
                      ) : null}
                      {notes[wohnung.id] ? (
                        <p className="print-note">
                          <strong>Persönliche Notiz:</strong> {notes[wohnung.id]}
                        </p>
                      ) : null}
                      <p className="print-source">
                        <strong>Quelle:</strong> {wohnung.anbieter} ·{" "}
                        {wohnung.quelle} · abgerufen am{" "}
                        {new Intl.DateTimeFormat("de-DE").format(
                          new Date(`${wohnung.abrufdatum}T12:00:00`),
                        )}
                        <br />
                        <a href={wohnung.direkte_inserats_url}>
                          {wohnung.direkte_inserats_url}
                        </a>
                      </p>
                    </article>
                  ))}
                </section>
              );
            })}
          </section>
        );
      })}

      <footer className="print-footer">
        450,50 € Nettokaltmiete je berücksichtigter Person dienen nur als
        rechnerische KdU-Orientierung. Die Anerkennung ist im Einzelfall zu
        klären.
      </footer>
    </section>
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
  const personOptions = [...new Set(
    wohnungen.map(
      (wohnung) => wohnung.notwendige_personenzahl_nach_kdu_limit,
    ),
  )].sort((a, b) => a - b);

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
  }, [district, hiddenIds, persons, query, rating, sort, view, wbs, wohnungen]);

  const exportWohnungen = useMemo(
    () =>
      [...visibleWohnungen].sort((a, b) => {
        const districtDifference =
          ["Johannstadt", "Gorbitz"].indexOf(districtName(a.stadtteil)) -
          ["Johannstadt", "Gorbitz"].indexOf(districtName(b.stadtteil));
        if (districtDifference) return districtDifference;

        const ratingDifference =
          ratingOrder[a.bewertung] - ratingOrder[b.bewertung];
        if (ratingDifference) return ratingDifference;

        return (
          a.zimmer - b.zimmer ||
          a.nettokaltmiete_eur - b.nettokaltmiete_eur
        );
      }),
    [visibleWohnungen],
  );

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
    const rows = exportWohnungen.map((wohnung) => [
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
        <span className="app-version">Version {appVersion}</span>
        <div className="hero-copy">
          <p className="hero-date">
            Stand{" "}
            {daten.aktualisiert_am
              ? new Intl.DateTimeFormat("de-DE").format(
                  new Date(`${daten.aktualisiert_am}T12:00:00`),
                )
              : "wird geladen"}
          </p>
          <h1>Wohnungsangebote mit Barriereangaben</h1>
          <p className="hero-subtitle">Dresden-Johannstadt und Dresden-Gorbitz</p>
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
              <span>mit klaren Barriereangaben</span>
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

      <section className="research-notice" id="hinweise" aria-label="Wichtige Hinweise">
        <strong>Ergänzende Recherchehilfe</strong>
        <p>
          Dies ist kein offizielles Wohnungsportal der Lebenshilfe und keine
          Wohnungsvermittlung. Die Übersicht sammelt recherchierte Angebote
          und kann unvollständig oder zwischenzeitlich veraltet sein.
          Maßgeblich ist immer das verlinkte Originalinserat.
        </p>
        <p>
          Angaben zur Zugänglichkeit stammen aus dem Originalinserat. Die
          farbliche Einordnung wird automatisiert beziehungsweise redaktionell
          daraus abgeleitet und ist keine Zusage, dass eine Wohnung individuell
          geeignet oder barrierefrei ist.
        </p>
      </section>

      <section className="overview-section" aria-labelledby="karten-ueberschrift">
        <div className="overview-section-heading">
          <div>
            <p className="eyebrow eyebrow-dark">Lage im Stadtteil</p>
            <h2 id="karten-ueberschrift">Alle Wohnungen auf einen Blick</h2>
          </div>
          <p>
            Jede Karte zeigt die aktuell gefundenen Wohnungen und die
            zuständige Regionalstelle. Ein Klick auf einen Wohnungsmarker
            öffnet die wichtigsten Angaben und den direkten Inseratslink.
          </p>
        </div>

        <div className="overview-map-grid">
          <DistrictOverviewMap district="Johannstadt" wohnungen={wohnungen} />
          <DistrictOverviewMap district="Gorbitz" wohnungen={wohnungen} />
        </div>

        <div className="overview-map-legend" aria-label="Kartenlegende">
          <span>
            <i className="overview-legend-dot overview-marker-good">W</i>
            klare Barriereangaben
          </span>
          <span>
            <i className="overview-legend-dot overview-marker-maybe">W</i>
            einzelne Barriereangaben
          </span>
          <span>
            <i className="overview-legend-dot overview-marker-check">W</i>
            Angaben prüfen
          </span>
          <span>
            <i className="overview-legend-office">R</i>
            Regionalstelle
          </span>
        </div>
        <p className="overview-map-note">
          Die Farben geben eine automatisierte beziehungsweise redaktionelle
          Einordnung der im Originalinserat genannten Angaben wieder. Sie
          ersetzen keine individuelle Prüfung. Beim Laden werden Kartendaten
          von OpenStreetMap abgerufen.
        </p>
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
            <p className="eyebrow eyebrow-dark">Recherchierte Direktangebote</p>
            <h2>Wohnungen filtern und vormerken</h2>
          </div>
          <p>
            Suche gezielt nach Stadtteil, notwendiger Personenzahl, WBS und
            Eignung. Vorgemerkte und ausgeblendete Angebote bleiben auf diesem
            Gerät gespeichert.
          </p>
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
                {personOptions.map((personCount) => (
                  <option value={personCount} key={personCount}>
                    {personCount} {personCount === 1 ? "Person" : "Personen"}
                  </option>
                ))}
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
                <option value="ausdrücklich geeignet">Klare Barriereangaben</option>
                <option value="möglicherweise geeignet">
                  Einzelne Barriereangaben
                </option>
                <option value="zu prüfen">Angaben prüfen</option>
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
              <button type="button" className="data-button" onClick={downloadCsv}>
                Daten für Excel
              </button>
              <button
                type="button"
                className="print-button"
                onClick={() => window.print()}
              >
                Gefilterte Liste drucken / als PDF speichern
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
        <p className="eyebrow">So wird recherchiert und eingeordnet</p>
        <div className="method-grid">
          <div>
            <span>01</span>
            <h2>Direkt verlinkt</h2>
            <p>
              Jedes Angebot nennt Quelle, Anbieter und Original-Link. Beim
              Abruf nicht erreichbare Inserate und Tauschwohnungen werden
              nicht in die aktive Liste übernommen.
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
            <h2>Quellennah eingeordnet</h2>
            <p>
              WBS und Barriereangaben werden nur übernommen, wenn sie
              ausdrücklich im Angebot stehen. Die Einordnung ist keine
              Eignungsprüfung und Unklares bleibt „Angaben prüfen“.
            </p>
          </div>
        </div>
      </section>

      <section className="privacy-section" id="datenschutz">
        <p className="eyebrow eyebrow-dark">Datenschutz und Nutzung</p>
        <div className="privacy-grid">
          <div>
            <h2>Lokale Funktionen</h2>
            <p>
              Favoriten, ausgeblendete Angebote und persönliche Notizen werden
              ausschließlich im lokalen Speicher dieses Browsers abgelegt. Die
              Seite übermittelt diese Angaben nicht an uns. Bitte trotzdem
              keine Gesundheitsdaten oder andere sensible personenbezogene
              Daten in Notizen eintragen.
            </p>
          </div>
          <div>
            <h2>Technische Dienste</h2>
            <p>
              Die Seite wird über GitHub Pages bereitgestellt. Beim Aufruf
              verarbeitet GitHub technisch erforderliche Verbindungsdaten wie
              die IP-Adresse. Für die Übersichtskarten und beim Öffnen einer
              Lagekarte werden Kartenkacheln von OpenStreetMap geladen; dabei
              erhält OpenStreetMap ebenfalls technische Verbindungsdaten.
            </p>
          </div>
          <div>
            <h2>Keine eigene Analyse</h2>
            <p>
              Die Seite setzt selbst keine Analyse- oder Werbedienste ein und
              legt keine eigenen Cookies an. Beim Öffnen eines Originalinserats
              gelten die Datenschutzbestimmungen des jeweiligen Anbieters.
            </p>
          </div>
        </div>
        <p className="privacy-links">
          Weitere Informationen:{" "}
          <a
            href="https://docs.github.com/de/site-policy/privacy-policies/github-general-privacy-statement"
            target="_blank"
            rel="noreferrer"
          >
            Datenschutz bei GitHub
          </a>{" "}
          ·{" "}
          <a
            href="https://osmfoundation.org/wiki/Privacy_Policy"
            target="_blank"
            rel="noreferrer"
          >
            Datenschutz bei OpenStreetMap
          </a>
        </p>
      </section>

      <section className="provider-section" id="anbieter">
        <p className="eyebrow eyebrow-dark">Anbieterkennzeichnung und Kontakt</p>
        <div>
          <h2>Hinweise zur Recherchehilfe</h2>
          <address>
            Markus Hutschenreuther<br />
            Wohnprojekt „Wohnen, wie ich es will“<br />
            Lebenshilfe Dresden e. V.<br />
            Josephinenstraße 31<br />
            01069 Dresden<br />
            <a href="mailto:WieIchEsWill@lebenshilfe-dresden.de">
              WieIchEsWill@lebenshilfe-dresden.de
            </a><br />
            <a href="tel:+49351424978410">0351 424 978 410</a>
          </address>
          <p>
            Kontakt für Korrekturhinweise zur Übersicht. Die Seite ist eine
            ergänzende Recherchehilfe im Rahmen individueller Wohnberatungen,
            kein allgemeines offizielles Wohnungsportal der Lebenshilfe und
            keine Wohnungsvermittlung.
          </p>
        </div>
      </section>

      <footer className="site-footer">
        <nav aria-label="Rechtliche Hinweise">
          <a href="#hinweise">Hinweise</a>
          <a href="#datenschutz">Datenschutz</a>
          <a href="#anbieter">Anbieter</a>
        </nav>
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
      <PrintSheet
        wohnungen={exportWohnungen}
        aktualisiertAm={daten.aktualisiert_am}
        notes={notes}
      />
    </main>
  );
}
