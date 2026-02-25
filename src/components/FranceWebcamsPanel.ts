import { Panel } from './Panel';
import { isDesktopRuntime, getRemoteApiBaseUrl } from '@/services/runtime';
import { escapeHtml } from '@/utils/sanitize';

// Webcams France — live YouTube
// IDs vérifiés comme diffusions permanentes. Peuvent évoluer ; mettre à jour si hors service.
interface FranceWebcam {
  id: string;
  city: string;
  spot: string;           // nom du lieu précis
  emoji: string;
  videoId: string;        // YouTube live video ID
}

const FRANCE_WEBCAMS: FranceWebcam[] = [
  { id: 'paris-eiffel',    city: 'Paris',       spot: 'Tour Eiffel',             emoji: '🗼', videoId: 'OzYp4NRZlwQ' },
  { id: 'nice-promenade',  city: 'Nice',        spot: 'Promenade des Anglais',   emoji: '🌊', videoId: 'bdGS0tkiJlM' },
  { id: 'chamonix',        city: 'Chamonix',    spot: 'Mont Blanc',              emoji: '⛰️', videoId: 'WmVNRjKOKN8' },
  { id: 'marseille-port',  city: 'Marseille',   spot: 'Vieux-Port',              emoji: '⚓', videoId: 'XN-J1Ob5Hbc' },
  { id: 'bordeaux',        city: 'Bordeaux',    spot: 'Miroir d\'Eau',           emoji: '🍷', videoId: 'vYzEWsv0vgY' },
  { id: 'strasbourg',      city: 'Strasbourg',  spot: 'Cathédrale',              emoji: '🏛️', videoId: 'KT9ZUq0l2Xg' },
];

const MAX_GRID = 4;

type ViewMode = 'grid' | 'single';

export class FranceWebcamsPanel extends Panel {
  private activeWebcam: FranceWebcam = FRANCE_WEBCAMS[0]!;
  private viewMode: ViewMode = 'grid';
  private toolbar: HTMLElement | null = null;
  private iframes: HTMLIFrameElement[] = [];
  private observer: IntersectionObserver | null = null;
  private isVisible = false;

  constructor() {
    super({
      id: 'france-webcams',
      title: 'Webcams France — Live',
      className: 'panel-wide',
    });
    this.element.classList.add('panel-wide');
    this.createToolbar();
    this.setupIntersectionObserver();
    this.render();
  }

  private buildEmbedUrl(videoId: string): string {
    if (isDesktopRuntime()) {
      const remoteBase = getRemoteApiBaseUrl();
      const params = new URLSearchParams({ videoId, autoplay: '1', mute: '1' });
      return `${remoteBase}/api/youtube/embed?${params.toString()}`;
    }
    return `https://www.youtube-nocookie.com/embed/${videoId}?autoplay=1&mute=1&controls=0&modestbranding=1&playsinline=1&rel=0`;
  }

  private createToolbar(): void {
    this.toolbar = document.createElement('div');
    this.toolbar.className = 'webcam-toolbar';

    // City buttons
    const cityGroup = document.createElement('div');
    cityGroup.className = 'webcam-toolbar-group';

    const allBtn = document.createElement('button');
    allBtn.className = `webcam-region-btn${this.viewMode === 'grid' ? ' active' : ''}`;
    allBtn.dataset.mode = 'grid';
    allBtn.textContent = '⊞ Grille';
    allBtn.addEventListener('click', () => this.setViewMode('grid'));
    cityGroup.appendChild(allBtn);

    FRANCE_WEBCAMS.forEach(cam => {
      const btn = document.createElement('button');
      btn.className = `webcam-region-btn${this.viewMode === 'single' && this.activeWebcam.id === cam.id ? ' active' : ''}`;
      btn.dataset.cam = cam.id;
      btn.textContent = `${cam.emoji} ${cam.city}`;
      btn.title = cam.spot;
      btn.addEventListener('click', () => this.selectWebcam(cam));
      cityGroup.appendChild(btn);
    });

    this.toolbar.appendChild(cityGroup);
    this.element.insertBefore(this.toolbar, this.content);
  }

  private setViewMode(mode: ViewMode): void {
    if (this.viewMode === mode) return;
    this.viewMode = mode;
    this.updateToolbarActive();
    this.render();
  }

