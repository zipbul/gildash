PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_relations` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`project` text NOT NULL,
	`type` text NOT NULL,
	`src_file_path` text NOT NULL,
	`src_symbol_name` text,
	`dst_project` text,
	`dst_file_path` text,
	`dst_symbol_name` text,
	`meta_json` text,
	`specifier` text,
	`is_external` integer NOT NULL DEFAULT 0,
	FOREIGN KEY (`project`,`src_file_path`) REFERENCES `files`(`project`,`file_path`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_relations`("id", "project", "type", "src_file_path", "src_symbol_name", "dst_project", "dst_file_path", "dst_symbol_name", "meta_json", "specifier", "is_external") SELECT "id", "project", "type", "src_file_path", "src_symbol_name", "dst_project", "dst_file_path", "dst_symbol_name", "meta_json", NULL, 0 FROM `relations`;--> statement-breakpoint
DROP TABLE `relations`;--> statement-breakpoint
ALTER TABLE `__new_relations` RENAME TO `relations`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `idx_relations_src` ON `relations` (`project`,`src_file_path`);--> statement-breakpoint
CREATE INDEX `idx_relations_dst` ON `relations` (`dst_project`,`dst_file_path`);--> statement-breakpoint
CREATE INDEX `idx_relations_type` ON `relations` (`project`,`type`);--> statement-breakpoint
CREATE INDEX `idx_relations_project_type_src` ON `relations` (`project`,`type`,`src_file_path`);--> statement-breakpoint
CREATE INDEX `idx_relations_specifier` ON `relations` (`project`,`specifier`);--> statement-breakpoint
INSERT OR REPLACE INTO sqlite_sequence (name, seq) SELECT 'relations', COALESCE(MAX(id), 0) FROM relations;
