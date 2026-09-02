export type Wohnung = {
  id: string;
  titel: string;
  stadtteil: string;
  adresse: string;
  zimmer: number;
  wohnflaeche_m2: number;
  nettokaltmiete_eur: number;
  warmmiete_eur: number;
  notwendige_personenzahl_nach_kdu_limit: number;
  wbs: "ja" | "nein" | "unklar";
  barriereangaben: string[];
  bewertung:
    | "ausdrücklich geeignet"
    | "möglicherweise geeignet"
    | "zu prüfen";
  anbieter: string;
  quelle: string;
  direkte_inserats_url: string;
  abrufdatum: string;
  erstmals_gefunden_am: string;
  kartenposition?: {
    breitengrad: number;
    laengengrad: number;
    genauigkeit: "Adresse gefunden" | "ungefähr" | "zu prüfen";
  };
  neu: boolean;
  hinweis?: string;
};

export type Wohnungsdaten = {
  aktualisiert_am: string;
  wohnungen: Wohnung[];
};

export type RbBewertung = "eher passend" | "bedingt passend" | "zu prüfen";

export type RbWohnung = {
  id: string;
  titel: string;
  suchbereich:
    | "Johannstadt"
    | "Eibenstocker Straße 105"
    | "Niedersedlitzer Platz"
    | "Lauensteiner Straße 40";
  adresse: string;
  zimmer: number;
  wohnflaeche_m2: number;
  nettokaltmiete_eur: number;
  warmmiete_eur: number | null;
  bewertung: RbBewertung;
  begruendung: string;
  anzahl_wohnungen_mietparteien: string;
  wohn_und_geschaeftshaus: "ja" | "nein" | "unklar";
  gewerbeeinheiten: string[];
  lage_im_gebaeude: string;
  eigener_separater_eingang: "ja" | "nein" | "unklar";
  direkt_angrenzende_wohnungen: string;
  schallschutz_ruhezonen: string[];
  positive_merkmale: string[];
  pruefhinweise: string[];
  anbieter: string;
  quelle: string;
  kontakt: string;
  direkte_inserats_url: string;
  status: "aktiv" | "zu prüfen";
  abrufdatum: string;
  erstmals_gefunden_am: string;
  fussweg_minuten?: number;
  entfernung_hinweis?: string;
  kartenposition?: {
    breitengrad: number;
    laengengrad: number;
    genauigkeit: "Adresse gefunden" | "ungefähr" | "zu prüfen";
  };
  neu: boolean;
};

export type RbWohnungsdaten = {
  aktualisiert_am: string;
  suchradius_hinweis: string;
  wohnungen: RbWohnung[];
};
