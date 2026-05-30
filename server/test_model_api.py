import unittest

from fastapi.testclient import TestClient

import main


class ModelApiRemovalTest(unittest.TestCase):
    def test_model_management_routes_are_removed(self):
        app = main.create_app(preload_model=lambda: None, exit_scheduler=lambda _code: None)
        with TestClient(app) as client:
            response = client.get("/models")
            download_response = client.post("/models/sensevoice-small/download")
            cancel_response = client.post("/models/sensevoice-small/cancel")
            delete_response = client.delete("/models/sensevoice-small")
            select_response = client.post("/models/sensevoice-small/select")

        self.assertEqual(response.status_code, 404)
        self.assertEqual(download_response.status_code, 404)
        self.assertEqual(cancel_response.status_code, 404)
        self.assertEqual(delete_response.status_code, 404)
        self.assertEqual(select_response.status_code, 404)


if __name__ == "__main__":
    unittest.main()
