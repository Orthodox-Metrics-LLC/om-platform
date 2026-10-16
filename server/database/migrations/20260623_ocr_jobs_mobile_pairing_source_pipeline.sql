-- Add mobile_pairing to ocr_jobs.source_pipeline enum (OCR Studio phone upload flow)
ALTER TABLE ocr_jobs MODIFY COLUMN source_pipeline
  ENUM('studio','uploader','worker','batch_import','analyze','mobile_pairing') NULL;
