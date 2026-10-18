// Apply before styles and React so a saved dark preference never flashes light.
(() => {
  let preference = 'system';
  try {
    const saved = localStorage.getItem('oli.theme');
    if (saved === 'light' || saved === 'dark') preference = saved;
  } catch { /* The theme still works when browser storage is unavailable. */ }
  const dark = preference === 'dark' || preference === 'system' && matchMedia('(prefers-color-scheme: dark)').matches;
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  document.documentElement.style.colorScheme = dark ? 'dark' : 'light';
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', dark ? '#191715' : '#f4f2f0');
})();
