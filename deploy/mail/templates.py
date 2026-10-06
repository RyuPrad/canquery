"""Authentication and signing for a separate Postfix submission listener.

Only master.cf gets additional services. Existing main.cf, loopback SMTP,
outbound HELO/PTR identity and other applications' DKIM paths stay intact.
"""
import ipaddress
import re


def render(domain, hostname, address, selector):
    for value in (domain, hostname, selector):
        if not re.fullmatch(r"[a-z0-9][a-z0-9.-]{0,200}", value):
            raise ValueError("Invalid mail identity")
    ipaddress.IPv4Address(address)
    if not hostname.endswith('.' + domain):
        raise ValueError("Mail hostname must belong to the domain")
    root = '/etc/canquery-mail'
    dovecot = f'''protocols =
listen = 127.0.0.1
base_dir = /run/canquery-mail-auth
state_dir = /var/lib/canquery-mail-auth
log_path = syslog
syslog_facility = mail
ssl = no
auth_mechanisms = plain login
auth_username_format = %Lu
auth_failure_delay = 3 secs
auth_verbose = no
auth_debug = no
auth_debug_passwords = no
passdb {{
  driver = passwd-file
  args = scheme=SHA512-CRYPT username_format=%u {root}/users
}}
userdb {{
  driver = static
  args = uid=nobody gid=nobody home=/nonexistent
}}
service auth {{
  unix_listener /var/spool/postfix/private/canquery-auth {{
    mode = 0660
    user = postfix
    group = postfix
  }}
}}
'''
    dkim = f'''Syslog yes
SyslogSuccess yes
LogWhy no
Mode s
Canonicalization relaxed/relaxed
SignatureAlgorithm rsa-sha256
Domain {domain}
Selector {selector}
KeyFile {root}/dkim.pem
Socket local:/run/canquery-mail-dkim/dkim.sock
UMask 007
MacroList daemon_name=ORIGINATING
OversignHeaders From
RequireSafeKeys yes
'''
    options = {
        'syslog_name': 'postfix/canquery-submission',
        'smtpd_banner': hostname + ' ESMTP',
        'smtpd_tls_security_level': 'encrypt',
        'smtpd_tls_mandatory_protocols': '>=TLSv1.2',
        'smtpd_tls_auth_only': 'yes',
        'smtpd_tls_cert_file': root + '/tls/current/cert.pem',
        'smtpd_tls_key_file': root + '/tls/current/key.pem',
        'smtpd_sasl_auth_enable': 'yes',
        'smtpd_sasl_type': 'dovecot',
        'smtpd_sasl_path': 'private/canquery-auth',
        'smtpd_sasl_security_options': 'noanonymous',
        'smtpd_client_restrictions': 'permit_sasl_authenticated,reject',
        'smtpd_relay_restrictions': 'permit_sasl_authenticated,reject',
        'smtpd_sender_login_maps': 'texthash:' + root + '/senders',
        'smtpd_sender_restrictions': 'reject_non_fqdn_sender,reject_authenticated_sender_login_mismatch,permit_sasl_authenticated,reject',
        'smtpd_recipient_restrictions': 'reject_non_fqdn_recipient,permit_sasl_authenticated,reject',
        'smtpd_helo_required': 'yes',
        'smtpd_milters': 'unix:/run/canquery-mail-dkim/dkim.sock',
        'milter_default_action': 'tempfail',
        'milter_macro_daemon_name': 'ORIGINATING',
        'smtpd_client_connection_count_limit': '5',
        'smtpd_client_connection_rate_limit': '20',
        'smtpd_client_message_rate_limit': '30',
        'smtpd_client_recipient_rate_limit': '60',
        'smtpd_recipient_limit': '20',
        'smtpd_client_event_limit_exceptions': '',
        'smtpd_timeout': '60s',
        'message_size_limit': '10485760',
        'queue_minfree': str(35 * 1024**3),
        'cleanup_service_name': 'canquery-cleanup',
    }
    services = []
    for bind in ('127.0.0.1', address):
        services.append(f'{bind}:587 inet n - n - 10 smtpd\n' + ''.join(
            '  -o {' + key + '=' + value + '}\n' for key, value in options.items()))
    services.append('canquery-cleanup unix n - n - 0 cleanup\n  -o message_size_limit=10485760\n')
    return {'dovecot.conf': dovecot, 'opendkim.conf': dkim,
            'senders': ''.join(f'{name}@{domain} {name}@{domain}\n' for name in ('support', 'accounts')),
            'master.cf.fragment': '# BEGIN CANQUERY SUBMISSION\n' + '\n'.join(services) + '# END CANQUERY SUBMISSION\n'}
