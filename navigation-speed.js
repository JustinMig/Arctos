export function installFastNavigation(root) {
  if (!(root instanceof HTMLElement) || root.dataset.fastNavigationInstalled === 'true') return;

  const descriptor = Object.getOwnPropertyDescriptor(Element.prototype, 'innerHTML');
  if (!descriptor?.get || !descriptor?.set) return;

  Object.defineProperty(root, 'innerHTML', {
    configurable: true,
    enumerable: descriptor.enumerable,
    get() { return descriptor.get.call(this); },
    set(value) {
      const markup = String(value ?? '');
      const currentShell = this.querySelector(':scope > .shell');

      // The workspace router historically rebuilt the entire application shell
      // for every hash route. Preserve the stable chrome (sidebar/top bar/tools)
      // and only swap the page content once the authenticated shell exists.
      if (currentShell && markup.startsWith('<div class="shell">')) {
        const template = document.createElement('template');
        template.innerHTML = markup;
        const nextShell = template.content.querySelector('.shell');
        const nextContent = nextShell?.querySelector('.content');
        const currentContent = currentShell.querySelector('.content');

        if (nextContent && currentContent) {
          currentContent.replaceChildren(...Array.from(nextContent.childNodes));

          // A group may contain both a primary link and a submenu link for
          // the same route. Match by role as well as href to keep both states
          // accurate when the shell is preserved between navigation changes.
          const keyForLink = link => link.getAttribute('href') + '|' +
            (link.classList.contains('nav-primary') ? 'primary' : 'child');
          const nextLinks = new Map(
            Array.from(nextShell.querySelectorAll('.nav a[href]')).map(link => [keyForLink(link), link])
          );
          currentShell.querySelectorAll('.nav a[href]').forEach(link => {
            const next = nextLinks.get(keyForLink(link));
            link.classList.toggle('active', Boolean(next?.classList.contains('active')));
            if (next?.hasAttribute('aria-current')) link.setAttribute('aria-current', next.getAttribute('aria-current'));
            else link.removeAttribute('aria-current');
          });
          // Keep More highlighted on Carriers and Agents, and reveal the
          // selected submenu on deep-link or programmatic navigation.
          const nowMore = currentShell.querySelector('.nav-more-trigger');
          const nextMore = nextShell.querySelector('.nav-more-trigger');
          if (nowMore && nextMore) {
            nowMore.classList.toggle('active', nextMore.classList.contains('active'));
          }
          currentShell.querySelectorAll('.nav-section[data-nav-section]').forEach(section => {
            const selected = nextShell.querySelector('.nav-section[data-nav-section="' + section.dataset.navSection + '"]');
            if (!selected || !selected.querySelector('.nav-primary.active')) return;
            const children = section.querySelector('.nav-children');
            const toggle = section.querySelector('[data-nav-toggle]');
            if (children && toggle) {
              children.hidden = false;
              toggle.setAttribute('aria-expanded', 'true');
            }
          });

          // Close mobile navigation immediately after a route switch.
          currentShell.querySelector('.sidebar')?.classList.remove('open');
          const shade = currentShell.querySelector('.sidebar-shade');
          if (shade) shade.hidden = true;
          currentShell.querySelector('.menu-toggle')?.setAttribute('aria-expanded', 'false');
          return;
        }
      }

      descriptor.set.call(this, markup);
    }
  });

  root.dataset.fastNavigationInstalled = 'true';
}
