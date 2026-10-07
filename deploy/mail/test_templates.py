import unittest
from templates import render


class SubmissionConfiguration(unittest.TestCase):
    def test_only_explicit_submission_services_are_added(self):
        data = render('example.com', 'mail.example.com', '192.0.2.10', 'cq202610')
        master = data['master.cf.fragment']
        self.assertEqual(master.count(':587 inet'), 2)
        self.assertNotIn(':25 ', master)
        self.assertNotIn('inet_interfaces', master)
        self.assertNotIn('smtp_helo_name', master)
        self.assertIn('smtpd_tls_security_level=encrypt', master)
        self.assertIn('smtpd_tls_auth_only=yes', master)
        self.assertIn('smtpd_relay_restrictions=permit_sasl_authenticated,reject', master)
        self.assertIn('reject_authenticated_sender_login_mismatch', master)
        self.assertIn('milter_default_action=tempfail', master)
        self.assertIn('queue_minfree=37580963840', master)
        self.assertEqual(master.count('message_size_limit=10485760'), 3)
        self.assertEqual(data['senders'].splitlines(), ['support@example.com support@example.com', 'accounts@example.com accounts@example.com'])
        self.assertTrue(data['dovecot.conf'].startswith('protocols =\n'))
        self.assertIn('Mode s', data['opendkim.conf'])

    def test_config_injection_and_wrong_domain_are_rejected(self):
        for host in ('mail.example.com\nssl=no', 'mail.other.com'):
            with self.assertRaises(ValueError):
                render('example.com', host, '192.0.2.10', 'cq202610')
        with self.assertRaises(ValueError):
            render('example.com', 'mail.example.com', '0.0.0.0\n', 'cq202610')


if __name__ == '__main__':
    unittest.main()
