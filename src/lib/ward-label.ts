/**
 * The one citizen-facing label for a ward: its public number and localized
 * name ("Ward 23 Jogpalya"), never the composite route id and never the
 * stored "23 - Jogpalya" form (design-system §7.15, breadcrumbs). Public
 * pages and staff screens use it wherever a ward is named in running text, a
 * table cell, a result link or a heading, so the label reads the same on
 * every screen and in both languages. Client islands build the same label
 * with `formatWardLabel` (./ward-label-format) from the `nav.ward` template
 * the server renders onto their markup.
 */
import { t, type Lang } from '../i18n';
import { formatWardLabel } from './ward-label-format';

export { bareWardName } from './ward-label-format';

export function wardLabel(lang: Lang, ward: { id: number; nameEn: string; nameKn: string }): string {
  return formatWardLabel(t(lang, 'nav.ward'), lang, ward);
}

/**
 * Administrative zone names are a closed set of ten with no Kannada column in
 * the data (`wards.zone` is the English name from `data/gba.geojson`), so the
 * Kannada reading lives in the UI strings. An unknown zone falls back to the
 * name as stored rather than failing the page.
 */
const ZONE_KEYS: Record<string, string> = {
  Rajarajeshwarinagar: 'ward.zone.rajarajeshwarinagar',
  Yelahanka: 'ward.zone.yelahanka',
  'K.R. Pura': 'ward.zone.krPura',
  Byatarayanapura: 'ward.zone.byatarayanapura',
  Mahadevapura: 'ward.zone.mahadevapura',
  'C.V. Raman Nagar': 'ward.zone.cvRamanNagar',
  Jayanagar: 'ward.zone.jayanagar',
  Gandhinagara: 'ward.zone.gandhinagara',
  Bommanahalli: 'ward.zone.bommanahalli',
  Malleshwaram: 'ward.zone.malleshwaram',
};

export function zoneLabel(lang: Lang, zone: string): string {
  const key = ZONE_KEYS[zone];
  return key ? t(lang, key) : zone;
}
