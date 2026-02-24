/**
 * France Climate Crisis Service
 *
 * Aggregates real-time climate crisis data for France from:
 * - Vigicrues (SCHAPI) — flood/river vigilance alerts
 * - Météo France — weather vigilance bulletins (via public GeoJSON)
 * - Copernicus EFFIS — satellite fire / drought data for France
 */

import { createCircuitBreaker } from '@/utils';

// ─── Vigicrues ────────────────────────────────────────────────────────────────

export type VigicrueLevel = 1 | 2 | 3 | 4;

export interface VigicrueAlert {
  id: string;
  departement: string;
  riviere: string;
  niveau: VigicrueLevel;     // 1=Vert, 2=Jaune, 3=Orange, 4=Rouge
  label: string;
  description: string;
  dateDebut: Date;
  lat: number;
  lon: number;
}

interface VigicrueFeature {
  properties: {
    gid?: string;
    entiname?: string;
    TypEntVigiCru?: number;
    NivSituVigiCru?: number;
    LbEntVigiCru?: string;
    cdtronc?: string;
    cdentitehydro?: string;
    LbNivInfoCru?: string;
    DateHeureDebut?: string;
  };
  geometry?: {
    type: string;
    coordinates: number[] | number[][] | number[][][];
  };
}

interface VigicrueGeoJSON {
  features?: VigicrueFeature[];
}

// Approximate centroids for each metropolitan France département (INSEE code → [lat, lon])
const DEPT_CENTROIDS: Record<string, [number, number]> = {
  '01': [46.15, 5.35], '02': [49.55, 3.6], '03': [46.35, 3.15], '04': [44.1, 6.2],
  '05': [44.7, 6.2], '06': [43.9, 7.1], '07': [44.75, 4.35], '08': [49.7, 4.7],
  '09': [42.95, 1.6], '10': [48.3, 4.1], '11': [43.1, 2.3], '12': [44.35, 2.6],
  '13': [43.5, 5.4], '14': [49.1, -0.35], '15': [45.05, 2.7], '16': [45.7, 0.15],
  '17': [45.75, -0.7], '18': [47.05, 2.5], '19': [45.35, 1.9], '21': [47.35, 4.85],
  '22': [48.4, -2.75], '23': [46.1, 2.15], '24': [45.15, 0.75], '25': [47.15, 6.2],
  '26': [44.75, 5.0], '27': [49.1, 1.15], '28': [48.45, 1.45], '29': [48.25, -3.95],
  '2A': [41.7, 9.0], '2B': [42.35, 9.2], '30': [44.05, 4.35], '31': [43.6, 1.45],
  '32': [43.65, 0.55], '33': [44.85, -0.55], '34': [43.6, 3.7], '35': [48.1, -1.7],
  '36': [46.65, 1.6], '37': [47.25, 0.7], '38': [45.2, 5.7], '39': [46.7, 5.55],
  '40': [44.0, -0.7], '41': [47.6, 1.35], '42': [45.7, 4.05], '43': [45.05, 3.9],
  '44': [47.35, -1.6], '45': [47.9, 2.15], '46': [44.65, 1.6], '47': [44.35, 0.45],
  '48': [44.5, 3.5], '49': [47.45, -0.55], '50': [49.1, -1.3], '51': [49.05, 4.05],
  '52': [48.1, 5.3], '53': [48.05, -0.75], '54': [48.7, 6.2], '55': [49.05, 5.35],
  '56': [47.85, -2.75], '57': [49.05, 6.65], '58': [47.15, 3.65], '59': [50.5, 3.2],
  '60': [49.35, 2.45], '61': [48.55, 0.15], '62': [50.5, 2.55], '63': [45.75, 3.15],
  '64': [43.35, -0.6], '65': [43.15, 0.15], '66': [42.65, 2.55], '67': [48.55, 7.65],
  '68': [47.85, 7.35], '69': [45.75, 4.85], '70': [47.6, 6.15], '71': [46.65, 4.5],
  '72': [47.95, 0.2], '73': [45.5, 6.45], '74': [46.05, 6.4], '75': [48.87, 2.33],
  '76': [49.65, 1.1], '77': [48.6, 2.95], '78': [48.8, 1.85], '79': [46.55, -0.35],
  '80': [49.9, 2.3], '81': [43.95, 2.15], '82': [44.1, 1.2], '83': [43.45, 6.1],
  '84': [44.05, 5.05], '85': [46.65, -1.45], '86': [46.55, 0.35], '87': [45.85, 1.35],
  '88': [48.2, 6.45], '89': [47.8, 3.6], '90': [47.65, 6.85], '91': [48.6, 2.25],
  '92': [48.85, 2.2], '93': [48.9, 2.45], '94': [48.78, 2.45], '95': [49.05, 2.15],
  '971': [16.25, -61.6], '972': [14.65, -61.0], '973': [3.93, -53.1], '974': [-21.1, 55.6],
};