  private selectWebcam(cam: FranceWebcam): void {
    this.activeWebcam = cam;
    this.viewMode = 'single';
    this.updateToolbarActive();
    this.render();
  }

  private updateToolbarActive(): void {
    this.toolbar?.querySelectorAll('.webcam-region-btn').forEach(btn => {
      const el = btn as HTMLElement;
      if (el.dataset.mode === 'grid') {
        el.classList.toggle('active', this.viewMode === 'grid');
      } else if (el.dataset.cam) {
        el.classList.toggle('active', this.viewMode === 'single' && el.dataset.cam === this.activeWebcam.id);
      }
    });
  }

  private createIframe(cam: FranceWebcam, style: string): HTMLIFrameElement {
    const iframe = document.createElement('iframe');
    iframe.className = 'webcam-iframe';
    iframe.src = this.isVisible ? this.buildEmbedUrl(cam.videoId) : 'about:blank';
    iframe.title = `${escapeHtml(cam.city)} — ${escapeHtml(cam.spot)}`;
    iframe.allow = 'autoplay; encrypted-media; picture-in-picture';
    iframe.allowFullscreen = true;
    iframe.style.cssText = style;
    iframe.dataset.camId = cam.id;
    this.iframes.push(iframe);
    return iframe;
  }

  private setupIntersectionObserver(): void {
    this.observer = new IntersectionObserver(
      entries => {
        const wasVisible = this.isVisible;
        this.isVisible = entries[0]?.isIntersecting ?? false;
        if (!wasVisible && this.isVisible) {
          this.iframes.forEach(iframe => {
            const camId = iframe.dataset.camId;
            const cam = FRANCE_WEBCAMS.find(c => c.id === camId);
            if (cam && iframe.src === 'about:blank') {
              iframe.src = this.buildEmbedUrl(cam.videoId);
            }
          });
        }
        if (!this.isVisible) {
          this.iframes.forEach(iframe => { iframe.src = 'about:blank'; });
        }
      },
      { threshold: 0.1 }
    );
    this.observer.observe(this.element);
  }

  private render(): void {
    this.content.innerHTML = '';
    this.iframes = [];

    if (this.viewMode === 'grid') {
      const grid = document.createElement('div');
      grid.className = 'webcam-grid';
      grid.style.cssText = 'display:grid;grid-template-columns:1fr 1fr;gap:4px;';

      FRANCE_WEBCAMS.slice(0, MAX_GRID).forEach(cam => {
        const cell = document.createElement('div');
        cell.style.cssText = 'position:relative;padding-top:56.25%;background:#000;border-radius:3px;overflow:hidden;cursor:pointer;';
        cell.title = `${cam.city} — ${cam.spot}`;

        const iframe = this.createIframe(cam, 'position:absolute;top:0;left:0;width:100%;height:100%;border:none;pointer-events:none;');
        cell.appendChild(iframe);

        const label = document.createElement('div');
        label.style.cssText = 'position:absolute;bottom:0;left:0;right:0;padding:3px 6px;background:rgba(0,0,0,.6);font-size:10px;color:#fff;';
        label.textContent = `${cam.emoji} ${cam.city}`;
        cell.appendChild(label);

        cell.addEventListener('click', () => this.selectWebcam(cam));
        grid.appendChild(cell);
      });

      this.content.appendChild(grid);
    } else {
      const wrapper = document.createElement('div');
      wrapper.style.cssText = 'position:relative;width:100%;padding-top:56.25%;background:#000;border-radius:4px;overflow:hidden;';
      const iframe = this.createIframe(this.activeWebcam, 'position:absolute;top:0;left:0;width:100%;height:100%;border:none;');
      wrapper.appendChild(iframe);

      const caption = document.createElement('p');
      caption.style.cssText = 'margin:4px 0 0;font-size:11px;color:var(--text-secondary);text-align:center;';
      caption.textContent = `${this.activeWebcam.emoji} ${this.activeWebcam.city} — ${this.activeWebcam.spot}`;

      this.content.appendChild(wrapper);
      this.content.appendChild(caption);
    }
  }

  public override destroy(): void {
    this.observer?.disconnect();
    super.destroy();
  }
}
