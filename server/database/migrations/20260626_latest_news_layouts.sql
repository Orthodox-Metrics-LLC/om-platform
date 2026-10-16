-- Add layout block type for sample page sections

ALTER TABLE latest_news_blocks
  MODIFY block_type ENUM('paragraph', 'image', 'layout') NOT NULL;