const VIGICRUE_LEVEL_LABELS: Record<number, string> = {
  1: 'Vert', 2: 'Jaune', 3: 'Orange', 4: 'Rouge',
};

const VIGICRUE_API =
  'https://www.vigicrues.gouv.fr/services/1/InfoVigiCru.jsonld?TypEntVigiCru=3';

const vigicrueBreaker = createCircuitBreaker<VigicrueAlert[]>({ name: 'Vigicrues' });

export async function fetchVigicrueAlerts(): Promise<VigicrueAlert[]> {
  return vigicrueBreaker.execute(async () => {
    const res = await fetch(VIGICRUE_API, {
      headers: { 'Accept': 'application/json' },
    });
    if (!res.ok) throw new Error(`Vigicrues HTTP ${res.status}`);
    const data: VigicrueGeoJSON = await res.json();

    return (data.features ?? [])
      .filter(f => (f.properties.NivSituVigiCru ?? 1) >= 2)
      .map<VigicrueAlert>(f => {
        const p = f.properties;
        const dept = (p.cdtronc ?? '').slice(0, 2).toUpperCase();
        const [lat, lon] = DEPT_CENTROIDS[dept] ?? [46.5, 2.5];
        const niveau = (p.NivSituVigiCru ?? 1) as VigicrueLevel;
        return {
          id: p.gid ?? p.cdtronc ?? Math.random().toString(36).slice(2),
          departement: dept,
          riviere: p.LbEntVigiCru ?? p.entiname ?? 'Cours d\'eau',
          niveau,
          label: VIGICRUE_LEVEL_LABELS[niveau] ?? 'Inconnu',
          description: p.LbNivInfoCru ?? `Vigilance ${VIGICRUE_LEVEL_LABELS[niveau] ?? niveau}`,
          dateDebut: new Date(p.DateHeureDebut ?? Date.now()),
          lat,
          lon,
        };
      });
  }, []);
}

// ─── Météo France Vigilance ───────────────────────────────────────────────────

export type MeteoVigilanceColor = 'vert' | 'jaune' | 'orange' | 'rouge';

export interface MeteoVigilanceAlert {
  id: string;
  departement: string;
  couleur: MeteoVigilanceColor;
  risques: string[];
  titrePhenomene: string;
  description: string;
  dateDebut: Date;
  dateFin: Date;
  lat: number;
  lon: number;
}

interface MeteoVigilanceFeature {
  properties: {
    dep?: string;
    couleur?: number;   // 1=Vert, 2=Jaune, 3=Orange, 4=Rouge
    phenomenes?: Array<{ phen_lib?: string; phen_ico?: string }>;
    debut?: string;
    fin?: string;
  };
  geometry?: {
    type: string;
    coordinates: unknown;
  };
}

interface MeteoVigilanceGeoJSON {
  features?: MeteoVigilanceFeature[];
}

const METEO_COLOR_MAP: Record<number, MeteoVigilanceColor> = {
  1: 'vert', 2: 'jaune', 3: 'orange', 4: 'rouge',
};

