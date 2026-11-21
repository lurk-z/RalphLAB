CREATE TABLE `qsar_jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`owner` text NOT NULL,
	`study` text,
	`created` integer NOT NULL,
	`state` text NOT NULL,
	`formula` text NOT NULL,
	`mode` text NOT NULL,
	`call` text,
	`lease` text,
	`until` integer DEFAULT 0 NOT NULL,
	`result` text,
	`report` text,
	`issue` text
);
--> statement-breakpoint
CREATE INDEX `qsar_owner_study` ON `qsar_jobs` (`owner`,`study`,`created`);--> statement-breakpoint
CREATE INDEX `qsar_queue` ON `qsar_jobs` (`state`,`until`,`created`);