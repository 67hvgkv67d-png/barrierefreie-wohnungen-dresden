"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import L from "leaflet";
import QRCode from "react-qr-code";
import {
  type RbBewertung,
  type RbWohnung,
  type RbWohnungsdaten,
  type Wohnung,
  type Wohnungsdaten,
} from "./types";

const euro = new Intl.NumberFormat("de-DE", {
  style: "currency",
  currency: "EUR",
});

const decimal = new Intl.NumberFormat("de-DE", {
  minimumFractionDigits: 0,
  maximumFractionDigits: 2,
});

const appVersion = "2026.09.02.1";

type DistrictFilter = "alle" | "Johannstadt" | "Gorbitz";
type DistrictName = Exclude<DistrictFilter, "alle">;
type RatingFilter = "alle" | Wohnung["bewertung"];
type ViewMode = "aktiv" | "ausgeblendet";
type SortMode = "kdu" | "nkm-auf" | "nkm-ab";
type AppMode = "barriere" | "rb";

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

const rbReferenzorte = [
  {
    name: "Eibenstocker Straße 105",
    breitengrad: 51.0346493,
    laengengrad: 13.8042419,
  },
  {
    name: "Niedersedlitzer Platz",
    breitengrad: 50.9955578,
    laengengrad: 13.8256765,
  },
  {
    name: "Lauensteiner Straße 40",
    breitengrad: 51.0401667,
    laengengrad: 13.8023002,
  },
] as const;

function rbRatingLabel(bewertung: RbBewertung) {
  if (bewertung === "eher passend") return "Eher konfliktarm";
  if (bewertung === "bedingt passend") return "Bedingt passend";
  return "Vor Ort prüfen";
}

function rbStatusClass(bewertung: RbBewertung) {
  if (bewertung === "eher passend") return "status-good";
  if (bewertung === "bedingt passend") return "status-maybe";
  return "status-check";
}