// Météo France public vigilance GeoJSON (open data, no API key needed)
const METEO_VIGILANCE_API =
  'https://vigilance.meteofrance.fr/data/vigilance.json';

const meteoBreaker = createCircuitBreaker<MeteoVigilanceAlert[]>({ name: 'MétéoFrance Vigilance' });

export async function fetchMeteoVigilanceAlerts(): Promise<MeteoVigilanceAlert[]> {
  return meteoBreaker.execute(async () => {
    const res = await fetch(METEO_VIGILANCE_API, {
      headers: { 'Accept': 'application/json' },
    });
    if (!res.ok) throw new Error(`Météo France HTTP ${res.status}`);
    const data: MeteoVigilanceGeoJSON = await res.json();

    return (data.features ?? [])
      .filter(f => (f.properties.couleur ?? 1) >= 2)
      .map<MeteoVigilanceAlert>(f => {
        const p = f.properties;
        const dept = (p.dep ?? '').padStart(2, '0').toUpperCase();
        const [lat, lon] = DEPT_CENTROIDS[dept] ?? [46.5, 2.5];
        const couleurIdx = p.couleur ?? 1;
        const couleur = METEO_COLOR_MAP[couleurIdx] ?? 'vert';
        const risques = (p.phenomenes ?? []).map(ph => ph.phen_lib ?? ph.phen_ico ?? '').filter(Boolean);
        return {
          id: `meteo-${dept}-${couleurIdx}`,
          departement: dept,
          couleur,
          risques,
          titrePhenomene: risques.join(', ') || 'Vigilance météorologique',
          description: `Vigilance ${couleur.toUpperCase()} — ${risques.join(', ') || 'phénomènes météo'}`,
          dateDebut: new Date(p.debut ?? Date.now()),
          dateFin: new Date(p.fin ?? Date.now()),
          lat,
          lon,
        };
      });
  }, []);
}

// ─── Copernicus EFFIS / Satellite France ──────────────────────────────────────

export interface CopernicusFranceEvent {
  id: string;
  type: 'fire' | 'flood' | 'drought';
  titre: string;
  region: string;
  description: string;
  severity: 'low' | 'medium' | 'high';
  date: Date;
  lat: number;
  lon: number;
  url?: string;
}

interface EFFISFeature {
  properties: {
    id?: string | number;
    BAPN?: string;
    ISO3166_1?: string;
    AREA_HA?: number;
    FIRE_DATE?: string;
    COUNTRY?: string;
    ADM1_NAME?: string;
    ADM2_NAME?: string;
  };
  geometry?: {
    type: string;
    coordinates: number[] | number[][] | number[][][];
  };
}

interface EFFISResponse {
  features?: EFFISFeature[];
}

const EFFIS_FRANCE_URL =
  'https://ies-ows.jrc.ec.europa.eu/effis?SERVICE=WFS&VERSION=2.0.0&request=GetFeature' +
  '&TypeNames=ms:modis.fr.ba&OutputFormat=application/json&SRSNAME=EPSG:4326' +
  '&CQL_FILTER=ISO3166_1=\'FR\'&count=50&sortBy=FIRE_DATE+DESC';

const effisBreaker = createCircuitBreaker<CopernicusFranceEvent[]>({ name: 'EFFIS France' });

