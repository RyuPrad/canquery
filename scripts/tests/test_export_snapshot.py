import hashlib
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest

spec = importlib.util.spec_from_file_location("export_snapshot", Path(__file__).parents[1] / "export-snapshot.py")
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
TOKEN = "cqs1_" + "a" * 64


class FakeClient:
    origin = "https://canquery.test"

    def __init__(self, total=3, export_limit=10000, offset=10000):
        self.total, self.export_limit, self.offset = total, export_limit, offset
        self.calls, self.requests = [], []
        self.fail_page = False
        self.change_provenance = False

    def get(self, path, params=None):
        self.calls.append(params)
        if not path.endswith("/query"):
            return {"data": {"query_mode": "ingested", "ingestion": {"snapshot_id": TOKEN}}}
        if len(self.calls) > 2 and self.fail_page:
            raise module.ExportError("interrupted stream")
        provenance = {"sources": [{"id": "source" if len(self.calls) <= 2 or not self.change_provenance else "changed"}]}
        return {"meta": {"query_mode": "ingested", "snapshot": {"id": TOKEN, "prepared_at": None,
                            "source_metadata_version": None}, "provenance": provenance,
                         "limits": {"max_page_rows": 100, "max_offset": self.offset, "export_max_rows": self.export_limit}},
                "data": {"fields": [{"id": "code", "type": "TEXT"}, {"id": "value", "type": "TEXT"}],
                         "total": self.total,
                         "records": [{"code": "00123", "value": [None, "", 0][i % 3]}
                                     for i in range(params["offset"], min(self.total, params["offset"] + params["limit"]))]}}


class ExportTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.output = Path(self.tmp.name) / "report"

    def test_complete_manifest_preserves_null_empty_zero_and_identifier(self):
        result = module.export(FakeClient(), "resource", self.output)
        content = (self.output / "data.jsonl").read_bytes()
        records = [json.loads(line) for line in content.splitlines()]
        self.assertEqual([r["value"] for r in records], [None, "", 0])
        self.assertTrue(all(r["code"] == "00123" for r in records))
        self.assertEqual(result["output"]["sha256"], hashlib.sha256(content).hexdigest())
        self.assertTrue(result["complete"])
        self.assertEqual((self.output.stat().st_mode & 0o777), 0o700)

    def test_empty_snapshot_is_complete(self):
        result = module.export(FakeClient(total=0), "resource", self.output)
        self.assertTrue(result["complete"])
        self.assertEqual((self.output / "data.jsonl").read_bytes(), b"")

    def test_over_limit_requires_explicit_truncation(self):
        with self.assertRaises(module.ExportError):
            module.export(FakeClient(total=4, export_limit=3), "resource", self.output)
        self.assertFalse(self.output.exists())
        result = module.export(FakeClient(total=4, export_limit=3), "resource", self.output, allow_truncated=True)
        self.assertFalse(result["complete"])
        self.assertEqual(result["returned"], 3)

    def test_lowered_offset_limit_allows_valid_final_page(self):
        client = FakeClient(total=150, offset=50)
        result = module.export(client, "resource", self.output)
        self.assertEqual([(c["offset"], c["limit"]) for c in client.calls[2:]], [(0, 50), (50, 100)])
        self.assertTrue(result["complete"])

    def test_failure_or_provenance_drift_publishes_no_report(self):
        for attr in ["fail_page", "change_provenance"]:
            client = FakeClient()
            setattr(client, attr, True)
            with self.assertRaises(module.ExportError):
                module.export(client, "resource", self.output)
            self.assertFalse(self.output.exists())

    def test_does_not_overwrite_existing_reports(self):
        self.output.mkdir()
        marker = self.output / "keep"
        marker.write_text("existing")
        with self.assertRaises(module.ExportError):
            module.export(FakeClient(), "resource", self.output)
        self.assertEqual(marker.read_text(), "existing")

    def test_origin_validation_prevents_credentials_and_nonlocal_http(self):
        for origin in ["https://user:secret@example.test", "http://example.test", "https://example.test/path"]:
            with self.assertRaises(module.ExportError):
                module.Client(origin)


if __name__ == "__main__":
    unittest.main()
