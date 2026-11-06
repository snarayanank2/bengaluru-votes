-- The ward "Questions to ask your candidates" section is removed
-- (2026-11-06). Its table is dropped; the rows were seed-derived and the
-- source data stays in git history (data/ward-candidate-questions.json).
DROP TABLE IF EXISTS "ward_candidate_questions" CASCADE;
