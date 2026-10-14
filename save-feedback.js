(() => {
  const notice = document.createElement('div');
  notice.className = 'save-confirmation';
  notice.hidden = true;
  const message = document.createElement('div');
  message.setAttribute('role', 'status');
  message.setAttribute('aria-live', 'polite');
  message.setAttribute('aria-atomic', 'true');
  const title = document.createElement('strong');
  const detail = document.createElement('span');
  detail.textContent = 'Saved on this device.';
  message.append(title, detail);
  const dismiss = document.createElement('button');
  dismiss.type = 'button';
  dismiss.className = 'save-confirmation-dismiss';
  dismiss.setAttribute('aria-label', 'Dismiss save confirmation');
  dismiss.textContent = '×';
  notice.append(message, dismiss);
  document.body.append(notice);
  let timer;
  let announcement;
  function hide() {
    clearTimeout(timer);
    clearTimeout(announcement);
    notice.hidden = true;
    title.textContent = '';
  }
  dismiss.addEventListener('click', hide);
  window.logbookFeedback = {
    hide,
    showSaved({ draft = false, updated = false } = {}) {
      hide();
      notice.hidden = false;
      // Insert fresh text so repeated saves are announced by screen readers.
      announcement = setTimeout(() => {
        title.textContent = draft ? 'Your draft has been saved.'
          : updated ? 'Your entry has been updated.' : 'Your entry has been saved.';
      }, 50);
      timer = setTimeout(hide, 6000);
    },
  };
})();
