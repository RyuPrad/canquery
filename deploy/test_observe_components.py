import datetime as dt
from contextlib import closing
import importlib.util
import json
import os
import hashlib
import subprocess
import sys
from pathlib import Path
import sqlite3
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location("observer", Path(__file__).with_name("observe-components.py"))
observer = importlib.util.module_from_spec(spec)
spec.loader.exec_module(observer)


class ObservationTests(unittest.TestCase):
    def setUp(self):
        self.now = dt.datetime(2026, 10, 8, tzinfo=dt.timezone.utc)
        self.config = {"database_os_user": "deploy", "database": "test", "deploy_user": "deploy",
                       "app_dir": "/srv/canquery/current", "services": {name: name + ".service" for name in
                       ("api", "preparation", "maps", "mail_auth", "mail_dkim", "mail_certificate")}}
        self.queues = {name: {"eligible_pending": 0, "running": 0, "stale_running": 0,
                              "oldest_pending_seconds": 0, **({"capacity_failures_last_hour": 0} if name == "preparation" else {"failed_resources": 0})}
                       for name in ("preparation", "maps")}
        self.commercial = dict.fromkeys(observer.COMMERCIAL_METRICS, 0)
        self.ops = {"data": {"jobs": {"full": {"status": "ok"}}}}
        self.backup = {"last_verified_at": self.now.isoformat(), "last_attempt_at": self.now.isoformat(), "last_attempt_ok": True}
        self.free = 44 * 1024 ** 3
        self.calls = []

    def run_command(self, arguments, **options):
        self.calls.append((arguments, options))
        if arguments[0].endswith("systemctl"):
            return "\n\n".join("Id=" + unit + "\nActiveState=active" for unit in self.config["services"].values())
        self.assertEqual(arguments[:4], ["/usr/sbin/runuser", "-u", "deploy", "--"])
        if arguments[4].endswith("psql"):
            self.assertIn("BEGIN READ ONLY", arguments[-1])
            return json.dumps(self.queues)
        self.assertEqual(arguments[-1], "status")
        self.assertNotIn("--apply", arguments)
        return json.dumps(self.commercial)

    def collect(self, run=None):
        return observer.observe(self.config, run=run or self.run_command,
                                fetch=lambda url: {"ok": True, "db": True} if url.endswith("readyz") else self.ops,
                                now=self.now, statfs=lambda _: SimpleNamespace(f_bavail=self.free, f_frsize=1),
                                read_json=lambda _: self.backup)["components"]

    def test_healthy_observations_are_bounded_aggregates(self):
        result = self.collect()
        self.assertTrue(all(component["ok"] for component in result.values()))
        self.assertNotIn('"test"', json.dumps(result))
        self.assertNotIn("/srv", json.dumps(result))
        self.assertEqual(result["storage"]["checks"]["operating_margin_bytes"], 43 * 1024 ** 3)

    def test_publisher_map_failure_does_not_fail_availability_or_preparation(self):
        self.queues["maps"]["failed_resources"] = 1
        result = self.collect()
        self.assertFalse(result["maps"]["ok"])
        self.assertTrue(result["availability"]["ok"])
        self.assertTrue(result["preparation"]["ok"])

    def test_stalled_worker_eligible_queue_and_capacity_are_actionable(self):
        for key, value in (("stale_running", 1), ("oldest_pending_seconds", 1801), ("capacity_failures_last_hour", 3)):
            with self.subTest(key=key):
                self.queues["preparation"][key] = value
                self.assertFalse(self.collect()["preparation"]["ok"])
                self.queues["preparation"][key] = 0

    def test_missed_or_failed_backup_and_low_margin_fail(self):
        self.backup["last_verified_at"] = (self.now - dt.timedelta(hours=26)).isoformat()
        self.assertFalse(self.collect()["backups"]["ok"])
        self.backup["last_verified_at"] = self.now.isoformat()
        self.backup["last_attempt_ok"] = False
        self.assertFalse(self.collect()["backups"]["ok"])
        self.free = 42 * 1024 ** 3
        self.assertFalse(self.collect()["storage"]["ok"])

    def test_running_backup_has_two_hour_bound_without_claiming_new_recovery_point(self):
        self.backup.update(last_attempt_status="running", last_attempt_ok=False)
        self.assertTrue(self.collect()["backups"]["ok"])
        self.assertTrue(self.collect()["backups"]["checks"]["attempt_in_progress"])
        self.backup["last_attempt_at"] = (self.now - dt.timedelta(hours=2, seconds=1)).isoformat()
        self.assertFalse(self.collect()["backups"]["ok"])
        self.backup["last_attempt_at"] = self.now.isoformat()
        self.backup["last_verified_at"] = (self.now - dt.timedelta(hours=26)).isoformat()
        self.assertFalse(self.collect()["backups"]["ok"])

    def test_terminal_failure_cannot_be_hidden_by_previous_success(self):
        self.backup.update(last_attempt_status="failed", last_attempt_ok=True)
        self.assertFalse(self.collect()["backups"]["ok"])
        self.backup.update(last_attempt_status="succeeded", last_attempt_ok=True)
        self.assertTrue(self.collect()["backups"]["ok"])

    def test_backlog_and_source_failure_preserve_independent_components(self):
        self.commercial["delayed_mail"] = 1
        self.ops["data"]["jobs"]["full"]["status"] = "failed"
        result = self.collect()
        self.assertFalse(result["commercial"]["ok"])
        self.assertFalse(result["sources"]["ok"])
        self.assertTrue(result["availability"]["ok"])

    def test_command_failure_never_exposes_diagnostics(self):
        def fail(*args, **kwargs):
            raise RuntimeError("private password or host path")
        result = self.collect(run=fail)
        self.assertEqual(result["preparation"]["status"], "unavailable")
        self.assertFalse(result["availability"]["ok"])
        self.assertNotIn("private", json.dumps(result))

    def test_original_public_sql_and_observer_stay_unchanged(self):
        # Frozen public query at f080ae6; private history must use another query.
        self.assertEqual(hashlib.sha256(observer.QUEUE_SQL.encode()).hexdigest(), 'bce9c0ccd6593a802e450542ef062115a2e386e1af69737e353eb892b91791b1')

    def test_private_query_failure_and_timeout_happen_after_identical_public_publication(self):
        self.queues['maps']['failed_resources'] = 1
        for failure in (RuntimeError('private diagnostic'), subprocess.TimeoutExpired('psql', 3)):
            with self.subTest(failure=type(failure).__name__):
                expected = self.collect()
                events = []; saved = []
                config = {**self.config, 'history_path': '/unused/private.sqlite3'}
                def run(arguments, **options):
                    if arguments[-1] == observer.HISTORY_JOBS_SQL:
                        events.append('private_query')
                        self.assertEqual(options['timeout'], 3)
                        raise failure
                    return self.run_command(arguments, **options)
                real_observe = observer.observe
                def actual_public(_):
                    return real_observe(config, run=run,
                        fetch=lambda url: {'db': True} if url.endswith('readyz') else self.ops,
                        now=self.now, statfs=lambda _: SimpleNamespace(f_bavail=self.free, f_frsize=1),
                        read_json=lambda _: self.backup)
                def collect(_):
                    return private_collector(config, run=run,
                        read_json=lambda _: {**self.backup, 'last_attempt_status': 'succeeded'},
                        statfs=lambda _: SimpleNamespace(f_bavail=self.free, f_frsize=1),
                        statpath=lambda _: SimpleNamespace(st_dev=1), clock=lambda: self.now.timestamp())
                with patch.object(observer.os, 'geteuid', return_value=0), \
                     patch.object(observer.os, 'stat', return_value=SimpleNamespace(st_uid=0, st_mode=0o600)), \
                     patch.object(observer.Path, 'read_text', return_value=json.dumps(config)), \
                     patch.object(observer, 'observe', side_effect=actual_public), \
                     patch.object(observer, 'write_atomic', side_effect=lambda _, doc: (events.append('publish'), saved.append(doc))), \
                     patch.object(observer, 'collect_private_sample', side_effect=collect), \
                     patch.object(observer, 'save_history') as save, \
                     patch('sys.argv', ['observer']), patch('sys.stdout'):
                    observer.main()
                self.assertEqual(events, ['publish', 'private_query'])
                self.assertEqual(saved[0]['components'], expected)
                self.assertNotIn('jobs', save.call_args.args[1])
                self.assertNotIn('private diagnostic', json.dumps(saved))


