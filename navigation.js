(() => {
  const sections = ['log', 'entries', 'census', 'export'];
  const views = sections.map(name => document.getElementById(`view-${name}`));

  function show(name, { focus = true } = {}) {
    const current = sections.includes(name) ? name : 'log';
    for (const [index, view] of views.entries()) {
      view.hidden = sections[index] !== current;
      const link = document.getElementById(`nav-${sections[index]}`);
      if (sections[index] === current) link.setAttribute('aria-current', 'page');
      else link.removeAttribute('aria-current');
    }
    // Keep the current section when switching between the two active logbooks.
    for (const link of document.querySelectorAll('.page-nav a')) {
      if (/(?:^|\/)(anaesthesia|critical-care)\.html(?:#.*)?$/.test(link.getAttribute('href'))) {
        link.hash = current;
      }
    }
    if (location.hash !== `#${current}`) history.replaceState(null, '', `#${current}`);
    if (focus) {
      const heading = views[sections.indexOf(current)].querySelector('h2, h3');
      heading.setAttribute('tabindex', '-1');
      heading.focus({ preventScroll: true });
      window.scrollTo({ top: 0, behavior: 'instant' });
    }
  }

  window.logbookNavigation = { show };
  window.addEventListener('hashchange', () => show(location.hash.slice(1)));
  show(location.hash.slice(1), { focus: false });
})();
