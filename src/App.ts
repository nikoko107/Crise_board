import type { MapLayers } from '@/types';
import { fetchFranceClimateData } from '@/services/france-climate';
import { fetchClimateAnomalies } from '@/services/climate';
import { fetchAllFires, flattenFires, computeRegionStats, toMapFires } from '@/services/wildfires';
import { initI18n, t } from '@/services/i18n';
import { getCurrentTheme, setTheme } from '@/utils';
import {
  MapContainer,
  type MapView,
  Panel,
  SatelliteFiresPanel,
  ClimateAnomalyPanel,
  FranceClimatePanel,
} from '@/components';

// ─── Map layers: tout désactivé sauf incendies et climat ─────────────────────
const CLIMATE_MAP_LAYERS: MapLayers = {
  conflicts: false, bases: false, cables: false, pipelines: false,
  hotspots: false, ais: false, nuclear: false, irradiators: false,
  sanctions: false, weather: false, economic: false, waterways: false,
  outages: false, cyberThreats: false, datacenters: false, protests: false,
  flights: false, military: false, natural: false, spaceports: false,
  minerals: false, fires: true, ucdpEvents: false, displacement: false,
  climate: true, startupHubs: false, cloudRegions: false, accelerators: false,
  techHQs: false, techEvents: false, stockExchanges: false,
  financialCenters: false, centralBanks: false, commodityHubs: false,
  gulfInvestments: false,
};

// ─── Intervalles de rafraîchissement ─────────────────────────────────────────
const REFRESH_FRANCE_CLIMATE_MS  = 15 * 60 * 1000; // 15 min
const REFRESH_CLIMATE_ANOMALY_MS = 30 * 60 * 1000; // 30 min
const REFRESH_FIRES_MS           = 30 * 60 * 1000; // 30 min

// Exported so that CountryBriefPage (still in the project) can import it as a type
export interface CountryBriefSignals {
  protests: number;
  militaryFlights: number;
  militaryVessels: number;
  outages: number;
  earthquakes: number;
  displacementOutflow: number;
  climateStress: number;
  conflictEvents: number;
  isTier1: boolean;
}

export class App {
  private container: HTMLElement;
  private map: MapContainer | null = null;
  private panels: Record<string, Panel> = {};
  private inFlight: Set<string> = new Set();
  private refreshIds: Map<string, ReturnType<typeof setTimeout>> = new Map();
  private isDestroyed = false;

  constructor(containerId: string) {
    const el = document.getElementById(containerId);
    if (!el) throw new Error(`Container #${containerId} not found`);
    this.container = el;
  }

  // ─── Bootstrap ──────────────────────────────────────────────────────────────

  public async init(): Promise<void> {
    await initI18n();
    this.renderLayout();
    this.initMap();
    this.createPanels();
    this.setupThemeToggle();
    this.startClock();
    await this.loadAll();
    this.scheduleRefreshes();
  }

  // ─── Layout ─────────────────────────────────────────────────────────────────

  private renderLayout(): void {
    this.container.innerHTML = `
      <div class="header">
        <div class="header-left">
          <span class="logo">Crises Climatiques France</span>
          <div class="status-indicator">
            <span class="status-dot"></span>
            <span>${t('header.live')}</span>
          </div>
          <span class="header-clock" id="headerClock"></span>
        </div>
        <div class="header-right">
          <button class="theme-toggle-btn" id="headerThemeToggle" title="${t('header.toggleTheme')}">
            ${this.themeIcon()}
          </button>
        </div>
      </div>
      <div class="main-content">
        <div class="map-section" id="mapSection">
          <div class="panel-header">
            <span class="panel-title">${t('panels.map')}</span>
          </div>
          <div class="map-container" id="mapContainer"></div>
        </div>
        <div class="panels-grid" id="panelsGrid"></div>
      </div>
    `;
  }

  private themeIcon(): string {
    return getCurrentTheme() === 'dark'
      ? '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg>'
      : '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z"/></svg>';
  }

  // ─── Carte ──────────────────────────────────────────────────────────────────

  private initMap(): void {
    const el = document.getElementById('mapContainer');
    if (!el) return;
    this.map = new MapContainer(el, {
      zoom: 5,
      pan: { x: 0, y: 0 },
      view: 'eu' as MapView,
      layers: { ...CLIMATE_MAP_LAYERS },
      timeRange: '7d',
    });
    this.map.setCenter(46.5, 2.35, 5);
  }

  // ─── Panneaux ───────────────────────────────────────────────────────────────

