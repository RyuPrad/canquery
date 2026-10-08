#!/usr/bin/env python3
"""Retain a bounded CanQuery snapshot extraction; Python standard library only."""
import argparse
import datetime as dt
import email.utils
import hashlib
import http.client
import json
import os
from pathlib import Path
import re
import shutil
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

SNAPSHOT = re.compile(r"cqs1_[0-9a-f]{64}\Z")
QUERY_KEYS = {"q", "filters", "sort", "group_by", "agg", "agg_column", "bucket"}
MAX_RESPONSE_BYTES = 32 * 1024 * 1024
MAX_OUTPUT_BYTES = 256 * 1024 * 1024


class ExportError(Exception):
    pass


def utc_now():
    return dt.datetime.now(dt.timezone.utc).isoformat().replace("+00:00", "Z")


def decode_json(value):
    def invalid(_value):
        raise ExportError("Nonfinite JSON number in API response")
    try:
        return json.loads(value, parse_constant=invalid)
    except (ValueError, UnicodeError) as error:
        raise ExportError("Malformed JSON response") from error


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


class Client:
    def __init__(self, origin, key=None):
        parsed = urllib.parse.urlsplit(origin)
        local = parsed.hostname in {"localhost", "127.0.0.1", "::1"}
        if (not parsed.netloc or parsed.username or parsed.password or parsed.query or parsed.fragment
                or parsed.path not in {"", "/"} or parsed.scheme not in {"http", "https"}
                or (parsed.scheme != "https" and not local)):
            raise ExportError("Use an HTTPS origin, or HTTP localhost for local fixtures")
        self.origin = origin.rstrip("/")
        self.key = key
        self.deadline = time.monotonic() + 1800
        self.requests = []
        self.opener = urllib.request.build_opener(NoRedirect())

    def get(self, path, params=None):
        params = params or {}
        encoded = {k: json.dumps(v, ensure_ascii=False, separators=(",", ":")) if k == "filters" else v
                   for k, v in params.items() if v is not None}
        url = self.origin + path + ("?" + urllib.parse.urlencode(encoded) if encoded else "")
        headers = {"Accept": "application/json", "User-Agent": "canquery-snapshot-export/1"}
        if self.key:
            headers["Authorization"] = "Bearer " + self.key
        for attempt in range(4):
            remaining = self.deadline - time.monotonic()
            if remaining <= 0:
                raise ExportError("Extraction deadline exceeded; no completed report was published")
            try:
                request = urllib.request.Request(url, headers=headers)
                with self.opener.open(request, timeout=min(120, remaining)) as response:
                    self.requests.append({"request_id": response.headers.get("X-Request-Id"), "status": response.status})
                    if "application/json" not in response.headers.get("Content-Type", "").lower():
                        raise ExportError("Expected a JSON API response")
                    data = bytearray()
                    while True:
                        if time.monotonic() >= self.deadline:
                            raise ExportError("Extraction deadline exceeded")
                        chunk = response.read(min(65536, MAX_RESPONSE_BYTES + 1 - len(data)))
                        if not chunk:
                            break
                        data.extend(chunk)
                        if len(data) > MAX_RESPONSE_BYTES:
                            raise ExportError("A response exceeds the 32 MiB safety limit; narrow the query")
                    envelope = decode_json(data)
                    if not isinstance(envelope, dict) or not isinstance(envelope.get("meta"), dict) or "data" not in envelope:
                        raise ExportError("Malformed CanQuery response envelope")
                    return envelope
            except urllib.error.HTTPError as error:
                self.requests.append({"request_id": error.headers.get("X-Request-Id"), "status": error.code})
                if error.code == 409:
                    raise ExportError("Snapshot unavailable: start a new extraction explicitly") from error
                if error.code not in {429, 502, 503, 504} or attempt == 3:
                    raise ExportError("API request failed with HTTP " + str(error.code)) from error
                retry = error.headers.get("Retry-After")
                try:
                    delay = max(0, float(retry)) if retry else 2 ** attempt
                except ValueError:
                    try:
                        retry_at = email.utils.parsedate_to_datetime(retry)
                        delay = max(0, (retry_at - dt.datetime.now(dt.timezone.utc)).total_seconds())
                    except (TypeError, ValueError, OverflowError):
                        delay = 2 ** attempt
            except (urllib.error.URLError, TimeoutError, ConnectionError, http.client.HTTPException) as error:
                if attempt == 3:
                    raise ExportError("Network request failed; no completed report was published") from error
                delay = 2 ** attempt
            if delay > self.deadline - time.monotonic():
                raise ExportError("Retry-After exceeds the extraction deadline; retry later")
            time.sleep(delay)
        raise ExportError("Request retry limit reached")