private_collector = observer.collect_private_sample


class CapacityHistoryTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory(prefix='.canquery-history-test-', dir=Path.home())
        self.addCleanup(self.directory.cleanup)
        self.path = Path(self.directory.name) / 'capacity.sqlite3'
        self.at = 1791417600
        self.sizes_calls = 0
        self.sizes = dict.fromkeys(('application_database_bytes','prepared_recorded_bytes',
            'retired_recorded_bytes','local_map_recorded_bytes','pmtiles_referenced_bytes'), 100)
        self.sizes['schema_relation_bytes'] = {'store':100,'map_store':200}
        self.output = {'generated_at':dt.datetime.fromtimestamp(self.at,dt.timezone.utc).isoformat(),
                      'components':{name:observer.healthy(True,{}) for name in observer.COMPONENTS}}

    def sample(self, offset=0, free=45, jobs=(), backup_known=True, device=1):
        at = self.at + offset
        sample = {'backup_known':backup_known,'device':device,'free_bytes':free,
                  'interval_started_at':at-.25,'jobs_observed_at':at-.15,
                  'backup_observed_at':at-.1,'filesystem_observed_at':at-.05,
                  'interval_finished_at':at,'observation_seconds':.25}
        if jobs is not None:
            sample['jobs'] = list(jobs)
        return sample

    def daily(self):
        self.sizes_calls += 1
        # Reservation must be visible to an independent connection BEFORE this callback.
        self.assertEqual(self.read('SELECT status FROM component_sizes ORDER BY at DESC LIMIT 1')[0]['status'],'reserved')
        return self.sizes

    def write(self, offset=0, free=45, jobs=(), **kwargs):
        daily = kwargs.pop('sizes',self.daily)
        observer.save_history(self.path,self.sample(offset,free,jobs,**kwargs),self.output,
                              daily_sizes=daily,owner=os.getuid())

    def read(self, sql, params=()):
        with closing(sqlite3.connect(self.path)) as db:
            db.row_factory = sqlite3.Row
            return [dict(row) for row in db.execute(sql,params)]

    def report(self, sql, offset):
        return self.read(sql,{'as_of':self.at+offset})

    def test_interval_activity_minima_and_missing_samples(self):
        job={'type':'tabular','attempt':'a'*32}; backup={'type':'backup','attempt':'b'*32}
        self.write(0,48); self.write(60,45,[job]); self.write(120,41,[job,backup]); self.write(240,46)
        rows=self.read('SELECT * FROM job_minima ORDER BY job_type')
        self.assertEqual([r['minimum_available_bytes'] for r in rows],[41,41])
        self.assertEqual([r['observed_samples'] for r in rows],[1,2])
        daily=self.report(observer.DAILY_CAPACITY_SQL,240)[-1]
        self.assertEqual(daily['maximum_within_day_gap_seconds'],120)
        self.assertEqual(daily['gaps_over_90_seconds'],1)
        self.assertEqual(daily['samples'],4)
        self.assertEqual(self.sizes_calls,1)
        self.assertEqual(self.read("SELECT minimum_available_bytes FROM activity_minima WHERE activity='backup+tabular'")[0]['minimum_available_bytes'],41)

    def test_private_deadline_kills_subprocess_group_and_closes_inherited_pipes(self):
        import time
        code = "import subprocess,sys,time; subprocess.Popen([sys.executable,'-c','import time; time.sleep(30)']); time.sleep(30)"
        started=time.monotonic()
        with self.assertRaises(subprocess.TimeoutExpired):
            observer.private_command([sys.executable,'-B','-c',code],timeout=.1)
        self.assertLess(time.monotonic()-started,2)

    def test_private_reads_are_consecutive_and_have_separate_timestamps(self):
        events=[];ticks=iter([self.at+i*.01 for i in range(20)])
        def run(args,**kwargs):
            events.append('jobs');self.assertEqual(args[-1],observer.HISTORY_JOBS_SQL)
            self.assertEqual(kwargs['timeout'],3)
            return json.dumps([{'type':'tabular','attempt':'a'*32}])
        def backup(_):
            events.append('backup');return {'last_attempt_status':'running','last_attempt_at':self.output['generated_at']}
        def fs(_):
            events.append('filesystem');return SimpleNamespace(f_bavail=45,f_frsize=1)
        sample=observer.collect_private_sample({'database_os_user':'test','database':'test'},run=run,
            read_json=backup,statfs=fs,statpath=lambda _:SimpleNamespace(st_dev=7),clock=lambda:next(ticks))
        self.assertEqual(events,['jobs','backup','filesystem'])
        names=('interval_started_at','jobs_observed_at','backup_observed_at','filesystem_observed_at','interval_finished_at')
        self.assertEqual([sample[n] for n in names],sorted(sample[n] for n in names))
        observer.save_history(self.path,sample,self.output,daily_sizes=self.daily,owner=os.getuid())
        row=self.read('SELECT * FROM samples')[0]
        self.assertEqual(row['activity'],'backup+tabular')
        self.assertEqual(row['device'],7)
        self.assertLess(row['public_generated_at'],row['interval_finished_at'])

    def test_unknown_activity_null_disk_and_filesystems_stay_separate(self):
        self.write(0,None,None);self.write(60,40,backup_known=False);self.write(120,60,device=2)
        rows=[r for r in self.report(observer.DAILY_CAPACITY_SQL,120) if r['samples']]
        self.assertEqual(rows[0]['incomplete_job_samples'],2)
        self.assertEqual(rows[0]['free_samples'],1)
        self.assertEqual(rows[1]['minimum_available_bytes'],60)
        self.assertEqual(self.read('SELECT * FROM activity_minima')[0]['device'],2)

    def test_duplicate_backward_invalid_intervals_and_jobs_are_rejected(self):
        self.write()
        for offset in (0,-60,29):
            with self.assertRaises(ValueError):self.write(offset)
        with self.assertRaises(ValueError):self.write(60,jobs=[{'type':'secret','attempt':'bad'}])
        sample=self.sample(60);sample['jobs_observed_at']=self.at+70
        with self.assertRaises(ValueError):
            observer.save_history(self.path,sample,self.output,daily_sizes=self.daily,owner=os.getuid())
        self.assertEqual(len(self.read('SELECT * FROM samples')),1)

    def test_failed_size_query_is_not_repeated_or_logged_raw(self):
        calls=[]
        def fail():calls.append(1);raise RuntimeError('secret password')
        self.write(sizes=fail);self.write(60)
        self.assertEqual(calls,[1]);self.assertEqual(self.sizes_calls,0)
        self.assertEqual(self.read('SELECT status FROM component_sizes')[0]['status'],'unavailable')
        self.assertNotIn(b'secret password',self.path.read_bytes())

    def test_reservation_write_failure_prevents_size_query(self):
        with closing(observer.open_history(self.path,self.at)) as db:
            db.execute("CREATE TRIGGER fail_reserve BEFORE INSERT ON component_sizes BEGIN SELECT RAISE(ABORT,'injected failure'); END")
        with self.assertRaises(sqlite3.IntegrityError):self.write()
        self.assertEqual(self.sizes_calls,0)
        self.assertFalse(self.read('SELECT * FROM component_sizes'))
        self.assertIsNone(self.read('SELECT last_reserved_day FROM history_state')[0]['last_reserved_day'])

    def test_reservation_commit_failure_prevents_size_query(self):
        original=observer.commit_history
        def fail(db,path):
            if db.execute("SELECT count(*) FROM component_sizes WHERE status='reserved'").fetchone()[0]:
                raise sqlite3.OperationalError('injected commit failure')
            original(db,path)
        with patch.object(observer,'commit_history',side_effect=fail):
            with self.assertRaises(sqlite3.OperationalError):self.write()
        self.assertEqual(self.sizes_calls,0)
        self.assertFalse(self.read('SELECT * FROM component_sizes'))

    def test_uncertain_reservation_commit_does_not_repeat_query(self):
        original=observer.commit_history;failed=[]
        def commit_then_fail(db,path):
            reserved=db.execute("SELECT count(*) FROM component_sizes WHERE status='reserved'").fetchone()[0]
            original(db,path)
            if reserved and not failed:
                failed.append(1);raise sqlite3.OperationalError('lost commit acknowledgement')
        with patch.object(observer,'commit_history',side_effect=commit_then_fail):
            with self.assertRaises(sqlite3.OperationalError):self.write()
        self.assertEqual(self.sizes_calls,0)
        self.assertEqual(self.read('SELECT status FROM component_sizes')[0]['status'],'reserved')
        self.write(60);self.assertEqual(self.sizes_calls,0)

    def test_result_write_failure_preserves_reservation_across_restart_and_new_day(self):
        with closing(observer.open_history(self.path,self.at)) as db:
            db.execute("CREATE TRIGGER fail_result BEFORE UPDATE ON component_sizes BEGIN SELECT RAISE(ABORT,'injected failure'); END")
        with self.assertRaises(sqlite3.IntegrityError):self.write()
        self.assertEqual(self.sizes_calls,1)
        self.assertEqual(self.read('SELECT status FROM component_sizes')[0]['status'],'reserved')
        self.write(60);self.assertEqual(self.sizes_calls,1)
        with closing(sqlite3.connect(self.path)) as db:db.execute('DROP TRIGGER fail_result')
        self.write(86400);self.assertEqual(self.sizes_calls,2)
        self.assertEqual([r['status'] for r in self.read('SELECT status FROM component_sizes ORDER BY day')],['reserved','ok'])

    def test_result_commit_failure_preserves_previous_durable_reservation(self):
        original=observer.commit_history
        def fail(db,path):
            if db.execute("SELECT count(*) FROM component_sizes WHERE status='ok'").fetchone()[0]:
                raise sqlite3.OperationalError('injected result commit failure')
            original(db,path)
        with patch.object(observer,'commit_history',side_effect=fail):
            with self.assertRaises(sqlite3.OperationalError):self.write()
        self.assertEqual(self.read('SELECT status FROM component_sizes')[0]['status'],'reserved')
        self.write(60);self.assertEqual(self.sizes_calls,1)

    def test_process_exit_after_reservation_consumes_attempt(self):
        code="""
import importlib.util,os,sys
from pathlib import Path
spec=importlib.util.spec_from_file_location('observer',sys.argv[1]);m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
p=Path(sys.argv[2]);db=m.open_history(p,int(sys.argv[3]))
m.reserve_daily_attempt(db,p,int(sys.argv[3]))
os._exit(23)
"""
        result=subprocess.run([sys.executable,'-B','-c',code,str(Path(observer.__file__)),str(self.path),str(self.at)],
                              capture_output=True,text=True,timeout=10)
        self.assertEqual(result.returncode,23,result.stderr)
        self.write(60);self.assertEqual(self.sizes_calls,0)
        self.write(86400);self.assertEqual(self.sizes_calls,1)

    def test_competing_collectors_only_one_reserves(self):
        from concurrent.futures import ThreadPoolExecutor
        from threading import Barrier
        with closing(observer.open_history(self.path,self.at)):pass
        barrier=Barrier(2)
        def reserve():
            with closing(observer.open_history(self.path,self.at)) as db:
                barrier.wait(timeout=5)
                return observer.reserve_daily_attempt(db,self.path,self.at)
        with ThreadPoolExecutor(max_workers=2) as pool:
            results=list(pool.map(lambda _:reserve(),range(2)))
        self.assertEqual(sum(v is not None for v in results),1)

    def test_daily_clock_rollback_and_midnight_boundary(self):
        self.write();self.write(31*86400)
        with closing(observer.open_history(self.path,self.at+31*86400)) as db:
            self.assertIsNone(observer.reserve_daily_attempt(db,self.path,self.at))
            # Day 31 was already reserved; use a genuinely new day that changes after commit.
            ticks=iter([self.at+33*86400-1,self.at+33*86400])
            observer.collect_daily_sizes(db,self.path,self.daily,lambda:next(ticks))
        self.assertEqual(self.sizes_calls,2)
        self.assertEqual(self.read('SELECT status FROM component_sizes ORDER BY day DESC')[0]['status'],'reserved')
        self.write(33*86400);self.assertEqual(self.sizes_calls,3)

    def test_zero_sample_days_freshness_and_component_counts(self):
        self.write();self.write(2*86400)
        rows=self.report(observer.DAILY_CAPACITY_SQL,2*86400+181)
        self.assertEqual(len(rows),30)
        missing=rows[-2]
        self.assertEqual(missing['samples'],0);self.assertIsNone(missing['minimum_available_bytes'])
        self.assertEqual(missing['coverage_status'],'no_samples')
        self.assertEqual(missing['maximum_within_day_gap_seconds'],86400)
        self.assertEqual(rows[0]['coverage_status'],'before_collection')
        components=self.report(observer.DAILY_COMPONENTS_SQL,2*86400+181)
        empty=[r for r in components if r['day']==missing['day']]
        self.assertEqual(len(empty),len(observer.COMPONENTS))
        self.assertTrue(all(r['samples']==r['ok_samples']==r['degraded_samples']==r['unavailable_samples']==0 for r in empty))
        status=self.report(observer.HISTORY_STATUS_SQL,2*86400+181)[0]
        self.assertEqual(status['freshness'],'stale');self.assertEqual(status['latest_sample_age_seconds'],181)
        self.assertEqual(self.report(observer.HISTORY_STATUS_SQL,2*86400+180)[0]['freshness'],'fresh')
        self.assertEqual(self.report(observer.HISTORY_STATUS_SQL,2*86400-1)[0]['freshness'],'clock_error')

    def test_empty_history_and_incompatible_prior_schema(self):
        with closing(observer.open_history(self.path,self.at)):pass
        self.assertEqual(self.report(observer.HISTORY_STATUS_SQL,0)[0]['freshness'],'missing')
        self.assertEqual(len(self.report(observer.DAILY_CAPACITY_SQL,0)),30)
        old=Path(self.directory.name)/'old.sqlite3'
        with closing(sqlite3.connect(old)) as db:db.execute('CREATE TABLE samples(at INTEGER)')
        os.chmod(old,0o600)
        with self.assertRaises(ValueError):observer.open_history(old,self.at)
        with closing(sqlite3.connect(old)) as db:
            self.assertEqual(db.execute('PRAGMA table_info(samples)').fetchall()[0][1],'at')

    def test_retention_is_bounded_and_daily_control_is_preserved(self):
        self.write();self.write(86400);self.write(31*86400+60)
        self.assertEqual(len(self.read('SELECT * FROM samples')),1)
        self.assertEqual(self.sizes_calls,3)
        self.assertEqual(self.read('SELECT removed_samples FROM history_state')[0]['removed_samples'],2)
        self.assertEqual(len(self.read('SELECT * FROM component_sizes')),2)

    def test_full_database_trims_oldest_and_continues_collecting_with_journal_accounted(self):
        # Real 64 MiB cap; large but valid job arrays reach it within <30 days.
        self.write()
        jobs=[{'type':'tabular','attempt':format(n,'032x')} for n in range(100)]
        latest=self.at
        with closing(observer.open_history(self.path,self.at)) as db:
            template=list(db.execute('SELECT * FROM samples').fetchone());template[3]=json.dumps(jobs)
            template[5]='+'.join(['tabular']*100)
            db.execute('BEGIN IMMEDIATE')
            while observer.available_history_pages(db)>64:
                latest+=60;template[0]=latest
                db.execute('INSERT INTO samples VALUES('+','.join('?' for _ in template)+')',template)
            observer.commit_history(db,self.path)
            observer.reserve_daily_attempt(db,self.path,latest)
        self.assertGreater(self.path.stat().st_size,63*1024**2)
        observed=[];real_commit=observer.commit_history
        def measure(db,target):
            footprint=observer.history_footprint(target);observed.append(footprint)
            real_commit(db,target)
        with patch.object(observer,'commit_history',side_effect=measure):
            for index in range(6):
                self.write(latest-self.at+60*(index+1),jobs=jobs)
        state=self.read('SELECT * FROM history_state')[0]
        self.assertGreater(state['removed_samples'],0)
        self.assertLessEqual(state['removed_samples'],6*observer.HISTORY_TRIM_BATCHES*observer.HISTORY_TRIM_BATCH)
        self.assertEqual(self.read('SELECT max(at) AS at FROM samples')[0]['at'],latest+360)
        self.assertLessEqual(self.path.stat().st_size,64*1024**2)
        self.assertGreater(max(v['journal_bytes'] for v in observed),0)
        self.assertLessEqual(max(v['total_bytes'] for v in observed),130*1024**2)
        self.assertTrue(any(v['total_bytes']>v['database_bytes'] for v in observed))
        self.assertGreater(state['peak_journal_bytes'],0)
        self.assertTrue(any(r['coverage_status']=='shortened_retention' for r in self.report(observer.DAILY_CAPACITY_SQL,latest-self.at+360)))
        self.assertEqual(self.sizes_calls,1)
        self.assertEqual(self.read('SELECT status FROM component_sizes ORDER BY day DESC')[0]['status'],'reserved')
        print('\nCAPACITY_FOOTPRINT '+json.dumps({'database_ceiling_bytes':64*1024**2,
              'observed_peak_total_bytes':max(v['total_bytes'] for v in observed),
              'observed_peak_journal_bytes':max(v['journal_bytes'] for v in observed),
              'observed_peak_allocated_bytes':max(v['allocated_bytes'] for v in observed),
              'removed_samples':state['removed_samples']}))

    def test_trim_receipt_failure_rolls_back_removal(self):
        self.write()
        with closing(observer.open_history(self.path,self.at)) as db:
            db.execute("CREATE TRIGGER fail_trim BEFORE INSERT ON retention_days BEGIN SELECT RAISE(ABORT,'injected failure'); END")
            with self.assertRaises(sqlite3.IntegrityError):
                observer.trim_history(db,self.path,self.at+60,[4],force=True)
        self.assertEqual(len(self.read('SELECT * FROM samples')),1)
        self.assertEqual(self.read('SELECT removed_samples FROM history_state')[0]['removed_samples'],0)

    def test_sqlite_full_retry_is_bounded(self):
        self.write();original=observer.history_transaction;raised=[]
        from contextlib import contextmanager
        @contextmanager
        def full_once(db,target):
            with original(db,target):
                yield
                if db.execute('SELECT count(*) FROM samples').fetchone()[0]>1 and not raised:
                    raised.append(1);e=sqlite3.OperationalError('injected full');e.sqlite_errorcode=sqlite3.SQLITE_FULL;raise e
        with patch.object(observer,'history_transaction',side_effect=full_once):self.write(60)
        self.assertEqual(raised,[1]);self.assertEqual(self.read('SELECT max(at) AS at FROM samples')[0]['at'],self.at+60)
        self.assertEqual(self.sizes_calls,1)

    def test_private_modes_symlinks_lock_and_allowlist(self):
        self.write();self.assertEqual(self.path.stat().st_mode&0o777,0o600)
        alias=Path(self.directory.name)/'alias';alias.symlink_to(self.path)
        with self.assertRaises(ValueError):observer.history_path(alias,owner=os.getuid())
        with closing(sqlite3.connect(self.path)) as db:
            db.execute('BEGIN EXCLUSIVE')
            with self.assertRaises(sqlite3.OperationalError):self.write(60)
            db.rollback()
        self.sizes['password']='secret';self.sizes['schema_relation_bytes']['customer']=1
        self.write(86400)
        data=self.read('SELECT measurements FROM component_sizes ORDER BY at DESC')[0]['measurements']
        self.assertNotIn('secret',data);self.assertNotIn('customer',data)
        self.sizes['local_map_recorded_bytes']=float('nan');self.write(2*86400)
        self.assertEqual(self.read('SELECT status FROM component_sizes ORDER BY at DESC')[0]['status'],'unavailable')
        os.chmod(self.path,0o644)
        with self.assertRaises(ValueError):observer.history_path(self.path,owner=os.getuid())


if __name__=='__main__':
    unittest.main()
