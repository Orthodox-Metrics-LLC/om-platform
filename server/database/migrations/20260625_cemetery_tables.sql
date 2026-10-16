-- Parish Cemetery module — tenant tables (om_church_* databases)
-- Apply per-tenant, e.g. om_church_46 on 192.168.1.241

SET FOREIGN_KEY_CHECKS = 0;

CREATE TABLE IF NOT EXISTS `cemetery_sections` (
  `id` int NOT NULL AUTO_INCREMENT,
  `code` varchar(8) NOT NULL,
  `name` varchar(128) NOT NULL,
  `description` text DEFAULT NULL,
  `center_x` double NOT NULL DEFAULT 50,
  `center_y` double NOT NULL DEFAULT 50,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `cemetery_sections_code_unique` (`code`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `cemetery_rows` (
  `id` int NOT NULL AUTO_INCREMENT,
  `section_id` int NOT NULL,
  `number` varchar(16) NOT NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `cemetery_plots` (
  `id` int NOT NULL AUTO_INCREMENT,
  `section_id` int NOT NULL,
  `row_id` int DEFAULT NULL,
  `plot_number` varchar(32) NOT NULL,
  `status` enum('available','reserved','occupied','unavailable') NOT NULL DEFAULT 'available',
  `map_x` double NOT NULL DEFAULT 0,
  `map_y` double NOT NULL DEFAULT 0,
  `lat` double DEFAULT NULL,
  `lng` double DEFAULT NULL,
  `notes` text DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `map_w` double NOT NULL DEFAULT 3.2,
  `map_h` double NOT NULL DEFAULT 3,
  `map_page` varchar(8) NOT NULL DEFAULT 'pg1',
  PRIMARY KEY (`id`),
  KEY `cemetery_plots_section_id_idx` (`section_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `cemetery_people` (
  `id` int NOT NULL AUTO_INCREMENT,
  `first_name` varchar(128) NOT NULL,
  `last_name` varchar(128) NOT NULL,
  `birth_date` date DEFAULT NULL,
  `death_date` date DEFAULT NULL,
  `notes` text DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `cemetery_people_last_name_idx` (`last_name`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `cemetery_interments` (
  `id` int NOT NULL AUTO_INCREMENT,
  `plot_id` int NOT NULL,
  `person_id` int NOT NULL,
  `burial_date` date DEFAULT NULL,
  `interment_type` enum('burial','entombment') NOT NULL DEFAULT 'burial',
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `cemetery_interments_plot_id_idx` (`plot_id`),
  KEY `cemetery_interments_person_id_idx` (`person_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `cemetery_relationships` (
  `id` int NOT NULL AUTO_INCREMENT,
  `person_id` int NOT NULL,
  `related_person_id` int NOT NULL,
  `relation_type` enum('spouse','parent','child','sibling') NOT NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `cemetery_path_nodes` (
  `id` int NOT NULL AUTO_INCREMENT,
  `label` varchar(128) NOT NULL,
  `map_x` double NOT NULL DEFAULT 0,
  `map_y` double NOT NULL DEFAULT 0,
  `is_entrance` int NOT NULL DEFAULT 0,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `cemetery_path_edges` (
  `id` int NOT NULL AUTO_INCREMENT,
  `from_node_id` int NOT NULL,
  `to_node_id` int NOT NULL,
  `distance_ft` double NOT NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `cemetery_maintenance_tasks` (
  `id` int NOT NULL AUTO_INCREMENT,
  `section_id` int DEFAULT NULL,
  `plot_id` int DEFAULT NULL,
  `title` varchar(256) NOT NULL,
  `description` text DEFAULT NULL,
  `status` enum('open','in_progress','done') NOT NULL DEFAULT 'open',
  `due_date` date DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

SET FOREIGN_KEY_CHECKS = 1;