def integer(value, label):
    if isinstance(value, bool) or not isinstance(value, int) or value < 0:
        raise ExportError("Invalid " + label + " in API response")
    return value


def query_page(envelope, snapshot_id):
    data, meta = envelope.get("data"), envelope.get("meta", {})
    if not isinstance(data, dict) or meta.get("query_mode") != "ingested":
        raise ExportError("The report requires a prepared local snapshot")
    snapshot = meta.get("snapshot")
    if not isinstance(snapshot, dict) or snapshot.get("id") != snapshot_id:
        raise ExportError("The API returned a different snapshot")
    fields, records = data.get("fields"), data.get("records")
    if not isinstance(fields, list) or not all(isinstance(f, dict) and isinstance(f.get("id"), str)
                                             and isinstance(f.get("type"), str) for f in fields):
        raise ExportError("Invalid returned field schema")
    ids = [field["id"] for field in fields]
    if len(ids) != len(set(ids)) or not isinstance(records, list):
        raise ExportError("Invalid field identities or row collection")
    if not all(isinstance(record, dict) and set(record) == set(ids) for record in records):
        raise ExportError("A record does not match the returned field schema")
    return data, meta, integer(data.get("total"), "total")


def page_sizes(total, maximum_offset, page_limit):
    offset = 0
    while offset < total:
        remaining = total - offset
        limit = remaining if remaining <= page_limit else min(page_limit, maximum_offset - offset)
        if limit <= 0 or offset > maximum_offset:
            raise ExportError("Output exceeds the installed pagination bounds")
        yield offset, limit
        offset += limit


