"""Temporary DB only: real persistence, timezone boundaries, source revisions and limits."""
import tempfile
import unittest
from datetime import datetime, timezone
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor
from app.config import UpstreamSource
from app.stats import RequestStats


class StatsContracts(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.path = Path(self.tmp.name) / 'stats.sqlite3'
        self.store = RequestStats(self.path)
        self.sources = [UpstreamSource(id='a', name='A', url='http://a.test/?token=private', headers={'X-API-Key':'private'}),
                        UpstreamSource(id='b', name='B', url='http://b.test/')]
        self.now = datetime(2026, 11, 6, 12, 0, tzinfo=timezone.utc).timestamp()

    def tearDown(self):
        self.tmp.cleanup()

    def record(self, flags=(True, True), at=None, latency=100):
        results = [dict(id=s.id, name=s.name, success=flag, status_code=200 if flag else 503,
                        count=2 if flag else 0, latency_ms=50,
                        error='secret raw URL') for s, flag in zip(self.sources, flags)]
        self.store.record('test', '<img src=x>', self.sources, results, 2 if any(flags) else 0, latency,
                          self.now if at is None else at)

    def overview(self, **kwargs):
        return self.store.overview(self.sources, now=self.now, **kwargs)

    def test_outcomes_and_dedup(self):
        for flags, latency in [((True, True),100), ((True, False),300), ((False,False),500)]:
            self.record(flags, latency=latency)
        data = self.overview()
        s = data['summary']
        self.assertEqual((s['requests'],s['complete'],s['partial'],s['failed']), (3,1,1,1))
        self.assertEqual((s['success_rate'],s['average_ms'],s['p95_ms']), (33.3,300,500))
        self.assertEqual((s['raw_count'],s['unique_count'],s['duplicate_count']), (6,4,2))
        public = str(data)
        for secret in ['private', 'secret raw URL', "'key':"]:
            self.assertNotIn(secret, public)

    def test_timezone_boundary_and_week(self):
        # Nov 5 16:00 UTC is Nov 6 midnight UTC+8.
        midnight = self.now - 20*3600
        self.record(at=midnight-1)
        self.record(at=midnight)
        today = self.overview()
        self.assertEqual(today['summary']['requests'], 1)
        self.assertEqual(today['buckets'][0]['requests'],1)
        week = self.overview(window='week')
        self.assertEqual(week['summary']['requests'],2)
        self.assertEqual(week['buckets'][-2]['requests'],1)
        self.assertEqual(week['buckets'][-1]['requests'],1)

    def test_restart_and_configuration_invalidation(self):
        self.record()
        self.store = RequestStats(self.path)
        self.assertIsNotNone(self.overview()['sources']['a']['last'])
        self.sources[0].timeout = 20
        data = self.overview()
        self.assertIsNone(data['sources']['a']['last'])
        self.assertEqual(data['summary']['requests'],1)
        self.assertIsNotNone(data['sources']['b']['last'])

    def test_reverted_configuration_does_not_revive_inflight_result(self):
        old_sources = [s.model_copy(deep=True) for s in self.sources]
        self.sources[0].config_revision = 'changed-and-reverted'
        results = [dict(id=s.id,name=s.name,success=True,status_code=200,count=1,latency_ms=20) for s in old_sources]
        self.store.record('test','old in-flight',old_sources,results,1,20,self.now)
        self.assertIsNone(self.overview()['sources']['a']['last'])
        self.assertEqual(self.overview()['summary']['requests'],1)

    def test_empty_does_not_claim_availability(self):
        data = self.overview()
        self.assertIsNone(data['summary']['success_rate'])
        self.assertIsNone(data['summary']['average_ms'])
        self.assertEqual(data['requests'],[])
        self.assertIsNone(data['sources']['a']['last'])
        self.store.record('api','',[],[],0,0,at=self.now)
        self.assertEqual(self.overview()['summary']['requests'],0)

    def test_pagination_and_errors_filter(self):
        for i in range(24): self.record(flags=(True, i%2==0))
        first = self.overview()
        second = self.overview(before=first['next_before'])
        self.assertEqual(len(first['requests']),20)
        self.assertEqual(len(second['requests']),4)
        self.assertFalse(set(r['id'] for r in first['requests']) & set(r['id'] for r in second['requests']))
        self.assertEqual(len(self.overview(errors_only=True)['requests']),12)
        self.assertEqual(self.overview(errors_only=True)['summary']['requests'],24)

    def test_retention_cap_and_concurrent_writes(self):
        self.store.max_records = 10
        with ThreadPoolExecutor(max_workers=4) as pool:
            list(pool.map(lambda _: self.record(), range(16)))
        self.assertEqual(self.overview()['summary']['requests'],10)
        self.record(at=self.now + 31*86400)
        self.assertEqual(self.store.overview(self.sources, now=self.now+31*86400)['summary']['requests'],1)

    def test_save_failure_isolated(self):
        self.store.path = Path('/dev/null/no-directory/stats.db')
        self.record()
        self.assertTrue(self.store.write_error)


if __name__ == '__main__':
    unittest.main(verbosity=2)
