-- Better Auth 1.7.7 generated schema; applied only by the application migrator.
CREATE SCHEMA IF NOT EXISTS canquery_auth;
SET LOCAL search_path = canquery_auth, public;
create table "user" ("id" text not null primary key, "name" text not null, "email" text not null unique, "emailVerified" boolean not null, "image" text, "createdAt" timestamptz default CURRENT_TIMESTAMP not null, "updatedAt" timestamptz default CURRENT_TIMESTAMP not null);
ALTER TABLE "user" ADD COLUMN "termsVersion" text NOT NULL,
    ADD COLUMN "termsAcceptedAt" timestamptz NOT NULL;

create table "session" ("id" text not null primary key, "expiresAt" timestamptz not null, "token" text not null unique, "createdAt" timestamptz default CURRENT_TIMESTAMP not null, "updatedAt" timestamptz not null, "ipAddress" text, "userAgent" text, "userId" text not null references "user" ("id") on delete cascade);

create table "account" ("id" text not null primary key, "accountId" text not null, "providerId" text not null, "userId" text not null references "user" ("id") on delete cascade, "accessToken" text, "refreshToken" text, "idToken" text, "accessTokenExpiresAt" timestamptz, "refreshTokenExpiresAt" timestamptz, "scope" text, "password" text, "createdAt" timestamptz default CURRENT_TIMESTAMP not null, "updatedAt" timestamptz not null);

create table "verification" ("id" text not null primary key, "identifier" text not null, "value" text not null, "expiresAt" timestamptz not null, "createdAt" timestamptz default CURRENT_TIMESTAMP not null, "updatedAt" timestamptz default CURRENT_TIMESTAMP not null);

create table "rateLimit" ("id" text not null primary key, "key" text not null unique, "count" integer not null, "lastRequest" bigint not null);

create index "session_userId_idx" on "session" ("userId");

create index "account_userId_idx" on "account" ("userId");

create index "verification_identifier_idx" on "verification" ("identifier");
SET LOCAL search_path = public;

CREATE SCHEMA commercial;
CREATE TABLE commercial.environment (
    singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
    mode text NOT NULL CHECK (mode IN ('sandbox','live'))
);
CREATE TABLE commercial.accounts (
    id uuid PRIMARY KEY,
    owner_id text UNIQUE REFERENCES canquery_auth."user"(id) ON DELETE SET NULL,
    stripe_customer_id text UNIQUE,
    stripe_subscription_id text,
    billing_checked_at timestamptz NOT NULL DEFAULT 'epoch',
    suspended_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE commercial.api_keys (
    id uuid PRIMARY KEY,
    account_id uuid NOT NULL REFERENCES commercial.accounts(id),
    name text NOT NULL CHECK (length(name) BETWEEN 1 AND 80),
    prefix text NOT NULL,
    digest text NOT NULL UNIQUE,
    created_at timestamptz NOT NULL DEFAULT now(),
    revoked_at timestamptz
);
CREATE INDEX commercial_keys_account ON commercial.api_keys(account_id, created_at, id) WHERE revoked_at IS NULL;
CREATE TABLE commercial.periods (
    id text PRIMARY KEY,
    account_id uuid NOT NULL REFERENCES commercial.accounts(id),
    plan text NOT NULL CHECK (plan IN ('free','business','enterprise')),
    starts_at timestamptz NOT NULL,
    ends_at timestamptz NOT NULL CHECK (ends_at > starts_at),
    allowance bigint NOT NULL CHECK (allowance > 0),
    used bigint NOT NULL DEFAULT 0 CHECK (used >= 0),
    reserved bigint NOT NULL DEFAULT 0 CHECK (reserved >= 0),
    key_limit integer NOT NULL CHECK (key_limit BETWEEN 1 AND 100),
    rate_limit integer NOT NULL CHECK (rate_limit BETWEEN 1 AND 10000),
    concurrency integer NOT NULL CHECK (concurrency BETWEEN 1 AND 4),
    revoked_at timestamptz,
    invoice_id text UNIQUE,
    CHECK (used + reserved <= allowance)
);
CREATE INDEX commercial_current_period ON commercial.periods(account_id, ends_at);
CREATE TABLE commercial.requests (
    id uuid PRIMARY KEY,
    account_id uuid NOT NULL REFERENCES commercial.accounts(id),
    period_id text NOT NULL REFERENCES commercial.periods(id),
    operation text NOT NULL,
    credits integer NOT NULL CHECK (credits >= 0),
    state text NOT NULL CHECK (state IN ('reserved','charged','refunded')),
    expensive boolean NOT NULL DEFAULT false,
    expires_at timestamptz NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    finished_at timestamptz,
    job_id bigint
);
CREATE INDEX commercial_request_leases ON commercial.requests(expires_at) WHERE state = 'reserved';
CREATE TABLE commercial.rate_windows (
    account_id uuid NOT NULL REFERENCES commercial.accounts(id),
    bucket text NOT NULL,
    starts_at timestamptz NOT NULL,
    hits integer NOT NULL CHECK (hits >= 0),
    PRIMARY KEY(account_id, bucket, starts_at)
);
CREATE TABLE commercial.usage_daily (
    account_id uuid NOT NULL REFERENCES commercial.accounts(id),
    day date NOT NULL,
    operation text NOT NULL,
    requests integer NOT NULL DEFAULT 0,
    credits bigint NOT NULL DEFAULT 0,
    PRIMARY KEY(account_id, day, operation)
);
-- Store only event identity, never full Stripe payloads or card/customer details.
CREATE TABLE commercial.stripe_events (
    id text PRIMARY KEY,
    type text NOT NULL,
    object_id text NOT NULL,
    customer_id text,
    attempts integer NOT NULL DEFAULT 0,
    available_at timestamptz NOT NULL DEFAULT now(),
    received_at timestamptz NOT NULL DEFAULT now(),
    processed_at timestamptz,
    failure boolean NOT NULL DEFAULT false
);
CREATE INDEX commercial_events_pending ON commercial.stripe_events(available_at) WHERE processed_at IS NULL;
-- Verification/reset links are encrypted; successful messages are deleted.
CREATE TABLE commercial.mail_outbox (
    id uuid PRIMARY KEY,
    -- The auth callback can run before its own connection commits the user.
    -- A cross-pool FK would wait for that commit while signup awaits this insert.
    -- Account deletion removes pending mail explicitly by this identifier.
    user_id text NOT NULL,
    payload text NOT NULL,
    attempts integer NOT NULL DEFAULT 0,
    available_at timestamptz NOT NULL DEFAULT now(),
    created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX commercial_mail_user ON commercial.mail_outbox(user_id);
