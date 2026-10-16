-- Update Find Your Parish enroll copy (remove CRM-directory wording).
-- Applied in production 2026-07-28; idempotent UPDATEs.

UPDATE translations_source
SET english_text = 'Select your state, then pick your parish on the map or search by name.',
    updated_at = NOW()
WHERE translation_key = 'enroll.section.find_parish.description';

UPDATE translations_source
SET english_text = 'Parishes displayed on the map are Orthodox parishes that exist throughout the United States.',
    updated_at = NOW()
WHERE translation_key = 'enroll.find_parish.crm_tip';

UPDATE translations_source
SET english_text = 'Zoom and tap a pin, or search by name below.',
    updated_at = NOW()
WHERE translation_key = 'enroll.find_parish.map.help';
