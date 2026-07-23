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
