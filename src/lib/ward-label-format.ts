/**
 * The pure half of the public ward label ("Ward 23 Jogpalya"), with no i18n
 * import so a client island can use it: the server hands over the localized
 * `nav.ward` template as a data attribute and the island fills it in here.
 * `src/lib/ward-label.ts` builds the same label for server code from the
 * same function, so the two can never disagree.
 */

/** "14 - Hebbal" -> "Hebbal": `name_en`/`name_kn` start with the ward number. */
export function bareWardName(name: string): string {
  return name.replace(/^\d+\s*-\s*/, '');
}

/**
 * Fills a `nav.ward` template (`Ward {wardNumber} {wardName}`). `ward.id` is
 * the collision-free route id (corporation * 1000 + number); the public number
 * is the remainder, because numbers repeat across corporations.
 */
export function formatWardLabel(
  template: string,
  lang: string,
  ward: { id: number; nameEn: string; nameKn: string },
): string {
  const name = bareWardName(lang === 'kn' && ward.nameKn ? ward.nameKn : ward.nameEn);
  return template
    .replace(/\{wardNumber\}/g, () => String(ward.id % 1000))
    .replace(/\{wardName\}/g, () => name);
}