function mainWohnungToRb(wohnung: Wohnung): RbWohnung {
  const dachgeschoss = /dachgeschoss|\bdg\b/i.test(wohnung.titel);
  return {
    id: `RB-${wohnung.id}`,
    titel: wohnung.titel,
    suchbereich: "Johannstadt",
    adresse: wohnung.adresse,
    zimmer: wohnung.zimmer,
    wohnflaeche_m2: wohnung.wohnflaeche_m2,
    nettokaltmiete_eur: wohnung.nettokaltmiete_eur,
    warmmiete_eur: wohnung.warmmiete_eur,
    bewertung: dachgeschoss ? "bedingt passend" : "zu prüfen",
    begruendung: dachgeschoss
      ? "Die Dachgeschosslage ist günstig; Angaben zu Hausgröße, Nachbarwohnungen und Schallschutz fehlen jedoch."
      : "Das Inserat liegt in Johannstadt, enthält aber noch zu wenige ausdrückliche Angaben zum Gebäude und zu direkt angrenzenden Wohnungen.",
    anzahl_wohnungen_mietparteien: "nicht genannt",
    wohn_und_geschaeftshaus: "unklar",
    gewerbeeinheiten: [],
    lage_im_gebaeude: dachgeschoss ? "Dachgeschoss" : "nicht genannt",
    eigener_separater_eingang: "unklar",
    direkt_angrenzende_wohnungen: "nicht genannt",
    schallschutz_ruhezonen: [],
    positive_merkmale: dachgeschoss ? ["Dachgeschoss"] : [],
    pruefhinweise: [
      "Hausgröße und Anzahl der Mietparteien erfragen",
      "direkt angrenzende Wohnungen und Hellhörigkeit vor Ort prüfen",
    ],
    anbieter: wohnung.anbieter,
    quelle: wohnung.quelle,
    kontakt: "über das Originalinserat",
    direkte_inserats_url: wohnung.direkte_inserats_url,
    status: "aktiv",
    abrufdatum: wohnung.abrufdatum,
    erstmals_gefunden_am: wohnung.erstmals_gefunden_am,
    kartenposition: wohnung.kartenposition,
    neu: wohnung.neu,
  };
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

function RbOverviewMap({ wohnungen }: { wohnungen: RbWohnung[] }) {
  const mapElement = useRef<HTMLDivElement>(null);
  const mapped = useMemo(
    () => wohnungen.filter((wohnung) => wohnung.kartenposition),
    [wohnungen],
  );

  useEffect(() => {
    if (!mapElement.current) return;
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
    mapped.forEach((wohnung) => {
      if (!wohnung.kartenposition) return;
      const position: L.LatLngTuple = [
        wohnung.kartenposition.breitengrad,
        wohnung.kartenposition.laengengrad,
      ];
      const marker = L.marker(position, {
        icon: L.divIcon({
          className: `map-marker overview-marker rb-marker-${wohnung.bewertung.replaceAll(" ", "-")}`,
          html: "<span>W</span>",
          iconSize: [34, 34],
          iconAnchor: [17, 17],
        }),
        title: `${wohnung.titel}: ${rbRatingLabel(wohnung.bewertung)}`,
      }).addTo(map);
      const popup = document.createElement("div");
      popup.className = "overview-popup";
      const title = document.createElement("strong");
      title.textContent = wohnung.titel;
      const address = document.createElement("span");
      address.textContent = wohnung.adresse;
      const rating = document.createElement("span");
      rating.textContent = rbRatingLabel(wohnung.bewertung);
      const link = document.createElement("a");
      link.href = wohnung.direkte_inserats_url;
      link.target = "_blank";
      link.rel = "noreferrer";
      link.textContent = "Originalinserat öffnen ↗";
      popup.append(title, address, rating, link);
      marker.bindPopup(popup);
      bounds.push(position);
    });

    rbReferenzorte.forEach((ort) => {
      const position: L.LatLngTuple = [ort.breitengrad, ort.laengengrad];
      L.marker(position, {
        icon: L.divIcon({
          className: "map-marker overview-marker rb-reference-marker",
          html: "<span>Z</span>",
          iconSize: [38, 38],
          iconAnchor: [19, 19],
        }),
        title: `Suchziel: ${ort.name}`,
      })
        .addTo(map)
        .bindPopup(`<strong>Suchziel</strong><br>${ort.name}`);
      bounds.push(position);
    });

    if (bounds.length) {
      map.fitBounds(L.latLngBounds(bounds), { padding: [30, 30], maxZoom: 14 });
    }
    return () => {
      map.remove();
    };
  }, [mapped]);

  return (
    <article className="overview-map-card rb-overview-map-card">
      <div className="overview-map-heading rb-overview-heading">
        <div>
          <p>RB-Suchgebiete</p>
          <h3>{mapped.length} Wohnungen kartiert</h3>
        </div>
        <span>Z = zusätzliche Suchadresse</span>
      </div>
      <div
        ref={mapElement}
        className="overview-map-canvas rb-overview-canvas"
        aria-label="Karte der RB-Wohnungen und der drei zusätzlichen Suchadressen"
      />
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

function RbListingCard({
  wohnung,
  isSaved,
  isHidden,
  note,
  onToggleSaved,
  onToggleHidden,
  onNoteChange,
}: {
  wohnung: RbWohnung;
  isSaved: boolean;
  isHidden: boolean;
  note: string;
  onToggleSaved: (id: string) => void;
  onToggleHidden: (id: string) => void;
  onNoteChange: (id: string, note: string) => void;
}) {
  return (
    <article className={`listing-card rb-listing-card ${isSaved ? "listing-card-saved" : ""}`}>
      <div className="card-topline">
        <div className="card-labels">
          <span className="district-label rb-area-label">{wohnung.suchbereich}</span>
          {wohnung.neu ? <span className="new-badge">Neu</span> : null}
        </div>
        <span className={`status-badge ${rbStatusClass(wohnung.bewertung)}`}>
          {rbRatingLabel(wohnung.bewertung)}
        </span>
      </div>

      <div className="card-heading rb-card-heading">
        <p className="listing-id">{wohnung.id}</p>
        <h3>{wohnung.titel}</h3>
        <p className="address">{wohnung.adresse}</p>
        {wohnung.fussweg_minuten !== undefined ? (
          <p className="rb-distance">
            ca. {wohnung.fussweg_minuten} Min. zu Fuß · {wohnung.entfernung_hinweis}
          </p>
        ) : null}
      </div>

      <dl className="quick-facts">
        <div><dt>Zimmer</dt><dd>{decimal.format(wohnung.zimmer)}</dd></div>
        <div><dt>Wohnfläche</dt><dd>{decimal.format(wohnung.wohnflaeche_m2)} m²</dd></div>
        <div><dt>Nettokalt</dt><dd>{euro.format(wohnung.nettokaltmiete_eur)}</dd></div>
        <div><dt>Warm</dt><dd>{wohnung.warmmiete_eur === null ? "nicht genannt" : euro.format(wohnung.warmmiete_eur)}</dd></div>
      </dl>

      <div className="rb-assessment">
        <p>Einordnung für ein möglichst konfliktarmes Umfeld</p>
        <strong>{wohnung.begruendung}</strong>
      </div>

      <dl className="rb-details">
        <div><dt>Haus / Mietparteien</dt><dd>{wohnung.anzahl_wohnungen_mietparteien}</dd></div>
        <div><dt>Lage im Gebäude</dt><dd>{wohnung.lage_im_gebaeude}</dd></div>
        <div><dt>Wohn- und Geschäftshaus</dt><dd>{wohnung.wohn_und_geschaeftshaus}</dd></div>
        <div><dt>Separater Eingang</dt><dd>{wohnung.eigener_separater_eingang}</dd></div>
        <div><dt>Direkte Nachbarwohnungen</dt><dd>{wohnung.direkt_angrenzende_wohnungen}</dd></div>
        <div><dt>Kontakt</dt><dd>{wohnung.kontakt}</dd></div>
      </dl>

      {wohnung.positive_merkmale.length ? (
        <div className="barrier-block rb-positive-block">
          <p>Ausdrücklich genannte positive Merkmale</p>
          <ul>{wohnung.positive_merkmale.map((merkmal) => <li key={merkmal}>{merkmal}</li>)}</ul>
        </div>
      ) : null}
      {wohnung.gewerbeeinheiten.length ? (
        <p className="rb-business"><strong>Gewerbe:</strong> {wohnung.gewerbeeinheiten.join(", ")}</p>
      ) : null}
      {wohnung.schallschutz_ruhezonen.length ? (
        <p className="rb-business"><strong>Ruhe / Schallschutz:</strong> {wohnung.schallschutz_ruhezonen.join(", ")}</p>
      ) : null}
      <div className="rb-checks">
        <strong>Vor Entscheidung prüfen</strong>
        <ul>{wohnung.pruefhinweise.map((hinweis) => <li key={hinweis}>{hinweis}</li>)}</ul>
      </div>

      <div className="provider-row">
        <span>{wohnung.anbieter} · {wohnung.quelle}</span>
        <span>Status: {wohnung.status} · Abruf {new Intl.DateTimeFormat("de-DE").format(new Date(`${wohnung.abrufdatum}T12:00:00`))}</span>
      </div>
      <div className="card-actions">
        <label className="save-control">
          <input type="checkbox" checked={isSaved} onChange={() => onToggleSaved(wohnung.id)} />
          <span aria-hidden="true">{isSaved ? "✓" : ""}</span>
          {isSaved ? "Favorit" : "Als Favorit"}
        </label>
        <button className="hide-button" type="button" onClick={() => onToggleHidden(wohnung.id)}>
          {isHidden ? "Wieder anzeigen" : "Ausblenden"}
        </button>
      </div>
      <details className="note-box" open={note ? true : undefined}>
        <summary>{note ? "Persönliche Notiz bearbeiten" : "Notiz hinzufügen"}</summary>
        <label>
          <span>Persönliche Notiz</span>
          <textarea value={note} onChange={(event) => onNoteChange(wohnung.id, event.target.value)} rows={3} />
        </label>
        <p>Nur lokal in diesem Browser. Bitte keine Gesundheitsdaten oder andere sensiblen Angaben eintragen.</p>
      </details>
      <a className="listing-link" href={wohnung.direkte_inserats_url} target="_blank" rel="noreferrer">
        Direkt zum Inserat <span aria-hidden="true">↗</span>
      </a>
    </article>
  );
}

function RbPrintSheet({
  wohnungen,
  aktualisiertAm,
  notes,
}: {
  wohnungen: RbWohnung[];
  aktualisiertAm: string;
  notes: Record<string, string>;
}) {
  const areas = ["Johannstadt", "Eibenstocker Straße 105", "Lauensteiner Straße 40", "Niedersedlitzer Platz"];
  return (
    <section className="print-sheet" aria-hidden="true">
      <header className="print-header">
        <div><p>RB-Spezialsuche</p><h1>Wohnungen mit Blick auf ein konfliktarmes Umfeld</h1></div>
        <div className="print-meta"><strong>{wohnungen.length} gefilterte Angebote</strong><span>Datenstand: {aktualisiertAm}</span></div>
      </header>
      <p className="print-disclaimer">Die Einordnung beruht ausschließlich auf ausdrücklichen Inseratsangaben und ersetzt keine Besichtigung. Barrierefreiheit ist in dieser Ansicht kein Auswahlkriterium.</p>
      {areas.map((area) => {
        const items = wohnungen.filter((wohnung) => wohnung.suchbereich === area);
        if (!items.length) return null;
        return <section className="print-district" key={area}>
          <h2>{area}<span>{items.length}</span></h2>
          {items.map((wohnung) => <article className="print-listing" key={wohnung.id}>
            <div className="print-listing-heading">
              <div className="print-listing-main"><h4>{wohnung.titel}</h4><p>{wohnung.adresse}</p><dl>
                <div><dt>Wohnfläche</dt><dd>{decimal.format(wohnung.wohnflaeche_m2)} m²</dd></div>
                <div><dt>Nettokalt</dt><dd>{euro.format(wohnung.nettokaltmiete_eur)}</dd></div>
                <div><dt>Warm</dt><dd>{wohnung.warmmiete_eur === null ? "–" : euro.format(wohnung.warmmiete_eur)}</dd></div>
                <div><dt>Einordnung</dt><dd>{rbRatingLabel(wohnung.bewertung)}</dd></div>
                <div><dt>Haus</dt><dd>{wohnung.anzahl_wohnungen_mietparteien}</dd></div>
              </dl></div>
              <div className="print-listing-aside"><strong>{decimal.format(wohnung.zimmer)} Zimmer</strong><div className="print-qr"><QRCode value={wohnung.direkte_inserats_url} size={112} level="M" bgColor="#ffffff" fgColor="#10283a" /><span>Originalinserat öffnen</span></div></div>
            </div>
            <p className="print-barriers"><strong>Begründung:</strong> {wohnung.begruendung}</p>
            <p className="print-hint"><strong>Prüfen:</strong> {wohnung.pruefhinweise.join(", ")}</p>
            {notes[wohnung.id] ? <p className="print-note"><strong>Persönliche Notiz:</strong> {notes[wohnung.id]}</p> : null}
            <p className="print-source"><strong>Quelle:</strong> {wohnung.anbieter} · {wohnung.quelle} · abgerufen am {wohnung.abrufdatum}<br/><a href={wohnung.direkte_inserats_url}>{wohnung.direkte_inserats_url}</a></p>
          </article>)}
        </section>;
      })}
    </section>
  );
}

function RbSection({
  wohnungen,
  aktualisiertAm,
}: {
  wohnungen: RbWohnung[];
  aktualisiertAm: string;
}) {
  const [query, setQuery] = useState("");
  const [area, setArea] = useState("alle");
  const [rating, setRating] = useState("alle");
  const [rooms, setRooms] = useState("alle");
  const [sort, setSort] = useState("bewertung");
  const [view, setView] = useState<ViewMode>("aktiv");
  const [savedIds, setSavedIds] = useState<Set<string>>(new Set());
  const [hiddenIds, setHiddenIds] = useState<Set<string>>(new Set());
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    try {
      setSavedIds(new Set(JSON.parse(localStorage.getItem("wohnraum-rb-saved") ?? "[]")));
      setHiddenIds(new Set(JSON.parse(localStorage.getItem("wohnraum-rb-hidden") ?? "[]")));
      const storedNotes = JSON.parse(localStorage.getItem("wohnraum-rb-notes") ?? "{}");
      setNotes(storedNotes && typeof storedNotes === "object" && !Array.isArray(storedNotes) ? storedNotes : {});
    } catch {
      setSavedIds(new Set()); setHiddenIds(new Set()); setNotes({});
    }
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    localStorage.setItem("wohnraum-rb-saved", JSON.stringify([...savedIds]));
    localStorage.setItem("wohnraum-rb-hidden", JSON.stringify([...hiddenIds]));
    localStorage.setItem("wohnraum-rb-notes", JSON.stringify(notes));
  }, [hiddenIds, hydrated, notes, savedIds]);

  const visible = useMemo(() => {
    const search = query.trim().toLocaleLowerCase("de-DE");
    const order: Record<RbBewertung, number> = { "eher passend": 0, "bedingt passend": 1, "zu prüfen": 2 };
    return wohnungen
      .filter((wohnung) => view === "ausgeblendet" ? hiddenIds.has(wohnung.id) : !hiddenIds.has(wohnung.id))
      .filter((wohnung) => area === "alle" || wohnung.suchbereich === area)
      .filter((wohnung) => rating === "alle" || wohnung.bewertung === rating)
      .filter((wohnung) => rooms === "alle" || wohnung.zimmer === Number(rooms))
      .filter((wohnung) => !search || [wohnung.titel, wohnung.adresse, wohnung.anbieter, wohnung.suchbereich, wohnung.begruendung, ...wohnung.positive_merkmale, ...wohnung.gewerbeeinheiten].join(" ").toLocaleLowerCase("de-DE").includes(search))
      .sort((a, b) => {
        if (sort === "miete") return a.nettokaltmiete_eur - b.nettokaltmiete_eur;
        if (sort === "zimmer") return a.zimmer - b.zimmer || a.nettokaltmiete_eur - b.nettokaltmiete_eur;
        if (sort === "fussweg") return (a.fussweg_minuten ?? 999) - (b.fussweg_minuten ?? 999);
        return order[a.bewertung] - order[b.bewertung] || a.nettokaltmiete_eur - b.nettokaltmiete_eur;
      });
  }, [area, hiddenIds, query, rating, rooms, sort, view, wohnungen]);

  function updateSet(setter: React.Dispatch<React.SetStateAction<Set<string>>>, id: string) {
    setter((current) => { const next = new Set(current); next.has(id) ? next.delete(id) : next.add(id); return next; });
  }
  function updateNote(id: string, note: string) {
    setNotes((current) => { const next = { ...current }; if (note) next[id] = note; else delete next[id]; return next; });
  }
  function reset() { setQuery(""); setArea("alle"); setRating("alle"); setRooms("alle"); setSort("bewertung"); }

  const roomOptions = [...new Set(wohnungen.map((wohnung) => wohnung.zimmer))].sort((a, b) => a - b);
  return <>
    <section className="overview-section rb-overview-section" aria-labelledby="rb-karten-ueberschrift">
      <div className="overview-section-heading">
        <div><p className="eyebrow eyebrow-dark">RB-Suchgebiete</p><h2 id="rb-karten-ueberschrift">Johannstadt und drei zusätzliche Zielorte</h2></div>
        <p>Die drei Adressen wurden in Dresden gefunden. Ergänzende Angebote werden nur aufgenommen, wenn sie ungefähr innerhalb von 15 Minuten Fußweg liegen. Die Gehzeit ist ein Orientierungswert.</p>
      </div>
      <div className="rb-reference-grid">
        {rbReferenzorte.map((ort) => <div key={ort.name}><strong>{ort.name}</strong><span>Dresden · Suchradius ca. 15 Gehminuten</span></div>)}
      </div>
      <div className="rb-map-wrap"><RbOverviewMap wohnungen={wohnungen} /></div>
      <div className="overview-map-legend">
        <span><i className="overview-legend-dot rb-legend-good">W</i> eher konfliktarm</span>
        <span><i className="overview-legend-dot rb-legend-maybe">W</i> bedingt passend</span>
        <span><i className="overview-legend-dot rb-legend-check">W</i> vor Ort prüfen</span>
        <span><i className="overview-legend-office rb-reference-legend">Z</i> zusätzliche Suchadresse</span>
      </div>
    </section>

    <section className="content-section rb-content-section" id="rb-angebote">
      <div className="section-heading">
        <div><p className="eyebrow eyebrow-dark">Getrennte RB-Spezialsuche</p><h2>Wohnumfeld statt Barrierefreiheit</h2></div>
        <p>Bewertet werden ausschließlich ausdrückliche Hinweise zu Hausgröße, Nachbarschaft, gemischter Nutzung, Lage im Gebäude und Schallschutz. Fehlende Angaben bleiben „vor Ort prüfen“.</p>
      </div>
      <div className="filter-panel" aria-label="RB-Angebote filtern">
        <div className="view-tabs" role="group" aria-label="Ansicht wählen">
          <button type="button" className={view === "aktiv" ? "active" : ""} onClick={() => setView("aktiv")}>Aktive RB-Liste <span>{wohnungen.length - hiddenIds.size}</span></button>
          <button type="button" className={view === "ausgeblendet" ? "active" : ""} onClick={() => setView("ausgeblendet")}>Ausgeblendet <span>{hiddenIds.size}</span></button>
        </div>
        <div className="filter-grid rb-filter-grid">
          <label className="search-field"><span>Suche</span><input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Adresse, Hausart, Gewerbe …" /></label>
          <label><span>Suchbereich</span><select value={area} onChange={(event) => setArea(event.target.value)}><option value="alle">Alle RB-Bereiche</option><option>Johannstadt</option><option>Eibenstocker Straße 105</option><option>Niedersedlitzer Platz</option><option>Lauensteiner Straße 40</option></select></label>
          <label><span>Einordnung</span><select value={rating} onChange={(event) => setRating(event.target.value)}><option value="alle">Alle Einordnungen</option><option value="eher passend">Eher konfliktarm</option><option value="bedingt passend">Bedingt passend</option><option value="zu prüfen">Vor Ort prüfen</option></select></label>
          <label><span>Zimmer</span><select value={rooms} onChange={(event) => setRooms(event.target.value)}><option value="alle">Alle Zimmerzahlen</option>{roomOptions.map((item) => <option key={item} value={item}>{decimal.format(item)} Zimmer</option>)}</select></label>
          <label><span>Sortierung</span><select value={sort} onChange={(event) => setSort(event.target.value)}><option value="bewertung">Konfliktarm zuerst</option><option value="fussweg">Fußweg zuerst</option><option value="miete">Nettokaltmiete</option><option value="zimmer">Zimmerzahl</option></select></label>
        </div>
        <div className="filter-footer"><p><strong>{visible.length}</strong> {visible.length === 1 ? "Angebot" : "Angebote"} angezeigt</p><div><button type="button" className="text-button" onClick={reset}>Filter zurücksetzen</button><button type="button" className="print-button" onClick={() => window.print()}>RB-Liste drucken / als PDF</button></div></div>
      </div>
      {visible.length ? <div className="listing-grid">{visible.map((wohnung) => <RbListingCard key={wohnung.id} wohnung={wohnung} isSaved={savedIds.has(wohnung.id)} isHidden={hiddenIds.has(wohnung.id)} note={notes[wohnung.id] ?? ""} onToggleSaved={(id) => updateSet(setSavedIds, id)} onToggleHidden={(id) => updateSet(setHiddenIds, id)} onNoteChange={updateNote} />)}</div> : <div className="empty-state"><span>0</span><h3>Keine passenden RB-Angebote</h3><p>Filter anpassen oder zur aktiven Liste wechseln.</p><button type="button" onClick={reset}>Filter zurücksetzen</button></div>}
    </section>
    <RbPrintSheet wohnungen={visible} aktualisiertAm={aktualisiertAm} notes={notes} />
  </>;
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
  const [mode, setMode] = useState<AppMode>(() =>
    new URLSearchParams(window.location.search).get("ansicht") === "rb"
      ? "rb"
      : "barriere",
  );
  const [daten, setDaten] = useState<Wohnungsdaten>({
    aktualisiert_am: "",
    wohnungen: [],
  });
  const [rbDaten, setRbDaten] = useState<RbWohnungsdaten>({
    aktualisiert_am: "",
    suchradius_hinweis: "",
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
    Promise.all([
      fetch(`${import.meta.env.BASE_URL}wohnungen.json`).then((response) => {
        if (!response.ok) throw new Error("Wohnungsdaten konnten nicht geladen werden.");
        return response.json() as Promise<Wohnungsdaten>;
      }),
      fetch(`${import.meta.env.BASE_URL}rb-wohnungen.json`).then((response) => {
        if (!response.ok) throw new Error("RB-Wohnungsdaten konnten nicht geladen werden.");
        return response.json() as Promise<RbWohnungsdaten>;
      }),
    ])
      .then(([mainData, rbData]) => { setDaten(mainData); setRbDaten(rbData); })
      .catch(() => setLoadError(true));
  }, []);

  function changeMode(nextMode: AppMode) {
    setMode(nextMode);
    const url = new URL(window.location.href);
    if (nextMode === "rb") url.searchParams.set("ansicht", "rb");
    else url.searchParams.delete("ansicht");
    window.history.replaceState({}, "", url);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

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
  const rbWohnungen = useMemo(() => {
    const mainJohannstadt = wohnungen
      .filter((wohnung) => districtName(wohnung.stadtteil) === "Johannstadt")
      .map(mainWohnungToRb);
    const seen = new Set(rbDaten.wohnungen.map((wohnung) => wohnung.direkte_inserats_url));
    return [
      ...rbDaten.wohnungen,
      ...mainJohannstadt.filter((wohnung) => !seen.has(wohnung.direkte_inserats_url)),
    ];
  }, [rbDaten.wohnungen, wohnungen]);

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
          <div className="mode-switch" role="group" aria-label="Wohnungssuche wählen">
            <button type="button" className={mode === "barriere" ? "active" : ""} aria-pressed={mode === "barriere"} onClick={() => changeMode("barriere")}>Barriereangaben</button>
            <button type="button" className={mode === "rb" ? "active" : ""} aria-pressed={mode === "rb"} onClick={() => changeMode("rb")}>RB – Spezialsuche</button>
          </div>
          <p className="hero-date">
            Stand{" "}
            {(mode === "rb" ? rbDaten.aktualisiert_am : daten.aktualisiert_am)
              ? new Intl.DateTimeFormat("de-DE").format(
                  new Date(`${mode === "rb" ? rbDaten.aktualisiert_am : daten.aktualisiert_am}T12:00:00`),
                )
              : "wird geladen"}
          </p>
          <h1>{mode === "rb" ? "Wohnungen mit Blick auf ein konfliktarmes Umfeld" : "Wohnungsangebote mit Barriereangaben"}</h1>
          <p className="hero-subtitle">{mode === "rb" ? "RB · Johannstadt und drei zusätzliche Dresdner Suchorte" : "Dresden-Johannstadt und Dresden-Gorbitz"}</p>
        </div>

        <aside className="hero-panel" aria-label="Übersicht">
          <p className="panel-kicker">Aktueller Überblick</p>
          <div className="hero-stat-primary">
            <strong>{mode === "rb" ? rbWohnungen.length : wohnungen.length}</strong>
            <span>{mode === "rb" ? "aktive RB-Direktangebote" : "aktive Direktangebote"}</span>
          </div>
          {mode === "rb" ? <div className="hero-stat-grid">
            <div><strong>{rbWohnungen.filter((wohnung) => wohnung.suchbereich === "Johannstadt").length}</strong><span>Johannstadt</span></div>
            <div><strong>{rbWohnungen.filter((wohnung) => wohnung.suchbereich !== "Johannstadt").length}</strong><span>an drei Zielorten</span></div>
            <div><strong>{rbWohnungen.filter((wohnung) => wohnung.bewertung === "eher passend").length}</strong><span>eher konfliktarm</span></div>
            <div><strong>{rbWohnungen.filter((wohnung) => wohnung.bewertung === "zu prüfen").length}</strong><span>noch näher prüfen</span></div>
          </div> : <div className="hero-stat-grid">
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
          </div>}
          <p className="panel-note">
            {mode === "rb" ? "Barrierefreiheit ist in der RB-Ansicht kein Auswahlkriterium." : "KdU-Grenze: 450,50 € Nettokaltmiete je berücksichtigter Person"}
          </p>
        </aside>
      </section>

      {mode === "barriere" ? <>
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
      </> : <>
        <section className="research-notice rb-research-notice" id="hinweise" aria-label="Wichtige Hinweise zur RB-Suche">
          <strong>Getrennte RB-Recherchehilfe</strong>
          <p>Diese Ansicht ist für eine konkrete Wohnungssuche gedacht. Sie zeigt Johannstadt sowie fußläufige Umfelder der drei zusätzlichen Adressen. Ihre Angebote werden nicht in die allgemeine Liste mit Barriereangaben gemischt.</p>
          <p>„Eher konfliktarm“ ist keine Eignungszusage. Entscheidend sind Besichtigung, Rückfrage zu Nachbarschaft und Hellhörigkeit sowie das Originalinserat. Barrierefreiheit wird hier nicht bewertet.</p>
        </section>
        <RbSection wohnungen={rbWohnungen} aktualisiertAm={rbDaten.aktualisiert_am || daten.aktualisiert_am} />
      </>}

      <section className="method-section" id="methode">
        <p className="eyebrow">So wird recherchiert und eingeordnet</p>
        {mode === "barriere" ? <div className="method-grid">
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
        </div> : <div className="method-grid">
          <div><span>01</span><h2>Räumlich getrennt</h2><p>Aufgenommen werden Wohnungen in Johannstadt und ungefähr 15 Gehminuten um die drei RB-Zieladressen. Tauschwohnungen, Wohngemeinschaften und reine Gewerberäume bleiben ausgeschlossen.</p></div>
          <div><span>02</span><h2>Nur belegte Merkmale</h2><p>Hausgröße, Gewerbe, Dach- oder Erdgeschoss, separater Eingang und Schallschutz werden nur genannt, wenn das Inserat sie ausdrücklich beschreibt. Fehlendes wird nicht geschätzt.</p></div>
          <div><span>03</span><h2>Konfliktarm prüfen</h2><p>Die Einordnung priorisiert wenige Nachbarn, gemischte Nutzung und günstige Gebäudelagen. Sie ist eine Arbeitshilfe und muss durch Rückfragen und Besichtigung bestätigt werden.</p></div>
        </div>}
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
          {(mode === "rb" ? rbDaten.aktualisiert_am : daten.aktualisiert_am)
            ? new Intl.DateTimeFormat("de-DE").format(
                new Date(`${mode === "rb" ? rbDaten.aktualisiert_am : daten.aktualisiert_am}T12:00:00`),
              )
            : "wird geladen"}{" "}
          · Angaben ohne Gewähr · Verfügbarkeit
          bitte auf der Direktseite prüfen
        </p>
      </footer>
      {mode === "barriere" ? (
        <PrintSheet
          wohnungen={exportWohnungen}
          aktualisiertAm={daten.aktualisiert_am}
          notes={notes}
        />
      ) : null}
    </main>
  );
}
