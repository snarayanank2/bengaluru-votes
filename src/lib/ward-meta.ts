import { t, type Lang } from '../i18n';

/**
 * Ward name for the <title>. 46 official names already end in "Ward"
 * (Kannada: ವಾರ್ಡ್, sometimes followed by a ZWNJ) and the title template
 * adds "Ward {n}", which would read "… Ward Ward 33". Drop only that
 * redundant last word; the name, number and corporation all remain.
 */
export function titleWardName(lang: Lang, name: string): string {
  const stripped = name.replace(lang === 'kn' ? /\s+ವಾರ್ಡ್[‌‍]*$/ : /\s+ward$/i, '').trim();
  return stripped || name;
}

/**
 * Old-ward clause for a ward page's meta description (task 194). The
 * overlap figures are the published share of the new ward's area that
 * sat in each old BBMP ward, so a ward that lies wholly inside one old
 * ward is "within" it, never "the same as" it. Every sourced old-ward
 * number is listed. Empty when there are none.
 */
export function oldWardsClause(
  lang: Lang,
  overlaps: ReadonlyArray<{ oldWardNumber: number | null; publishedOverlapBasisPoints: number }>,
): string {
  const sourced = overlaps.filter((o) => o.oldWardNumber != null);
  if (sourced.length === 0) return '';
  const numbers = sourced.map((o) => o.oldWardNumber as number).sort((a, b) => a - b).join(', ');
  if (sourced.length > 1) return t(lang, 'ward.meta.oldWards.partMany', { oldWards: numbers });
  const share = sourced[0].publishedOverlapBasisPoints;
  // An unnumbered row means part of the ward is not accounted for here, so
  // "within" would over-state containment.
  const complete = sourced.length === overlaps.length;
  const key = !complete ? 'partOne' : share >= 9900 ? 'within' : share > 5000 ? 'mostly' : 'partOne';
  return t(lang, `ward.meta.oldWards.${key}`, { oldWards: numbers });
}
