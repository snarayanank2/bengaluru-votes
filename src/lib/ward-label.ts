/**
 * The one citizen-facing label for a ward: its public number and localized
 * name ("Ward 23 Jogpalya"), never the composite route id and never the
 * stored "23 - Jogpalya" form (design-system §7.15, breadcrumbs). Staff
 * screens use it wherever a ward is named in running text, a table cell or a
 * heading, so the label reads the same on every screen and in both languages.
 */
import { t, type Lang } from '../i18n';

/** "14 - Hebbal" -> "Hebbal": `name_en`/`name_kn` start with the ward number. */
export function bareWardName(name: string): string {
  return name.replace(/^\d+\s*-\s*/, '');
}

export function wardLabel(lang: Lang, ward: { id: number; nameEn: string; nameKn: string }): string {
  return t(lang, 'nav.ward', { wardNumber: ward.id % 1000, wardName: bareWardName(lang === 'kn' ? ward.nameKn : ward.nameEn) });
}
