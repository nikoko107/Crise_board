import { Panel } from './Panel';
import { escapeHtml } from '@/utils/sanitize';
import { t } from '@/services/i18n';
import {
  type VigicrueAlert,
  type MeteoVigilanceAlert,
  type CopernicusFranceEvent,
  type FranceClimateResult,
  getVigicrueIcon,
  getMeteoIcon,
  getCopernicusIcon,
} from '@/services/france-climate';

export class FranceClimatePanel extends Panel {
  private data: FranceClimateResult = {
    vigicrues: [],
    meteoVigilance: [],
    copernicusFires: [],
    ok: false,
  };
  private onAlertClick?: (lat: number, lon: number) => void;

  constructor() {
    super({
      id: 'france-climate',
      title: t('panels.franceCrises'),
      showCount: true,
      trackActivity: true,
      infoTooltip: t('components.franceCrises.infoTooltip'),
    });
    this.showLoading(t('common.loading'));
  }

  public setAlertClickHandler(handler: (lat: number, lon: number) => void): void {
    this.onAlertClick = handler;
  }

  public setData(data: FranceClimateResult): void {
    this.data = data;
    const total =
      data.vigicrues.length + data.meteoVigilance.length + data.copernicusFires.length;
    this.setCount(total);
    this.renderContent();
  }

  private renderContent(): void {
    const { vigicrues, meteoVigilance, copernicusFires } = this.data;
    const total = vigicrues.length + meteoVigilance.length + copernicusFires.length;

    if (total === 0) {
      this.setContent(
        `<div class="panel-empty">${t('components.franceCrises.noAlerts')}</div>`,
      );
      return;
    }

    const html = [
      this.renderVigicrueSection(vigicrues),
      this.renderMeteoSection(meteoVigilance),
      this.renderCopernicusSection(copernicusFires),
    ]
      .filter(Boolean)
      .join('');

    this.setContent(`<div class="france-climate-panel">${html}</div>`);

    // Attach click handlers for map navigation
    this.content.querySelectorAll('[data-lat]').forEach(el => {
      el.addEventListener('click', () => {
        const lat = Number((el as HTMLElement).dataset.lat);
        const lon = Number((el as HTMLElement).dataset.lon);
        if (Number.isFinite(lat) && Number.isFinite(lon)) {
          this.onAlertClick?.(lat, lon);
        }
      });
    });
  }

  // ── Vigicrues ───────────────────────────────────────────────────────────────

  private renderVigicrueSection(alerts: VigicrueAlert[]): string {
    if (alerts.length === 0) return '';

    const sorted = [...alerts].sort((a, b) => b.niveau - a.niveau);
    const rows = sorted
      .map(a => {
        const icon = getVigicrueIcon(a.niveau);
        const lvlClass = `vigicrue-lvl-${a.niveau}`;
        return `<tr class="france-alert-row" data-lat="${a.lat}" data-lon="${a.lon}">
          <td class="fc-icon">${icon}</td>
          <td class="fc-source">${escapeHtml(a.riviere)}</td>
          <td><span class="fc-badge ${lvlClass}">${escapeHtml(a.label)}</span></td>
          <td class="fc-dept">${escapeHtml(a.departement)}</td>
        </tr>`;
      })
      .join('');

    return `
      <div class="fc-section">
        <div class="fc-section-title">
          \u{1F30A} ${t('components.franceCrises.vigicrues')}
          <span class="fc-count">${alerts.length}</span>
        </div>
        <table class="fc-table">
          <thead><tr>
            <th></th>
            <th>${t('components.franceCrises.river')}</th>
            <th>${t('components.franceCrises.level')}</th>
            <th>${t('components.franceCrises.dept')}</th>
          </tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>`;
  }

  // ── Météo France ────────────────────────────────────────────────────────────

  private renderMeteoSection(alerts: MeteoVigilanceAlert[]): string {
    if (alerts.length === 0) return '';

    const sorted = [...alerts].sort((a, b) => {
      const order = { rouge: 0, orange: 1, jaune: 2, vert: 3 };
      return (order[a.couleur] ?? 3) - (order[b.couleur] ?? 3);
    });

    const rows = sorted
      .map(a => {
        const icon = getMeteoIcon(a.couleur);
        const badgeClass = `meteo-${a.couleur}`;
        return `<tr class="france-alert-row" data-lat="${a.lat}" data-lon="${a.lon}">
          <td class="fc-icon">${icon}</td>
          <td class="fc-source">${escapeHtml(a.titrePhenomene.slice(0, 30))}</td>
          <td><span class="fc-badge ${badgeClass}">${escapeHtml(a.couleur.toUpperCase())}</span></td>
          <td class="fc-dept">${escapeHtml(a.departement)}</td>
        </tr>`;
      })
      .join('');

    return `
      <div class="fc-section">
        <div class="fc-section-title">
          \u{1F327}\u{FE0F} ${t('components.franceCrises.meteoFrance')}
          <span class="fc-count">${alerts.length}</span>
        </div>
        <table class="fc-table">
          <thead><tr>
            <th></th>
            <th>${t('components.franceCrises.phenomenon')}</th>
            <th>${t('components.franceCrises.level')}</th>
            <th>${t('components.franceCrises.dept')}</th>
          </tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>`;
  }

  // ── Copernicus satellite ─────────────────────────────────────────────────────

  private renderCopernicusSection(events: CopernicusFranceEvent[]): string {
    if (events.length === 0) return '';

    const sorted = [...events].sort((a, b) => {
      const order = { high: 0, medium: 1, low: 2 };
      return (order[a.severity] ?? 2) - (order[b.severity] ?? 2);
    });

    const rows = sorted
      .slice(0, 10)
      .map(e => {
        const icon = getCopernicusIcon(e.type);
        const sevClass = `cop-sev-${e.severity}`;
        return `<tr class="france-alert-row" data-lat="${e.lat}" data-lon="${e.lon}">
          <td class="fc-icon">${icon}</td>
          <td class="fc-source">${escapeHtml(e.region.slice(0, 25))}</td>
          <td><span class="fc-badge ${sevClass}">${escapeHtml(e.severity.toUpperCase())}</span></td>
          <td class="fc-dept">${e.date.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' })}</td>
        </tr>`;
      })
      .join('');

    return `
      <div class="fc-section">
        <div class="fc-section-title">
          \u{1F6F0}\u{FE0F} ${t('components.franceCrises.copernicus')}
          <span class="fc-count">${events.length}</span>
        </div>
        <table class="fc-table">
          <thead><tr>
            <th></th>
            <th>${t('components.franceCrises.zone')}</th>
            <th>${t('components.franceCrises.severity')}</th>
            <th>${t('components.franceCrises.date')}</th>
          </tr></thead>
          <tbody>${rows}</tbody>
        </table>
        <div class="fc-source-note">
          Source : <a href="https://effis.jrc.ec.europa.eu/" target="_blank" rel="noopener">Copernicus EFFIS</a>
        </div>
      </div>`;
  }
}
