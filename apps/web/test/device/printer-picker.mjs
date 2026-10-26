// The Device tab's printer picker (components/Picker.tsx): the site's own list, so tests open it
// and tap a row instead of using a <select>.

/** Opens the printer list (if it isn't open) and returns it. */
export async function openPrinterList(page) {
  const button = page.getByTestId('printer-select');
  if ((await button.getAttribute('aria-expanded')) !== 'true') await button.click();
  const list = page.getByRole('listbox', { name: 'Printer' });
  await list.waitFor();
  return list;
}

/** Picks a printer by its name. */
export async function pickPrinter(page, name) {
  const list = await openPrinterList(page);
  await list.getByRole('option', { name, exact: true }).click();
}

/** Opens Printers & bridges, the last row of the printer list. */
export async function openManage(page) {
  await openPrinterList(page);
  await page.getByTestId('manage-open').click();
}

/** The printers in the list, in order (the list is closed again after). */
export async function printerNames(page) {
  const list = await openPrinterList(page);
  const names = await list.locator('[role="option"]:not(.picker-action)').allTextContents();
  await page.keyboard.press('Escape');
  return names;
}

/** The printer shown on the button. */
export const currentPrinter = (page) => page.getByTestId('printer-select').locator('.picker-value').textContent();
