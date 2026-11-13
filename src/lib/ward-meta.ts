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

type OldWardOverlap = { oldWardNumber: number | null; publishedOverlapBasisPoints: number };
type OldWardsKind = 'within' | 'mostly' | 'partOne' | 'partMany';

/**
 * How a new ward relates to the old BBMP wards it overlaps (task 194). The
 * overlap figures are the published share of the new ward's area that sat
 * in each old BBMP ward, so a ward that lies wholly inside one old ward is
 * "within" it, never "the same as" it. Every sourced old-ward number is
 * listed, sorted. Null when there are none.
 */
function oldWardsKind(overlaps: ReadonlyArray<OldWardOverlap>): { kind: OldWardsKind; numbers: string } | null {
  const sourced = overlaps.filter((o) => o.oldWardNumber != null);
  if (sourced.length === 0) return null;
  const numbers = sourced.map((o) => o.oldWardNumber as number).sort((a, b) => a - b).join(', ');
  if (sourced.length > 1) return { kind: 'partMany', numbers };
  const share = sourced[0].publishedOverlapBasisPoints;
  // An unnumbered row means part of the ward is not accounted for here, so
  // "within" would over-state containment.
  const complete = sourced.length === overlaps.length;
  const kind = !complete ? 'partOne' : share >= 9900 ? 'within' : share > 5000 ? 'mostly' : 'partOne';
  return { kind, numbers };
}

/** Old-ward clause for a ward page's meta description. Empty when there are none. */
export function oldWardsClause(lang: Lang, overlaps: ReadonlyArray<OldWardOverlap>): string {
  const found = oldWardsKind(overlaps);
  return found ? t(lang, `ward.meta.oldWards.${found.kind}`, { oldWards: found.numbers }) : '';
}

/**
 * The plain-language summary under a ward page's H1 (task 207, architecture
 * §8 AEO): one short paragraph that answers "which ward is this, and where
 * was it before?" in visible text. Built only from stored ward facts, with
 * no adjectives and nothing about candidates, so it reads the same for
 * every ward and never needs a curator. Sentences whose facts are missing
 * are left out.
 */
export function wardSummary(
  lang: Lang,
  facts: {
    wardName: string;
    wardNumber: number;
    corporation: string;
    zone: string;
    assembly: string | null;
    reservation: string | null;
    oldWardOverlaps: ReadonlyArray<OldWardOverlap>;
  },
): string {
  const { wardName, wardNumber, corporation, zone, assembly, reservation } = facts;
  const sentences = [
    assembly
      ? t(lang, 'ward.summary.place', { wardName, wardNumber, corporation, zone, assembly })
      : t(lang, 'ward.summary.placeNoAssembly', { wardName, wardNumber, corporation, zone }),
  ];
  if (reservation) sentences.push(t(lang, 'ward.summary.reservation', { reservation }));
  const old = oldWardsKind(facts.oldWardOverlaps);
  if (old) sentences.push(t(lang, `ward.summary.oldWards.${old.kind}`, { oldWards: old.numbers }));
  return sentences.join(' ');
}
