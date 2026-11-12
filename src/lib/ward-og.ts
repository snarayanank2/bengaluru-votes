/**
 * Per-ward social share images (task 196). `scripts/generate-ward-og.ts`
 * renders one 1200x630 PNG per ward and language into `public/og/ward/`;
 * this module names those files and tells a page whether one exists, so a
 * ward missing from the generated set falls back to the default image.
 *
 * The data half (`loadWardOgRows`) reads `data/gba.geojson` directly, so the
 * generator needs no database. Ward ids follow `scripts/seed-wards.ts`:
 * `corporation_id * 1000 + ward_id`.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { t, type Lang } from '../i18n';
import { bareWardName } from './ward-label-format';

export const WARD_OG_WIDTH = 1200;
export const WARD_OG_HEIGHT = 630;

const CORPORATIONS = ['north', 'south', 'east', 'west', 'central'] as const;
export type OgCorporation = (typeof CORPORATIONS)[number];

export interface WardOgRow {
  id: number;
  corporation: OgCorporation;
  nameEn: string;
  nameKn: string;
}

/** Site-relative URL of a ward's share image. */
export function wardOgPath(wardId: number, lang: Lang): string {
  return `/og/ward/${wardId}-${lang}.png`;
}

/** The two lines drawn under the brand: the ward name and its number line. */
export function wardOgText(lang: Lang, ward: WardOgRow): { name: string; detail: string } {
  const number = t(lang, 'nav.ward', { wardNumber: ward.id % 1000, wardName: '' }).trim();
  const corporation = t(lang, 'corporation.name', { corporation: t(lang, `ward.corporation.${ward.corporation}`) });
  return {
    name: bareWardName(lang === 'kn' ? ward.nameKn : ward.nameEn),
    detail: `${number} · ${corporation}`,
  };
}

export function loadWardOgRows(geojsonPath: string): WardOgRow[] {
  const data = JSON.parse(readFileSync(geojsonPath, 'utf8')) as {
    features: { properties: Record<string, unknown> }[];
  };
  return data.features.map(({ properties: p }) => {
    const corporation = String(p.Corporation ?? '').trim().toLowerCase();
    if (!(CORPORATIONS as readonly string[]).includes(corporation)) {
      throw new Error(`ward-og: unknown corporation ${JSON.stringify(p.Corporation)}`);
    }
    const nameEn = String(p.ward_name ?? '').trim();
    const nameKn = String(p.ward_name_kn ?? '').trim();
    const id = Number(p.corporation_id) * 1000 + Number(p.ward_id);
    if (!Number.isInteger(id) || !nameEn || !nameKn) {
      throw new Error(`ward-og: incomplete feature ${String(p.id)}`);
    }
    return { id, corporation: corporation as OgCorporation, nameEn, nameKn };
  });
}

// The built app serves public/ from dist/client; in dev it is public/.
const ROOTS = [join(process.cwd(), 'dist', 'client'), join(process.cwd(), 'public')];
const present = new Map<string, boolean>();

/**
 * The ward's share image path when its file ships with this build, else
 * `undefined` so the layout uses the default image. Only hits are cached: a
 * miss is re-checked, and cannot change within a running build anyway.
 */
export function wardOgImage(wardId: number, lang: Lang): string | undefined {
  const path = wardOgPath(wardId, lang);
  if (present.get(path)) return path;
  if (ROOTS.some((root) => existsSync(join(root, path)))) {
    present.set(path, true);
    return path;
  }
  return undefined;
}

/** `ogImage` and `ogImageAlt` props for Base, or `{}` to keep the default image. */
export function wardOgMeta(lang: Lang, ward: WardOgRow): { ogImage?: string; ogImageAlt?: string } {
  const ogImage = wardOgImage(ward.id, lang);
  if (!ogImage) return {};
  const { name, detail } = wardOgText(lang, ward);
  return { ogImage, ogImageAlt: t(lang, 'ward.og.alt', { wardName: name, details: detail }) };
}
