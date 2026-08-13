/**
 * Which site-wide environment banner (if any) this deployment shows above
 * the AppBar — see src/components/EnvBanner.astro for the markup and
 * docs/design-system.md §7.14.
 *
 * WHY A DEDICATED `APP_ENV` AND NOT `SITE_ORIGIN`: `SITE_ORIGIN` is
 * resolved once at BUILD time by astro.config.mjs, and it defaults to the
 * PRODUCTION origin when unset (see that file) — so keying the banner off
 * it would silently show the production "under construction" copy on every
 * developer's laptop and in every test run. `APP_ENV` is read at REQUEST
 * time from the container's environment, is set explicitly per environment
 * in deploy/compose.staging.yml and deploy/compose.production.yml, and is
 * absent everywhere else, which is exactly the "no banner" default we want
 * locally.
 *
 * CACHE-SAFETY (architecture.md §5): the value is a property of the
 * CONTAINER, not of the request — it cannot vary by visitor, session or
 * cookie, so a public page carrying this banner is still identical for
 * every viewer and safe for nginx's anonymous micro-cache. Do not extend
 * this to read anything request-scoped.
 *
 * Unknown values return `null` rather than throwing or guessing. A typo in
 * a compose file should degrade to "no banner", never to "show a staging
 * warning on production" — the failure that would actually hurt. The
 * inverse risk (banner silently missing) is covered at deploy time:
 * deploy/deploy.sh asserts the `data-env-banner` element is present.
 */

export type EnvBanner = 'staging' | 'production';

/**
 * Maps a raw `APP_ENV` value to a banner variant. Trimmed and lowercased
 * first, because these values come from hand-edited YAML.
 */
export function resolveEnvBanner(appEnv: string | undefined): EnvBanner | null {
  switch (appEnv?.trim().toLowerCase()) {
    case 'staging':
      return 'staging';
    case 'production':
      return 'production';
    default:
      return null;
  }
}

/** The i18n key carrying this variant's copy. */
export function envBannerKey(variant: EnvBanner): string {
  return `banner.${variant}`;
}
