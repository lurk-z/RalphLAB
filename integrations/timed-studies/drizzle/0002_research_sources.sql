CREATE TABLE `research_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`owner` text NOT NULL,
	`scope` text NOT NULL,
	`created` integer NOT NULL,
	`revision` integer NOT NULL,
	`payload` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `research_owner_scope` ON `research_runs` (`owner`,`scope`,`created`);