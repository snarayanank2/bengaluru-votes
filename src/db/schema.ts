import {
  pgTable, pgEnum, serial, integer, text, boolean, timestamp,
  uniqueIndex, index, primaryKey, customType, date, check, jsonb,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

export const bytea = customType<{ data: Buffer }>({ dataType: () => 'bytea' });

export const corporationEnum = pgEnum('corporation', ['north', 'south', 'east', 'west', 'central']);
export const langEnum = pgEnum('lang', ['en', 'kn']);
export const roleEnum = pgEnum('role', ['transcriber', 'curator', 'admin']);
export const userStatusEnum = pgEnum('user_status', ['active', 'banned', 'erased']);
export const candidateStatusEnum = pgEnum('candidate_status', ['filed', 'contesting', 'rejected', 'withdrawn']);
export const sourceTypeEnum = pgEnum('source_type', ['official', 'curator']);
export const translationStatusEnum = pgEnum('translation_status', ['pending', 'done', 'manual']);
export const assignmentStateEnum = pgEnum('assignment_state', ['open', 'submitted', 'abandoned']);
export const affidavitStateEnum = pgEnum('affidavit_state', ['queued', 'extracting', 'needs_matching', 'published', 'failed']);
export const flagStatusEnum = pgEnum('flag_status', ['pending', 'accepted', 'rejected']);
export const flagTargetEnum = pgEnum('flag_target', ['candidate_field']);
export const budgetKindEnum = pgEnum('budget_kind', ['geocode', 'epic_lookup', 'anonymous_vote']);

export const wards = pgTable('wards', {
  id: integer('id').primaryKey(),                      // corporation_id*1000 + per-corporation ward number (no city-wide official number exists in source data — see scripts/seed-wards.ts)
  nameEn: text('name_en').notNull(),
  nameKn: text('name_kn').notNull(),                   // official bilingual data — never MT (arch §9)
  corporation: corporationEnum('corporation').notNull(),
  zone: text('zone').notNull(),
  boundaryRef: text('boundary_ref').notNull(),         // feature id in data/gba.geojson
  assemblyNumber: integer('assembly_number'),
  assemblyNameEn: text('assembly_name_en'),
  assemblyNameKn: text('assembly_name_kn'),
  populationTotal: integer('population_total'),
  populationMale: integer('population_male'),
  populationFemale: integer('population_female'),
  reservationEn: text('reservation_en'),
  reservationKn: text('reservation_kn'),
  factsSourceUrl: text('facts_source_url'),
  factsSourceDate: date('facts_source_date'),
});

export const wardOldWardOverlaps = pgTable('ward_old_ward_overlaps', {
  id: serial('id').primaryKey(),
  wardId: integer('ward_id').notNull().references(() => wards.id, { onDelete: 'cascade' }),
  position: integer('position').notNull(),
  oldWardNumber: integer('old_ward_number'),
  oldWardNameEn: text('old_ward_name_en').notNull(),
  oldWardNameKn: text('old_ward_name_kn').notNull(),
  publishedOverlapBasisPoints: integer('published_overlap_basis_points').notNull(),
}, (t) => [
  uniqueIndex('ward_old_ward_overlaps_ward_position_uq').on(t.wardId, t.position),
  index('ward_old_ward_overlaps_ward_idx').on(t.wardId),
  check('ward_old_ward_overlaps_position_check', sql`${t.position} > 0`),
  check('ward_old_ward_overlaps_percentage_check', sql`${t.publishedOverlapBasisPoints} between 0 and 10000`),
]);

export const wardKeyAreas = pgTable('ward_key_areas', {
  id: serial('id').primaryKey(),
  wardId: integer('ward_id').notNull().references(() => wards.id, { onDelete: 'cascade' }),
  position: integer('position').notNull(),
  nameEn: text('name_en').notNull(),
  nameKn: text('name_kn').notNull(),
}, (t) => [
  uniqueIndex('ward_key_areas_ward_position_uq').on(t.wardId, t.position),
  index('ward_key_areas_ward_idx').on(t.wardId),
  check('ward_key_areas_position_check', sql`${t.position} > 0`),
]);

export const media = pgTable('media', {
  id: serial('id').primaryKey(),
  bytes: bytea('bytes').notNull(),
  contentType: text('content_type').notNull(),         // validated stored type (arch §13)
  sha256: text('sha256').notNull(),
  size: integer('size').notNull(),
  createdBy: integer('created_by'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
});

export const candidates = pgTable('candidates', {
  id: serial('id').primaryKey(),
  slug: text('slug').notNull().unique(),               // ward is part of the slug
  wardId: integer('ward_id').notNull().references(() => wards.id),
  nameEn: text('name_en').notNull(),
  partyEn: text('party_en').notNull(),                 // 'Independent' allowed
  status: candidateStatusEnum('status').notNull().default('filed'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
}, (t) => [index('candidates_ward_idx').on(t.wardId)]);

// The public field set is defined in src/lib/candidate-profile.ts; legacy
// curator fields may coexist. Values are written by src/lib/affidavit-publish.ts.
export const candidateFields = pgTable('candidate_fields', {
  id: serial('id').primaryKey(),
  candidateId: integer('candidate_id').notNull().references(() => candidates.id),
  fieldKey: text('field_key').notNull(),
  valueEn: text('value_en'),
  valueKn: text('value_kn'),
  notDeclared: boolean('not_declared').notNull().default(false),  // valid, complete answer
  authoredLang: langEnum('authored_lang').notNull().default('en'),
  translationStatus: translationStatusEnum('translation_status').notNull().default('pending'),
  sourceUrl: text('source_url'),
  sourceType: sourceTypeEnum('source_type').notNull().default('curator'),
  aiExtracted: boolean('ai_extracted').notNull().default(false),  // cleared on curator confirm
  // The structured value behind value_en, written only by src/lib/affidavit-publish.ts.
  // Null only on rows written before values were structured.
  valueData: jsonb('value_data'),
  unreadable: boolean('unreadable').notNull().default(false),     // nobody could read it from the scan; shown as unresolved
  // Written only by the transaction that publishes a value a person checked
  // against the affidavit (src/lib/affidavit-publish.ts); never set on their own.
  checkedBy: integer('checked_by'),
  checkedAt: timestamp('checked_at'),
  confirmedAi: boolean('confirmed_ai'),                           // true: the person kept the AI's value; false: they changed it
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
}, (t) => [uniqueIndex('candidate_field_uq').on(t.candidateId, t.fieldKey)]);

// The extraction queue (src/lib/affidavit-queue.ts). A row is claimed by the
// worker while `queued`, and ends `published`, `needs_matching` (no candidate
// yet, waiting on /admin/affidavits) or `failed`.
export const candidateAffidavits = pgTable('candidate_affidavits', {
  id: serial('id').primaryKey(),
  candidateId: integer('candidate_id').references(() => candidates.id),   // null until matched to a candidate
  mediaId: integer('media_id').notNull().references(() => media.id),
  state: affidavitStateEnum('state').notNull().default('queued'),
  attempts: integer('attempts').notNull().default(0),
  leaseExpiresAt: timestamp('lease_expires_at'),        // set while `extracting`; past it, the row is claimable again
  confidence: integer('confidence'),                    // the model's one figure for the affidavit, 0-100
  extraction: jsonb('extraction'),                      // the validated AffidavitExtraction, as returned
  failure: text('failure'),
  matchReason: text('match_reason'),                    // 'ward_unresolved' | 'possible_duplicate' | 'reported_by_transcriber'
  sha256: text('sha256'),                               // of the PDF; unique, so a re-upload is a no-op. Null on pre-queue rows.
  transcribedAt: timestamp('transcribed_at'),           // a transcriber submitted a reading; never drawn again
  matchNote: text('match_note'),                        // a transcriber's note when they sent it back as the wrong ward or document
  createdAt: timestamp('created_at').notNull().defaultNow(),
}, (t) => [
  uniqueIndex('candidate_affidavits_sha256_uq').on(t.sha256),
  index('candidate_affidavits_state_idx').on(t.state),
]);

// A transcriber's hold on one affidavit (src/lib/transcribe.ts). Held, not
// owned: past `expires_at` the affidavit is anyone's to draw again.
export const transcriptionAssignments = pgTable('transcription_assignments', {
  id: serial('id').primaryKey(),
  affidavitId: integer('affidavit_id').notNull().references(() => candidateAffidavits.id, { onDelete: 'cascade' }),
  transcriberId: integer('transcriber_id').notNull().references(() => users.id),
  state: assignmentStateEnum('state').notNull().default('open'),
  drawnAt: timestamp('drawn_at').notNull().defaultNow(),
  expiresAt: timestamp('expires_at').notNull(),
  closedAt: timestamp('closed_at'),
}, (t) => [
  uniqueIndex('transcription_open_affidavit_uq').on(t.affidavitId).where(sql`state = 'open'`),
  index('transcription_transcriber_idx').on(t.transcriberId, t.state),
]);

export const wardIssues = pgTable('ward_issues', {
  id: serial('id').primaryKey(),
  wardId: integer('ward_id').notNull().references(() => wards.id),
  catalogKey: text('catalog_key'),
  titleEn: text('title_en'),
  titleKn: text('title_kn'),
  authoredLang: langEnum('authored_lang').notNull().default('en'),
  translationStatus: translationStatusEnum('translation_status').notNull().default('pending'),
  position: integer('position').notNull().default(0),
}, (t) => [
  index('ward_issues_ward_idx').on(t.wardId),
  uniqueIndex('ward_issues_catalog_uq').on(t.wardId, t.catalogKey).where(sql`${t.catalogKey} is not null`),
]);

export const users = pgTable('users', {
  id: serial('id').primaryKey(),
  email: text('email').unique(),                        // one account per contact
  language: langEnum('language').notNull().default('en'),
  role: roleEnum('role').notNull(),
  status: userStatusEnum('status').notNull().default('active'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
});

export const sessions = pgTable('sessions', {
  id: text('id').primaryKey(),                          // random 32-byte hex
  userId: integer('user_id').notNull().references(() => users.id),
  expiresAt: timestamp('expires_at').notNull(),         // sliding 1h idle
  createdAt: timestamp('created_at').notNull().defaultNow(),
});

export const flagItems = pgTable('flag_items', {          // deduped queue item
  id: serial('id').primaryKey(),
  wardId: integer('ward_id').notNull().references(() => wards.id),
  targetType: flagTargetEnum('target_type').notNull(),
  targetRef: text('target_ref').notNull(),                // e.g. 'candidate:12:cases'
  status: flagStatusEnum('status').notNull().default('pending'),
  resolutionReason: text('resolution_reason'),
  resolvedBy: integer('resolved_by'),
  resolvedAt: timestamp('resolved_at'),
  resolvedValueHash: text('resolved_value_hash'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
}, (t) => [uniqueIndex('flag_dedupe_uq').on(t.targetRef).where(sql`status = 'pending'`)]);

export const flagSubmissions = pgTable('flag_submissions', {
  id: serial('id').primaryKey(),
  flagItemId: integer('flag_item_id').notNull().references(() => flagItems.id),
  browserHash: text('browser_hash'),
  fingerprint: text('fingerprint'),
  isSpam: boolean('is_spam').notNull().default(false),
  moderatedBy: integer('moderated_by'),
  moderatedAt: timestamp('moderated_at'),
  moderationReason: text('moderation_reason'),
  detail: text('detail').notNull(),
  suggestedValue: text('suggested_value'),
  sourceUrl: text('source_url'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
}, (t) => [
  uniqueIndex('flag_browser_item_uq').on(t.flagItemId, t.browserHash).where(sql`${t.browserHash} is not null`),
  index('flag_submission_item_idx').on(t.flagItemId, t.id),
]);

/** Short-lived admission metadata; separate from report content. */
export const flagAdmissions = pgTable('flag_admissions', {
  id: serial('id').primaryKey(), browserHash: text('browser_hash'), networkHash: text('network_hash'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
}, t => [index('flag_admission_browser_idx').on(t.browserHash,t.createdAt),index('flag_admission_network_idx').on(t.networkHash,t.createdAt)]);
export const flagRequestBuckets = pgTable('flag_request_buckets', {
  networkHash:text('network_hash').notNull(),minute:timestamp('minute').notNull(),count:integer('count').notNull(),
},t => [primaryKey({columns:[t.networkHash,t.minute]})]);
export const flagMetrics = pgTable('flag_metrics', {
  hour:timestamp('hour').notNull(),event:text('event').notNull(),count:integer('count').notNull().default(0),
},t => [primaryKey({columns:[t.hour,t.event]})]);

export const anonymousIssueVoteSets = pgTable('anonymous_issue_vote_sets', {
  id: serial('id').primaryKey(),
  voterHash: text('voter_hash').notNull().unique(),
  wardId: integer('ward_id').notNull().references(() => wards.id),
  createdAt: timestamp('created_at').notNull().defaultNow(),
}, (t) => [index('anonymous_issue_vote_sets_ward_idx').on(t.wardId)]);

export const anonymousIssueVoteSelections = pgTable('anonymous_issue_vote_selections', {
  setId: integer('set_id').notNull().references(() => anonymousIssueVoteSets.id, { onDelete: 'cascade' }),
  wardIssueId: integer('ward_issue_id').notNull().references(() => wardIssues.id, { onDelete: 'cascade' }),
}, (t) => [primaryKey({ columns: [t.setId, t.wardIssueId] })]);

export const appSettings = pgTable('app_settings', {      // election anchors, wording versions
  key: text('key').primaryKey(),                          // 'notification_date' | 'election_date' |
  value: text('value').notNull(),                         // 'roll_deadline' | …
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
});

export const geocodeCache = pgTable('geocode_cache', {    // derived conclusion only (arch §13)
  normalizedAddress: text('normalized_address').primaryKey(),
  wardId: integer('ward_id'),                             // null = out of coverage
  createdAt: timestamp('created_at').notNull().defaultNow(),
});

export const budgetCounters = pgTable('budget_counters', {
  day: date('day').notNull(),
  kind: budgetKindEnum('kind').notNull(),
  count: integer('count').notNull().default(0),
}, (t) => [primaryKey({ columns: [t.day, t.kind] })]);
