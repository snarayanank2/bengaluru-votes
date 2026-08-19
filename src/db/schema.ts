import {
  pgTable, pgEnum, serial, bigserial, integer, text, boolean, timestamp,
  jsonb, uniqueIndex, index, primaryKey, customType, date, check,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

export const bytea = customType<{ data: Buffer }>({ dataType: () => 'bytea' });

export const corporationEnum = pgEnum('corporation', ['north', 'south', 'east', 'west', 'central']);
export const langEnum = pgEnum('lang', ['en', 'kn']);
export const roleEnum = pgEnum('role', ['citizen', 'curator', 'admin']);
export const userStatusEnum = pgEnum('user_status', ['active', 'banned', 'erased']);
export const candidateStatusEnum = pgEnum('candidate_status', ['filed', 'contesting', 'rejected', 'withdrawn']);
export const sourceTypeEnum = pgEnum('source_type', ['official', 'curator']);
export const translationStatusEnum = pgEnum('translation_status', ['pending', 'done', 'manual']);
export const extractionStatusEnum = pgEnum('extraction_status', ['pending', 'done', 'failed']);
export const newsOriginEnum = pgEnum('news_origin', ['auto', 'curator']);
export const newsStatusEnum = pgEnum('news_status', ['suggested', 'approved']);
export const channelEnum = pgEnum('channel', ['email', 'whatsapp']);
export const otpPurposeEnum = pgEnum('otp_purpose', ['auth', 'add_contact']);
export const suppressionReasonEnum = pgEnum('suppression_reason', ['bounce', 'complaint', 'stop']);
export const flagStatusEnum = pgEnum('flag_status', ['pending', 'accepted', 'rejected']);
export const flagTargetEnum = pgEnum('flag_target', ['candidate_field', 'ward_field', 'ward_issue']);
export const eoiPathEnum = pgEnum('eoi_path', ['awareness', 'curation']);
export const eoiStatusEnum = pgEnum('eoi_status', ['new', 'accepted', 'declined']);
export const sendCodeEnum = pgEnum('send_code', ['W1', 'R1', 'L1', 'C1', 'C2', 'C3', 'F1']);
export const sendStatusEnum = pgEnum('send_status', ['sent', 'failed', 'suppressed', 'held']);
export const budgetKindEnum = pgEnum('budget_kind', ['geocode', 'otp_send', 'news_query', 'epic_lookup']);

export const wards = pgTable('wards', {
  id: integer('id').primaryKey(),                      // corporation_id*1000 + per-corporation ward number (no city-wide official number exists in source data — see scripts/seed-wards.ts)
  nameEn: text('name_en').notNull(),
  nameKn: text('name_kn').notNull(),                   // official bilingual data — never MT (arch §9)
  corporation: corporationEnum('corporation').notNull(),
  zone: text('zone').notNull(),
  boundaryRef: text('boundary_ref').notNull(),         // feature id in data/gba.geojson
});

export const wardCandidateQuestions = pgTable('ward_candidate_questions', {
  id: serial('id').primaryKey(),
  wardId: integer('ward_id').notNull().references(() => wards.id, { onDelete: 'cascade' }),
  position: integer('position').notNull(),
  questionEn: text('question_en').notNull(),
  questionKn: text('question_kn').notNull(),
}, (t) => [
  uniqueIndex('ward_candidate_questions_ward_position_uq').on(t.wardId, t.position),
  index('ward_candidate_questions_ward_idx').on(t.wardId),
  check('ward_candidate_questions_position_check', sql`${t.position} between 1 and 5`),
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
  slug: text('slug').notNull().unique(),               // ward is part of the slug (IA §3.4)
  wardId: integer('ward_id').notNull().references(() => wards.id),
  nameEn: text('name_en').notNull(),
  nameKn: text('name_kn'),
  partyEn: text('party_en').notNull(),                 // 'Independent' allowed
  partyKn: text('party_kn'),
  photoMediaId: integer('photo_media_id').references(() => media.id),
  status: candidateStatusEnum('status').notNull().default('filed'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
}, (t) => [index('candidates_ward_idx').on(t.wardId)]);

// Report-card fields: track_record | cases | assets | education | approachability
export const candidateFields = pgTable('candidate_fields', {
  id: serial('id').primaryKey(),
  candidateId: integer('candidate_id').notNull().references(() => candidates.id),
  fieldKey: text('field_key').notNull(),
  valueEn: text('value_en'),
  valueKn: text('value_kn'),
  notDeclared: boolean('not_declared').notNull().default(false),  // valid, complete answer (PRD §9.1)
  authoredLang: langEnum('authored_lang').notNull().default('en'),
  translationStatus: translationStatusEnum('translation_status').notNull().default('pending'),
  sourceUrl: text('source_url'),
  sourceType: sourceTypeEnum('source_type').notNull().default('curator'),
  aiExtracted: boolean('ai_extracted').notNull().default(false),  // cleared on curator confirm (PRD §5.2)
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
}, (t) => [uniqueIndex('candidate_field_uq').on(t.candidateId, t.fieldKey)]);

export const candidateAffidavits = pgTable('candidate_affidavits', {
  id: serial('id').primaryKey(),
  candidateId: integer('candidate_id').notNull().references(() => candidates.id),
  mediaId: integer('media_id').notNull().references(() => media.id),
  originUrl: text('origin_url'),                        // EC URL when fetched, null when uploaded
  extractionStatus: extractionStatusEnum('extraction_status').notNull().default('pending'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
});

export const candidateNewsLinks = pgTable('candidate_news_links', {
  id: serial('id').primaryKey(),
  candidateId: integer('candidate_id').notNull().references(() => candidates.id),
  url: text('url').notNull(),
  title: text('title').notNull(),
  domain: text('domain').notNull(),
  origin: newsOriginEnum('origin').notNull(),
  status: newsStatusEnum('status').notNull().default('suggested'),
  approvedBy: integer('approved_by'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
}, (t) => [uniqueIndex('news_link_uq').on(t.candidateId, t.url)]);

export const wardIssues = pgTable('ward_issues', {
  id: serial('id').primaryKey(),
  wardId: integer('ward_id').notNull().references(() => wards.id),
  titleEn: text('title_en'),
  titleKn: text('title_kn'),
  authoredLang: langEnum('authored_lang').notNull().default('en'),
  translationStatus: translationStatusEnum('translation_status').notNull().default('pending'),
  position: integer('position').notNull().default(0),
}, (t) => [index('ward_issues_ward_idx').on(t.wardId)]);

export const candidateStances = pgTable('candidate_stances', {
  id: serial('id').primaryKey(),
  wardIssueId: integer('ward_issue_id').notNull().references(() => wardIssues.id, { onDelete: 'cascade' }),
  candidateId: integer('candidate_id').notNull().references(() => candidates.id),
  valueEn: text('value_en'),
  valueKn: text('value_kn'),
  authoredLang: langEnum('authored_lang').notNull().default('en'),
  translationStatus: translationStatusEnum('translation_status').notNull().default('pending'),
  sourceUrl: text('source_url'),
  sourceType: sourceTypeEnum('source_type').notNull().default('curator'),
}, (t) => [uniqueIndex('stance_uq').on(t.wardIssueId, t.candidateId)]);

export const booths = pgTable('booths', {
  id: serial('id').primaryKey(),
  wardId: integer('ward_id').notNull().references(() => wards.id),
  nameEn: text('name_en').notNull(),
  nameKn: text('name_kn'),
  address: text('address').notNull(),
  lat: text('lat').notNull(),
  lng: text('lng').notNull(),
});

export const users = pgTable('users', {
  id: serial('id').primaryKey(),
  email: text('email').unique(),                        // one account per contact (PRD §10)
  phone: text('phone').unique(),
  homeWardId: integer('home_ward_id').references(() => wards.id),
  language: langEnum('language').notNull().default('en'),
  role: roleEnum('role').notNull().default('citizen'),
  status: userStatusEnum('status').notNull().default('active'),
  srcAttribution: text('src_attribution'),
  consentAt: timestamp('consent_at'),
  consentVersion: text('consent_version'),
  futureToolsOptIn: boolean('future_tools_opt_in').notNull().default(false),
  emailEnabled: boolean('email_enabled').notNull().default(true),   // /account/notifications toggles
  whatsappEnabled: boolean('whatsapp_enabled').notNull().default(true),
  createdAt: timestamp('created_at').notNull().defaultNow(),
});

export const curatorScopes = pgTable('curator_scopes', {
  userId: integer('user_id').notNull().references(() => users.id),
  wardId: integer('ward_id').notNull().references(() => wards.id),
}, (t) => [primaryKey({ columns: [t.userId, t.wardId] })]);

/**
 * TEST ONLY — written to exclusively when `OTP_TEST_SINK === 'true'`
 * (src/lib/otp.ts's `requestOtp`), which must NEVER be set in production or
 * staging (it defeats the hashed-storage protection `otp_codes.code_hash`
 * exists for by additionally persisting the plaintext code). This table
 * exists purely so the Playwright e2e suite (Task 64) — a real browser
 * driving the app as a separate process — can read the OTP code a request
 * generated, since it has no in-process access to `requestOtp`'s return
 * value. Empty and unused in every environment that doesn't set the flag.
 */
export const otpTestCodes = pgTable('otp_test_codes', {
  id: serial('id').primaryKey(),
  destination: text('destination').notNull(),
  code: text('code').notNull(),
  createdAt: timestamp('created_at').notNull().defaultNow(),
}, (t) => [index('otp_test_codes_destination_idx').on(t.destination, t.createdAt)]);

export const otpCodes = pgTable('otp_codes', {
  id: serial('id').primaryKey(),
  destination: text('destination').notNull(),           // email address or +91… number
  channel: channelEnum('channel').notNull(),
  purpose: otpPurposeEnum('purpose').notNull().default('auth'),
  userId: integer('user_id'),                           // set for add_contact
  codeHash: text('code_hash').notNull(),                // sha256(code + SESSION_SECRET)
  attempts: integer('attempts').notNull().default(0),   // invalidated at 5 (arch §7)
  expiresAt: timestamp('expires_at').notNull(),
  consumedAt: timestamp('consumed_at'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
}, (t) => [index('otp_destination_idx').on(t.destination, t.createdAt)]);

export const sessions = pgTable('sessions', {
  id: text('id').primaryKey(),                          // random 32-byte hex
  userId: integer('user_id').notNull().references(() => users.id),
  expiresAt: timestamp('expires_at').notNull(),         // sliding 1h idle
  createdAt: timestamp('created_at').notNull().defaultNow(),
});

export const suppressions = pgTable('suppressions', {
  id: serial('id').primaryKey(),
  contact: text('contact').notNull(),
  channel: channelEnum('channel').notNull(),
  reason: suppressionReasonEnum('reason').notNull(),
  createdAt: timestamp('created_at').notNull().defaultNow(),
}, (t) => [uniqueIndex('suppression_uq').on(t.contact, t.channel)]);

export const flagItems = pgTable('flag_items', {          // deduped queue item (PRD §6.3)
  id: serial('id').primaryKey(),
  wardId: integer('ward_id').notNull().references(() => wards.id),
  targetType: flagTargetEnum('target_type').notNull(),
  targetRef: text('target_ref').notNull(),                // e.g. 'candidate:12:cases' | 'ward:57:name'
  status: flagStatusEnum('status').notNull().default('pending'),
  resolutionReason: text('resolution_reason'),
  resolvedBy: integer('resolved_by'),
  resolvedAt: timestamp('resolved_at'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
}, (t) => [uniqueIndex('flag_dedupe_uq').on(t.targetRef).where(sql`status = 'pending'`)]);

export const flagSubmissions = pgTable('flag_submissions', {
  id: serial('id').primaryKey(),
  flagItemId: integer('flag_item_id').notNull().references(() => flagItems.id),
  userId: integer('user_id').notNull().references(() => users.id),
  detail: text('detail').notNull(),
  suggestedValue: text('suggested_value'),
  sourceUrl: text('source_url'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
});

export const issueVoteSets = pgTable('issue_vote_sets', {
  id: serial('id').primaryKey(),
  userId: integer('user_id').notNull().references(() => users.id),
  wardId: integer('ward_id').notNull().references(() => wards.id),
  active: boolean('active').notNull().default(true),      // retired on home-ward change / re-cast
  createdAt: timestamp('created_at').notNull().defaultNow(),
}, (t) => [uniqueIndex('active_set_uq').on(t.userId).where(sql`active`)]);

export const issueVoteSelections = pgTable('issue_vote_selections', {
  setId: integer('set_id').notNull().references(() => issueVoteSets.id, { onDelete: 'cascade' }),
  wardIssueId: integer('ward_issue_id').notNull().references(() => wardIssues.id, { onDelete: 'cascade' }),
}, (t) => [primaryKey({ columns: [t.setId, t.wardIssueId] })]);

export const partners = pgTable('partners', {
  id: serial('id').primaryKey(),
  slug: text('slug').notNull().unique(),
  name: text('name').notNull(),
  contact: text('contact'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
});
export const partnerWards = pgTable('partner_wards', {
  partnerId: integer('partner_id').notNull().references(() => partners.id),
  wardId: integer('ward_id').notNull().references(() => wards.id),
}, (t) => [primaryKey({ columns: [t.partnerId, t.wardId] })]);

export const eoiSubmissions = pgTable('eoi_submissions', {
  id: serial('id').primaryKey(),
  path: eoiPathEnum('path').notNull(),
  name: text('name').notNull(),
  organisation: text('organisation'),
  contact: text('contact').notNull(),
  wardsText: text('wards_text'),
  message: text('message'),
  status: eoiStatusEnum('status').notNull().default('new'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
});

export const wardReadiness = pgTable('ward_readiness', {
  wardId: integer('ward_id').primaryKey().references(() => wards.id),
  completenessSnapshot: jsonb('completeness_snapshot'),   // {complete, gaps[]} at sign-off time
  signedOffBy: integer('signed_off_by'),
  signedOffAt: timestamp('signed_off_at'),                // null = not signed off (or cleared)
  clearedAt: timestamp('cleared_at'),                     // set when candidate-set change clears it
  commsHoldOverride: boolean('comms_hold_override').notNull().default(false),  // admin release
});

export const auditLog = pgTable('audit_log', {            // append-only (enforced in Task 5)
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  actorUserId: integer('actor_user_id'),                  // null = system (MT, extraction, jobs)
  actorRole: text('actor_role').notNull(),                // 'curator' | 'admin' | 'system' | 'citizen'
  action: text('action').notNull(),                       // 'publish' | 'flag' | 'sign_off' | 'restore' | …
  entityType: text('entity_type').notNull(),
  entityId: text('entity_id').notNull(),
  wardId: integer('ward_id'),
  fieldKey: text('field_key'),
  oldValue: jsonb('old_value'),
  newValue: jsonb('new_value'),
  sourceUrl: text('source_url'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
}, (t) => [index('audit_entity_idx').on(t.entityType, t.entityId), index('audit_created_idx').on(t.createdAt)]);

export const campaignSends = pgTable('campaign_sends', {  // send-once ledger per user × code
  id: serial('id').primaryKey(),
  code: sendCodeEnum('code').notNull(),
  userId: integer('user_id').notNull().references(() => users.id),
  wardId: integer('ward_id').notNull(),
  channel: channelEnum('channel').notNull(),
  language: langEnum('language').notNull(),
  status: sendStatusEnum('status').notNull(),
  sentAt: timestamp('sent_at').notNull().defaultNow(),
}, (t) => [uniqueIndex('send_once_uq').on(t.code, t.userId, t.channel)]);

export const appSettings = pgTable('app_settings', {      // election anchors, wording versions
  key: text('key').primaryKey(),                          // 'notification_date' | 'election_date' |
  value: text('value').notNull(),                         // 'roll_deadline' | 'consent_wording_version' | …
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