export async function fetchCopernicusFranceFires(): Promise<CopernicusFranceEvent[]> {
  return effisBreaker.execute(async () => {
    const res = await fetch(EFFIS_FRANCE_URL, {
      headers: { 'Accept': 'application/json' },
    });
    if (!res.ok) throw new Error(`EFFIS HTTP ${res.status}`);
    const data: EFFISResponse = await res.json();

    return (data.features ?? []).slice(0, 30).map<CopernicusFranceEvent>(f => {
      const p = f.properties;
      const areaHa = p.AREA_HA ?? 0;
      const severity: CopernicusFranceEvent['severity'] =
        areaHa > 1000 ? 'high' : areaHa > 100 ? 'medium' : 'low';

      // Extract centroid from geometry
      let lat = 46.5;
      let lon = 2.5;
      if (f.geometry?.type === 'Point') {
        const coords = f.geometry.coordinates as number[];
        lon = coords[0] ?? lon; lat = coords[1] ?? lat;
      } else if (f.geometry?.type === 'Polygon') {
        const ring = (f.geometry.coordinates as number[][][])[0];
        if (ring?.length) {
          lon = ring.reduce((s, c) => s + (c[0] ?? 0), 0) / ring.length;
          lat = ring.reduce((s, c) => s + (c[1] ?? 0), 0) / ring.length;
        }
      }

      const region = [p.ADM2_NAME, p.ADM1_NAME].filter(Boolean).join(', ') || 'France';
      const dateStr = p.FIRE_DATE ?? new Date().toISOString();

      return {
        id: String(p.id ?? p.BAPN ?? Math.random().toString(36).slice(2)),
        type: 'fire',
        titre: `Incendie détecté — ${region}`,
        region,
        description: `Surface brûlée : ${areaHa.toFixed(0)} ha — détecté par satellite Copernicus EFFIS`,
        severity,
        date: new Date(dateStr),
        lat,
        lon,
      };
    });
  }, []);
}

// ─── Aggregated result ────────────────────────────────────────────────────────

export interface FranceClimateResult {
  vigicrues: VigicrueAlert[];
  meteoVigilance: MeteoVigilanceAlert[];
  copernicusFires: CopernicusFranceEvent[];
  ok: boolean;
}

export async function fetchFranceClimateData(): Promise<FranceClimateResult> {
  const [vigicrues, meteoVigilance, copernicusFires] = await Promise.allSettled([
    fetchVigicrueAlerts(),
    fetchMeteoVigilanceAlerts(),
    fetchCopernicusFranceFires(),
  ]);

  return {
    vigicrues: vigicrues.status === 'fulfilled' ? vigicrues.value : [],
    meteoVigilance: meteoVigilance.status === 'fulfilled' ? meteoVigilance.value : [],
    copernicusFires: copernicusFires.status === 'fulfilled' ? copernicusFires.value : [],
    ok: true,
  };
}

// ─── Display helpers ──────────────────────────────────────────────────────────

export function getVigicrueColor(niveau: VigicrueLevel): string {
  const map: Record<VigicrueLevel, string> = {
    1: '#4caf50', 2: '#ffeb3b', 3: '#ff9800', 4: '#f44336',
  };
  return map[niveau] ?? '#4caf50';
}

export function getMeteoColor(couleur: MeteoVigilanceColor): string {
  const map: Record<MeteoVigilanceColor, string> = {
    vert: '#4caf50', jaune: '#ffeb3b', orange: '#ff9800', rouge: '#f44336',
  };
  return map[couleur] ?? '#4caf50';
}

export function getVigicrueIcon(niveau: VigicrueLevel): string {
  const map: Record<VigicrueLevel, string> = {
    1: '\u{1F7E2}', 2: '\u{1F7E1}', 3: '\u{1F7E0}', 4: '\u{1F534}',
  };
  return map[niveau] ?? '\u{1F7E2}';
}

export function getMeteoIcon(couleur: MeteoVigilanceColor): string {
  const map: Record<MeteoVigilanceColor, string> = {
    vert: '\u{1F7E2}', jaune: '\u{1F7E1}', orange: '\u{1F7E0}', rouge: '\u{1F534}',
  };
  return map[couleur] ?? '\u{1F7E2}';
}

export function getCopernicusIcon(type: CopernicusFranceEvent['type']): string {
  const map: Record<CopernicusFranceEvent['type'], string> = {
    fire: '\u{1F525}', flood: '\u{1F30A}', drought: '\u{2600}\u{FE0F}',
  };
  return map[type] ?? '\u{1F6A8}';
}
