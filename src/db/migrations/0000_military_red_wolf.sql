CREATE TABLE `accounts` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`official_name` text,
	`type` text NOT NULL,
	`currency` text DEFAULT 'USD' NOT NULL,
	`balance` integer DEFAULT 0 NOT NULL,
	`available` integer,
	`institution` text,
	`connection_id` text,
	`external_id` text,
	`mask` text,
	`archived` integer DEFAULT false NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`connection_id`) REFERENCES `connections`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `accounts_connection_external_uq` ON `accounts` (`connection_id`,`external_id`);--> statement-breakpoint
CREATE INDEX `accounts_connection_idx` ON `accounts` (`connection_id`);--> statement-breakpoint
CREATE INDEX `accounts_type_idx` ON `accounts` (`type`);--> statement-breakpoint
CREATE TABLE `budgets` (
	`id` text PRIMARY KEY NOT NULL,
	`category_id` text NOT NULL,
	`month` text NOT NULL,
	`amount` integer NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`category_id`) REFERENCES `categories`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `budgets_category_month_uq` ON `budgets` (`category_id`,`month`);--> statement-breakpoint
CREATE INDEX `budgets_month_idx` ON `budgets` (`month`);--> statement-breakpoint
CREATE TABLE `categories` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`parent_id` text,
	`icon` text,
	`discretionary` integer DEFAULT false NOT NULL,
	`system` integer DEFAULT false NOT NULL,
	FOREIGN KEY (`parent_id`) REFERENCES `categories`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `categories_parent_idx` ON `categories` (`parent_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `categories_parent_name_uq` ON `categories` (`parent_id`,`name`);--> statement-breakpoint
CREATE TABLE `connections` (
	`id` text PRIMARY KEY NOT NULL,
	`provider` text NOT NULL,
	`institution` text,
	`status` text DEFAULT 'ok' NOT NULL,
	`credentials_enc` text,
	`sync_cursor` text,
	`last_sync_at` text,
	`last_error` text,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `connections_provider_idx` ON `connections` (`provider`);--> statement-breakpoint
CREATE TABLE `insights` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`severity` text NOT NULL,
	`title` text NOT NULL,
	`body` text NOT NULL,
	`action` text,
	`refs` text DEFAULT '{}' NOT NULL,
	`period` text NOT NULL,
	`dedupe_key` text NOT NULL,
	`dismissed` integer DEFAULT false NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `insights_period_kind_key_uq` ON `insights` (`period`,`kind`,`dedupe_key`);--> statement-breakpoint
CREATE INDEX `insights_period_idx` ON `insights` (`period`);--> statement-breakpoint
CREATE TABLE `networth_snapshots` (
	`id` text PRIMARY KEY NOT NULL,
	`date` text NOT NULL,
	`account_id` text NOT NULL,
	`account_type` text NOT NULL,
	`balance` integer NOT NULL,
	`currency` text DEFAULT 'USD' NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `networth_date_account_uq` ON `networth_snapshots` (`date`,`account_id`);--> statement-breakpoint
CREATE INDEX `networth_date_idx` ON `networth_snapshots` (`date`);--> statement-breakpoint
CREATE TABLE `recurring_series` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`merchant` text,
	`normalized_key` text NOT NULL,
	`amount` integer NOT NULL,
	`cadence` text NOT NULL,
	`first_date` text NOT NULL,
	`last_date` text NOT NULL,
	`next_expected_date` text NOT NULL,
	`occurrences` integer DEFAULT 0 NOT NULL,
	`account_id` text NOT NULL,
	`category_id` text,
	`active` integer DEFAULT true NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`category_id`) REFERENCES `categories`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `recurring_account_key_uq` ON `recurring_series` (`account_id`,`normalized_key`);--> statement-breakpoint
CREATE INDEX `recurring_active_idx` ON `recurring_series` (`active`);--> statement-breakpoint
CREATE TABLE `transactions` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`external_id` text,
	`amount` integer NOT NULL,
	`currency` text DEFAULT 'USD' NOT NULL,
	`date` text NOT NULL,
	`name` text NOT NULL,
	`merchant` text,
	`category_id` text,
	`category_source` text,
	`pending` integer DEFAULT false NOT NULL,
	`notes` text,
	`recurring_series_id` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`category_id`) REFERENCES `categories`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`recurring_series_id`) REFERENCES `recurring_series`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `transactions_account_external_uq` ON `transactions` (`account_id`,`external_id`);--> statement-breakpoint
CREATE INDEX `transactions_account_date_idx` ON `transactions` (`account_id`,`date`);--> statement-breakpoint
CREATE INDEX `transactions_date_idx` ON `transactions` (`date`);--> statement-breakpoint
CREATE INDEX `transactions_category_date_idx` ON `transactions` (`category_id`,`date`);--> statement-breakpoint
CREATE INDEX `transactions_merchant_idx` ON `transactions` (`merchant`);--> statement-breakpoint
CREATE INDEX `transactions_series_idx` ON `transactions` (`recurring_series_id`);--> statement-breakpoint
CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`username` text NOT NULL,
	`password_hash` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_username_uq` ON `users` (`username`);