def export(client, resource, output, query=None, allow_truncated=False):
    query = dict(query or {})
    if set(query) - QUERY_KEYS:
        raise ExportError("Unsupported query options: use search, filters, sort or aggregation options only")
    if "filters" in query and not isinstance(query["filters"], dict):
        raise ExportError("filters must be a JSON object")
    query.setdefault("sort", "key asc" if query.get("agg") else "_id asc")
    output = Path(output)
    if output.exists():
        raise ExportError("Output already exists; choose a new report directory")
    started = utc_now()
    path = "/api/v1/resources/" + urllib.parse.quote(resource, safe="")
    metadata = client.get(path)["data"]
    if not isinstance(metadata, dict) or metadata.get("query_mode") != "ingested":
        raise ExportError("Prepare this resource explicitly before exporting; this helper never admits jobs")
    snapshot_id = (metadata.get("ingestion") or {}).get("snapshot_id")
    if not isinstance(snapshot_id, str) or not SNAPSHOT.fullmatch(snapshot_id):
        raise ExportError("The server did not supply a valid local snapshot identifier")
    params = {**query, "snapshot": snapshot_id}
    probe = client.get(path + "/query", {**params, "offset": 0, "limit": 1})
    data, meta, total = query_page(probe, snapshot_id)
    limits = meta.get("limits", {})
    page_limit = min(100, integer(limits.get("max_page_rows"), "page limit"))
    maximum_offset = integer(limits.get("max_offset"), "offset limit")
    export_limit = min(10000, integer(limits.get("export_max_rows"), "export limit"))
    if not page_limit or not export_limit:
        raise ExportError("Invalid zero page/export limit")
    effective = min(export_limit, maximum_offset + page_limit)
    if total > effective and not allow_truncated:
        raise ExportError("The filtered result exceeds the retained-output limit; narrow the query or explicitly use --allow-truncated")
    target = min(total, effective)
    output.mkdir(mode=0o700)  # Exclusive reservation: never overwrite an earlier report.
    try:
        partial = output / "data.jsonl.partial"
        digest = hashlib.sha256()
        written = 0
        count = 0
        with partial.open("xb") as stream:
            os.chmod(partial, 0o600)
            for offset, limit in page_sizes(target, maximum_offset, page_limit):
                page = client.get(path + "/query", {**params, "offset": offset, "limit": limit})
                current, current_meta, current_total = query_page(page, snapshot_id)
                if (current_total != total or current["fields"] != data["fields"]
                        or current_meta.get("provenance") != meta.get("provenance")):
                    raise ExportError("Schema, count or observed provenance changed during extraction")
                if len(current["records"]) != limit:
                    raise ExportError("An incomplete page was returned; no completed report was published")
                for record in current["records"]:
                    line = (json.dumps(record, ensure_ascii=False, separators=(",", ":"), allow_nan=False) + "\n").encode("utf-8")
                    written += len(line)
                    if written > MAX_OUTPUT_BYTES:
                        raise ExportError("Output exceeds the 256 MiB safety limit; narrow the query")
                    digest.update(line)
                    stream.write(line)
                    count += 1
            stream.flush()
            os.fsync(stream.fileno())
        if count != target:
            raise ExportError("Output count did not match the planned extract")
        manifest = {"manifest_version": 1, "resource_id": resource, "api_origin": client.origin,
                    "query": query, "fields": data["fields"], "snapshot": meta["snapshot"],
                    "publisher_modified_at_observed": meta.get("publisher_modified_at"),
                    "provenance_observed_at": meta.get("retrieved_at"), "provenance": meta.get("provenance"),
                    "retrieval_started_at": started, "retrieval_finished_at": utc_now(),
                    "content_verification": {"status": "not_recorded"},
                    "total": total, "returned": count, "count_unit": "groups" if query.get("agg") else "rows",
                    "limits": limits, "effective_row_limit": effective, "complete": count == total,
                    "truncation_reason": None if count == total else "retained_output_limit",
                    "output": {"file": "data.jsonl", "media_type": "application/x-ndjson", "bytes": written,
                               "sha256": digest.hexdigest()}, "requests": client.requests}
        manifest_partial = output / "manifest.json.partial"
        with manifest_partial.open("x", encoding="utf-8") as stream:
            os.chmod(manifest_partial, 0o600)
            json.dump(manifest, stream, ensure_ascii=False, indent=2, allow_nan=False)
            stream.write("\n")
            stream.flush()
            os.fsync(stream.fileno())
        partial.rename(output / "data.jsonl")
        manifest_partial.rename(output / "manifest.json")
        directory = os.open(output, os.O_RDONLY)
        try:
            os.fsync(directory)
        finally:
            os.close(directory)
        return manifest
    except BaseException:
        # This directory was created exclusively by this invocation.
        shutil.rmtree(output)
        raise


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("resource_id")
    parser.add_argument("output_directory")
    parser.add_argument("--query-file", type=Path, help="JSON file containing supported query parameters")
    parser.add_argument("--origin", default="https://canquery.com")
    parser.add_argument("--allow-truncated", action="store_true")
    args = parser.parse_args()
    try:
        query = decode_json(args.query_file.read_bytes()) if args.query_file else {}
        if not isinstance(query, dict):
            raise ExportError("Query file must contain a JSON object")
        result = export(Client(args.origin, os.environ.get("CANQUERY_API_KEY")), args.resource_id,
                        args.output_directory, query, args.allow_truncated)
        print("Retained", result["returned"], result["count_unit"], "(complete=" + str(result["complete"]).lower() + ")")
    except (ExportError, OSError, ValueError) as error:
        print("Export failed:", error, file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
