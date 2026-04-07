// Общий скрипт для всех страниц Kaizen
// Загружает и отображает версию приложения в nav-баре

(async function initCommon() {
  try {
    const res = await fetch('/api/health');
    const data = await res.json();
    if (data.version) {
      const logo = document.querySelector('.nav-logo');
      if (logo) {
        const badge = document.createElement('span');
        badge.className = 'nav-version';
        badge.textContent = `v${data.version}`;
        logo.appendChild(badge);
      }
    }
  } catch {
    // не критично — версия просто не отобразится
  }
})();
