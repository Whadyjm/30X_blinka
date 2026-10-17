import hashlib
import importlib.util
import io
import json
from pathlib import Path
import unittest
from unittest.mock import patch
from urllib.error import HTTPError


spec = importlib.util.spec_from_file_location("r2_sync", Path(__file__).parents[1] / "sync-invoice-fixtures-r2.py")
sync_module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(sync_module)


class R2FixturesTest(unittest.TestCase):
    def test_manifest_pins_tiamat_and_separates_documents_from_answers(self):
        manifest = sync_module.build_manifest()
        self.assertEqual(manifest["accountId"], "fbaa64f96579f93b2db32a1eb12ff6c9")
        self.assertIn("tiamat.agency", manifest["accountName"].lower())
        self.assertEqual(manifest["bucket"], "oli-invoice-tests")
        self.assertEqual(len(manifest["objects"]), 63)
        documents = [item for item in manifest["objects"] if item["key"].startswith(manifest["extractorInputPrefix"])]
        self.assertEqual(len(documents), 60)
        self.assertTrue(all(item["contentType"] in ["application/pdf", "image/png"] for item in documents))
        for item in manifest["objects"]:
            data = (sync_module.FIXTURES / item["source"]).read_bytes()
            self.assertEqual(hashlib.sha256(data).hexdigest(), item["sha256"])

    def fake_r2(self, public=False, initial=None):
        self.remote = dict(initial or {})
        self.writes = []

        def urlopen(request, timeout):
            route = request.full_url
            if route.endswith("/domains/managed"):
                return io.BytesIO(json.dumps({"result": {"enabled": public}}).encode())
            if route.endswith("/domains/custom"):
                return io.BytesIO(b'{"result":{"domains":[]}}')
            key = route.split("/objects/", 1)[1]
            if request.get_method() == "PUT":
                self.writes.append(key)
                self.remote[key] = request.data
                return io.BytesIO(b'{"success":true}')
            if key not in self.remote:
                raise HTTPError(route, 404, "Not found", {}, None)
            return io.BytesIO(self.remote[key])

        return urlopen

    def test_upload_verifies_downloaded_bytes_and_retry_does_not_rewrite(self):
        manifest = sync_module.build_manifest()
        with patch.dict("os.environ", {"CLOUDFLARE_API_TOKEN": "synthetic-test-token"}), \
                patch.object(sync_module.urllib.request, "urlopen", self.fake_r2()), \
                patch.object(sync_module, "write_json") as save:
            sync_module.sync(manifest)
            self.assertEqual(len(self.writes), 64)
            receipt = save.call_args.args[1]
            self.assertEqual(receipt["verification"], "DOWNLOADED_SHA256")
            self.assertEqual(len(receipt["objects"]), 64)
            sync_module.sync(manifest)
            self.assertEqual(len(self.writes), 64)

    def test_public_bucket_is_rejected_before_any_upload(self):
        with patch.dict("os.environ", {"CLOUDFLARE_API_TOKEN": "synthetic-test-token"}), \
                patch.object(sync_module.urllib.request, "urlopen", self.fake_r2(public=True)):
            with self.assertRaisesRegex(ValueError, "acceso público"):
                sync_module.sync(sync_module.build_manifest())
        self.assertEqual(self.writes, [])

    def test_conflicting_existing_version_is_never_overwritten(self):
        manifest = sync_module.build_manifest()
        initial = {manifest["objects"][-1]["key"]: b"different-existing-version"}
        with patch.dict("os.environ", {"CLOUDFLARE_API_TOKEN": "synthetic-test-token"}), \
                patch.object(sync_module.urllib.request, "urlopen", self.fake_r2(initial=initial)):
            with self.assertRaisesRegex(ValueError, "contenido distinto"):
                sync_module.sync(manifest)
        self.assertEqual(self.writes, [])
        self.assertEqual(self.remote, initial)


if __name__ == "__main__":
    unittest.main()
