// The site's own pickers (components/Picker.tsx): the sidebar's printer and filament lists and
// the Text tool's fonts. They aren't <select>s, so tests open the list and tap a row.

/** The picker's button, by its label ("Printer preset", "Filament 1 preset", "Font"). */
export const picker = (scope, name) => scope.getByRole('combobox', { name, exact: true });

/** The value picked (the preset's full name, the font's name). */
export const pickerValue = (scope, name) => picker(scope, name).getAttribute('data-value');

/** Opens the list (if it isn't open) and returns it. The list hangs off the page, not the scope. */
export async function openPicker(scope, name) {
  const button = picker(scope, name);
  if ((await button.getAttribute('aria-expanded')) !== 'true') await button.click();
  const page = 'page' in scope ? scope.page() : scope;
  const list = page.getByRole('listbox', { name, exact: true });
  await list.waitFor();
  return list;
}

const exactly = (text) => new RegExp(`^${text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`);

/** Picks a choice by its words ({ label }) or its value (a string or { value }), or an action row by its words. */
export async function pick(scope, name, choice) {
  const list = await openPicker(scope, name);
  const row =
    typeof choice === 'string' || 'value' in choice
      ? list.locator(`[data-value="${(typeof choice === 'string' ? choice : choice.value).replace(/"/g, '\\"')}"]`)
      : list.locator('[role="option"]').filter({ has: list.page().locator('.picker-label', { hasText: exactly(choice.label) }) });
  await row.first().click();
}

/** The words of every choice (not the action rows), in order; the list is closed again after. */
export async function pickerChoices(scope, name) {
  const list = await openPicker(scope, name);
  const words = (await list.locator('[role="option"]:not(.picker-action) .picker-label').allTextContents()).map((t) => t.trim());
  await (('page' in scope ? scope.page() : scope).keyboard.press('Escape'));
  return words;
}

/** Every choice as { label, hint, value } (the hint is the row's end, like "Direct print"); the list is closed again after. */
export async function pickerRows(scope, name) {
  const list = await openPicker(scope, name);
  const rows = await list.locator('[role="option"]:not(.picker-action)').evaluateAll((els) =>
    els.map((e) => ({ label: e.querySelector('.picker-label')?.textContent?.trim() ?? '', hint: e.querySelector('.menu-hint')?.textContent?.trim() ?? '', value: e.dataset.value })),
  );
  await (('page' in scope ? scope.page() : scope).keyboard.press('Escape'));
  return rows;
}

/** The action rows' words ("Add or remove printers…"); the list is closed again after. */
export async function pickerActions(scope, name) {
  const list = await openPicker(scope, name);
  const words = (await list.locator('.picker-action .picker-label').allTextContents()).map((t) => t.trim());
  await (('page' in scope ? scope.page() : scope).keyboard.press('Escape'));
  return words;
}

/** Waits until the picker is ready (not greyed out) with `value` picked. Resolves false on a timeout. */
export function waitPicked(page, name, value, timeout = 60000) {
  return page
    .waitForFunction(
      ([n, v]) => {
        const b = [...document.querySelectorAll('button.picker')].find((e) => e.getAttribute('aria-label') === n);
        return b && !b.disabled && b.dataset.value === v;
      },
      [name, value],
      { timeout },
    )
    .then(
      () => true,
      () => false,
    );
}

/** The picker with the calls tests used on a <select>: inputValue, selectOption ({ label }, or a value), and its choices' words. */
export function pickerOf(scope, name) {
  return {
    button: picker(scope, name),
    inputValue: () => pickerValue(scope, name),
    selectOption: (choice) => pick(scope, name, choice),
    choices: () => pickerChoices(scope, name),
    actions: () => pickerActions(scope, name),
    waitFor: (options) => picker(scope, name).waitFor(options),
    isDisabled: () => picker(scope, name).isDisabled(),
  };
}