  private createPanels(): void {
    const grid = document.getElementById('panelsGrid');
    if (!grid) return;

    const franceClimate = new FranceClimatePanel();
    franceClimate.setAlertClickHandler((lat, lon) => this.map?.setCenter(lat, lon, 7));
    this.panels['france-climate'] = franceClimate;
    grid.appendChild(franceClimate.getElement());

    const climateAnomaly = new ClimateAnomalyPanel();
    climateAnomaly.setZoneClickHandler((lat, lon) => this.map?.setCenter(lat, lon, 5));
    this.panels['climate'] = climateAnomaly;
    grid.appendChild(climateAnomaly.getElement());

    const fires = new SatelliteFiresPanel();
    this.panels['satellite-fires'] = fires;
    grid.appendChild(fires.getElement());
  }

  // ─── Chargement de données ───────────────────────────────────────────────────

  private async loadAll(): Promise<void> {
    await Promise.allSettled([
      this.guarded('france-climate', () => this.loadFranceClimate()),
      this.guarded('climate',        () => this.loadClimateAnomalies()),
      this.guarded('fires',          () => this.loadFires()),
    ]);
  }

  private async guarded(key: string, fn: () => Promise<void>): Promise<void> {
    if (this.inFlight.has(key)) return;
    this.inFlight.add(key);
    try   { await fn(); }
    catch (e) { console.error(`[App] ${key} failed:`, e); }
    finally   { this.inFlight.delete(key); }
  }

  private async loadFranceClimate(): Promise<void> {
    const data = await fetchFranceClimateData();
    (this.panels['france-climate'] as FranceClimatePanel).setData(data);
  }

  private async loadClimateAnomalies(): Promise<void> {
    const result = await fetchClimateAnomalies();
    if (!result.ok) return;
    (this.panels['climate'] as ClimateAnomalyPanel).setAnomalies(result.anomalies);
    if (result.anomalies.length) {
      this.map?.setClimateAnomalies(result.anomalies);
    }
  }

  private async loadFires(): Promise<void> {
    const result = await fetchAllFires(1);
    if (result.skipped) {
      this.panels['satellite-fires']?.showConfigError(
        'NASA_FIRMS_API_KEY non configuré — ajouter dans les paramètres'
      );
      return;
    }
    const { regions, totalCount } = result;
    if (totalCount > 0) {
      const flat  = flattenFires(regions);
      const stats = computeRegionStats(regions);
      this.map?.setFires(toMapFires(flat));
      (this.panels['satellite-fires'] as SatelliteFiresPanel).update(stats, totalCount);
    } else {
      (this.panels['satellite-fires'] as SatelliteFiresPanel).update([], 0);
    }
  }

  // ─── Planification des rafraîchissements ─────────────────────────────────────

  private scheduleRefreshes(): void {
    this.schedule('france-climate', () => this.loadFranceClimate(), REFRESH_FRANCE_CLIMATE_MS);
    this.schedule('climate',        () => this.loadClimateAnomalies(), REFRESH_CLIMATE_ANOMALY_MS);
    this.schedule('fires',          () => this.loadFires(), REFRESH_FIRES_MS);
  }

  private schedule(key: string, fn: () => Promise<void>, intervalMs: number): void {
    const tick = (): void => {
      if (this.isDestroyed) return;
      void this.guarded(key, fn).finally(() => {
        if (!this.isDestroyed) this.refreshIds.set(key, setTimeout(tick, intervalMs));
      });
    };
    this.refreshIds.set(key, setTimeout(tick, intervalMs));
  }

  // ─── Helpers UI ─────────────────────────────────────────────────────────────

  private setupThemeToggle(): void {
    document.getElementById('headerThemeToggle')?.addEventListener('click', () => {
      const next = getCurrentTheme() === 'dark' ? 'light' : 'dark';
      setTheme(next);
      const btn = document.getElementById('headerThemeToggle');
      if (btn) btn.innerHTML = this.themeIcon();
    });
  }

  private startClock(): void {
    const el = document.getElementById('headerClock');
    if (!el) return;
    const tick = (): void => {
      el.textContent = new Date().toLocaleTimeString('fr-FR', {
        hour: '2-digit', minute: '2-digit', second: '2-digit',
      });
    };
    tick();
    setInterval(tick, 1000);
  }

  // ─── Teardown ────────────────────────────────────────────────────────────────

  public destroy(): void {
    this.isDestroyed = true;
    this.refreshIds.forEach(id => clearTimeout(id));
    this.refreshIds.clear();
  }
}
