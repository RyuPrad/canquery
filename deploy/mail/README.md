# Authenticated mail submission

Incoming `support` and `accounts` aliases forward through the domain provider to
the owner's mailbox. Outgoing support replies and account mail use a separate
authenticated Postfix submission listener on TCP 587 with mandatory STARTTLS.
There is no new mailbox or IMAP service on the application host.

The shared Postfix `main.cf`, loopback port 25, outbound HELO/PTR, existing sender
restrictions and other applications' signing remain intact. `templates.py`
adds explicit loopback/public 587 services and a separate cleanup service.
Dovecot 2.3 provides authentication only; two independent random passwords are
hashed with SHA512-CRYPT. Sender/login mappings prevent one credential from
using the other's envelope sender. A dedicated OpenDKIM process signs the new
domain only on submission, failing closed if signing is unavailable. Its key
is owned by the signer with mode 0600. SMTP connection/message/recipient caps,
10 MiB message size and a 35 GiB queue-space floor bound the new service.

Before installation, inspect actual units, Postfix configuration, firewall,
DNS, disk space and package versions. Retain reviewed configuration snapshots
and fresh verified encrypted database backups under the existing backup lock.
Install only missing Dovecot/OpenDKIM packages from the distribution's signed
repositories. Do not rerun an older whole-host mail provisioning script.

Add a DNS-only A record for the mail hostname. Preserve the existing forwarding
MX records and merge the host IPv4 into the single existing SPF record. Add the
generated DKIM selector TXT and an initial DMARC `p=none` record. Provider
forwarding setup may rewrite MX/SPF record IDs, so re-read them before editing.

Have Caddy issue a public certificate for the mail hostname. Add only that site
block, validate the entire configuration and reload Caddy. `sync-certificate.py`
checks hostname, expiry and matching public keys, copies cert/key privately and
publishes their directory atomically before reloading Postfix. Run it from a
root oneshot service with an hourly systemd timer. Monitor timer failures and
the actual SMTP certificate expiry; retaining an expired copy is not success.

`configure.py` previews its exact generated files by default. It requires a
domain, mail hostname, public IPv4, DKIM selector, captured `main.cf` and
`master.cf` SHA-256 hashes, and a private evidence directory. `--apply` requires
the verified off-host backup receipt and the installed TLS copy. It refuses
existing credentials or partial installations so reruns cannot silently rotate
passwords. Keep credentials and private keys out of source control and chat.

Validate locally before opening the firewall: no AUTH before TLS, certificate
hostname verification, no unauthenticated relay, correct password acceptance,
bad password rejection, cross-sender rejection, expected listener inventory,
and continuity of the old loopback sender policy. Then open only 587 and repeat
TLS checks externally. Send test messages only to owner-approved recipients;
inspect received Authentication-Results for DKIM/SPF/DMARC and actual inbox
placement. SMTP acceptance alone does not prove delivery.

Application settings are `SMTP_HOST`, `SMTP_PORT=587`, `SMTP_SERVERNAME`,
`SMTP_REQUIRE_TLS=true`, `SMTP_USER=accounts@YOUR_DOMAIN` and `SMTP_PASSWORD`.
Thunderbird can keep the owner's existing Gmail incoming account and add a
support identity with this SMTP hostname, port 587, STARTTLS and its separate
support password. This does not require sharing the Gmail password with the app.

Retain the installation receipt, exact source templates, package list, DNS
readbacks, TLS/authentication/delivery checks and private rollback snapshots.
For rollback, remove only the reviewed submission fragment, stop its two
services/timer and remove its firewall opening. Restore Caddy's added block
only after a drift check. Preserve the old Postfix configuration and queue;
never delete unrelated queued messages or uninstall shared dependencies.
Re-read current DNS before rolling back only the new mail records/SPF addition.
Coordinate account-email delivery before disabling a live sender.
