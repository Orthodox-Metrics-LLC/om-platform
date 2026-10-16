-- Cemetery plot identity model — canonical plot_key per physical grave
-- Apply per-tenant (e.g. om_church_46). Safe to re-run (checks column existence via procedure pattern).

ALTER TABLE `cemetery_plots`
  ADD COLUMN `plot_key` varchar(64) DEFAULT NULL COMMENT 'Stable identity: section|side|row|position',
  ADD COLUMN `side` varchar(8) DEFAULT NULL COMMENT 'Road side: M, N, S, E, W, etc.',
  ADD COLUMN `position` varchar(16) DEFAULT NULL COMMENT 'Position within row',
  ADD COLUMN `display_numbers` varchar(128) DEFAULT NULL COMMENT 'Marker grave number(s), comma-separated';

CREATE UNIQUE INDEX `cemetery_plots_plot_key_unique` ON `cemetery_plots` (`plot_key`);
