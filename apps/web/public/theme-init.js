(() => {
  const preferenceKey = 'arielcharts.theme.v1';
  let preference = 'system';

  try {
    const storedPreference = window.localStorage.getItem(preferenceKey);
    if (storedPreference === 'light' || storedPreference === 'dark' || storedPreference === 'system') {
      preference = storedPreference;
    }
  } catch {}

  const systemTheme = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  const resolvedTheme = preference === 'system' ? systemTheme : preference;
  document.documentElement.dataset.theme = resolvedTheme;
  document.documentElement.style.colorScheme = resolvedTheme;
})();
