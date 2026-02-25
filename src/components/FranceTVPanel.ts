import { Panel } from './Panel';
import { isDesktopRuntime, getRemoteApiBaseUrl } from '@/services/runtime';
import { escapeHtml } from '@/utils/sanitize';

// Chaînes de télévision françaises — live YouTube
// IDs vérifiés comme live permanents. Peuvent évoluer ; mettre à jour si hors service.
interface TVChannel {
  id: string;
  name: string;
  logo: string;           // emoji ou initiales
  videoId: string;        // YouTube live video ID
  description: string;
}

const TV_CHANNELS: TVChannel[] = [
  {
    id: 'france24-fr',
    name: 'France 24',
    logo: '🌐',
    videoId: 'l8pmfordHJk',
    description: 'Info en continu — chaîne française internationale',
  },
  {
    id: 'lci',
    name: 'LCI',
    logo: '📡',
    videoId: 'D3pFc73cAIg',
    description: 'La Chaîne Info — TF1 Group',
  },
  {
    id: 'bfmtv',
    name: 'BFMTV',
    logo: '📺',
    videoId: '4TyWQP5PVDM',
    description: 'Première chaîne d\'info de France',
  },
  {
    id: 'cnews',
    name: 'CNews',
    logo: '🗞️',
    videoId: 'GVDEgSmwY10',
    description: 'Info en continu — Canal+ Group',
  },
];

export class FranceTVPanel extends Panel {
  private activeChannel: TVChannel = TV_CHANNELS[0]!;
  private iframe: HTMLIFrameElement | null = null;
  private toolbar: HTMLElement | null = null;
  private isVisible = false;
  private observer: IntersectionObserver | null = null;

  constructor() {
    super({
      id: 'france-tv',
      title: 'TV France — Info en direct',
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
    return `https://www.youtube-nocookie.com/embed/${videoId}?autoplay=1&mute=1&controls=1&modestbranding=1&playsinline=1&rel=0`;
  }

  private createToolbar(): void {
    this.toolbar = document.createElement('div');
    this.toolbar.className = 'webcam-toolbar';

    const group = document.createElement('div');
    group.className = 'webcam-toolbar-group';

    TV_CHANNELS.forEach(ch => {
      const btn = document.createElement('button');
      btn.className = `webcam-region-btn${ch.id === this.activeChannel.id ? ' active' : ''}`;
      btn.dataset.channel = ch.id;
      btn.textContent = `${ch.logo} ${ch.name}`;
      btn.title = ch.description;
      btn.addEventListener('click', () => this.selectChannel(ch));
      group.appendChild(btn);
    });

    this.toolbar.appendChild(group);
    this.element.insertBefore(this.toolbar, this.content);
  }

  private selectChannel(ch: TVChannel): void {
    if (ch.id === this.activeChannel.id) return;
    this.activeChannel = ch;
    this.toolbar?.querySelectorAll('.webcam-region-btn').forEach(btn => {
      (btn as HTMLElement).classList.toggle('active', (btn as HTMLElement).dataset.channel === ch.id);
    });
    if (this.iframe) {
      this.iframe.src = this.buildEmbedUrl(ch.videoId);
    }
  }

  private setupIntersectionObserver(): void {
    this.observer = new IntersectionObserver(
      entries => {
        const wasVisible = this.isVisible;
        this.isVisible = entries[0]?.isIntersecting ?? false;
        if (!wasVisible && this.isVisible && !this.iframe?.src) {
          this.render();
        }
        // Pause iframe src when panel leaves viewport to save bandwidth
        if (!this.isVisible && this.iframe) {
          this.iframe.src = 'about:blank';
        } else if (this.isVisible && this.iframe && this.iframe.src === 'about:blank') {
          this.iframe.src = this.buildEmbedUrl(this.activeChannel.videoId);
        }
      },
      { threshold: 0.1 }
    );
    this.observer.observe(this.element);
  }

  private render(): void {
    this.content.innerHTML = '';

    const wrapper = document.createElement('div');
    wrapper.className = 'webcam-single-wrapper';
    wrapper.style.cssText = 'position:relative;width:100%;padding-top:56.25%;background:#000;border-radius:4px;overflow:hidden;';

    this.iframe = document.createElement('iframe');
    this.iframe.className = 'webcam-iframe';
    this.iframe.src = this.isVisible ? this.buildEmbedUrl(this.activeChannel.videoId) : 'about:blank';
    this.iframe.title = `${escapeHtml(this.activeChannel.name)} — direct`;
    this.iframe.allow = 'autoplay; encrypted-media; picture-in-picture';
    this.iframe.allowFullscreen = true;
    this.iframe.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100%;border:none;';

    wrapper.appendChild(this.iframe);

    const caption = document.createElement('p');
    caption.className = 'webcam-caption';
    caption.style.cssText = 'margin:4px 0 0;font-size:11px;color:var(--text-secondary);text-align:center;';
    caption.textContent = this.activeChannel.description;

    this.content.appendChild(wrapper);
    this.content.appendChild(caption);
  }

  public override destroy(): void {
    this.observer?.disconnect();
    super.destroy();
  }
}
