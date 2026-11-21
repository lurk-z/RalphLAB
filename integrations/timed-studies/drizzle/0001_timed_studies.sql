CREATE TABLE `timed_studies` (
	`id` text PRIMARY KEY NOT NULL,
	`owner` text NOT NULL,
	`created` integer NOT NULL,
	`version` integer NOT NULL,
	`payload` text NOT NULL,
	`pair_hash` text,
	`sent_version` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE INDEX `timed_owner_created` ON `timed_studies` (`owner`,`created`);